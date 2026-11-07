import type {DashboardReportScoresOf} from '../../../core/contracts/report-scores.ts';
import { and, asc, count, desc, eq, exists, gte, inArray, isNull, lt, max, ne, or, sql } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import { cachedReport } from '../../../core/cache/report-cache.ts';
import { json, type Router } from '../../../core/http/router.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees, positions } from '../../staff/schema.ts';
import { customers, customerStaff } from '../../customers/schema.ts';
import { customerActivities as care } from '../../care/schema.ts';
import { salesContracts, salesOrders as orders } from '../../sales/schema.ts';
import { quotations as quotes } from '../../quotes/schema.ts';
import { sapoHealthMonitorState } from '../../integrations/schema.ts';
import { vietnamDate } from '../../sales/domain/sales.ts';
import { dashboardFilters } from '../domain/filters.ts';
import type { DashboardKpiOf } from '../../../core/contracts/dashboard-kpi.ts';
import type { DashboardStoreOf } from '../../../core/contracts/dashboard-store.ts';

const amount = (column: typeof orders.total | typeof care.expectedRevenue) => sql<number>`coalesce(sum(${column}), 0)`.mapWith(Number);
const ratio = (part: number, whole: number) => whole ? Math.round(part / whole * 1000) / 10 : null;
/** Pipeline chỉ tính cơ hội còn "sống": lần chăm sóc mới nhất không quá N ngày trước cuối kỳ. */
export const PIPELINE_FRESH_DAYS = 90;
/**
 * Bản tính sẵn 30 phút cho từng người xem + bộ lọc (core/cache/report-cache.ts); `refresh=1` (nút "Cập nhật") tính lại.
 * Khoá gồm vai trò và quyền xem toàn công ty, nên đổi quyền không bao giờ lộ bản tính của phạm vi cũ.
 */
const viewerKey = (me: { id: string; role: string }, f: { manager: boolean }) => `${me.id}:${me.role}:${f.manager ? 'all' : 'self'}`;
const cacheOf = (c: { url: URL }, scope: string, me: { id: string; role: string }, f: { manager: boolean }) =>
  ({ scope, viewer: viewerKey(me, f), params: c.url.searchParams, refresh: c.url.searchParams.get('refresh') === '1' });
const blank = () => ({ actual: 0, orders: 0, expected: 0, pipeline: 0, consulting: 0, quote_sent: 0, negotiating: 0, lost: 0, quotes: 0, converted: 0 });

/** Only GET. All totals are DB aggregates; no limit on source orders/activities. */
export function registerDashboardRoutes(router: Router<StaffEnv>, deps: { kpiOf?: DashboardKpiOf; storeOf?: DashboardStoreOf; reportScoresOf?:DashboardReportScoresOf } = {}) {
  /**
   * Điểm KPI Sale một tháng (mặc định tháng cuối kỳ) – tách khỏi /dashboard/revenue để trang doanh số không chờ phần tính lương.
   * Cùng bộ lọc / quyền với doanh số; KPI người khác chỉ Manager xem (như phiếu lương). Quyền "Doanh số toàn công ty" không mở KPI người khác.
   */
  router.get('/dashboard/report-scores',async c=>{
    const me=(c.state.session as SessionState|undefined)?.member;
    if(!me)throw new AppError(401,'Vui lòng đăng nhập.');
    const f=dashboardFilters(c.url.searchParams,me,vietnamDate().iso),month=c.url.searchParams.get('month')||f.months.at(-1)!;
    if(!f.months.includes(month))throw new AppError(400,'Tháng điểm báo cáo phải nằm trong kỳ đang xem.');
    const manager=me.role==='manager';
    if(!manager&&f.owner&&f.owner!==me.id)throw new AppError(403,'Chỉ Manager xem được điểm báo cáo của nhân viên khác.');
    const ids=(await c.env.db.select({id:employees.id}).from(employees).where(and(inArray(employees.role,['manager','employee']),isNull(employees.deletedAt),manager?undefined:eq(employees.id,me.id),f.owner?eq(employees.id,f.owner):undefined,manager&&f.group?eq(employees.positionId,f.group):undefined))).map(r=>r.id);
    return json(await cachedReport(c.env.db,cacheOf(c,'dashboard-report-scores',me,f),async()=>{
      const members=deps.reportScoresOf?await deps.reportScoresOf(c.env.db,month,ids):[];
      return {month,available:!!deps.reportScoresOf,scope:manager&&!f.owner?'company':'self',members};
    }));
  },'business');

  router.get('/dashboard/kpi', async c => {
    const me = (c.state.session as SessionState | undefined)?.member;
    if (!me) throw new AppError(401, 'Vui lòng đăng nhập.');
    const f = dashboardFilters(c.url.searchParams, me, vietnamDate().iso);
    const month = c.url.searchParams.get('month') || f.months.at(-1)!;
    if (!f.months.includes(month)) throw new AppError(400, 'Tháng KPI phải nằm trong kỳ đang xem.');
    const manager = me.role === 'manager';
    if (!manager && f.owner && f.owner !== me.id) throw new AppError(403, 'Chỉ Manager xem được KPI của nhân viên khác.');
    if (!deps.kpiOf) return json({ month, available: false, scope: manager ? 'company' : 'self', members: [] });
    const ids = (await c.env.db.select({ id: employees.id }).from(employees).where(and(
      inArray(employees.role, ['manager', 'employee']), isNull(employees.deletedAt),
      manager ? undefined : eq(employees.id, me.id),
      f.owner ? eq(employees.id, f.owner) : undefined,
      manager && f.group ? eq(employees.positionId, f.group) : undefined))).map(r => r.id);
    const kpiOf = deps.kpiOf;
    return json(await cachedReport(c.env.db, cacheOf(c, 'dashboard-kpi', me, f), async () => {
      const members = (await kpiOf(c.env.db, month, ids)).sort((a, b) => b.used - a.used || a.name.localeCompare(b.name, 'vi'));
      return { month, available: true, scope: manager && !f.owner ? 'company' : 'self', restricted: !manager && f.manager, members };
    }));
   }, 'business');

  /**
   * Doanh số chung cửa hàng (CRM + POS), chỉ tiêu, mốc / tỷ lệ thưởng và DS từng nhân viên của cửa hàng – một tháng.
   * Manager / quyền "Doanh số toàn công ty" xem mọi cửa hàng; nhân viên chỉ thấy cửa hàng mình thuộc (nhóm lương,
   * cửa hàng trưởng hoặc có mở ca POS trong tháng). Người không thuộc cửa hàng nào: available=false.
   */
  router.get('/dashboard/store', async c => {
    const me = (c.state.session as SessionState | undefined)?.member;
    if (!me) throw new AppError(401, 'Vui lòng đăng nhập.');
    const today = vietnamDate().iso, raw = c.url.searchParams.get('month') || today.slice(0, 7);
    const f = dashboardFilters(new URLSearchParams({ from: raw, to: raw }), me, today);
    const month = f.months[0]!;
    return json(await cachedReport(c.env.db, cacheOf(c, 'dashboard-store', me, f), async () => {
      const board = deps.storeOf ? await deps.storeOf(c.env.db, month) : null;
      const stores = (board?.stores ?? []).filter(s => f.manager || s.members.some(m => m.id === me.id));
      return { month, available: stores.length > 0, scope: f.manager ? 'company' : 'self', me: me.id, today, policyMonth: board?.policyMonth ?? null, stores };
    }));
  }, 'business');

  router.get('/dashboard/revenue', async c => {
    const me = (c.state.session as SessionState | undefined)?.member;
    if (!me) throw new AppError(401, 'Vui lòng đăng nhập.');
    const f = dashboardFilters(c.url.searchParams, me, vietnamDate().iso);
    // One read-only snapshot keeps totals, tables and pagination consistent during concurrent updates.
    const data = await cachedReport(c.env.db, cacheOf(c, 'dashboard-revenue', me, f), () => c.env.db.transaction(async db => {
      const selected = db.select({ id: employees.id }).from(employees).where(and(
        inArray(employees.role, ['manager', 'employee']),
        f.manager ? undefined : eq(employees.id, me.id),
        f.owner ? eq(employees.id, f.owner) : undefined,
        f.group ? eq(employees.positionId, f.group) : undefined));
      const [members, groups, visibleRoster] = await Promise.all([
        db.select({ id: employees.id, name: employees.name, groupId: employees.positionId, groupName: positions.name, active: employees.active, deletedAt: employees.deletedAt })
          .from(employees).leftJoin(positions, eq(employees.positionId, positions.id)).where(inArray(employees.id, selected)).orderBy(asc(employees.name)),
        f.manager ? db.select({ id: positions.id, name: positions.name }).from(positions).orderBy(asc(positions.name)) : Promise.resolve([]),
        // Match the staff page: soft-deleted accounts are hidden; locked accounts remain visible.
        f.manager ? db.select({ id: employees.id, name: employees.name }).from(employees)
          .where(and(inArray(employees.role, ['manager', 'employee']), isNull(employees.deletedAt))).orderBy(asc(employees.name)) : Promise.resolve([]),
      ]);
      if (!f.manager && f.owner && !members.some(m => m.id === f.owner)) throw new AppError(403, 'Không có quyền xem nhân viên này.');
      // EXISTS prevents multiplying a single order when historical contracts exist.
      const signed = exists(db.select({ id: salesContracts.id }).from(salesContracts).where(and(eq(salesContracts.orderId, orders.id), inArray(salesContracts.status, ['signed', 'completed']))));
      const counted = and(ne(orders.status, 'cancelled'), or(ne(orders.status, 'draft'), signed));
      const orderMonth = sql<string>`substr(${orders.orderDate}, 1, 7)`;
      const actual = await db.select({ owner: orders.ownerId, month: orderMonth.as('month'), actual: amount(orders.total), orders: count() })
        .from(orders).where(and(inArray(orders.ownerId, selected), counted, gte(orders.orderDate, f.from), lt(orders.orderDate, f.next)))
        .groupBy(orders.ownerId, orderMonth);
      // Employee care metrics never expose customers merely shared with them or another employee's log.
      const careOwnedCustomer = f.manager ? undefined : exists(db.select({ id: customerStaff.customerId }).from(customerStaff)
        .where(and(eq(customerStaff.customerId, care.customerId), inArray(customerStaff.memberId, selected), eq(customerStaff.role, 'owner'))));
      const careMonth = sql<string>`to_char(${care.occurredAt}::timestamptz at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM')`;
      // Text timestamps are canonical UTC; use timestamptz for VN midnight boundaries.
      const inPeriod = and(sql`${care.occurredAt}::timestamptz >= ${f.from + 'T00:00:00+07:00'}::timestamptz`,
        sql`${care.occurredAt}::timestamptz < ${f.next + 'T00:00:00+07:00'}::timestamptz`);
      const latest = db.$with('dashboard_latest').as(db.selectDistinctOn([care.ownerId, care.customerId], {
        owner: care.ownerId, customer: care.customerId, result: care.result, expected: care.expectedRevenue, at: care.occurredAt,
      }).from(care).where(and(inArray(care.ownerId, selected), careOwnedCustomer,
        sql`${care.occurredAt}::timestamptz < ${f.next + 'T00:00:00+07:00'}::timestamptz`))
        .orderBy(care.ownerId, care.customerId, desc(care.occurredAt), desc(care.updatedAt), desc(care.id)));
      const pipeline = await db.with(latest).select({ owner: latest.owner, stage: latest.result, value: sql<number>`sum(${latest.expected})`.mapWith(Number) })
        .from(latest).where(and(inArray(latest.result, ['consulting', 'quote_sent', 'negotiating']),
          // Khách để quá lâu không cập nhật không còn tính là đang theo đuổi.
          sql`${latest.at}::timestamptz >= ${f.next + 'T00:00:00+07:00'}::timestamptz - make_interval(days => ${PIPELINE_FRESH_DAYS})`))
        .groupBy(latest.owner, latest.result);
      const monthlyCare = db.$with('dashboard_monthly_care').as(db.selectDistinctOn([care.ownerId, care.customerId, careMonth], {
        owner: care.ownerId, customer: care.customerId, month: careMonth.as('month'), expected: care.expectedRevenue, result: care.result,
      }).from(care).where(and(inArray(care.ownerId, selected), careOwnedCustomer, inPeriod))
        .orderBy(care.ownerId, care.customerId, careMonth, desc(care.occurredAt), desc(care.updatedAt), desc(care.id)));
      const expected = await db.with(monthlyCare).select({ owner: monthlyCare.owner, month: monthlyCare.month,
        expected: sql<number>`coalesce(sum(${monthlyCare.expected}) filter (where ${monthlyCare.result} <> 'lost'), 0)`.mapWith(Number),
        lost: sql<number>`count(*) filter (where ${monthlyCare.result} = 'lost')`.mapWith(Number),
      }).from(monthlyCare).groupBy(monthlyCare.owner, monthlyCare.month);
      const periodCare = db.$with('dashboard_period_care').as(db.selectDistinctOn([care.ownerId, care.customerId], {
        owner: care.ownerId, customer: care.customerId, expected: care.expectedRevenue, result: care.result,
      }).from(care).where(and(inArray(care.ownerId, selected), careOwnedCustomer, inPeriod))
        .orderBy(care.ownerId, care.customerId, desc(care.occurredAt), desc(care.updatedAt), desc(care.id)));
      const periodExpected = await db.with(periodCare).select({ owner: periodCare.owner,
        expected: sql<number>`coalesce(sum(${periodCare.expected}) filter (where ${periodCare.result} <> 'lost'), 0)`.mapWith(Number),
        lost: sql<number>`count(*) filter (where ${periodCare.result} = 'lost')`.mapWith(Number),
      }).from(periodCare).groupBy(periodCare.owner);
      const quoteOwner = sql<string>`coalesce(${quotes.assigneeId}, ${quotes.creatorId})`;
      const quoteDay = sql<string>`coalesce(nullif(${quotes.quoteDate}, ''), substr(${quotes.createdAt}, 1, 10))`;
      const quoteMonth = sql<string>`substr(${quoteDay}, 1, 7)`;
      const converted = exists(db.select({ id: orders.id }).from(orders).where(and(eq(orders.quoteId, quotes.id), ne(orders.status, 'cancelled'), f.owner || f.group || !f.manager ? inArray(orders.ownerId, selected) : undefined)));
      const conversion = await db.select({ owner: quoteOwner.as('owner'), month: quoteMonth.as('month'), quotes: count(),
        converted: sql<number>`count(*) filter (where ${converted})`.mapWith(Number),
      }).from(quotes).where(and(inArray(quoteOwner, selected), gte(quoteDay, f.from), lt(quoteDay, f.next))).groupBy(quoteOwner, quoteMonth);
      const employeeRows = members.map(m => ({ ...m, ...blank() }));
      const monthRows = f.months.map(month => ({ month, ...blank() }));
      const rowsById = new Map(employeeRows.map(r => [r.id, r]));
      for (const r of [...actual, ...expected, ...conversion]) {
        const e = 'expected' in r ? undefined : rowsById.get(r.owner), m = monthRows.find(m => m.month === r.month);
        for (const k of ['actual', 'orders', 'expected', 'lost', 'quotes', 'converted'] as const) {
          const value = k in r ? Number(r[k as keyof typeof r]) : 0;
          if (e) e[k] += value; if (m) m[k] += value;
        }
      }
      for (const r of periodExpected) { const e = rowsById.get(r.owner); if (e) { e.expected = r.expected; e.lost = r.lost; } }
      for (const p of pipeline) { const e = rowsById.get(p.owner); if (e) { e.pipeline += p.value; e[p.stage as 'consulting' | 'quote_sent' | 'negotiating'] += p.value; } }
      const summary = blank(); const teamRows = new Map<string, ReturnType<typeof blank> & { id: string; name: string }>();
      for (const e of employeeRows) {
        const id = e.groupId ?? '', team = teamRows.get(id) ?? { id, name: e.groupName ?? 'Chưa phân nhóm', ...blank() };
        for (const k of Object.keys(summary) as (keyof typeof summary)[]) { summary[k] += e[k]; team[k] += e[k]; }
        teamRows.set(id, team);
      }
      const lastCare = db.$with('dashboard_last_care').as(db.select({ customer: care.customerId, lastAt: max(care.occurredAt).as('last_at') }).from(care)
        .where(f.manager ? undefined : inArray(care.ownerId, selected)).groupBy(care.customerId));
      const staleBefore = new Date(Date.parse(f.today + 'T00:00:00+07:00') - f.neglectDays * 86400000).toISOString();
      const ownCustomer = exists(db.select({ id: customerStaff.customerId }).from(customerStaff).where(and(eq(customerStaff.customerId, customers.id),
        eq(customerStaff.role, 'owner'), inArray(customerStaff.memberId, selected))));
      // Toàn công ty: chỉ khách đã có người phụ trách (khách đồng bộ Sapo chưa giao ai không tính là "bỏ quên").
      const anyOwner = exists(db.select({ id: customerStaff.customerId }).from(customerStaff).where(and(eq(customerStaff.customerId, customers.id), eq(customerStaff.role, 'owner'))));
      const customerScope = (!f.manager || f.owner || f.group) ? ownCustomer : anyOwner;
      const stale = and(customerScope, or(isNull(lastCare.lastAt), lt(lastCare.lastAt, staleBefore)));
      const [neglectCount] = await db.with(lastCare).select({ count: count() }).from(customers).leftJoin(lastCare, eq(lastCare.customer, customers.id)).where(stale);
      const neglected = await db.with(lastCare).select({ id: customers.id, name: customers.name, lastAt: lastCare.lastAt })
        .from(customers).leftJoin(lastCare, eq(lastCare.customer, customers.id)).where(stale)
        .orderBy(sql`${lastCare.lastAt} asc nulls first`, asc(customers.id)).limit(25).offset((f.page - 1) * 25);
      // Select a timestamp only, never read/return Sapo session, cookie or raw monitor JSON.
      const [sync] = await db.select({ at: sql<string | null>`case when (${sapoHealthMonitorState.data}::jsonb ->> 'ok') = 'true' then ${sapoHealthMonitorState.data}::jsonb ->> 'finishedAt' else null end` })
        .from(sapoHealthMonitorState).where(eq(sapoHealthMonitorState.id, 'pull')).limit(1);
      const [customerSync] = await db.select({ at: max(sql<string>`nullif(${customers.syncedAt}, '')`) }).from(customers).where(sql`${customers.id} ~ '^[0-9]+$'`);
      const syncAt = sync?.at && (!customerSync?.at || sync.at >= customerSync.at) ? sync.at : customerSync?.at ?? null;
      const rates = <T extends { converted: number; quotes: number }>(r: T) => ({ ...r, closeRate: ratio(r.converted, r.quotes) });
      return { scope: f.manager ? 'company' : 'self', from: f.from, to: f.months.at(-1), summary: rates(summary),
        employees: employeeRows.filter(e => e.deletedAt === null).map(({ deletedAt, ...row }) => rates(row)), groups: f.manager ? [...teamRows.values()].map(rates) : [], months: monthRows.map(rates),
        filters: { employees: visibleRoster, groups },
        neglected: { total: neglectCount?.count ?? 0, page: f.page, pageSize: 25, days: f.neglectDays, customers: neglected },
        lastSyncedAt: syncAt, syncSource: syncAt && syncAt === sync?.at ? 'sapo-pull' : syncAt ? 'customers' : null,
        calculatedAt: new Date().toISOString() };
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' }));
    return json(data);
  }, 'business');
}
