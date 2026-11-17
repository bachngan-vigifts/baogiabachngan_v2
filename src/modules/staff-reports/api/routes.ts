import {workspaceSchema,workspaceProblems,workspaceForecast,type WorkspaceInputs} from '../domain/workspace.ts';
import {weeklyWorkspaceFacts,workspaceFactView,type WeeklyTaskServices} from './workspace.ts';
/**
 * BÁO CÁO TUẦN Sale / Sale Admin – khu vực `business`. Xem domain/weekly.ts cho hạn nộp, điểm, công thức Tiền trách nhiệm.
 *  GET  /staff-reports/me?month                 các tuần của tháng (trạng thái, điểm) + việc cần nộp
 *  GET  /staff-reports/week?period[&memberId]   số liệu CRM tự tính + nháp + báo cáo + lịch sử nộp (memberId: chỉ Manager)
 *  PUT  /staff-reports/draft                    lưu nháp (không tính là đã nộp)
 *  POST /staff-reports                          nộp chính thức / nộp lại (tuần phải kết thúc; giữ giờ nộp đầu; đã duyệt thì khoá)
 *  GET  /staff-reports/review?month             Manager: mọi Sale / Sale Admin × tuần của tháng
 *  POST /staff-reports/:id/review               Manager: Đạt / Chưa đạt (bắt buộc lý do) / Miễn (bắt buộc lý do)
 * Nhân viên chỉ xem / nộp báo cáo của chính mình – kiểm tra ở máy chủ.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, ne, sql } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import { json, readJson, type Router } from '../../../core/http/router.ts';
import type { AnyDb } from '../../../core/db/client.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees } from '../../staff/schema.ts';
import { customerPayments, deliveries, salesContracts, salesOrderLines, salesOrders } from '../../sales/schema.ts';
import { debtCounts, orderLinesFromQuote, quoteTotal } from '../../sales/domain/sales.ts';
import { netReceivables } from '../../sales/api/pos-return-credit.ts';
import { customers } from '../../customers/schema.ts';
import { newCustomerFacts } from '../../customers/api/kpi-facts.ts';
import { quotations } from '../../quotes/schema.ts';
import { activityFacts } from '../../care/api/kpi-facts.ts';
import type { SalePayrollPreviewOf, SaleTargetOf, WeeklyReportPointsOf } from '../../../core/contracts/weekly-report.ts';
import { staffWeeklyReportDrafts, staffWeeklyReportVersions, staffWeeklyReports } from '../schema.ts';
import {
  INDUSTRIES, INDUSTRY_LABEL, WEEKLY_LIMITS, WEEKLY_POSITIONS, industryOf, weeklyProblems, type WeeklyInputs, WEEKLY_REVIEWS, WEEKLY_REVIEW_LABEL, addDays, appliesTo, canSubmitWeek, isWeek, mondayOf, monthPoints, vnDay,
  MONTHLY_REPORT_FROM, canSubmitMonth, isMonthPeriod, monthStarted, monthlyDeadline, monthlyOpensAt, monthlyProblems, monthlyRequired, monthlyScore, monthlyState, nextMonth, shiftMonths, type MonthlyInputs,
  beforeLaunch, weekScore, weekStarted, weekState, weeklyDeadline, weeklyOpensAt, weeksOfMonth, type WeeklyReview,
} from '../domain/weekly.ts';

type Ctx = Parameters<Parameters<Router<StaffEnv>['get']>[1]>[0];
const me = (c: Ctx) => (c.state.session as SessionState).member;
const nowIso = () => new Date().toISOString();
const text = (v: unknown, max: number = WEEKLY_LIMITS.text) => String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
const isMonth = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const canonical=(v:unknown):string=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical((v as Record<string,unknown>)[k])).join(',')+'}':JSON.stringify(v);
const payloadHash=async(v:unknown)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(v))))].map(n=>n.toString(16).padStart(2,'0')).join('');
const parse = (s: string | null) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
const reports = (m: { role: string; positionId?: string | null }) => m.role === 'employee' && WEEKLY_POSITIONS.includes(m.positionId as never);
const isManager = (m: { role: string }) => m.role === 'manager';

/** Thành viên phải nộp báo cáo tuần (đang làm, chức vụ Sale / Sale Admin). */
async function reporters(db: AnyDb, ids?: readonly string[]) {
  return db.select({ id: employees.id, name: employees.name, positionId: employees.positionId }).from(employees)
    .where(and(eq(employees.role, 'employee'), inArray(employees.positionId, [...WEEKLY_POSITIONS]), isNull(employees.deletedAt), ids ? inArray(employees.id, [...ids]) : undefined))
    .orderBy(asc(employees.name));
}
/** Điểm báo cáo tuần theo tháng cho bảng lương (chỉ người phải nộp, tháng đã áp dụng). */
export const weeklyPointsFor: WeeklyReportPointsOf = async (db, month, memberIds) => {
  const out = new Map<string, Awaited<ReturnType<WeeklyReportPointsOf>> extends Map<string, infer V> ? V : never>();
  if (!appliesTo(month) || !memberIds.length) return out;
  const people = await reporters(db, memberIds), weeks = weeksOfMonth(month);
  if (!people.length) return out;
  const rows = await db.select({ memberId: staffWeeklyReports.memberId, period: staffWeeklyReports.period, submittedAt: staffWeeklyReports.submittedAt, review: staffWeeklyReports.review })
    .from(staffWeeklyReports).where(and(inArray(staffWeeklyReports.memberId, people.map(p => p.id)), inArray(staffWeeklyReports.period, [...weeks, month])));
  const now = nowIso();
  for (const p of people) {
    const mine = new Map(rows.filter(r => r.memberId === p.id).map(r => [r.period, { submittedAt: r.submittedAt, review: r.review as WeeklyReview }]));
    const m = monthPoints(month, mine, now);
    out.set(p.id, { points: m.points, required: m.required, weeks: m.weeks, monthly: m.monthly });
  }
  return out;
};

const VN_TODAY = () => vnDay(nowIso());
const itemsText = (lines: readonly { name: string; qty: number }[]) => {
  const top = lines.slice(0, 2).map(l => `${Math.round(l.qty * 100) / 100} ${l.name}`).join(' + ');
  return lines.length > 2 ? `${top} + ${lines.length - 2} mục khác` : top;
};

/** Số liệu tuần của một nhân viên (chỉ dữ liệu của chính người đó; không có lương, không có khách người khác phụ trách). */
async function weekFacts(db: AnyDb, memberId: string, monday: string, targetOf?: SaleTargetOf) {
  const sunday = addDays(monday, 6), next = addDays(monday, 7), month = sunday.slice(0, 7), today = VN_TODAY();
  const counted = and(eq(salesOrders.ownerId, memberId), ne(salesOrders.status, 'cancelled'), ne(salesOrders.status, 'draft'));
  const quoteOwner = sql<string>`coalesce(${quotations.assigneeId}, ${quotations.creatorId})`;
  const quoteDay = sql<string>`coalesce(nullif(${quotations.quoteDate}, ''), substr(${quotations.createdAt}, 1, 10))`;
  const [weekOrders, mtd, newCustomers, quoteRows, contracts, care, target, ships, recv, workspace] = await Promise.all([
    db.select({ id: salesOrders.id, orderNo: salesOrders.orderNo, customerName: salesOrders.customerName, total: salesOrders.total }).from(salesOrders)
      .where(and(counted, gte(salesOrders.orderDate, monday), lte(salesOrders.orderDate, sunday))).orderBy(desc(salesOrders.total)),
    db.select({ revenue: sql<number>`coalesce(sum(${salesOrders.total}),0)`.mapWith(Number) }).from(salesOrders)
      .where(and(counted, gte(salesOrders.orderDate, month + '-01'), lte(salesOrders.orderDate, sunday))),
    newCustomerFacts(db, monday, next),
    // Câu con trong phần select: Drizzle không ghi tên bảng cho cột ngoài → ghi tên bảng tường minh.
    db.select({ id: quotations.id, quoteNo: quotations.quoteNo, customer: quotations.customer, data: quotations.data,
      won: sql<boolean>`exists (select 1 from ${salesOrders} o where o.quote_id = "staff_quotations"."id" and o.status <> 'cancelled')` })
      .from(quotations).where(and(eq(quoteOwner, memberId), gte(quoteDay, monday), lte(quoteDay, sunday))).orderBy(asc(quotations.quoteNo)),
    db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(salesContracts).innerJoin(salesOrders, eq(salesOrders.id, salesContracts.orderId))
      .where(and(eq(salesOrders.ownerId, memberId), inArray(salesContracts.status, ['signed', 'completed']), gte(salesContracts.signedDate, monday), lte(salesContracts.signedDate, sunday))),
    activityFacts(db, monday, next, [memberId]),
    targetOf ? targetOf(db, memberId, month) : Promise.resolve(null),
    // Giao hàng chưa xong của đơn mình phụ trách, hẹn tới hết 2 tuần sau.
    db.select({ id: deliveries.id, orderId: deliveries.orderId, plannedDate: deliveries.plannedDate, status: deliveries.status, orderNo: salesOrders.orderNo, customerName: salesOrders.customerName })
      .from(deliveries).innerJoin(salesOrders, eq(salesOrders.id, deliveries.orderId))
      .where(and(eq(salesOrders.ownerId, memberId), inArray(deliveries.status, ['planned', 'in_transit', 'failed']), lte(deliveries.plannedDate, addDays(sunday, 14))))
      .orderBy(asc(deliveries.plannedDate)).limit(30),
    ownReceivables(db, memberId, today),weeklyWorkspaceFacts(db,memberId,monday),
  ]);
  const orderIds = weekOrders.map(o => o.id);
  const careRows = care.rows.filter(a => care.marks.get(a.id)?.counted), careCustomerIds = [...new Set(careRows.map(a => a.customerId))];
  const [lines, customerRows, oldRows] = await Promise.all([
    orderIds.length ? db.select({ orderId: salesOrderLines.orderId, name: salesOrderLines.name, qty: salesOrderLines.qty, amount: salesOrderLines.amount })
      .from(salesOrderLines).where(inArray(salesOrderLines.orderId, orderIds)).orderBy(desc(salesOrderLines.amount)) : [],
    careCustomerIds.length ? db.select({ id: customers.id, name: customers.name, type: customers.customerType }).from(customers).where(inArray(customers.id, careCustomerIds)) : [],
    careCustomerIds.length ? db.selectDistinct({ id: salesOrders.customerId }).from(salesOrders)
      .where(and(inArray(salesOrders.customerId, careCustomerIds), ne(salesOrders.status, 'cancelled'), ne(salesOrders.status, 'draft'), lt(salesOrders.orderDate, monday))) : [],
  ]);
  const oldIds = new Set(oldRows.map(r => r.id)), customerOf = new Map(customerRows.map(c => [c.id, c]));
  const careBy = new Map(INDUSTRIES.map(k => [k, { industry: k, label: INDUSTRY_LABEL[k], oldCustomers: new Set<string>(), newCustomers: new Set<string>(), activities: 0 }]));
  for (const a of careRows) {
    const c = customerOf.get(a.customerId), g = careBy.get(industryOf(c?.type, c?.name))!;
    g.activities++; (oldIds.has(a.customerId) ? g.oldCustomers : g.newCustomers).add(a.customerId);
  }
  const quotes = quoteRows.map(q => { let ls: { name: string; qty: number; amount: number }[] = []; try { ls = orderLinesFromQuote(JSON.parse(q.data)); } catch { /* báo giá lỗi dữ liệu */ }
    return { id: q.id, quoteNo: q.quoteNo, customer: q.customer, total: quoteTotal(q.data), items: itemsText([...ls].sort((a, b) => b.amount - a.amount)), won: !!q.won }; })
    .sort((a, b) => b.total - a.total);
  const receivables = recv.list;
  return { from: monday, to: sunday, revenue: weekOrders.reduce((s, o) => s + o.total, 0), orders: weekOrders.length, newCustomers: newCustomers.get(memberId) ?? 0,
    transactions: care.counts.get(memberId) ?? 0, quotesSent: quotes.length, quotesWon: quotes.filter(q => q.won).length, contracts: contracts[0]?.n ?? 0,
    month: { month, revenue: mtd[0]?.revenue ?? 0, target, ratio: target ? (mtd[0]?.revenue ?? 0) / target : null },
    orderList: weekOrders.map(o => ({ orderNo: o.orderNo, customerName: o.customerName, total: o.total, items: itemsText(lines.filter(l => l.orderId === o.id)) })),
    quotes, care: [...careBy.values()].map(g => ({ industry: g.industry, label: g.label, oldCustomers: g.oldCustomers.size, newCustomers: g.newCustomers.size, activities: g.activities })),
    deliveries: ships, receivables,
    receivableTotals: recv.totals,...workspace };
}
type WeekFacts = Awaited<ReturnType<typeof weekFacts>>;
function inputsOf(b: Record<string, unknown>, quotes?: WeekFacts['quotes']): WeeklyInputs {
  if(b.workspaceVersion===2){const parsed=workspaceSchema.safeParse(b);if(!parsed.success)throw new AppError(400,'Kiểm tra nội dung báo cáo: '+parsed.error.issues.slice(0,3).map(i=>i.path.join('.')+' '+i.message).join('; '));const v=parsed.data;v.quoteNotes=Object.fromEntries(Object.entries(v.quoteFollowups).filter(([,p])=>p.feedback).map(([id,p])=>[id,p.feedback]));v.highlights=v.overview;v.nextWeekPlan=[v.priority,...v.planTasks.map(t=>t.title+' · '+t.date)].join('\n').slice(0,2000);return v;}
  const raw = (b.quoteNotes && typeof b.quoteNotes === 'object' ? b.quoteNotes : {}) as Record<string, unknown>;
  // Chỉ giữ ghi chú của báo giá thuộc tuần (khi đã biết danh sách) – không nhận khoá lạ từ client.
  const keys = quotes ? quotes.map(q => q.id) : Object.keys(raw).slice(0, 200);
  const quoteNotes = Object.fromEntries(keys.map(k => [k, text(raw[k], 500)]).filter(([, v]) => v));
  return { highlights: text(b.highlights), nextWeekPlan: text(b.nextWeekPlan), support: text(b.support), quoteNotes };
}

/** Công nợ còn lại của đơn mình phụ trách (đã trừ hàng trả, như trang Công nợ) – quá hạn lên đầu. */
async function ownReceivables(db: AnyDb, memberId: string, today: string) {
  const owned = await db.select({ id: salesOrders.id, orderNo: salesOrders.orderNo, customerName: salesOrders.customerName, status: salesOrders.status,
    contract: sql<string | null>`(select k.status from ${salesContracts} k where k.order_id = "sales_orders"."id" and k.status <> 'cancelled' limit 1)`,
    contractNo: sql<string | null>`(select k.contract_no from ${salesContracts} k where k.order_id = "sales_orders"."id" and k.status <> 'cancelled' limit 1)` })
    .from(salesOrders).where(and(eq(salesOrders.ownerId, memberId), ne(salesOrders.status, 'cancelled')));
  const debtOrders = owned.filter(o => debtCounts(o.status, o.contract)), net = await netReceivables(db, debtOrders.map(o => o.id), today);
  const list = debtOrders.map(o => ({ orderId:o.id,orderNo: o.orderNo, contractNo: o.contractNo, customerName: o.customerName, ...net.get(o.id)! }))
    .filter(r => r.balance > 0).map(r => ({ orderId:r.orderId,orderNo: r.orderNo, contractNo: r.contractNo, customerName: r.customerName, balance: r.balance, overdue: r.overdue, nextDueDate: r.nextDueDate }))
    .sort((a, b) => b.overdue - a.overdue || b.balance - a.balance);
  return { list, totals: { balance: list.reduce((n, r) => n + r.balance, 0), overdue: list.reduce((n, r) => n + r.overdue, 0) } };
}

/** Số liệu tháng của một Sale (chỉ của chính người đó). Thưởng KPI dự kiến lấy từ bảng lương qua contract (app lắp). */
async function monthFacts(db: AnyDb, memberId: string, month: string, deps: StaffReportDeps) {
  const from = month + '-01', to = addDays(nextMonth(month) + '-01', -1), today = VN_TODAY(), prev = shiftMonths(month, -1), lastYear = shiftMonths(month, -12);
  const counted = and(eq(salesOrders.ownerId, memberId), ne(salesOrders.status, 'cancelled'), ne(salesOrders.status, 'draft'));
  const sumIn = (m: string) => db.select({ v: sql<number>`coalesce(sum(${salesOrders.total}),0)`.mapWith(Number) }).from(salesOrders)
    .where(and(counted, gte(salesOrders.orderDate, m + '-01'), lte(salesOrders.orderDate, addDays(nextMonth(m) + '-01', -1))));
  const quoteOwner = sql<string>`coalesce(${quotations.assigneeId}, ${quotations.creatorId})`;
  const quoteDay = sql<string>`coalesce(nullif(${quotations.quoteDate}, ''), substr(${quotations.createdAt}, 1, 10))`;
  const won = sql<boolean>`exists (select 1 from ${salesOrders} o where o.quote_id = "staff_quotations"."id" and o.status <> 'cancelled')`;
  const [orders, prevRev, lastYearRev, monthQuotes, openQuotes, contracts, care, target, paid, preview, recv, newCustomers] = await Promise.all([
    db.select({ customerId: salesOrders.customerId, customerName: salesOrders.customerName, total: salesOrders.total }).from(salesOrders)
      .where(and(counted, gte(salesOrders.orderDate, from), lte(salesOrders.orderDate, to))),
    sumIn(prev), sumIn(lastYear),
    db.select({ id: quotations.id, won }).from(quotations).where(and(eq(quoteOwner, memberId), gte(quoteDay, from), lte(quoteDay, to))),
    // Báo giá còn mở chuyển sang tháng sau: gửi trong 3 tháng gần nhất, chưa thành đơn.
    db.select({ id: quotations.id, customer: quotations.customer, data: quotations.data, won }).from(quotations)
      .where(and(eq(quoteOwner, memberId), gte(quoteDay, shiftMonths(month, -2) + '-01'), lte(quoteDay, to))),
    db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(salesContracts).innerJoin(salesOrders, eq(salesOrders.id, salesContracts.orderId))
      .where(and(eq(salesOrders.ownerId, memberId), inArray(salesContracts.status, ['signed', 'completed']), gte(salesContracts.signedDate, from), lte(salesContracts.signedDate, to))),
    activityFacts(db, from, nextMonth(month) + '-01', [memberId]),
    deps.targetOf ? deps.targetOf(db, memberId, month) : Promise.resolve(null),
    db.select({ v: sql<number>`coalesce(sum(${customerPayments.amount}),0)`.mapWith(Number) }).from(customerPayments).innerJoin(salesOrders, eq(salesOrders.id, customerPayments.orderId))
      .where(and(eq(salesOrders.ownerId, memberId), isNull(customerPayments.voidedAt), gte(customerPayments.paidAt, from), lte(customerPayments.paidAt, to))),
    deps.payrollPreviewOf ? deps.payrollPreviewOf(db, memberId, month) : Promise.resolve(null),
    ownReceivables(db, memberId, today),
    newCustomerFacts(db, from, nextMonth(month) + '-01'),
  ]);
  const revenue = orders.reduce((n, o) => n + o.total, 0), ids = [...new Set(orders.map(o => o.customerId).filter((x): x is string => !!x))];
  const [customerRows, oldRows] = ids.length ? await Promise.all([
    db.select({ id: customers.id, name: customers.name, type: customers.customerType }).from(customers).where(inArray(customers.id, ids)),
    db.selectDistinct({ id: salesOrders.customerId }).from(salesOrders).where(and(inArray(salesOrders.customerId, ids), ne(salesOrders.status, 'cancelled'), ne(salesOrders.status, 'draft'), lt(salesOrders.orderDate, from))),
  ]) : [[], []];
  const customerOf = new Map(customerRows.map(c => [c.id, c])), oldIds = new Set(oldRows.map(r => r.id));
  const byIndustry = new Map(INDUSTRIES.map(k => [k, 0])), byCustomer = new Map<string, number>();
  let oldRevenue = 0;
  for (const o of orders) {
    const c = o.customerId ? customerOf.get(o.customerId) : undefined;
    byIndustry.set(industryOf(c?.type, c?.name ?? o.customerName), byIndustry.get(industryOf(c?.type, c?.name ?? o.customerName))! + o.total);
    byCustomer.set(o.customerName, (byCustomer.get(o.customerName) ?? 0) + o.total);
    if (o.customerId && oldIds.has(o.customerId)) oldRevenue += o.total;
  }
  const open = openQuotes.filter(q => !q.won).map(q => ({ customer: q.customer, total: quoteTotal(q.data) })).sort((a, b) => b.total - a.total);
  return { month, from, to, revenue, prevRevenue: prevRev[0]?.v ?? 0, lastYearRevenue: lastYearRev[0]?.v ?? 0, target, ratio: target ? revenue / target : null,
    orders: orders.length, newCustomers: newCustomers.get(memberId) ?? 0, transactions: care.counts.get(memberId) ?? 0, contracts: contracts[0]?.n ?? 0,
    quotesSent: monthQuotes.length, quotesWon: monthQuotes.filter(q => q.won).length,
    industries: INDUSTRIES.map(k => ({ industry: k, label: INDUSTRY_LABEL[k], revenue: byIndustry.get(k)! })).filter(x => x.revenue > 0),
    oldShare: revenue > 0 ? oldRevenue / revenue : null,
    topCustomers: [...byCustomer].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total).slice(0, 5),
    openQuotes: { count: open.length, total: open.reduce((n, q) => n + q.total, 0), largest: open[0]?.customer ?? null },
    collected: paid[0]?.v ?? 0, receivables: recv.list, receivableTotals: recv.totals, payroll: preview };
}
function monthlyInputsOf(b: Record<string, unknown>): MonthlyInputs {
  const n = Number(String(b.nextTarget ?? '').replace(/[^\d]/g, ''));
  return { evaluation: text(b.evaluation), nextTarget: Number.isFinite(n) && n > 0 ? Math.min(n, 1e13) : null, keyCustomers: text(b.keyCustomers), plan: text(b.plan), support: text(b.support) };
}

/** Kỳ báo cáo: tuần (thứ Hai 'YYYY-MM-DD') hoặc tháng ('YYYY-MM'). Mọi quy tắc hạn / điểm / số liệu theo kỳ. */
type StaffReportDeps = { workspaceTasks: WeeklyTaskServices; targetOf?: SaleTargetOf; payrollPreviewOf?: SalePayrollPreviewOf };
function specOf(period: unknown, deps: StaffReportDeps) {
  if (isWeek(period)) return { kind: 'weekly' as const, period, label: 'tuần', deadline: weeklyDeadline(period), opensAt: weeklyOpensAt(period),
    started: (now: string) => weekStarted(period, now), official: (now: string) => canSubmitWeek(period, now),
    state: (at: string | null, now: string) => weekState(period, at, now), score: (r: { submittedAt: string; review: WeeklyReview } | null, now: string) => weekScore(period, r, now),
    facts: (db: AnyDb, memberId: string) => weekFacts(db, memberId, period, deps.targetOf),
    openMsg: 'Tuần chưa kết thúc – chỉ lưu nháp được, chưa nộp chính thức.', openCode: 'WEEK_OPEN',
    blockerOpen: 'Tuần chưa kết thúc – chỉ lưu nháp; nộp chính thức từ 00:00 thứ Hai tuần sau.', notStarted: 'Tuần chưa bắt đầu.',
    draftInputs: (b: Record<string, unknown>) => inputsOf(b) as unknown,
    validate: (b: Record<string, unknown>, facts: unknown) => { const f = facts as WeekFacts, v = inputsOf(b, f.quotes); return { inputs: v as unknown, issues: 'workspaceVersion' in v&&v.workspaceVersion===2?workspaceProblems(v as WorkspaceInputs,workspaceFactView(f)):weeklyProblems(v, f.quotes.filter(q => !q.won)) }; },
    sources: ['sales_orders', 'sales_order_lines', 'quotations', 'sales_contracts', 'customer_activities', 'deliveries', 'payment_schedules', 'customer_payments', 'hr_revenue_targets'] };
  if (isMonthPeriod(period) && period >= MONTHLY_REPORT_FROM) return { kind: 'monthly' as const, period, label: 'tháng', deadline: monthlyDeadline(period), opensAt: monthlyOpensAt(period),
    started: (now: string) => monthStarted(period, now), official: (now: string) => canSubmitMonth(period, now),
    state: (at: string | null, now: string) => monthlyState(period, at, now), score: (r: { submittedAt: string; review: WeeklyReview } | null, now: string) => monthlyScore(period, r, now),
    facts: (db: AnyDb, memberId: string) => monthFacts(db, memberId, period, deps),
    openMsg: 'Tháng chưa kết thúc – chỉ lưu nháp được, chưa nộp chính thức.', openCode: 'MONTH_OPEN',
    blockerOpen: 'Tháng chưa kết thúc – chỉ lưu nháp; nộp chính thức từ 00:00 ngày 01 tháng sau.', notStarted: 'Tháng chưa bắt đầu.',
    draftInputs: (b: Record<string, unknown>) => monthlyInputsOf(b) as unknown,
    validate: (b: Record<string, unknown>) => { const v = monthlyInputsOf(b); return { inputs: v as unknown, issues: monthlyProblems(v) }; },
    sources: ['sales_orders', 'quotations', 'sales_contracts', 'customer_activities', 'customer_payments', 'payment_schedules', 'hr_revenue_targets', 'hr_payroll (thưởng KPI dự kiến)'] };
  throw new AppError(400, 'Kỳ báo cáo không hợp lệ (tuần: chọn thứ Hai; tháng: từ 11/2026).');
}

export function registerStaffReportRoutes(router: Router<StaffEnv>, deps: StaffReportDeps) {
  router.get('/staff-reports/me', async c => {
    const m = me(c), db = c.env.db, now = nowIso(), month = isMonth(c.url.searchParams.get('month')) ? c.url.searchParams.get('month')! : vnDay(now).slice(0, 7);
    if (!reports(m)) return json({ required: false, canReview: isManager(m), month });
    const periods = [...weeksOfMonth(month), month];
    const [rows, drafts, eventReminders] = await Promise.all([
      db.select().from(staffWeeklyReports).where(and(eq(staffWeeklyReports.memberId, m.id), inArray(staffWeeklyReports.period, periods))),
      db.select({ period: staffWeeklyReportDrafts.period, updatedAt: staffWeeklyReportDrafts.updatedAt }).from(staffWeeklyReportDrafts).where(and(eq(staffWeeklyReportDrafts.memberId, m.id), inArray(staffWeeklyReportDrafts.period, periods))),
      deps.workspaceTasks.reminders(db,m.id,vnDay(now)),
    ]);
    const pts = monthPoints(month, new Map(rows.map(r => [r.period, { submittedAt: r.submittedAt, review: r.review as WeeklyReview }])), now);
    const lastWeek = addDays(mondayOf(vnDay(now)), -7);
    const [last] = await db.select({ id: staffWeeklyReports.id }).from(staffWeeklyReports).where(and(eq(staffWeeklyReports.memberId, m.id), eq(staffWeeklyReports.period, lastWeek))).limit(1);
    return json({recommendedPeriod: !last && !beforeLaunch(lastWeek) ? lastWeek : mondayOf(vnDay(now)), eventReminders, required: true, applies: appliesTo(month), canReview: false, month, points: pts.points, maxPoints: pts.required,
      weeks: pts.weeks.map(w => { const r = rows.find(x => x.period === w.period);
        return { ...w, reportId: r?.id ?? null, submittedAt: r?.submittedAt ?? null, reviewNote: r?.reviewNote ?? '', draftAt: drafts.find(d => d.period === w.period)?.updatedAt ?? null }; }),
      monthly: pts.monthly ? (() => { const r = rows.find(x => x.period === month);
        return { ...pts.monthly, reportId: r?.id ?? null, submittedAt: r?.submittedAt ?? null, reviewNote: r?.reviewNote ?? '', draftAt: drafts.find(d => d.period === month)?.updatedAt ?? null }; })() : null,
      // Nhắc: tuần trước chưa nộp, từ 08h00 thứ Hai.
      remind: !last && !beforeLaunch(lastWeek) && now >= new Date(Date.parse(addDays(lastWeek, 7) + 'T08:00:00+07:00')).toISOString() ? { period: lastWeek, deadline: weeklyDeadline(lastWeek) } : null,
      reviewLabels: WEEKLY_REVIEW_LABEL });
  }, 'business');

  // Xem một kỳ (tuần: period = thứ Hai; tháng: period = 'YYYY-MM'). memberId khác mình: chỉ Manager.
  router.get('/staff-reports/week', async c => {
    const m = me(c), db = c.env.db, q = c.url.searchParams, sp = specOf(q.get('period'), deps), period = sp.period, now = nowIso();
    const memberId = q.get('memberId') && q.get('memberId') !== m.id ? q.get('memberId')! : m.id;
    if (memberId !== m.id && !isManager(m)) throw new AppError(403, `Chỉ Manager xem được báo cáo ${sp.label} của người khác.`);
    if (memberId === m.id && !reports(m)) throw new AppError(403, 'Chức vụ của bạn không phải nộp báo cáo tuần / tháng.');
    const [person] = await reporters(db, [memberId]);
    if (!person) throw new AppError(404, 'Không tìm thấy nhân viên phải nộp báo cáo.');
    const [[report], [draft]] = await Promise.all([
      db.select().from(staffWeeklyReports).where(and(eq(staffWeeklyReports.memberId, memberId), eq(staffWeeklyReports.period, period))).limit(1),
      db.select().from(staffWeeklyReportDrafts).where(and(eq(staffWeeklyReportDrafts.memberId, memberId), eq(staffWeeklyReportDrafts.period, period))).limit(1),
    ]);
    const versions = report ? await db.select({ version: staffWeeklyReportVersions.version, submittedAt: staffWeeklyReportVersions.submittedAt })
      .from(staffWeeklyReportVersions).where(eq(staffWeeklyReportVersions.reportId, report.id)).orderBy(asc(staffWeeklyReportVersions.version)) : [];
    const own = memberId === m.id, locked = !!report && report.review !== 'pending', started = sp.started(now), official = sp.official(now);
    return json({ kind: sp.kind, member: { id: person.id, name: person.name }, period, deadline: sp.deadline, opensAt: sp.opensAt, factsAt: now,
      facts: await sp.facts(db, memberId), canEdit: own && started && !locked, canSubmit: own && official && !locked, canReview: isManager(m) && !!report,
      blockers: [...(!started ? [sp.notStarted] : []), ...(started && !official ? [sp.blockerOpen] : []), ...(locked ? ['Báo cáo đã được duyệt – không sửa được.'] : [])],
      draft: own && draft ? { inputs: parse(draft.inputs), updatedAt: draft.updatedAt } : null, versions,
      report: report ? { ...report, data: parse(report.data), state: sp.state(report.submittedAt, now), score: sp.score({ submittedAt: report.submittedAt, review: report.review as WeeklyReview }, now) } : null,
      reviewLabels: WEEKLY_REVIEW_LABEL });
  }, 'business');

  router.get('/staff-reports/actions',async c=>{const m=me(c),memberId=c.url.searchParams.get('memberId')||m.id;if(memberId!==m.id&&!isManager(m))throw new AppError(403,'Chỉ xem việc phát sinh từ báo cáo của mình.');if(memberId===m.id&&!reports(m)&&!isManager(m))throw new AppError(403,'Không có quyền xem báo cáo.');return json({actions:await deps.workspaceTasks.actions(c.env.db,memberId)});},'business');

  router.put('/staff-reports/draft', async c => {
    const m = me(c), db = c.env.db, b = await readJson(c.req, 300_000), now = nowIso();
    if (!reports(m)) throw new AppError(403, 'Chức vụ của bạn không phải nộp báo cáo tuần / tháng.');
    const sp = specOf(b.period, deps), period = sp.period;
    if (!sp.started(now)) throw new AppError(400, sp.notStarted);
    const [r] = await db.select({ review: staffWeeklyReports.review }).from(staffWeeklyReports).where(and(eq(staffWeeklyReports.memberId, m.id), eq(staffWeeklyReports.period, period))).limit(1);
    if (r && r.review !== 'pending') throw new AppError(409, 'Báo cáo đã được duyệt, không sửa được.');
    const normalized=sp.draftInputs((b.inputs??{}) as Record<string,unknown>),inputs=JSON.stringify(normalized);
    const updatedAt=await db.transaction(async tx=>{
      await tx.select({id:employees.id}).from(employees).where(eq(employees.id,m.id)).for('update');
      const [report]=await tx.select().from(staffWeeklyReports).where(and(eq(staffWeeklyReports.memberId,m.id),eq(staffWeeklyReports.period,period))).limit(1).for('update');
      if(report&&report.review!=='pending')throw new AppError(409,'Báo cáo đã được duyệt, không sửa được.');
      const [prior]=await tx.select().from(staffWeeklyReportDrafts).where(and(eq(staffWeeklyReportDrafts.memberId,m.id),eq(staffWeeklyReportDrafts.period,period))).limit(1);
      if(Object.hasOwn(b,'expectedDraftAt')&&(b.expectedDraftAt??null)!==(prior?.updatedAt??null))throw new AppError(409,'Nháp đã thay đổi ở cửa sổ khác. Nội dung đang nhập được giữ; mở lại để đối chiếu.','DRAFT_CONFLICT');
      if(parse(prior?.inputs??null)?.workspaceVersion===2&&(normalized as {workspaceVersion?:number}).workspaceVersion!==2)throw new AppError(409,'Có bản nháp theo mẫu mới. Tải lại ứng dụng trước khi lưu.','REPORT_CLIENT_OLD');
      const stamp=new Date(Math.max(Date.parse(now),prior?Date.parse(prior.updatedAt)+1:0)).toISOString();
      await tx.insert(staffWeeklyReportDrafts).values({memberId:m.id,period,inputs,updatedAt:stamp}).onConflictDoUpdate({target:[staffWeeklyReportDrafts.memberId,staffWeeklyReportDrafts.period],set:{inputs,updatedAt:stamp}});return stamp;
    });
    return json({ok:true,updatedAt});
  }, 'business');

  router.post('/staff-reports', async c => {
    const m = me(c), db = c.env.db, b = await readJson(c.req, 300_000), clientKey = text(b.clientKey, 80), now = nowIso();
    if (!reports(m)) throw new AppError(403, 'Chức vụ của bạn không phải nộp báo cáo tuần / tháng.');
    const sp = specOf(b.period, deps), period = sp.period;
    if (clientKey.length < 8) throw new AppError(400, 'Thiếu mã chống gửi lặp. Tải lại trang rồi thử lại.');
    if (!sp.started(now)) throw new AppError(400, sp.notStarted);
    if (!sp.official(now)) throw new AppError(409, sp.openMsg, sp.openCode);
    const requestInputs=sp.draftInputs((b.inputs??{}) as Record<string,unknown>),clientHash=await payloadHash(requestInputs),workspaceRequest=(requestInputs as {workspaceVersion?:number}).workspaceVersion===2;
    const [replay] = await db.select({ id: staffWeeklyReports.id,data:staffWeeklyReports.data }).from(staffWeeklyReports).where(and(eq(staffWeeklyReports.memberId, m.id), eq(staffWeeklyReports.clientKey, clientKey))).limit(1);
    if (replay){if(workspaceRequest&&parse(replay.data)?.meta?.clientHash!==clientHash)throw new AppError(409,'Mã lần nộp đã dùng cho nội dung khác.','COMMAND_CONFLICT');return json({ok:true,id:replay.id,replayed:true});}
    if(workspaceRequest){
      const [priorCommand]=await db.select({id:staffWeeklyReports.id,version:staffWeeklyReportVersions.version,data:staffWeeklyReportVersions.data}).from(staffWeeklyReportVersions).innerJoin(staffWeeklyReports,eq(staffWeeklyReports.id,staffWeeklyReportVersions.reportId)).where(and(eq(staffWeeklyReports.memberId,m.id),eq(staffWeeklyReports.period,period),sql`${staffWeeklyReportVersions.data}::jsonb->'meta'->>'clientKey'=${clientKey}`)).limit(1);
      if(priorCommand){if(parse(priorCommand.data)?.meta?.clientHash!==clientHash)throw new AppError(409,'Mã lần nộp đã dùng cho nội dung khác.','COMMAND_CONFLICT');return json({ok:true,id:priorCommand.id,replayed:true,version:priorCommand.version,historical:true});}
      if(!Number.isSafeInteger(b.expectedVersion)||Number(b.expectedVersion)<0||!Object.hasOwn(b,'expectedDraftAt'))throw new AppError(400,'Thiếu phiên bản báo cáo / bản nháp đã mở. Tải lại để đối chiếu.');
    }
    const [locked] = await db.select({ review: staffWeeklyReports.review }).from(staffWeeklyReports).where(and(eq(staffWeeklyReports.memberId, m.id), eq(staffWeeklyReports.period, period))).limit(1);
    if (locked && locked.review !== 'pending') throw new AppError(409, 'Báo cáo đã được duyệt, không sửa được.');
    // Số liệu CRM luôn tính ở máy chủ lúc nộp – bỏ qua mọi số liệu client gửi lên.
    const facts = await sp.facts(db, m.id);
    const { inputs, issues } = sp.validate((b.inputs ?? {}) as Record<string, unknown>, facts);
    if (issues.length) throw new AppError(400, issues.join(' '));
    const forecast=sp.kind==='weekly'&&(inputs as {workspaceVersion?:number}).workspaceVersion===2?workspaceForecast(inputs as WorkspaceInputs,workspaceFactView(facts as WeekFacts).quotes):undefined;
    const data = JSON.stringify({ kind: sp.kind, facts, inputs,...(forecast?{forecast}:{}), meta: { factsAt: now, sources: sp.sources,clientKey,clientHash } });
    const result = await db.transaction(async tx => {
      await tx.select({id:employees.id}).from(employees).where(eq(employees.id,m.id)).for('update');
      const [existing] = await tx.select().from(staffWeeklyReports).where(and(eq(staffWeeklyReports.memberId, m.id), eq(staffWeeklyReports.period, period))).limit(1).for('update');
      if(existing?.clientKey===clientKey){if(workspaceRequest&&parse(existing.data)?.meta?.clientHash!==clientHash)throw new AppError(409,'Mã lần nộp đã dùng cho nội dung khác.','COMMAND_CONFLICT');return{status:200,body:{ok:true,id:existing.id,replayed:true}};}
      const [liveDraft]=await tx.select().from(staffWeeklyReportDrafts).where(and(eq(staffWeeklyReportDrafts.memberId,m.id),eq(staffWeeklyReportDrafts.period,period))).limit(1);
      if(workspaceRequest&&(b.expectedDraftAt??null)!==(liveDraft?.updatedAt??null))throw new AppError(409,'Bản nháp đã thay đổi ở cửa sổ khác. Chưa nộp dữ liệu cũ.','DRAFT_CONFLICT');
      if(!workspaceRequest&&(parse(existing?.data??null)?.inputs?.workspaceVersion===2||parse(liveDraft?.inputs??null)?.workspaceVersion===2))throw new AppError(409,'Báo cáo đã dùng mẫu mới. Tải lại ứng dụng để tiếp tục.','REPORT_CLIENT_OLD');
      if (existing) {
        if (existing.review !== 'pending') throw new AppError(409, 'Báo cáo đã được duyệt, không sửa được.');
        const [last] = await tx.select({ v: sql<number>`coalesce(max(${staffWeeklyReportVersions.version}),0)`.mapWith(Number) }).from(staffWeeklyReportVersions).where(eq(staffWeeklyReportVersions.reportId, existing.id));
        if((inputs as {workspaceVersion?:number}).workspaceVersion===2&&b.expectedVersion!==(last?.v??0))throw new AppError(409,'Báo cáo đã có phiên bản mới. Tải lại để đối chiếu.','REPORT_CONFLICT');
        const version = (last?.v ?? 0) + 1;
        if(sp.kind==='weekly'&&(inputs as {workspaceVersion?:number}).workspaceVersion===2)await deps.workspaceTasks.sync(tx as AnyDb,m.id,existing.id,period,inputs as WorkspaceInputs,workspaceFactView(facts as WeekFacts),now);
        await tx.update(staffWeeklyReports).set({ data, updatedAt: now, clientKey }).where(eq(staffWeeklyReports.id, existing.id));
        await tx.insert(staffWeeklyReportVersions).values({ id: crypto.randomUUID(), reportId: existing.id, version, data, submittedAt: now });
        await tx.delete(staffWeeklyReportDrafts).where(and(eq(staffWeeklyReportDrafts.memberId, m.id), eq(staffWeeklyReportDrafts.period, period)));
        return { status: 200, body: { ok: true, id: existing.id, version, state: sp.state(existing.submittedAt, now) } };
      }
      if((inputs as {workspaceVersion?:number}).workspaceVersion===2&&b.expectedVersion!==0)throw new AppError(409,'Thiếu phiên bản báo cáo đã mở.','REPORT_CONFLICT');
      const id = crypto.randomUUID();
      const inserted = await tx.insert(staffWeeklyReports).values({ id, memberId: m.id, period, data, submittedAt: now, updatedAt: now, clientKey }).onConflictDoNothing().returning({ id: staffWeeklyReports.id });
      if(sp.kind==='weekly'&&(inputs as {workspaceVersion?:number}).workspaceVersion===2)await deps.workspaceTasks.sync(tx as AnyDb,m.id,id,period,inputs as WorkspaceInputs,workspaceFactView(facts as WeekFacts),now);
      if (!inserted.length) throw new AppError(409, `Báo cáo ${sp.label} này vừa được nộp ở máy khác. Tải lại trang.`);
      await tx.insert(staffWeeklyReportVersions).values({ id: crypto.randomUUID(), reportId: id, version: 1, data, submittedAt: now });
      await tx.delete(staffWeeklyReportDrafts).where(and(eq(staffWeeklyReportDrafts.memberId, m.id), eq(staffWeeklyReportDrafts.period, period)));
      return { status: 201, body: { ok: true, id, version: 1, state: sp.state(now, now) } };
    });
    return json(result.body, result.status);
  }, 'business');

  router.get('/staff-reports/review', async c => {
    const m = me(c); if (!isManager(m)) throw new AppError(403, 'Chỉ Manager duyệt báo cáo tuần.');
    const db = c.env.db, now = nowIso(), month = isMonth(c.url.searchParams.get('month')) ? c.url.searchParams.get('month')! : vnDay(now).slice(0, 7);
    const weeks = weeksOfMonth(month), people = await reporters(db);
    const rows = people.length ? await db.select({ id: staffWeeklyReports.id, memberId: staffWeeklyReports.memberId, period: staffWeeklyReports.period, submittedAt: staffWeeklyReports.submittedAt, review: staffWeeklyReports.review })
      .from(staffWeeklyReports).where(and(inArray(staffWeeklyReports.memberId, people.map(p => p.id)), inArray(staffWeeklyReports.period, [...weeks, month]))) : [];
    return json({ month, applies: appliesTo(month), weeks, hasMonthly: monthlyRequired(month), reviewLabels: WEEKLY_REVIEW_LABEL,
      people: people.map(p => { const mine = rows.filter(r => r.memberId === p.id);
        const pts = monthPoints(month, new Map(mine.map(r => [r.period, { submittedAt: r.submittedAt, review: r.review as WeeklyReview }])), now);
        return { id: p.id, name: p.name, positionId: p.positionId, points: pts.points, required: pts.required, weeks: pts.weeks.map(w => ({ ...w, reportId: mine.find(r => r.period === w.period)?.id ?? null })),
          monthly: pts.monthly ? { ...pts.monthly, reportId: mine.find(r => r.period === month)?.id ?? null } : null }; }) });
  }, 'business');

  router.post('/staff-reports/:id/review', async c => {
    const m = me(c); if (!isManager(m)) throw new AppError(403, 'Chỉ Manager duyệt báo cáo tuần.');
    const b = await readJson(c.req, 4_000), db = c.env.db, review = b.review as WeeklyReview;
    if (!WEEKLY_REVIEWS.includes(review) || review === 'pending') throw new AppError(400, 'Kết quả duyệt không hợp lệ.');
    const note = text(b.note, 1000);
    if (review !== 'ok' && note.length < 3) throw new AppError(400, 'Nhập lý do (bắt buộc khi Chưa đạt hoặc Miễn).');
    const [r] = await db.select({ id: staffWeeklyReports.id }).from(staffWeeklyReports).where(eq(staffWeeklyReports.id, String(c.params.id))).limit(1);
    if (!r) throw new AppError(404, 'Không tìm thấy báo cáo.');
    await db.update(staffWeeklyReports).set({ review, reviewNote: note, reviewedBy: m.id, reviewedAt: nowIso() }).where(eq(staffWeeklyReports.id, r.id));
    return json({ ok: true });
  }, 'business');
}
