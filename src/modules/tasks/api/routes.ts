import { and, asc, desc, eq, inArray, isNull, notInArray, or, sql, type SQL } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees } from '../../staff/schema.ts';
import { vietnamDate } from '../../sales/domain/sales.ts';
import { notify } from '../../notifications/api/routes.ts';
import { taskComments, tasks } from '../schema.ts';
import { reconcileAutoTasks } from './auto-tasks.ts';
import { OPEN_STATUSES, PRIORITY_RANK, TASK_PRIORITIES, TASK_SOURCES, TASK_STATUSES, dueBucket, type TaskPriority, type TaskStatus } from '../domain/task-config.ts';

type Ctx = RouteContext<StaffEnv>;
type Task = typeof tasks.$inferSelect;
const me = (c: Ctx) => (c.state.session as SessionState).member;
const nowIso = () => new Date().toISOString();
const str = (v: unknown, max = 500) => String(v ?? '').trim().slice(0, max);
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z'));
const isTime = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

/** Việc tự sinh được đồng bộ tối đa mỗi 15 giây / phiên chạy (mở bảng việc liên tục không quét lại toàn bộ). `?refresh=1` ép đồng bộ ngay. */
let lastReconcile = 0;
async function syncAuto(c: Ctx) {
  if (c.url.searchParams.get('refresh') !== '1' && Date.now() - lastReconcile < 15_000) return;
  lastReconcile = Date.now();
  try { await reconcileAutoTasks(c.env.db); } catch (e) { console.error('reconcile auto tasks failed', e instanceof Error ? e.message : e); }
}

/** Ai thấy việc: Manager thấy tất cả; nhân viên thấy việc mình nhận hoặc mình giao. */
const visible = (c: Ctx): SQL | undefined => { const m = me(c); return m.role === 'manager' ? undefined : or(eq(tasks.assigneeId, m.id), eq(tasks.createdBy, m.id)); };
const canSee = (c: Ctx, t: Task) => { const m = me(c); return m.role === 'manager' || t.assigneeId === m.id || t.createdBy === m.id; };
const canManage = (c: Ctx, t: Task) => me(c).role === 'manager' || (t.createdBy !== null && t.createdBy === me(c).id);

async function loadTask(c: Ctx, id: string) {
  const [t] = await c.env.db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (!t || !canSee(c, t)) throw new AppError(404, 'Không tìm thấy công việc.');
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

export function registerTaskRoutes(router: Router<StaffEnv>) {
  /** Người nhận việc chọn được: nhân viên + Manager đang hoạt động. */
  router.get('/tasks/people', async c => {
    const rows = await c.env.db.select({ id: employees.id, name: employees.name, role: employees.role }).from(employees)
      .where(and(eq(employees.active, true), notInArray(employees.role, ['customer', 'supplier']))).orderBy(asc(employees.name));
    return json({ people: rows });
  }, 'business');

  /** Đếm cho huy hiệu menu: việc của tôi đang mở / quá hạn / hôm nay; Manager thêm số việc chưa giao. */
  router.get('/tasks/summary', async c => {
    await syncAuto(c);
    const m = me(c), today = vietnamDate().iso;
    const rows = await c.env.db.select({ assigneeId: tasks.assigneeId, dueDate: tasks.dueDate }).from(tasks)
      .where(and(inArray(tasks.status, [...OPEN_STATUSES]), m.role === 'manager' ? or(eq(tasks.assigneeId, m.id), isNull(tasks.assigneeId)) : eq(tasks.assigneeId, m.id)));
    const mine = rows.filter(r => r.assigneeId === m.id);
    return json({ open: mine.length, overdue: mine.filter(r => dueBucket(r.dueDate, today) === 'overdue').length, today: mine.filter(r => dueBucket(r.dueDate, today) === 'today').length,
      unassigned: rows.filter(r => r.assigneeId === null).length });
  }, 'business');

  /**
   * Danh sách việc. `view`: mine (tôi nhận) · created (tôi giao) · unassigned (chưa giao, Manager) · all.
   * `status`: open (mặc định) · done · all. Lọc thêm `priority`, `source`, `q`.
   */
  router.get('/tasks', async c => {
    await syncAuto(c);
    const m = me(c), p = c.url.searchParams, view = p.get('view') || 'mine', status = p.get('status') || 'open', q = str(p.get('q'), 100).toLowerCase();
    const where: (SQL | undefined)[] = [visible(c)];
    if (view === 'mine') where.push(eq(tasks.assigneeId, m.id));
    else if (view === 'created') where.push(eq(tasks.createdBy, m.id));
    else if (view === 'unassigned') where.push(isNull(tasks.assigneeId));
    if (status === 'open') where.push(inArray(tasks.status, [...OPEN_STATUSES]));
    else if (status === 'done') where.push(inArray(tasks.status, ['done', 'cancelled']));
    const priority = p.get('priority'), source = p.get('source');
    if (priority && TASK_PRIORITIES.includes(priority as TaskPriority)) where.push(eq(tasks.priority, priority as TaskPriority));
    if (source && (TASK_SOURCES as readonly string[]).includes(source)) where.push(eq(tasks.source, source as Task['source']));
    if (q) where.push(sql`lower(${tasks.title} || ' ' || ${tasks.description}) like ${'%' + q.replace(/[%_\\]/g, '') + '%'}`);
    const rows = await c.env.db.select().from(tasks).where(and(...where)).orderBy(status === 'done' ? desc(tasks.completedAt) : asc(tasks.dueDate), desc(tasks.createdAt)).limit(500);
    const ids = [...new Set(rows.flatMap(r => [r.assigneeId, r.createdBy, r.completedBy]).filter(Boolean) as string[])];
    const people = ids.length ? await c.env.db.select({ id: employees.id, name: employees.name }).from(employees).where(inArray(employees.id, ids)) : [];
    const name = (id: string | null) => id ? people.find(x => x.id === id)?.name ?? '' : '';
    const counts = await c.env.db.select({ taskId: taskComments.taskId, n: sql<number>`count(*)` }).from(taskComments)
      .where(rows.length ? inArray(taskComments.taskId, rows.map(r => r.id)) : sql`false`).groupBy(taskComments.taskId);
    const today = vietnamDate().iso;
    // Đang mở: quá hạn trước, rồi theo hạn, rồi ưu tiên.
    const sorted = status === 'done' ? rows : [...rows].sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
    return json({ today, tasks: sorted.map(t => ({ ...t, auto: !!t.autoKey, autoKey: undefined, assigneeName: name(t.assigneeId), creatorName: t.createdBy ? name(t.createdBy) : 'Hệ thống',
      completedByName: name(t.completedBy), comments: Number(counts.find(x => x.taskId === t.id)?.n ?? 0), due: dueBucket(t.dueDate, today),
      canManage: canManage(c, t), canDelete: !t.autoKey && canManage(c, t) })) });
  }, 'business');

  /** Giao việc thủ công. Người nhận (khác mình) được báo ngay. */
  router.post('/tasks', async c => {
    const m = me(c), b = await readJson(c.req, 20_000), f = readFields(b);
    if (!f.title) throw new AppError(400, 'Nhập tên công việc.');
    const assigneeId = b.assigneeId === undefined ? m.id : (str(b.assigneeId, 80) || null);
    if (assigneeId !== m.id && m.role !== 'manager' && !assigneeId) throw new AppError(400, 'Chọn người nhận việc.');
    await assertAssignee(c, assigneeId);
    const id = crypto.randomUUID(), now = nowIso();
    await c.env.db.insert(tasks).values({ id, title: f.title, description: f.description ?? '', priority: f.priority ?? 'normal', status: 'todo', source: 'manual', link: f.link ?? '',
      assigneeId, createdBy: m.id, dueDate: f.dueDate ?? null, dueTime: f.dueTime ?? null, createdAt: now, updatedAt: now });
    if (assigneeId && assigneeId !== m.id) await notify(c.env, { eventType: 'task_assigned', title: 'Bạn được giao việc mới', body: `${m.name}: ${f.title}`, url: `/index.html#/tasks/${id}`,
      targetMemberId: assigneeId, actorId: m.id, data: { taskId: id } });
    return json({ id }, 201);
  }, 'business');

  /**
   * Sửa việc. Người giao / Manager sửa mọi thông tin (việc tự sinh: không sửa tên, mô tả).
   * Người nhận: đổi trạng thái, mức ưu tiên, hạn.
   */
  router.put('/tasks/:id', async c => {
    const m = me(c), b = await readJson(c.req, 20_000), t = await loadTask(c, c.params.id!);
    if (b.revision !== undefined && Number(b.revision) !== t.revision) throw new AppError(409, 'Công việc vừa được người khác cập nhật. Tải lại để xem bản mới.', 'REVISION_CONFLICT');
    const manage = canManage(c, t), isAssignee = t.assigneeId === m.id, f = readFields(b);
    if (t.autoKey) { delete f.title; delete f.description; delete f.link; }
    if (!manage && (f.title !== undefined || f.description !== undefined || f.link !== undefined)) throw new AppError(403, 'Chỉ người giao việc hoặc Manager sửa được nội dung.');
    if (!manage && !isAssignee) throw new AppError(403, 'Bạn không được sửa công việc này.');
    const set: Partial<typeof tasks.$inferInsert> = { ...f, updatedAt: nowIso() };
    let reassigned: string | null = null;
    if (b.assigneeId !== undefined) {
      const to = str(b.assigneeId, 80) || null;
      if (!manage && !isAssignee) throw new AppError(403, 'Bạn không được giao lại việc này.');
      if (!to && m.role !== 'manager') throw new AppError(400, 'Chọn người nhận việc.');
      await assertAssignee(c, to);
      if (to !== t.assigneeId) { set.assigneeId = to; reassigned = to; }
    }
    if (b.status !== undefined) {
      if (!TASK_STATUSES.includes(b.status as TaskStatus)) throw new AppError(400, 'Trạng thái không hợp lệ.');
      if (b.status === 'cancelled' && !manage) throw new AppError(403, 'Chỉ người giao việc hoặc Manager huỷ được việc.');
      Object.assign(set, statusPatch(b.status as TaskStatus, m.id, t));
    }
    await c.env.db.update(tasks).set({ ...set, revision: sql`${tasks.revision} + 1` }).where(eq(tasks.id, t.id));
    if (reassigned && reassigned !== m.id) await notify(c.env, { eventType: 'task_assigned', title: 'Bạn được giao việc', body: `${m.name}: ${t.title}`, url: `/index.html#/tasks/${t.id}`,
      targetMemberId: reassigned, actorId: m.id, data: { taskId: t.id } });
    if (b.status === 'done' && t.status !== 'done' && t.createdBy && t.createdBy !== m.id) await notify(c.env, { eventType: 'task_done', title: 'Việc đã hoàn thành', body: `${m.name}: ${t.title}`,
      url: `/index.html#/tasks/${t.id}`, targetMemberId: t.createdBy, actorId: m.id, data: { taskId: t.id } });
    return json({ ok: true });
  }, 'business');

  router.get('/tasks/:id', async c => {
    const t = await loadTask(c, c.params.id!);
    const ids = [t.assigneeId, t.createdBy, t.completedBy].filter(Boolean) as string[];
    const people = ids.length ? await c.env.db.select({ id: employees.id, name: employees.name }).from(employees).where(inArray(employees.id, ids)) : [];
    const name = (id: string | null) => id ? people.find(x => x.id === id)?.name ?? '' : '';
    return json({ task: { ...t, auto: !!t.autoKey, autoKey: undefined, assigneeName: name(t.assigneeId), creatorName: t.createdBy ? name(t.createdBy) : 'Hệ thống',
      completedByName: name(t.completedBy), due: dueBucket(t.dueDate, vietnamDate().iso), canManage: canManage(c, t), canDelete: !t.autoKey && canManage(c, t) } });
  }, 'business');

  router.delete('/tasks/:id', async c => {
    const t = await loadTask(c, c.params.id!);
    if (t.autoKey) throw new AppError(409, 'Việc tự sinh không xoá được; việc sẽ tự hoàn thành khi xử lý xong chứng từ.');
    if (!canManage(c, t)) throw new AppError(403, 'Chỉ người giao việc hoặc Manager xoá được.');
    await c.env.db.delete(tasks).where(eq(tasks.id, t.id));
    return json({ ok: true });
  }, 'business');

  router.get('/tasks/:id/comments', async c => {
    const t = await loadTask(c, c.params.id!);
    const rows = await c.env.db.select({ id: taskComments.id, body: taskComments.body, createdAt: taskComments.createdAt, memberId: taskComments.memberId, name: employees.name })
      .from(taskComments).innerJoin(employees, eq(employees.id, taskComments.memberId)).where(eq(taskComments.taskId, t.id)).orderBy(asc(taskComments.createdAt)).limit(300);
    return json({ comments: rows });
  }, 'business');

  /** Trao đổi trong việc: báo người còn lại (người giao ↔ người nhận). */
  router.post('/tasks/:id/comments', async c => {
    const m = me(c), t = await loadTask(c, c.params.id!), body = str((await readJson(c.req, 8_000)).body, 2000);
    if (!body) throw new AppError(400, 'Nhập nội dung trao đổi.');
    const id = crypto.randomUUID();
    await c.env.db.insert(taskComments).values({ id, taskId: t.id, memberId: m.id, body, createdAt: nowIso() });
    for (const to of new Set([t.assigneeId, t.createdBy].filter(x => x && x !== m.id) as string[]))
      await notify(c.env, { eventType: 'task_comment', title: `Trao đổi: ${t.title}`, body: `${m.name}: ${body.slice(0, 160)}`, url: `/index.html#/tasks/${t.id}`, targetMemberId: to, actorId: m.id, data: { taskId: t.id } });
    return json({ id }, 201);
  }, 'business');
}
