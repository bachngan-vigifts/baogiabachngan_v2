import { registerHomeTasks } from './home.ts';
import { stockTransfers } from '../../inventory/schema.ts';
import { receivingReminderTasks, RECEIVING_REMINDER_PREFIX } from './receiving-reminders.ts';
import { registerAccountingTaskRoutes } from './accounting-routes.ts';
import { accountingKind, canUseAccountingTasks, sourceManaged, sourceCompletionHelp } from '../domain/accounting.ts';
import { and, asc, desc, eq, inArray, isNull, like, notInArray, or, sql, type SQL } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees, positionPermissions } from '../../staff/schema.ts';
import { sha256Hex } from '../../staff/domain/session.ts';
import { can, type PermissionMember } from '../../staff/domain/permissions.ts';
import { vietnamDate } from '../../sales/domain/sales.ts';
import { notify, notifyMany } from '../../notifications/api/routes.ts';
import { quoteSaveHooks } from '../../quotes/api/routes.ts';
import { taskComments, tasks } from '../schema.ts';
import { RULES, reconcileAutoTasks, reconcileTaskSet, transferTasks } from './auto-tasks.ts';
import { invoiceTasks } from './invoice-tasks.ts';
import type { InvoiceTaskRef } from '../../sales/api/invoice-task-hooks.ts';
import { completeFollowUp } from '../../care/api/routes.ts';
import { OPEN_STATUSES, addDaysIso, TASK_PRIORITIES, TASK_SOURCES, TASK_STATUSES, TASK_TEAMS, TEAM_PERMISSION, TEAM_PERMISSION_EXCLUDED, canViewPeers, dueBucket, isTeam, type TaskTeam, type TaskPriority, type TaskStatus } from '../domain/task-config.ts';
import { deliveries, deliveryLines, salesContracts, salesOrderLines, salesOrders } from '../../sales/schema.ts';
import { docRef } from '../../sales/domain/doc-ref.ts';
import { markProgress } from '../../sales/api/progress.ts';
import { orderScopeFor } from '../../sales/api/routes.ts';

type Ctx = RouteContext<StaffEnv>;
type Task = typeof tasks.$inferSelect;
const me = (c: Ctx) => (c.state.session as SessionState).member;
const nowIso = () => new Date().toISOString();
const str = (v: unknown, max = 500) => String(v ?? '').trim().slice(0, max);
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z'));
const addDays = (iso: string, n: number) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
const isTime = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

/**
 * Quét toàn bộ việc tự sinh (~30+ truy vấn) tối đa mỗi SWEEP_MS / phiên chạy Edge: bắt việc đến hạn và sự kiện bị bỏ sót.
 * Thay đổi chứng từ đã có đồng bộ riêng theo sự kiện (hoá đơn, điều chuyển, két, lưu báo giá). `?refresh=1` ép quét ngay.
 * Chỉ một lượt quét chạy một lúc: gọi trùng thì chờ chung lượt đang chạy; gọi ép trong lúc đang quét thì quét lại một lượt sau đó.
 */
const SWEEP_MS = 60_000;
let lastReconcile = 0, running: Promise<void> | null = null, rerun = false;
// Mở trang / đếm việc: đồng bộ chạy nền (trả lời ngay, lượt sau thấy việc mới); bấm "Làm mới" (?refresh=1) thì chờ đồng bộ xong.
const syncAuto = (c: Ctx) => {
  const force = c.url.searchParams.get('refresh') === '1';
  return force ? syncAutoTasks(c.env, true, me(c).id) : syncAutoTasksLater(c.env, me(c).id);
};
/** Đồng bộ việc tự sinh sau khi đã trả lời (~30 truy vấn) – nút / trang không phải chờ. Không có waitUntil (test) thì chạy luôn. */
export function syncAutoTasksLater(env: StaffEnv, actorId: string | null = null, force = false) {
  if (!env.waitUntil) return syncAutoTasks(env, force, actorId);
  env.waitUntil(syncAutoTasks(env, force, actorId).catch(e => console.error('background auto tasks failed', e instanceof Error ? e.message : e)));
  return Promise.resolve();
}
/**
 * Đồng bộ việc tự sinh rồi thông báo (chuông + Web Push) cho việc mới: người nhận; việc của nhóm → cả nhóm; chưa giao ai → Manager.
 * Tối đa 30 việc mỗi lượt (tránh dồn dập). Gọi từ trang Công việc và ngay sau khi lưu báo giá chờ duyệt.
 */
export function syncAutoTasks(env: StaffEnv, force = false, actorId: string | null = null): Promise<void> {
  if (running) { if (force) rerun = true; return running; }
  if (!force && Date.now() - lastReconcile < SWEEP_MS) return Promise.resolve();
  lastReconcile = Date.now();
  running = (async () => {
    try {
      do {
        rerun = false;
        let fresh: Awaited<ReturnType<typeof reconcileAutoTasks>>['fresh'] = [];
        try { fresh = (await reconcileAutoTasks(env.db)).fresh; } catch (e) { console.error('reconcile auto tasks failed', e instanceof Error ? e.message : e); }
        await notifyAutoTasks(env, fresh, actorId);
      } while (rerun);
    } finally { running = null; lastReconcile = Date.now(); }
  })();
  return running;
}
/** Lưu báo giá chỉ đổi việc "Duyệt báo giá": đồng bộ đúng nhóm việc đó (1 quy tắc), không quét lại mọi quy tắc. */
export async function syncQuoteApprovalTasks(env: StaffEnv, actorId: string | null = null) {
  const wanted = await RULES.quoteApproval!(env.db, vietnamDate().iso, new Date());
  const result = await reconcileTaskSet(env.db, new Map(wanted.map(t => [t.autoKey, t])), new Date(),
    or(like(tasks.autoKey, 'quote-approve:%'), like(tasks.autoKey, 'quote-customer:%')));
  await notifyAutoTasks(env, result.fresh, actorId);
}
/** Narrow event reconciliation: a sale need not rescan quotes, purchases or all other task rules. */
export async function syncInvoiceTasks(env: StaffEnv, ref: InvoiceTaskRef, actorId: string | null = null) {
  const wanted = await invoiceTasks(env.db, ref);
  const key = 'orderId' in ref ? `invoice:${ref.orderId}` : `invoice-web:${ref.webOrderId}`;
  const result = await reconcileTaskSet(env.db, new Map(wanted.map(t => [t.autoKey, t])), new Date(), eq(tasks.autoKey, key));
  await notifyAutoTasks(env, result.fresh, actorId);
}
/** A transfer event only reconciles that document; no broad task scan or 15-second throttle. */
export async function syncTransferTasks(env: StaffEnv, id: string, actorId: string) {
  const result = await env.db.transaction(async tx => {
    await tx.select({id:stockTransfers.id}).from(stockTransfers).where(eq(stockTransfers.id,id)).for('update');
    const db=tx as unknown as StaffEnv['db'];
    const wanted = await transferTasks(db, vietnamDate().iso, id);
    return reconcileTaskSet(db, new Map(wanted.map(t => [t.autoKey, t])), new Date(), and(eq(tasks.source, 'transfer'), eq(tasks.sourceId, id)));
  });
  await notifyAutoTasks(env, result.fresh, actorId);
}
async function notifyAutoTasks(env: StaffEnv, fresh: Awaited<ReturnType<typeof reconcileAutoTasks>>['fresh'], actorId: string | null) {
  if (!fresh.length) return;
  const job = Promise.all(fresh.slice(0, 30).map(t => {
    const n = { eventType: 'task_assigned', title: 'Việc mới', body: t.title, url: `/index.html#/tasks/${t.id}`, data: { taskId: t.id } };
    return t.assigneeId ? notify(env, { ...n, targetMemberId: t.assigneeId })
      : t.assigneePosition ? notifyTeam(env, t.assigneePosition, { ...n, title: `Việc mới cho nhóm ${teamName(t.assigneePosition)}`, actorId })
      : notifyMany(env, 'managers', n);
  })).catch(e => console.error('notify auto tasks failed', e instanceof Error ? e.message : e));
  if (env.waitUntil) env.waitUntil(job); else await job;
}
// Lưu báo giá chờ duyệt → tạo ngay việc "Duyệt báo giá" cho Manager và báo, không đợi ai mở trang Công việc.
quoteSaveHooks.afterCommit.push(env => {
  const job = syncQuoteApprovalTasks(env).catch(e => console.error('quote approval tasks failed', e instanceof Error ? e.message : e));
  if (env.waitUntil) { env.waitUntil(job); return Promise.resolve(); }
  return job;
});

/** Các nhóm của tôi: nhóm trùng chức vụ (Kho, Kế toán, Sale Admin…) + nhóm có quyền tương ứng (`TEAM_PERMISSION`). Manager thấy mọi việc nên không cần. */
const myTeams = (c: Ctx): TaskTeam[] => {
  const m = me(c), p = (m as { positionId?: string | null }).positionId;
  if (m.role !== 'employee') return [];
  const byPerm = (Object.entries(TEAM_PERMISSION) as [TaskTeam, string][]).filter(([t, perm]) => can(m as PermissionMember, perm) && !TEAM_PERMISSION_EXCLUDED[t]?.includes(p ?? '')).map(([t]) => t);
  return [...new Set([...(isTeam(p) ? [p] : []), ...byPerm])];
};
/** Việc của nhóm tôi chưa ai nhận – điều kiện SQL (undefined nếu tôi không thuộc nhóm nào). */
const teamOpenSql = (teams: TaskTeam[]) => teams.length ? and(isNull(tasks.assigneeId), inArray(tasks.assigneePosition, teams)) : undefined;
/** Việc giao cho nhóm, chưa ai nhận. */
const teamOpen = (t: Pick<Task, 'assigneeId' | 'assigneePosition'>) => !t.assigneeId && !!t.assigneePosition;
/** Ai thấy việc: Manager thấy tất cả; nhân viên thấy việc mình nhận, mình giao, và việc giao cho nhóm của mình chưa ai nhận. */
/** Chức vụ được xem việc của đồng nghiệp cùng chức vụ (theo nhóm/chức vụ được gán), null nếu không. Manager không cần (thấy tất cả). */
const peerPos = (c: Ctx) => { const m = me(c); return m.role === 'employee' && canViewPeers(m.positionId) ? m.positionId : null; };
/** Đồng nghiệp cùng chức vụ (nhân viên, không tính Manager) – câu con SQL. */
const colleaguesOf = (pos: string) => sql`(select ${employees.id} from ${employees} where ${employees.positionId} = ${pos} and ${employees.role} = 'employee' and ${employees.active} = true and ${employees.deletedAt} is null)`;
/** Việc của đồng nghiệp cùng chức vụ: đồng nghiệp nhận, đồng nghiệp giao, hoặc giao cho nhóm chức vụ đó. */
const peerCond = (pos: string): SQL => or(sql`${tasks.assigneeId} in ${colleaguesOf(pos)}`, sql`${tasks.createdBy} in ${colleaguesOf(pos)}`, eq(tasks.assigneePosition, pos))!;
/** Việc tôi trực tiếp liên quan (được sửa / trao đổi theo quyền cũ): Manager, người nhận, người giao, nhóm của tôi chưa ai nhận. */
const involved = (c: Ctx, t: Task) => { const m = me(c); return m.role === 'manager' || t.assigneeId === m.id || t.createdBy === m.id || inMyTeam(c, t); };
/** Việc tự sinh có mô tả nhạy cảm (ghi chú chăm sóc khách, số tiền công nợ, MST / email xuất hoá đơn): đồng nghiệp chỉ xem thấy tiêu đề, không thấy mô tả. */
const PRIVATE_DESC_SOURCES = new Set<string>(['care', 'receivable', 'invoice']);
/** Bản gửi cho người xem: việc chỉ xem của đồng nghiệp bị ẩn mô tả nhạy cảm. */
/** Việc tự hoàn thành theo chứng từ (nhận hàng NCC, các việc duyệt): không đánh dấu xong / huỷ tay – làm trên chứng từ thì việc tự đóng. */
const completionFromSource = (t: Task) => sourceManaged(t.autoKey);
const canComment = (c: Ctx, t: Task) => accountingKind(t.autoKey) ? me(c).role === 'manager' || t.assigneeId === me(c).id : involved(c, t);
const forViewer = (c: Ctx, t: Task) => ({ ...t, canComment: canComment(c, t), completionFromSource: completionFromSource(t), completionHelp: sourceCompletionHelp(t.autoKey),
  ...(!involved(c, t) && PRIVATE_DESC_SOURCES.has(t.source) ? { description: '' } : {}) });
/** Điều kiện SQL "việc tôi trực tiếp liên quan" (để tìm kiếm trong mô tả chỉ trên các việc này). */
const involvedSql = (c: Ctx): SQL | undefined => {
  const m = me(c);
  return m.role === 'manager' ? undefined : or(eq(tasks.assigneeId, m.id), eq(tasks.createdBy, m.id), teamOpenSql(myTeams(c)));
};
const visible = (c: Ctx): SQL | undefined => {
  const m = me(c), pos = peerPos(c);
  if (m.role === 'manager') return undefined;
  return or(eq(tasks.assigneeId, m.id), eq(tasks.createdBy, m.id), teamOpenSql(myTeams(c)), pos ? peerCond(pos) : undefined);
};
const inMyTeam = (c: Ctx, t: Task) => teamOpen(t) && (myTeams(c) as string[]).includes(t.assigneePosition!);
const canSee = (c: Ctx, t: Task) => involved(c, t);
const canManage = (c: Ctx, t: Task) => me(c).role === 'manager' || (t.createdBy !== null && t.createdBy === me(c).id);
const teamName = (pos: string | null) => (pos && isTeam(pos) ? TASK_TEAMS[pos] : '');
const VIEWS = ['mine', 'created', 'team', 'colleagues', 'unassigned', 'all'] as const;
/** Điều kiện của từng chế độ xem (tab) – dùng chung cho danh sách và số đếm trên tab. */
function viewCond(c: Ctx, view: string): SQL | undefined {
  const m = me(c), teams = myTeams(c);
  if (view === 'mine') return or(eq(tasks.assigneeId, m.id), teamOpenSql(teams));
  if (view === 'created') return eq(tasks.createdBy, m.id);
  if (view === 'team') return and(isNull(tasks.assigneeId), sql`${tasks.assigneePosition} is not null`, m.role === 'manager' ? undefined : teams.length ? inArray(tasks.assigneePosition, teams) : sql`false`);
  if (view === 'unassigned') return m.role === 'manager' ? and(isNull(tasks.assigneeId), isNull(tasks.assigneePosition)) : sql`false`;
  if (view === 'colleagues') { // việc của đồng nghiệp cùng chức vụ (không gồm việc của chính mình)
    const pos = peerPos(c);
    return pos ? and(peerCond(pos), sql`coalesce(${tasks.assigneeId}, '') <> ${m.id}`, sql`coalesce(${tasks.createdBy}, '') <> ${m.id}`) : sql`false`;
  }
  return undefined;
}
/** Mốc hạn: quá hạn · hôm nay · 7 ngày tới · sắp tới (mọi ngày sau hôm nay) · chưa đặt hạn. */
function dueCond(due: string, today: string): SQL | undefined {
  if (due === 'overdue') return sql`${tasks.dueDate} <> '' and ${tasks.dueDate} < ${today}`;
  if (due === 'today') return eq(tasks.dueDate, today);
  if (due === 'week') return sql`${tasks.dueDate} > ${today} and ${tasks.dueDate} <= ${addDaysIso(today, 7)}`;
  if (due === 'upcoming') return sql`${tasks.dueDate} > ${today}`;
  if (due === 'none') return or(isNull(tasks.dueDate), eq(tasks.dueDate, ''));
  return undefined;
}

/** Người nhận: id nhân viên, hoặc `team:<chức vụ>` = giao cho cả nhóm, hoặc '' = chưa giao. */
function parseAssignee(v: unknown): { assigneeId: string | null; assigneePosition: string | null } {
  const raw = str(v, 80);
  if (raw.startsWith('team:')) { const team = raw.slice(5); if (!isTeam(team)) throw new AppError(400, 'Nhóm nhận việc không hợp lệ.'); return { assigneeId: null, assigneePosition: team }; }
  return { assigneeId: raw || null, assigneePosition: null };
}
/** Báo cho mọi người đang hoạt động trong nhóm. */
async function notifyTeam(env: StaffEnv, team: string, n: Omit<Parameters<typeof notify>[1], 'targetMemberId'>) {
  // Thành viên nhóm = cùng chức vụ, hoặc chức vụ có quyền tương ứng (TEAM_PERMISSION) – khớp với ai thấy / nhận được việc của nhóm.
  const perm = isTeam(team) ? TEAM_PERMISSION[team] : undefined, excluded = isTeam(team) ? TEAM_PERMISSION_EXCLUDED[team] ?? [] : [];
  const members = await env.db.select({ id: employees.id }).from(employees).where(and(eq(employees.role, 'employee'), eq(employees.active, true), isNull(employees.deletedAt),
    or(eq(employees.positionId, team), perm ? sql`${employees.positionId} IN (SELECT ${positionPermissions.positionId} FROM ${positionPermissions} WHERE ${positionPermissions.permission} = ${perm})${excluded.length ? sql` AND ${notInArray(employees.positionId, [...excluded])}` : sql``}` : undefined)));
  for (const x of members) if (x.id !== n.actorId) await notify(env, { ...n, targetMemberId: x.id });
}

/** Xem được việc: liên quan trực tiếp, hoặc việc của đồng nghiệp cùng chức vụ (chỉ xem). */
async function loadTask(c: Ctx, id: string) {
  const [t] = await c.env.db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (!t) throw new AppError(404, 'Không tìm thấy công việc.');
  if (canSee(c, t)) return t;
  const pos = peerPos(c);
  if (pos && (await c.env.db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, t.id), peerCond(pos))).limit(1)).length) return t;
  throw new AppError(404, 'Không tìm thấy công việc.');
}
/** Việc chỉ xem (của đồng nghiệp): không sửa, không trao đổi. */
async function loadOwnTask(c: Ctx, id: string, message: string) {
  const t = await loadTask(c, id);
  if (!involved(c, t)) throw new AppError(403, message);
  return t;
}
async function assertAssignee(c: Ctx, id: string | null) {
  if (!id) return;
  const [p] = await c.env.db.select({ role: employees.role, active: employees.active }).from(employees).where(eq(employees.id, id)).limit(1);
  if (!p || !p.active || p.role === 'customer' || p.role === 'supplier') throw new AppError(400, 'Người nhận việc không hợp lệ.');
}
function readFields(b: Record<string, unknown>) {
  const out: Partial<typeof tasks.$inferInsert> = {};
  if (b.title !== undefined) { out.title = str(b.title, 300); if (!out.title) throw new AppError(400, 'Nhập tên công việc.'); }
  if (b.description !== undefined) out.description = str(b.description, 5000);
  if (b.priority !== undefined) { if (!TASK_PRIORITIES.includes(b.priority as TaskPriority)) throw new AppError(400, 'Mức ưu tiên không hợp lệ.'); out.priority = b.priority as TaskPriority; }
  if (b.dueDate !== undefined) { const d = str(b.dueDate, 10); if (d && !isDate(d)) throw new AppError(400, 'Hạn hoàn thành không hợp lệ.'); out.dueDate = d || null; if (!d) out.dueTime = null; }
  if (b.dueTime !== undefined) { const t = str(b.dueTime, 5); if (t && !isTime(t)) throw new AppError(400, 'Giờ hạn không hợp lệ.'); out.dueTime = t || null; }
  if (b.link !== undefined) { const l = str(b.link, 300); if (l && !/^#\/[\w/-]*$/.test(l)) throw new AppError(400, 'Liên kết không hợp lệ.'); out.link = l; }
  return out;
}
const statusPatch = (status: TaskStatus, by: string, t?: Task) => ({
  status, ...(status === 'in_progress' && !t?.startedAt ? { startedAt: nowIso() } : {}),
  ...(status === 'done' ? { completedAt: nowIso(), completedBy: by } : { completedAt: null, completedBy: null }),
});

/** Mọi trường gửi lên đã trùng với việc hiện tại (dùng khi gửi lại sau mất phản hồi). */
function alreadyApplied(b: Record<string, unknown>, t: typeof tasks.$inferSelect): boolean {
  const same = (k: 'status' | 'priority' | 'dueDate' | 'dueTime' | 'title' | 'description' | 'link' | 'assigneeId') => b[k] === undefined || (b[k] || null) === (t[k] || null);
  return (['status', 'priority', 'dueDate', 'dueTime', 'title', 'description', 'link', 'assigneeId'] as const).every(same);
}

/** Canonical projection for a confirmed write; same visibility rules as task reads. */
async function confirmedTask(c: Ctx,id: string) {
  try {
    const t=await loadTask(c,id),ids=[t.assigneeId,t.createdBy,t.completedBy].filter((v):v is string=>!!v);
    const people=ids.length?await c.env.db.select({id:employees.id,name:employees.name}).from(employees).where(inArray(employees.id,ids)):[];
    const name=(id:string|null)=>people.find(p=>p.id===id)?.name||'';
    const [count]=await c.env.db.select({n:sql<number>`count(*)`.mapWith(Number)}).from(taskComments).where(eq(taskComments.taskId,id));
    return {...forViewer(c,t),auto:!!t.autoKey,autoKey:undefined,assigneeName:name(t.assigneeId),creatorName:t.createdBy?name(t.createdBy):'Hệ thống',completedByName:name(t.completedBy),teamName:teamName(t.assigneePosition),
      canClaim:inMyTeam(c,t)||(me(c).role==='manager'&&teamOpen(t)),comments:canComment(c,t)?count?.n||0:0,due:dueBucket(t.dueDate,vietnamDate().iso),canManage:canManage(c,t),canDelete:!t.autoKey&&canManage(c,t),viewOnly:!involved(c,t)};
  }catch{return undefined;}
}

/** Id việc theo người tạo + mã chống lặp (dạng UUID để giống id thường). */
function keyedTaskId(memberId: string, clientKey: string): string {
  const h = sha256Hex('task:' + memberId + ':' + clientKey);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export function registerTaskRoutes(router: Router<StaffEnv>) {
  registerHomeTasks(router,{scope:c=>and(visible(c),viewCond(c,me(c).role==='manager'?'all':'mine')),sync:syncAuto});
  // Server-only cron endpoint: existing integrations token guard, never a staff cookie or public client key.
  router.post('/integrations/tasks/receiving-reminders', async c => {
    const now = new Date(), wanted = await receivingReminderTasks(c.env.db, now);
    const result = await reconcileTaskSet(c.env.db, new Map(wanted.map(t => [t.autoKey,t])), now, like(tasks.autoKey, RECEIVING_REMINDER_PREFIX+'%'));
    for (let offset=0;offset<result.fresh.length;offset+=30) await notifyAutoTasks(c.env,result.fresh.slice(offset,offset+30),null);
    return json({created:result.created,closed:result.closed,updated:result.updated,reopened:result.reopened});
  }, 'sapo-sync');
  registerAccountingTaskRoutes(router, { sync: syncAuto, visible, colleagues: c => peerPos(c) ? peerCond(peerPos(c)!) : undefined, loadTask, private: involved,
    serialize: (c, t) => ({ ...forViewer(c, t), auto: !!t.autoKey, autoKey: undefined, viewOnly: !involved(c, t), canClaim: inMyTeam(c, t) || me(c).role === 'manager' && teamOpen(t) }) });
  /** Người nhận việc chọn được: nhân viên + Manager đang hoạt động. */
  router.get('/tasks/people', async c => {
    const rows = await c.env.db.select({ id: employees.id, name: employees.name, role: employees.role }).from(employees)
      .where(and(eq(employees.active, true), notInArray(employees.role, ['customer', 'supplier']))).orderBy(asc(employees.name));
    return json({ people: rows });
  }, 'business');

  /** Đếm cho huy hiệu menu: việc của tôi đang mở / quá hạn / hôm nay; Manager thêm số việc chưa giao. */
  router.get('/tasks/summary', async c => {
    await syncAuto(c);
    const m = me(c), teams: string[] = myTeams(c), today = vietnamDate().iso;
    const rows = await c.env.db.select({ assigneeId: tasks.assigneeId, assigneePosition: tasks.assigneePosition, dueDate: tasks.dueDate }).from(tasks)
      .where(and(inArray(tasks.status, [...OPEN_STATUSES]), or(eq(tasks.assigneeId, m.id), m.role === 'manager' ? isNull(tasks.assigneeId) : teamOpenSql(myTeams(c)) ?? sql`false`)));
    // "Của tôi" = việc tôi nhận + việc nhóm tôi chưa ai nhận.
    const mine = rows.filter(r => r.assigneeId === m.id || (!r.assigneeId && r.assigneePosition && teams.includes(r.assigneePosition)));
    return json({ accountingAvailable: me(c).role === 'employee' && canUseAccountingTasks(me(c)), open: mine.length, overdue: mine.filter(r => dueBucket(r.dueDate, today) === 'overdue').length, today: mine.filter(r => dueBucket(r.dueDate, today) === 'today').length,
      team: rows.filter(r => !r.assigneeId && r.assigneePosition && (m.role === 'manager' || teams.includes(r.assigneePosition))).length,
      unassigned: m.role === 'manager' ? rows.filter(r => !r.assigneeId && !r.assigneePosition).length : 0,
      // Số việc đang mở theo từng tab (cùng điều kiện với danh sách) + tên nhóm của tôi cho tab "Việc nhóm".
      views: Object.fromEntries(await Promise.all(VIEWS.map(async v => [v, Number((await c.env.db.select({ n: sql<number>`count(*)` }).from(tasks)
        .where(and(visible(c), viewCond(c, v), inArray(tasks.status, [...OPEN_STATUSES]))))[0]?.n ?? 0)] as const))),
      teamNames: myTeams(c).map(t => TASK_TEAMS[t]), canViewColleagues: !!peerPos(c) });
  }, 'business');

  /**
   * Danh sách việc. `view`: mine (tôi nhận + nhóm tôi chưa ai nhận) · created (tôi giao) · team (việc giao cho nhóm, chưa ai nhận) · unassigned (chưa giao, Manager)
   * · colleagues (việc của đồng nghiệp cùng chức vụ – Sale Admin / Kho / NVBH LOCK / NVBH ML, chỉ xem) · all.
   * `status`: open (mặc định) · done · all. Lọc thêm `priority`, `source`, `q`, `due=overdue|today|upcoming|none` (trước giới hạn 500 dòng).
   */
  router.get('/tasks', async c => {
    await syncAuto(c);
    const m = me(c), p = c.url.searchParams, view = p.get('view') || 'mine', status = p.get('status') || 'open', q = str(p.get('q'), 100).toLowerCase();
    const due = p.get('due') || '', today = vietnamDate().iso;
    if (due && !['overdue', 'today', 'week', 'upcoming', 'none'].includes(due)) throw new AppError(400, 'Bộ lọc hạn công việc không hợp lệ.');
    const where: (SQL | undefined)[] = [visible(c), viewCond(c, view)];
    // Người nhận: id nhân viên · team:<nhóm> (nhóm chưa ai nhận) · none (chưa giao).
    const assignee = str(p.get('assignee'), 80);
    if (assignee === 'none') where.push(and(isNull(tasks.assigneeId), isNull(tasks.assigneePosition)));
    else if (assignee.startsWith('team:')) where.push(and(isNull(tasks.assigneeId), eq(tasks.assigneePosition, assignee.slice(5))));
    else if (assignee) where.push(eq(tasks.assigneeId, assignee));
    if (status === 'open') where.push(inArray(tasks.status, [...OPEN_STATUSES]));
    else if (status === 'done') where.push(inArray(tasks.status, ['done', 'cancelled']));
    const priority = p.get('priority'), source = p.get('source');
    if (priority && TASK_PRIORITIES.includes(priority as TaskPriority)) where.push(eq(tasks.priority, priority as TaskPriority));
    if (source && (TASK_SOURCES as readonly string[]).includes(source)) where.push(eq(tasks.source, source as Task['source']));
    if (q) { // tìm theo tiêu đề; mô tả chỉ tìm trong việc mình liên quan (không dò được mô tả đã ẩn của đồng nghiệp)
      const pat = '%' + q.replace(/[%_\\]/g, '') + '%', inv = involvedSql(c);
      where.push(or(sql`lower(${tasks.title}) like ${pat}`, and(sql`lower(${tasks.description}) like ${pat}`, inv)));
    }
    // Số việc theo mốc hạn với mọi bộ lọc khác (thẻ hạn trên trang) – đếm trước khi lọc hạn và trước giới hạn 500 dòng.
    const n = (cond: SQL | undefined) => sql<number>`count(*) filter (where ${cond})`.mapWith(Number);
    const [dueCounts] = await c.env.db.select({ overdue: n(dueCond('overdue', today)), today: n(dueCond('today', today)), week: n(dueCond('week', today)), upcoming: n(dueCond('upcoming', today)), none: n(dueCond('none', today)), total: sql<number>`count(*)`.mapWith(Number) })
      .from(tasks).where(and(...where));
    where.push(dueCond(due, today));
    // Việc sinh sau (mới tạo) lên trên cùng; quá 500 việc thì giữ các việc mới nhất.
    const rows = await c.env.db.select().from(tasks).where(and(...where)).orderBy(desc(tasks.createdAt), desc(tasks.id)).limit(500);
    const ids = [...new Set(rows.flatMap(r => [r.assigneeId, r.createdBy, r.completedBy]).filter(Boolean) as string[])];
    const people = ids.length ? await c.env.db.select({ id: employees.id, name: employees.name }).from(employees).where(inArray(employees.id, ids)) : [];
    const name = (id: string | null) => id ? people.find(x => x.id === id)?.name ?? '' : '';
    const counts = await c.env.db.select({ taskId: taskComments.taskId, n: sql<number>`count(*)` }).from(taskComments)
      .where(rows.length ? inArray(taskComments.taskId, rows.map(r => r.id)) : sql`false`).groupBy(taskComments.taskId);
    const sorted = rows;
    return json({ today, syncedAt: new Date().toISOString(), dueCounts, canViewColleagues: !!peerPos(c), tasks: sorted.map(t => ({ ...forViewer(c, t), auto: !!t.autoKey, autoKey: undefined, assigneeName: name(t.assigneeId), teamName: teamName(t.assigneePosition), canClaim: inMyTeam(c, t) || (m.role === 'manager' && teamOpen(t)), creatorName: t.createdBy ? name(t.createdBy) : 'Hệ thống',
      completedByName: name(t.completedBy), comments: canComment(c, t) ? Number(counts.find(x => x.taskId === t.id)?.n ?? 0) : 0, due: dueBucket(t.dueDate, today),
      canManage: canManage(c, t), canDelete: !t.autoKey && canManage(c, t), viewOnly: !involved(c, t) })) });
  }, 'business');

  /** Giao việc thủ công. Người nhận (khác mình) được báo ngay. */
  router.post('/tasks', async c => {
    const m = me(c), b = await readJson(c.req, 20_000), f = readFields(b);
    if (!f.title) throw new AppError(400, 'Nhập tên công việc.');
    const { assigneeId, assigneePosition } = b.assigneeId === undefined ? { assigneeId: m.id, assigneePosition: null } : parseAssignee(b.assigneeId);
    if (!assigneeId && !assigneePosition && m.role !== 'manager') throw new AppError(400, 'Chọn người hoặc nhóm nhận việc.');
    await assertAssignee(c, assigneeId);
    // Mã chống lặp (tuỳ chọn): id việc suy ra từ người tạo + mã → mạng rớt sau khi đã lưu, gửi lại không sinh việc thứ hai.
    // Không cần cột mới: khoá chính đã bảo đảm duy nhất (cả khi hai lần gửi chạy đồng thời).
    const clientKey = typeof b.clientKey === 'string' && /^[\w-]{8,100}$/.test(b.clientKey) ? b.clientKey : null;
    const id = clientKey ? keyedTaskId(m.id, clientKey) : crypto.randomUUID(), now = nowIso();
    const inserted = await c.env.db.insert(tasks).values({ id, title: f.title, description: f.description ?? '', priority: f.priority ?? 'normal', status: 'todo', source: 'manual', link: f.link ?? '',
      assigneeId, assigneePosition, createdBy: m.id, dueDate: f.dueDate ?? null, dueTime: f.dueTime ?? null, createdAt: now, updatedAt: now }).onConflictDoNothing().returning({ id: tasks.id });
    if (!inserted.length) {
      const [prior] = await c.env.db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
      // Mã sinh ngẫu nhiên theo từng lần giao việc của chính người này: việc đã được sửa sau khi tạo (người nhận đổi hạn, nhận việc…)
      // vẫn là đúng lần giao đó → báo đã tạo, không bắt người giao kẹt ở lỗi 409. Việc chưa sửa thì so đủ nội dung như trước.
      if (prior && prior.createdBy === m.id && prior.updatedAt !== prior.createdAt) return json({ id, replayed: true, changedSince: true });
      if (!prior || prior.createdBy !== m.id || prior.title !== f.title || prior.description !== (f.description ?? '') || prior.priority !== (f.priority ?? 'normal') || prior.assigneeId !== assigneeId || prior.assigneePosition !== assigneePosition || prior.dueDate !== (f.dueDate ?? null) || prior.dueTime !== (f.dueTime ?? null) || prior.link !== (f.link ?? '')) throw new AppError(409, 'Mã chống lặp đã dùng cho việc khác. Tải lại trang rồi thử lại.', 'IDEMPOTENCY_CONFLICT');
      return json({ id, replayed: true });
    }
    if (assigneeId && assigneeId !== m.id) await notify(c.env, { eventType: 'task_assigned', title: 'Bạn được giao việc mới', body: `${m.name}: ${f.title}`, url: `/index.html#/tasks/${id}`,
      targetMemberId: assigneeId, actorId: m.id, data: { taskId: id } });
    if (assigneePosition) await notifyTeam(c.env, assigneePosition, { eventType: 'task_assigned', title: `Việc mới cho nhóm ${teamName(assigneePosition)}`, body: `${m.name}: ${f.title}`, url: `/index.html#/tasks/${id}`, actorId: m.id, data: { taskId: id } });
    return json({ id }, 201);
  }, 'business');

  /**
   * Sửa việc. Người giao / Manager sửa mọi thông tin (việc tự sinh: không sửa tên, mô tả).
   * Người nhận: đổi trạng thái, mức ưu tiên, hạn.
   */
  router.put('/tasks/:id', async c => {
    const m = me(c), b = await readJson(c.req, 20_000), t = await loadOwnTask(c, c.params.id!, 'Việc của đồng nghiệp cùng chức vụ – chỉ xem, không sửa được.');
    if (b.revision !== undefined && Number(b.revision) !== t.revision) {
      // Gửi lại sau khi mạng rớt (lần trước đã lưu nên phiên bản đã tăng): việc đã đúng như yêu cầu → báo thành công, không báo nhầm "người khác cập nhật".
      if (alreadyApplied(b, t)) return json({ ok: true, alreadyApplied: true, ...(b.returnTask===true?{task:await confirmedTask(c,t.id)}:{}) });
      throw new AppError(409, 'Công việc vừa được người khác cập nhật. Tải lại để xem bản mới.', 'REVISION_CONFLICT');
    }
    // Người trong nhóm được giao (chưa ai nhận) làm như người nhận: bấm "Nhận việc" hoặc đổi trạng thái là nhận luôn.
    const manage = canManage(c, t), isAssignee = t.assigneeId === m.id || inMyTeam(c, t), f = readFields(b);
    if (t.autoKey) { delete f.title; delete f.description; delete f.link; }
    if (!manage && (f.title !== undefined || f.description !== undefined || f.link !== undefined)) throw new AppError(403, 'Chỉ người giao việc hoặc Manager sửa được nội dung.');
    if (!manage && !isAssignee) throw new AppError(403, 'Bạn không được sửa công việc này.');
    const set: Partial<typeof tasks.$inferInsert> = { ...f, updatedAt: nowIso() };
    let reassigned: string | null = null;
    let toTeam: string | null = null;
    if (b.assigneeId !== undefined) {
      const { assigneeId: to, assigneePosition } = parseAssignee(b.assigneeId);
      if (!manage && !isAssignee) throw new AppError(403, 'Bạn không được giao lại việc này.');
      if (!to && !assigneePosition && m.role !== 'manager') throw new AppError(400, 'Chọn người hoặc nhóm nhận việc.');
      await assertAssignee(c, to);
      if (to !== t.assigneeId || assigneePosition !== t.assigneePosition) { set.assigneeId = to; set.assigneePosition = assigneePosition; reassigned = to; toTeam = assigneePosition !== t.assigneePosition ? assigneePosition : null; }
    } else if (teamOpen(t) && inMyTeam(c, t) && b.status !== undefined && b.status !== 'todo') {
      // Người trong nhóm bắt đầu làm / hoàn thành việc của nhóm → tự nhận việc.
      set.assigneeId = m.id; set.assigneePosition = null;
    }
    if (b.status !== undefined) {
      if (completionFromSource(t) && (b.status === 'done' || b.status === 'cancelled' ||
        ((t.status === 'done' || t.status === 'cancelled') && b.status !== t.status))) {
        throw new AppError(409, accountingKind(t.autoKey) ? sourceCompletionHelp(t.autoKey) : t.autoKey?.startsWith('invoice:') ? 'Việc xuất hoá đơn tự hoàn thành khi nhập số hoá đơn trên đơn / HĐKT. Mở chứng từ để ghi nhận số hoá đơn.' : (t.autoKey?.startsWith('po-receive:') || t.autoKey?.startsWith(RECEIVING_REMINDER_PREFIX)) ? 'Việc nhận hàng NCC tự hoàn thành theo đơn mua. Vui lòng ghi nhận hàng trên đơn mua, không đánh dấu hoàn thành thủ công.'
          : 'Việc duyệt tự hoàn thành khi chứng từ được duyệt. Mở chứng từ để duyệt, không đánh dấu hoàn thành thủ công.', 'TASK_SOURCE_MANAGED');
      }
      if (!TASK_STATUSES.includes(b.status as TaskStatus)) throw new AppError(400, 'Trạng thái không hợp lệ.');
      if (b.status === 'cancelled' && !manage) throw new AppError(403, 'Chỉ người giao việc hoặc Manager huỷ được việc.');
      Object.assign(set, statusPatch(b.status as TaskStatus, m.id, t));
    }
    const changed = await c.env.db.update(tasks).set({ ...set, revision: sql`${tasks.revision} + 1` }).where(and(eq(tasks.id, t.id), eq(tasks.revision, t.revision))).returning({ id: tasks.id });
    if (!changed.length) throw new AppError(409, 'Công việc vừa được người khác nhận hoặc cập nhật. Tải lại để xem.', 'REVISION_CONFLICT');
    // Việc hẹn chăm sóc khách hoàn thành ở "Công việc" → lịch hẹn bên nhật ký chăm sóc cũng xong (khoá việc = care:<id>:<ngày hẹn>).
    if (b.status === 'done' && t.source === 'care' && t.sourceId && t.autoKey) await completeFollowUp(c.env.db, t.sourceId, t.autoKey.split(':')[2] ?? '');
    // Hoàn thành việc "In mẫu" / "Sản xuất" → bước tương ứng trên thanh tiến trình đơn / HĐKT xong (khoá việc = print-sample:<đơn> / production:<đơn>).
    const stage = t.autoKey?.startsWith('print-sample:') ? 'sample' as const : t.autoKey?.startsWith('production:') ? 'production' as const : null;
    if (b.status === 'done' && stage && t.sourceId) await markProgress(c.env.db, t.sourceId, [stage], 'task', m.id);
    if (reassigned && reassigned !== m.id) await notify(c.env, { eventType: 'task_assigned', title: 'Bạn được giao việc', body: `${m.name}: ${t.title}`, url: `/index.html#/tasks/${t.id}`,
      targetMemberId: reassigned, actorId: m.id, data: { taskId: t.id } });
    if (toTeam) await notifyTeam(c.env, toTeam, { eventType: 'task_assigned', title: `Việc mới cho nhóm ${teamName(toTeam)}`, body: `${m.name}: ${t.title}`, url: `/index.html#/tasks/${t.id}`, actorId: m.id, data: { taskId: t.id } });
    // Người giao việc (việc tự sinh: Manager) được báo khi có người NHẬN việc / BẮT ĐẦU làm / HOÀN THÀNH.
    const boss = t.createdBy ? [t.createdBy] : 'managers' as const;
    const claimed = set.assigneeId === m.id && t.assigneeId !== m.id, started = b.status === 'in_progress' && t.status === 'todo';
    if (b.status === 'done' && t.status !== 'done') await notifyMany(c.env, boss, { eventType: 'task_done', title: 'Việc đã hoàn thành', body: `${m.name}: ${t.title}`,
      url: `/index.html#/tasks/${t.id}`, actorId: m.id, data: { taskId: t.id } });
    else if (claimed || started) await notifyMany(c.env, boss, { eventType: 'task_claimed', title: claimed ? 'Đã có người nhận việc' : 'Bắt đầu làm việc', body: `${m.name}: ${t.title}`,
      url: `/index.html#/tasks/${t.id}`, actorId: m.id, data: { taskId: t.id } });
    return json({ ok: true, ...(b.returnTask===true?{task:await confirmedTask(c,t.id)}:{}) });
  }, 'business');

  /**
   * Nhân viên phụ trách bấm "Yêu cầu kho đóng hàng" cho một chuyến giao → việc "Xuất kho & đóng hàng" giao cho nhóm Kho
   * (cả nhóm nhận thông báo). Kho làm xong → người yêu cầu được báo. Chuyến đã đi / đã giao / huỷ thì việc tự hoàn thành.
   */
  router.post('/tasks/packing', async c => {
    const m = me(c), b = await readJson(c.req, 4_000), deliveryId = str(b.deliveryId, 80), note = str(b.note, 1000);
    const [row] = await c.env.db.select({ d: deliveries, o: salesOrders }).from(deliveries).innerJoin(salesOrders, eq(salesOrders.id, deliveries.orderId)).where(eq(deliveries.id, deliveryId)).limit(1);
    if (!row || (m.role !== 'manager' && row.o.ownerId !== m.id && row.o.createdBy !== m.id)) throw new AppError(404, 'Không tìm thấy chuyến giao.');
    if (row.d.status !== 'planned') throw new AppError(409, 'Chỉ yêu cầu đóng hàng cho chuyến đang chờ giao.');
    const key = `pack:${row.d.id}`, [old] = await c.env.db.select().from(tasks).where(eq(tasks.autoKey, key)).limit(1);
    if (old && (old.status === 'todo' || old.status === 'in_progress')) throw new AppError(409, 'Đã yêu cầu kho đóng hàng cho chuyến này.', 'PACK_EXISTS');
    const lines = await c.env.db.select({ name: salesOrderLines.name, unit: salesOrderLines.unit, qty: deliveryLines.qty }).from(deliveryLines)
      .innerJoin(salesOrderLines, eq(salesOrderLines.id, deliveryLines.orderLineId)).where(eq(deliveryLines.deliveryId, row.d.id));
    const today = vietnamDate().iso, now = nowIso();
    const [k] = await c.env.db.select({ no: salesContracts.contractNo }).from(salesContracts).where(eq(salesContracts.orderId, row.o.id)).limit(1);
    const description = [`${docRef(row.o.id, row.o.orderNo, k?.no).Label} · giao ${row.d.plannedDate.split('-').reverse().join('/')}${row.d.timeSlot ? ' ' + row.d.timeSlot : ''}`, `Địa chỉ: ${row.d.address || row.o.address}`,
      ...lines.map(l => `- ${l.name}: ${new Intl.NumberFormat('vi-VN').format(l.qty)} ${l.unit}`), note ? `Ghi chú: ${note}` : ''].filter(Boolean).join('\n');
    const values = { title: `Xuất kho & đóng hàng ${row.d.deliveryNo} – ${row.o.customerName}`, description, status: 'todo' as const, priority: row.d.plannedDate <= addDays(today, 1) ? 'urgent' as const : 'high' as const,
      source: 'packing' as const, sourceId: row.o.id, link: '', // kho không mở được đơn (đơn chỉ NV phụ trách / Manager xem) – nội dung việc đã ghi đủ hàng cần xuất
      assigneeId: null, assigneePosition: 'warehouse', createdBy: m.id, dueDate: row.d.plannedDate, dueTime: null,
      startedAt: null, completedAt: null, completedBy: null, updatedAt: now };
    const id = old?.id ?? crypto.randomUUID();
    if (old) await c.env.db.update(tasks).set({ ...values, revision: sql`${tasks.revision} + 1` }).where(eq(tasks.id, id));
    else await c.env.db.insert(tasks).values({ id, autoKey: key, createdAt: now, ...values });
    await notifyTeam(c.env, 'warehouse', { eventType: 'task_assigned', title: 'Kho: yêu cầu xuất kho & đóng hàng', body: `${row.d.deliveryNo} – ${row.o.customerName} (giao ${row.d.plannedDate.split('-').reverse().join('/')})`,
      url: `/index.html#/tasks/${id}`, actorId: m.id, data: { taskId: id } });
    return json({ id }, 201);
  }, 'business');

  /** Tình trạng đóng hàng của các chuyến giao trong một đơn (hiện ở ô Lịch giao hàng). */
  router.get('/tasks/packing', async c => {
    const orderId = str(c.url.searchParams.get('orderId'), 80);
    // Chỉ người xem được đơn (Manager, Kế toán, người phụ trách / tạo đơn, người được chia sẻ khách) mới xem tình trạng đóng hàng.
    if (!(await c.env.db.select({ id: salesOrders.id }).from(salesOrders).where(and(eq(salesOrders.id, orderId), orderScopeFor(me(c)))).limit(1)).length) return json({ packing: [] });
    const rows = await c.env.db.select({ t: tasks, name: employees.name }).from(tasks).leftJoin(employees, eq(employees.id, sql`coalesce(${tasks.completedBy}, ${tasks.assigneeId})`))
      .where(and(eq(tasks.source, 'packing'), eq(tasks.sourceId, orderId))).limit(100);
    // Chỉ là tình trạng đóng hàng của chuyến (ai làm, lúc nào) – người xem được đơn đều thấy.
    return json({ packing: rows.map(({ t, name }) => ({ deliveryId: t.autoKey?.slice(5) ?? '', taskId: t.id, status: t.status,
      by: name ?? '', completedAt: t.completedAt, auto: t.status === 'done' && !t.completedBy })) });
  }, 'business');

  router.get('/tasks/:id', async c => {
    const t = await loadTask(c, c.params.id!);
    const ids = [t.assigneeId, t.createdBy, t.completedBy].filter(Boolean) as string[];
    const people = ids.length ? await c.env.db.select({ id: employees.id, name: employees.name }).from(employees).where(inArray(employees.id, ids)) : [];
    const name = (id: string | null) => id ? people.find(x => x.id === id)?.name ?? '' : '';
    return json({ task: { ...forViewer(c, t), auto: !!t.autoKey, autoKey: undefined, assigneeName: name(t.assigneeId), teamName: teamName(t.assigneePosition), canClaim: inMyTeam(c, t) || (me(c).role === 'manager' && teamOpen(t)), creatorName: t.createdBy ? name(t.createdBy) : 'Hệ thống',
      completedByName: name(t.completedBy), due: dueBucket(t.dueDate, vietnamDate().iso), canManage: canManage(c, t), canDelete: !t.autoKey && canManage(c, t), viewOnly: !involved(c, t) } });
  }, 'business');

  router.delete('/tasks/:id', async c => {
    const t = await loadOwnTask(c, c.params.id!, 'Việc của đồng nghiệp cùng chức vụ – chỉ xem, không sửa được.');
    if (t.autoKey) throw new AppError(409, 'Việc tự sinh không xoá được; việc sẽ tự hoàn thành khi xử lý xong chứng từ.');
    if (!canManage(c, t)) throw new AppError(403, 'Chỉ người giao việc hoặc Manager xoá được.');
    await c.env.db.delete(tasks).where(eq(tasks.id, t.id));
    return json({ ok: true });
  }, 'business');

  router.get('/tasks/:id/comments', async c => {
    // Trao đổi là chuyện riêng của người giao ↔ người nhận: đồng nghiệp cùng chức vụ (chỉ xem việc) không đọc được.
    const t = await loadOwnTask(c, c.params.id!, 'Chỉ người giao, người nhận và Manager xem được trao đổi của việc này.');
    if (!canComment(c, t)) throw new AppError(403, 'Chỉ người nhận và Manager xem trao đổi của công việc kế toán.');
    const rows = await c.env.db.select({ id: taskComments.id, body: taskComments.body, createdAt: taskComments.createdAt, memberId: taskComments.memberId, name: employees.name })
      .from(taskComments).innerJoin(employees, eq(employees.id, taskComments.memberId)).where(eq(taskComments.taskId, t.id)).orderBy(asc(taskComments.createdAt)).limit(300);
    return json({ comments: rows });
  }, 'business');

  /** Trao đổi trong việc: báo người còn lại (người giao ↔ người nhận). */
  router.post('/tasks/:id/comments', async c => {
    const m = me(c), t = await loadOwnTask(c, c.params.id!, 'Chỉ người giao, người nhận và Manager trao đổi được trong việc này.'), body = str((await readJson(c.req, 8_000)).body, 2000);
    if (!canComment(c, t)) throw new AppError(403, 'Chỉ người nhận và Manager trao đổi trong công việc kế toán.');
    if (!body) throw new AppError(400, 'Nhập nội dung trao đổi.');
    const id = crypto.randomUUID();
    const createdAt = nowIso();
    await c.env.db.insert(taskComments).values({ id, taskId: t.id, memberId: m.id, body, createdAt });
    for (const to of new Set([t.assigneeId, t.createdBy].filter(x => x && x !== m.id) as string[]))
      await notify(c.env, { eventType: 'task_comment', title: `Trao đổi: ${t.title}`, body: `${m.name}: ${body.slice(0, 160)}`, url: `/index.html#/tasks/${t.id}`, targetMemberId: to, actorId: m.id, data: { taskId: t.id } });
    return json({ id, comment: { id, taskId: t.id, memberId: m.id, name: m.name, body, createdAt } }, 201);
  }, 'business');
}

