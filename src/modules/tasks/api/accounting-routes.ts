import { and, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import type { StaffEnv, SessionState } from '../../staff/api/auth-routes.ts';
import { employees } from '../../staff/schema.ts';
import { tasks } from '../schema.ts';
import { accountingKind, canUseAccountingTasks } from '../domain/accounting.ts';
import { dueBucket, isOpen } from '../domain/task-config.ts';
import { vietnamDate } from '../../sales/domain/sales.ts';
import { addDaysIso } from '../domain/task-config.ts';
import { accountingSources } from './accounting-sources.ts';
import { accountingDiagnostics } from './accounting-diagnostics.ts';
import { accountingChecks } from './accounting-checks.ts';
type Ctx = RouteContext<StaffEnv>;
type Task = typeof tasks.$inferSelect;
export interface AccountingAccess {
  sync(c: Ctx): Promise<unknown>; visible(c: Ctx): SQL | undefined; colleagues(c: Ctx): SQL | undefined;
  loadTask(c: Ctx, id: string): Promise<Task>; private(c: Ctx, t: Task): boolean;
  serialize(c: Ctx, t: Task): { viewOnly: boolean; canClaim: boolean; canComment: boolean; [key: string]: unknown };
}
const me = (c: Ctx) => (c.state.session as SessionState).member;
const check = (c: Ctx) => { if (!canUseAccountingTasks(me(c))) throw new AppError(403, 'Bạn không thuộc nhóm Kế toán.'); };
const kindSql = or(...['invoice:', 'invoice-web:', 'po-pay:', 'debt-overdue-acc:'].map(p => sql`${tasks.autoKey} like ${p + '%'}`));
const localDay = (s: string | null) => s && Number.isFinite(Date.parse(s)) ? vietnamDate(new Date(s)).iso : null;
export function registerAccountingTaskRoutes(router: Router<StaffEnv>, access: AccountingAccess) {
  router.get('/tasks/accounting', async c => {
    check(c); await access.sync(c);
    const member = me(c), today = vietnamDate().iso, params = c.url.searchParams;
    const view = params.get('view') || 'team', kind = params.get('kind') || '', q = (params.get('q') || '').trim().toLocaleLowerCase('vi');
    if (!['team', 'mine', 'colleagues', 'closed_today'].includes(view) || !['', 'invoice', 'web', 'purchase', 'debt'].includes(kind)) throw new AppError(400, 'Bộ lọc công việc không hợp lệ.');
    const peers = access.colleagues(c), offset = Number(params.get('offset') || 0);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new AppError(400, 'Trang công việc không hợp lệ.');
    const rows = await c.env.db.select().from(tasks).where(and(access.visible(c), kindSql));
    const peerIds = peers ? new Set((await c.env.db.select({ id: tasks.id }).from(tasks).where(and(access.visible(c), kindSql, peers))).map(t => t.id)) : new Set<string>();
    const sources = await accountingSources(c.env.db, member, rows, today, t => access.private(c, t));
    const peopleIds = [...new Set(rows.flatMap(t => [t.assigneeId, t.createdBy, t.completedBy]).filter((s): s is string => !!s))];
    const people = peopleIds.length ? await c.env.db.select({ id: employees.id, name: employees.name }).from(employees).where(inArray(employees.id, peopleIds)) : [];
    const name = (id: string | null) => people.find(p => p.id === id)?.name || '';
    const open = rows.filter(t => isOpen(t.status));
    const team = (t: Task) => !t.assigneeId && t.assigneePosition === 'accounting';
    const colleague = (t: Task) => peerIds.has(t.id) && !access.private(c, t);
    const closedToday = (t: Task) => !isOpen(t.status) && localDay(t.completedAt) === today;
    const past = (t: Task) => !!t.dueDate && t.dueDate < today;
    const invoices = open.filter(t => ['invoice', 'web'].includes(accountingKind(t.autoKey) || ''));
    const purchases = open.filter(t => accountingKind(t.autoKey) === 'purchase' && !!t.dueDate && t.dueDate <= addDaysIso(today, 3));
    const debts = open.filter(t => accountingKind(t.autoKey) === 'debt');
    const periods = (ts: Task[]) => ts.reduce((n, t) => n + (sources.get(t.id)?.periodCount ?? 1), 0);
    const sum = (ts: Task[]) => ts.reduce((n, t) => n + (sources.get(t.id)?.amount ?? 0), 0);
    const warnings = rows.filter(t => ((t.status === 'done' && !!t.completedBy) || t.status === 'cancelled') && sources.get(t.id)?.outstanding === true)
      .map(t => ({ id: t.id, title: t.title, closedAt: t.completedAt, closedByName: name(t.completedBy), source: sources.get(t.id)! }));
    let result = rows.filter(t => view === 'closed_today' ? closedToday(t) : isOpen(t.status) && (view === 'team' ? team(t) : view === 'mine' ? t.assigneeId === member.id : !!peers && colleague(t)));
    if (kind) result = result.filter(t => accountingKind(t.autoKey) === kind);
    if (q) result = result.filter(t => [t.title, sources.get(t.id)?.docNo || '', access.private(c, t) && sources.get(t.id)?.available ? t.description : ''].some(s => s.toLocaleLowerCase('vi').includes(q)));
    result.sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || a.createdAt.localeCompare(b.createdAt));
    const list = result.slice(offset, offset + 100).map(t => ({ ...access.serialize(c, t), link: sources.get(t.id)?.link || '', ...(!sources.get(t.id)?.available ? { description: '' } : {}), assigneeName: name(t.assigneeId), creatorName: name(t.createdBy) || 'Hệ thống',
      completedByName: name(t.completedBy), due: dueBucket(t.dueDate, today), sourceData: sources.get(t.id) }));
    const sourceWarnings = await accountingDiagnostics(c.env.db, member, today);
    return json({ today, syncedAt: new Date().toISOString(), canViewColleagues: !!peers, sourceWarnings,
      tabs: { team: open.filter(team).length, mine: open.filter(t => t.assigneeId === member.id).length, colleagues: peers ? open.filter(colleague).length : 0, closed_today: rows.filter(closedToday).length },
      kpis: { invoices: { count: invoices.length, overdue: invoices.filter(past).length }, purchases: { count: periods(purchases), amount: sum(purchases), overdue: periods(purchases.filter(past)) },
        debts: { count: new Set(debts.map(t => t.sourceId)).size, amount: sum(debts) }, unclaimed: open.filter(team).length,
        unavailableAmounts: open.filter(t => !sources.get(t.id)?.available).length }, warnings,
      tasks: list, total: result.length, nextOffset: offset + 100 < result.length ? offset + 100 : null });
  }, 'business');
  /** "Cần kiểm tra": thu trùng, yêu cầu xuất HĐ quá hạn, phiếu chi lớn chưa ảnh – chỉ đọc (accounting-checks.ts). */
  router.get('/tasks/accounting/checks', async c => {
    check(c);
    return json(await accountingChecks(c.env.db, me(c), vietnamDate().iso));
  }, 'business');
  router.get('/tasks/accounting/:id', async c => {
    check(c); const t = await access.loadTask(c, c.params.id!);
    if (!accountingKind(t.autoKey)) throw new AppError(404, 'Không tìm thấy công việc kế toán.');
    const today = vietnamDate().iso, source = (await accountingSources(c.env.db, me(c), [t], today, x => access.private(c, x))).get(t.id);
    const ids = [t.assigneeId, t.completedBy].filter((s): s is string => !!s);
    const people = ids.length ? await c.env.db.select({ id: employees.id, name: employees.name }).from(employees).where(inArray(employees.id, ids)) : [];
    const name = (id: string | null) => people.find(p => p.id === id)?.name || '';
    const history = [t.createdAt ? { at: t.createdAt, label: 'Hệ thống tạo việc' } : null,
      t.startedAt ? { at: t.startedAt, label: 'Bắt đầu xử lý' } : null,
      t.completedAt ? { at: t.completedAt, label: t.completedBy ? 'Đóng việc bằng tay' : 'Tự hoàn thành theo chứng từ' } : null].filter(Boolean);
    return json({ today, task: { ...access.serialize(c, t), link: source?.link || '', ...(!source?.available ? { description: '' } : {}), assigneeName: name(t.assigneeId), completedByName: name(t.completedBy), sourceData: source, history } });
  }, 'business');
}
