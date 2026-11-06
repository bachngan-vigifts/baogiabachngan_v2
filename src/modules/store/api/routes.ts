/**
 * BÁO CÁO CỬA HÀNG TRƯỞNG (CHT) – khu vực `business`. Xem domain/reports.ts cho hạn nộp và Tiền Trách nhiệm.
 *  GET  /store/status                       cửa hàng mình phụ trách + quyền duyệt (+ danh sách cửa hàng / CHT cho người duyệt)
 *  GET  /store/reminders                    việc CHT cần làm lúc này (hộp nhắc 30 phút)
 *  GET  /store/reports?registerId&month     báo cáo trong tháng + Tiền Trách nhiệm tạm tính
 *  GET  /store/reports/draft?registerId&kind&period   số liệu CRM tự điền + báo cáo đã nộp (nếu có)
 *  POST /store/reports                      CHT nộp / nộp lại (giữ giờ nộp lần đầu; đã duyệt thì khoá)
 *  POST /store/reports/:id/review           người duyệt (Manager / quyền store.review): đạt, sai sổ quỹ, đề xuất sai, miễn…
 *  POST /store/reports/:id/explain          CHT giải trình
 *  PUT  /store/managers                     Manager gán / bỏ CHT cho cửa hàng
 * Chỉ CHT của cửa hàng (và người duyệt) xem / nộp báo cáo của cửa hàng đó – kiểm tra ở máy chủ.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import { json, readJson, type Router } from '../../../core/http/router.ts';
import type { AnyDb } from '../../../core/db/client.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees } from '../../staff/schema.ts';
import { can } from '../../staff/domain/permissions.ts';
import { posRegisters, posShifts } from '../../sales/pos-schema.ts';
import { salesOrderLines, salesOrders } from '../../sales/schema.ts';
import { inventoryAdjustments, stockBalances } from '../../inventory/schema.ts';
import { productMovements, products } from '../../catalog/schema.ts';
import { storeManagers, storeReports } from '../schema.ts';
import {
  REVIEW_FOR, STORE_LIMITS, STORE_REPORT_KINDS, STORE_REPORT_LABEL, STORE_REVIEW_LABEL, deadlineOf, isPeriod, nextMonth, periodStarted, remindersAt,
  responsibilityOf, slotState, vnClock, weeksDueIn, type StoreReportKind, type StoreReviewStatus,
} from '../domain/reports.ts';

type Ctx = Parameters<Parameters<Router<StaffEnv>['get']>[1]>[0];
type Member = SessionState['member'];
const me = (c: Ctx) => (c.state.session as SessionState).member;
const reviews = (m: Member) => can(m as never, 'store.review');
const nowIso = () => new Date().toISOString();
const text = (v: unknown, max: number = STORE_LIMITS.text) => String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
const money = (v: unknown, label: string) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[.\s]/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > STORE_LIMITS.money) throw new AppError(400, `${label} không hợp lệ.`);
  return Math.round(n);
};
const addDays = (day: string, n: number) => new Date(Date.parse(day + 'T00:00:00Z') + n * 86400_000).toISOString().slice(0, 10);
const isMonth = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const kindOf = (v: unknown): StoreReportKind => { if (!STORE_REPORT_KINDS.includes(v as never)) throw new AppError(400, 'Loại báo cáo không hợp lệ.'); return v as StoreReportKind; };

async function myStore(db: AnyDb, memberId: string) {
  const [row] = await db.select({ registerId: storeManagers.registerId, name: posRegisters.name, warehouseId: posRegisters.warehouseId })
    .from(storeManagers).innerJoin(posRegisters, eq(posRegisters.id, storeManagers.registerId)).where(eq(storeManagers.memberId, memberId)).limit(1);
  return row ?? null;
}
/** Cửa hàng được xem: CHT của chính cửa hàng đó, hoặc người duyệt. */
async function storeFor(c: Ctx, registerId: unknown) {
  const m = me(c), id = text(registerId, 80);
  const [reg] = await c.env.db.select({ id: posRegisters.id, name: posRegisters.name, warehouseId: posRegisters.warehouseId, managerId: storeManagers.memberId })
    .from(posRegisters).leftJoin(storeManagers, eq(storeManagers.registerId, posRegisters.id)).where(eq(posRegisters.id, id)).limit(1);
  if (!reg) throw new AppError(404, 'Không tìm thấy cửa hàng.');
  const isManager = reg.managerId === m.id;
  if (!isManager && !reviews(m)) throw new AppError(403, 'Bạn chỉ xem được báo cáo của cửa hàng mình phụ trách.');
  return { ...reg, isManager };
}
/** Các ngày cửa hàng có mở ca POS trong [from, to]. */
async function shiftDays(db: AnyDb, registerId: string, from: string, to: string) {
  const rows = await db.selectDistinct({ day: posShifts.businessDate }).from(posShifts)
    .where(and(eq(posShifts.registerId, registerId), gte(posShifts.businessDate, from), lte(posShifts.businessDate, to))).orderBy(asc(posShifts.businessDate));
  return rows.map(r => r.day);
}
const parse = (s: string | null) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

// ---------------- Số liệu CRM tự điền
async function dailyFacts(db: AnyDb, registerId: string, day: string) {
  const shifts = await db.select({ id: posShifts.id, member: employees.name, openedAt: posShifts.openedAt, closedAt: posShifts.closedAt, openingCash: posShifts.openingCash,
    expectedCash: posShifts.expectedCash, countedCash: posShifts.countedCash, cashDifference: posShifts.cashDifference, differenceReason: posShifts.differenceReason, snapshot: posShifts.reportSnapshot })
    .from(posShifts).leftJoin(employees, eq(employees.id, posShifts.memberId)).where(and(eq(posShifts.registerId, registerId), eq(posShifts.businessDate, day))).orderBy(asc(posShifts.openedAt));
  const list = shifts.map(s => {
    const snap = parse(s.snapshot), pay = (method: string) => (snap?.payments ?? []).filter((p: { method: string }) => p.method === method).reduce((n: number, p: { total: number }) => n + Number(p.total || 0), 0);
    return { id: s.id, member: s.member ?? '', openedAt: s.openedAt, closedAt: s.closedAt, bills: Number(snap?.bills?.count ?? 0), revenue: Number(snap?.bills?.revenue ?? 0),
      cash: pay('cash'), transfer: pay('transfer'), other: (snap?.payments ?? []).filter((p: { method: string }) => !['cash', 'transfer'].includes(p.method)).reduce((n: number, p: { total: number }) => n + Number(p.total || 0), 0),
      openingCash: s.openingCash, expectedCash: s.expectedCash, countedCash: s.countedCash, cashDifference: s.cashDifference, differenceReason: s.differenceReason };
  });
  const sum = (k: 'bills' | 'revenue' | 'cash' | 'transfer' | 'other' | 'cashDifference') => list.reduce((n, s) => n + Number(s[k] || 0), 0);
  return { shifts: list, openShifts: list.filter(s => !s.closedAt).length,
    totals: { bills: sum('bills'), revenue: sum('revenue'), cash: sum('cash'), transfer: sum('transfer'), other: sum('other'), cashDifference: sum('cashDifference') } };
}
/** Doanh số POS (đơn không huỷ) của cửa hàng theo ngày làm việc trong [from, to]. */
async function salesByDay(db: AnyDb, registerId: string, from: string, to: string) {
  return db.select({ day: posShifts.businessDate, revenue: sql<number>`coalesce(sum(${salesOrders.total}),0)`.mapWith(Number), bills: sql<number>`count(*)`.mapWith(Number) })
    .from(salesOrders).innerJoin(posShifts, eq(posShifts.id, salesOrders.shiftId))
    .where(and(eq(posShifts.registerId, registerId), gte(posShifts.businessDate, from), lte(posShifts.businessDate, to), ne(salesOrders.status, 'cancelled')))
    .groupBy(posShifts.businessDate).orderBy(asc(posShifts.businessDate));
}
async function topProducts(db: AnyDb, registerId: string, from: string, to: string, limit = 10) {
  return db.select({ sku: salesOrderLines.sku, name: sql<string>`max(${salesOrderLines.name})`, qty: sql<number>`sum(${salesOrderLines.qty})`.mapWith(Number), amount: sql<number>`sum(${salesOrderLines.amount})`.mapWith(Number) })
    .from(salesOrderLines).innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.orderId)).innerJoin(posShifts, eq(posShifts.id, salesOrders.shiftId))
    .where(and(eq(posShifts.registerId, registerId), gte(posShifts.businessDate, from), lte(posShifts.businessDate, to), ne(salesOrders.status, 'cancelled')))
    .groupBy(salesOrderLines.sku).orderBy(desc(sql`sum(${salesOrderLines.qty})`)).limit(limit);
}
/** Hàng tồn tại kho cửa hàng nhưng không bán được trong 30 ngày (tồn nhiều nhất trước). */
async function slowProducts(db: AnyDb, registerId: string, warehouseId: string, to: string, limit = 10) {
  const from = addDays(to, -29);
  const sold = db.select({ sku: salesOrderLines.sku }).from(salesOrderLines).innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.orderId)).innerJoin(posShifts, eq(posShifts.id, salesOrders.shiftId))
    .where(and(eq(posShifts.registerId, registerId), gte(posShifts.businessDate, from), lte(posShifts.businessDate, to), ne(salesOrders.status, 'cancelled')));
  return db.select({ sku: stockBalances.sku, name: products.name, qty: stockBalances.qty }).from(stockBalances).innerJoin(products, eq(products.sku, stockBalances.sku))
    .where(and(eq(stockBalances.warehouseId, warehouseId), sql`${stockBalances.qty} > 0`, sql`${stockBalances.sku} not in (${sold})`))
    .orderBy(desc(stockBalances.qty)).limit(limit);
}
async function stocktakeFacts(db: AnyDb, warehouseId: string, month: string) {
  const from = addDays(month + '-01', -5), to = nextMonth(month) + '-04';
  const rows = await db.select({ id: inventoryAdjustments.id, refNo: inventoryAdjustments.refNo, status: inventoryAdjustments.status, createdAt: inventoryAdjustments.createdAt, lines: inventoryAdjustments.lines })
    .from(inventoryAdjustments).where(and(eq(inventoryAdjustments.warehouseId, warehouseId), gte(inventoryAdjustments.createdAt, from), lt(inventoryAdjustments.createdAt, to),
      sql`${inventoryAdjustments.lines}::jsonb @> '[{"source":"stocktake"}]'::jsonb`)).orderBy(asc(inventoryAdjustments.createdAt));
  const lines = rows.flatMap(r => (parse(r.lines) ?? []) as { sku: string; qty: number }[]);
  const skus = [...new Set(lines.filter(l => l.qty).map(l => l.sku))];
  const costs = skus.length ? new Map((await db.selectDistinctOn([productMovements.sku], { sku: productMovements.sku, price: productMovements.unitPrice }).from(productMovements)
    .where(and(inArray(productMovements.sku, skus), eq(productMovements.kind, 'purchase'), sql`${productMovements.unitPrice} is not null`))
    .orderBy(productMovements.sku, desc(productMovements.occurredAt))).map(r => [r.sku, Number(r.price)])) : new Map<string, number>();
  return { counts: rows.map(r => { const ls = ((parse(r.lines) ?? []) as { sku: string; qty: number }[]).filter(l => l.qty);
    const value = ls.reduce((n, l) => n + Math.abs(l.qty) * (costs.get(l.sku) ?? 0), 0);
    return { id: r.id, refNo: r.refNo, status: r.status, createdAt: r.createdAt, gapSkus: ls.length, gapValue: Math.round(value), missingCost: ls.filter(l => !costs.has(l.sku)).length }; }) };
}
async function factsFor(db: AnyDb, store: { id: string; warehouseId: string }, kind: StoreReportKind, period: string) {
  if (kind === 'daily') return dailyFacts(db, store.id, period);
  if (kind === 'weekly') { const to = addDays(period, 6);
    const [days, top] = await Promise.all([salesByDay(db, store.id, period, to), topProducts(db, store.id, period, to)]);
    return { from: period, to, days, revenue: days.reduce((n, d) => n + d.revenue, 0), bills: days.reduce((n, d) => n + d.bills, 0), top, slow: await slowProducts(db, store.id, store.warehouseId, to) }; }
  if (kind === 'monthly') { const from = period + '-01', to = addDays(nextMonth(period) + '-01', -1);
    const [days, top, staff] = await Promise.all([salesByDay(db, store.id, from, to), topProducts(db, store.id, from, to, 15),
      db.select({ member: employees.name, shifts: sql<number>`count(distinct ${posShifts.id})`.mapWith(Number), days: sql<number>`count(distinct ${posShifts.businessDate})`.mapWith(Number) })
        .from(posShifts).leftJoin(employees, eq(employees.id, posShifts.memberId)).where(and(eq(posShifts.registerId, store.id), gte(posShifts.businessDate, from), lte(posShifts.businessDate, to)))
        .groupBy(employees.name)]);
    return { from, to, revenue: days.reduce((n, d) => n + d.revenue, 0), bills: days.reduce((n, d) => n + d.bills, 0), days, top, staff }; }
  return stocktakeFacts(db, store.warehouseId, period);
}
/** Phần CHT nhập theo loại báo cáo (chỉ nhận đúng các ô này). */
function inputsFor(kind: StoreReportKind, b: Record<string, unknown>) {
  if (kind === 'daily') return { bankDeposit: money(b.bankDeposit, 'Tiền nộp ngân hàng'), bankRef: text(b.bankRef, 200), incidents: text(b.incidents), note: text(b.note) };
  if (kind === 'weekly') { const v = { orderProposal: text(b.orderProposal), roster: text(b.roster), note: text(b.note) };
    if (v.orderProposal.length < 3) throw new AppError(400, 'Nhập đề xuất đặt hàng (Sale-in) cho tuần tới.'); return v; }
  if (kind === 'monthly') { const v = { groupAnalysis: text(b.groupAnalysis), staffReview: text(b.staffReview), note: text(b.note) };
    if (v.staffReview.length < 3) throw new AppError(400, 'Nhập đánh giá ngày công và năng lực NVBH.'); return v; }
  const v = { counted: b.counted === true, gapExplanation: text(b.gapExplanation), note: text(b.note) };
  if (!v.counted) throw new AppError(400, 'Xác nhận đã kiểm kê theo đúng quy trình.'); return v;
}

export function registerStoreRoutes(router: Router<StaffEnv>) {
  router.get('/store/status', async c => {
    const m = me(c), db = c.env.db, mine = await myStore(db, m.id), canReview = reviews(m);
    const stores = canReview ? await db.select({ registerId: posRegisters.id, name: posRegisters.name, active: posRegisters.active, memberId: storeManagers.memberId, memberName: employees.name })
      .from(posRegisters).leftJoin(storeManagers, eq(storeManagers.registerId, posRegisters.id)).leftJoin(employees, eq(employees.id, storeManagers.memberId)).orderBy(asc(posRegisters.name)) : [];
    const pending = canReview ? Number((await db.select({ n: sql<number>`count(*)` }).from(storeReports).where(eq(storeReports.review, 'pending')))[0]?.n ?? 0) : 0;
    return json({ mine: mine ? { registerId: mine.registerId, name: mine.name } : null, canReview, canAssign: m.role === 'manager', stores, pending,
      labels: { kinds: STORE_REPORT_LABEL, reviews: STORE_REVIEW_LABEL }, reviewFor: REVIEW_FOR });
  }, 'business');

  router.get('/store/reminders', async c => {
    const m = me(c), db = c.env.db, mine = await myStore(db, m.id), now = nowIso();
    if (!mine) return json({ items: [] });
    const today = vnClock(now).day, from = addDays(today.slice(0, 7) + '-01', -40);
    const [days, done] = await Promise.all([shiftDays(db, mine.registerId, from, today),
      db.select({ kind: storeReports.kind, period: storeReports.period }).from(storeReports).where(and(eq(storeReports.registerId, mine.registerId), gte(storeReports.submittedAt, addDays(from, -40))))]);
    return json({ store: mine.name, registerId: mine.registerId, items: remindersAt(now, days, new Set(done.map(r => `${r.kind}:${r.period}`))) });
  }, 'business');

  router.get('/store/reports', async c => {
    const store = await storeFor(c, c.url.searchParams.get('registerId')), db = c.env.db, now = nowIso();
    const month = isMonth(c.url.searchParams.get('month')) ? c.url.searchParams.get('month')! : vnClock(now).day.slice(0, 7);
    const from = month + '-01', last = addDays(nextMonth(month) + '-01', -1);
    const days = await shiftDays(db, store.id, addDays(from, -7), last);
    const weeks = weeksDueIn(month, days), dailyDays = days.filter(d => d.startsWith(month));
    const rows = await db.select({ id: storeReports.id, kind: storeReports.kind, period: storeReports.period, submittedAt: storeReports.submittedAt, updatedAt: storeReports.updatedAt,
      review: storeReports.review, reviewNote: storeReports.reviewNote, reviewedAt: storeReports.reviewedAt, explanation: storeReports.explanation, member: employees.name })
      .from(storeReports).leftJoin(employees, eq(employees.id, storeReports.memberId))
      .where(and(eq(storeReports.registerId, store.id), or(and(inArray(storeReports.kind, ['monthly', 'stocktake']), eq(storeReports.period, month)),
        and(eq(storeReports.kind, 'daily'), gte(storeReports.period, from), lte(storeReports.period, last)), and(eq(storeReports.kind, 'weekly'), inArray(storeReports.period, weeks.length ? weeks : ['-'])))))
      .orderBy(asc(storeReports.period));
    const reports = rows.map(r => ({ ...r, deadline: deadlineOf(r.kind, r.period), state: slotState(r.kind, r.period, r.submittedAt, now) }));
    const responsibility = responsibilityOf({ month, dailyDays, weeks, now, reports: rows.map(r => ({ kind: r.kind, period: r.period, submittedAt: r.submittedAt, review: r.review })) });
    return json({ store: { registerId: store.id, name: store.name }, isManager: store.isManager, canReview: reviews(me(c)), month, dailyDays, weeks, reports, responsibility });
  }, 'business');

  router.get('/store/reports/draft', async c => {
    const q = c.url.searchParams, store = await storeFor(c, q.get('registerId')), kind = kindOf(q.get('kind')), period = q.get('period');
    if (!isPeriod(kind, period)) throw new AppError(400, 'Kỳ báo cáo không hợp lệ.');
    const [existing] = await c.env.db.select().from(storeReports).where(and(eq(storeReports.registerId, store.id), eq(storeReports.kind, kind), eq(storeReports.period, period))).limit(1);
    const facts = await factsFor(c.env.db, store, kind, period);
    return json({ kind, period, deadline: deadlineOf(kind, period), facts,
      report: existing ? { ...existing, data: parse(existing.data), state: slotState(kind, period, existing.submittedAt, nowIso()) } : null });
  }, 'business');

  router.post('/store/reports', async c => {
    const b = await readJson(c.req, 30_000), m = me(c), db = c.env.db, kind = kindOf(b.kind), period = b.period, clientKey = text(b.clientKey, 80);
    if (!isPeriod(kind, period)) throw new AppError(400, 'Kỳ báo cáo không hợp lệ.');
    if (clientKey.length < 8) throw new AppError(400, 'Thiếu mã chống gửi lặp. Tải lại trang rồi thử lại.');
    const mine = await myStore(db, m.id);
    if (!mine || mine.registerId !== text(b.registerId, 80)) throw new AppError(403, 'Chỉ Cửa hàng trưởng của cửa hàng này được nộp báo cáo.');
    const now = nowIso();
    if (!periodStarted(kind, period, now)) throw new AppError(400, 'Kỳ báo cáo chưa bắt đầu.');
    const inputs = inputsFor(kind, (b.inputs ?? {}) as Record<string, unknown>);
    const [replay] = await db.select({ id: storeReports.id }).from(storeReports).where(and(eq(storeReports.memberId, m.id), eq(storeReports.clientKey, clientKey))).limit(1);
    if (replay) return json({ ok: true, id: replay.id, replayed: true });
    const facts = await factsFor(db, { id: mine.registerId, warehouseId: mine.warehouseId }, kind, period);
    const data = JSON.stringify({ facts, inputs });
    const [existing] = await db.select().from(storeReports).where(and(eq(storeReports.registerId, mine.registerId), eq(storeReports.kind, kind), eq(storeReports.period, period))).limit(1);
    if (existing) {
      if (existing.review !== 'pending') throw new AppError(409, 'Báo cáo đã được duyệt, không sửa được. Dùng "Giải trình" nếu cần.');
      await db.update(storeReports).set({ data, updatedAt: now, clientKey, memberId: m.id }).where(and(eq(storeReports.id, existing.id), eq(storeReports.review, 'pending')));
      return json({ ok: true, id: existing.id, updated: true, state: slotState(kind, period, existing.submittedAt, now) });
    }
    const id = crypto.randomUUID();
    const inserted = await db.insert(storeReports).values({ id, registerId: mine.registerId, kind, period, memberId: m.id, data, submittedAt: now, updatedAt: now, clientKey })
      .onConflictDoNothing().returning({ id: storeReports.id });
    if (!inserted.length) throw new AppError(409, 'Báo cáo kỳ này vừa được nộp ở máy khác. Tải lại trang.');
    return json({ ok: true, id, state: slotState(kind, period, now, now) }, 201);
  }, 'business');

  router.post('/store/reports/:id/review', async c => {
    const m = me(c); if (!reviews(m)) throw new AppError(403, 'Bạn chưa được cấp quyền duyệt báo cáo Cửa hàng trưởng.');
    const b = await readJson(c.req, 4_000), db = c.env.db;
    const [r] = await db.select({ id: storeReports.id, kind: storeReports.kind }).from(storeReports).where(eq(storeReports.id, c.params.id!)).limit(1);
    if (!r) throw new AppError(404, 'Không tìm thấy báo cáo.');
    const review = b.review as StoreReviewStatus;
    if (!REVIEW_FOR[r.kind].includes(review)) throw new AppError(400, 'Kết quả duyệt không hợp lệ với loại báo cáo này.');
    const note = text(b.note, 1000);
    if (review !== 'ok' && note.length < 3) throw new AppError(400, 'Nhập lý do (bắt buộc khi không đạt hoặc miễn).');
    await db.update(storeReports).set({ review, reviewNote: note, reviewedBy: m.id, reviewedAt: nowIso() }).where(eq(storeReports.id, r.id));
    return json({ ok: true });
  }, 'business');

  router.post('/store/reports/:id/explain', async c => {
    const m = me(c), b = await readJson(c.req, 4_000), db = c.env.db, mine = await myStore(db, m.id);
    const [r] = await db.select({ id: storeReports.id, registerId: storeReports.registerId }).from(storeReports).where(eq(storeReports.id, c.params.id!)).limit(1);
    if (!r) throw new AppError(404, 'Không tìm thấy báo cáo.');
    if (!mine || mine.registerId !== r.registerId) throw new AppError(403, 'Chỉ Cửa hàng trưởng của cửa hàng này được giải trình.');
    const explanation = text(b.explanation, 1000); if (explanation.length < 3) throw new AppError(400, 'Nhập nội dung giải trình.');
    await db.update(storeReports).set({ explanation, updatedAt: nowIso() }).where(eq(storeReports.id, r.id));
    return json({ ok: true });
  }, 'business');

  router.put('/store/managers', async c => {
    const m = me(c); if (m.role !== 'manager') throw new AppError(403, 'Chỉ Manager được gán Cửa hàng trưởng.');
    const b = await readJson(c.req, 2_000), db = c.env.db, registerId = text(b.registerId, 80), memberId = b.memberId ? text(b.memberId, 80) : null;
    const [reg] = await db.select({ id: posRegisters.id }).from(posRegisters).where(eq(posRegisters.id, registerId)).limit(1);
    if (!reg) throw new AppError(404, 'Không tìm thấy cửa hàng.');
    if (!memberId) { await db.delete(storeManagers).where(eq(storeManagers.registerId, registerId)); return json({ ok: true }); }
    const [person] = await db.select({ id: employees.id }).from(employees).where(and(eq(employees.id, memberId), eq(employees.active, true), isNull(employees.deletedAt),
      inArray(employees.role, ['employee', 'manager']))).limit(1);
    if (!person) throw new AppError(404, 'Không tìm thấy nhân viên.');
    await db.transaction(async tx => {
      await tx.delete(storeManagers).where(and(eq(storeManagers.memberId, memberId), ne(storeManagers.registerId, registerId)));
      await tx.insert(storeManagers).values({ registerId, memberId, assignedBy: m.id, assignedAt: nowIso() })
        .onConflictDoUpdate({ target: storeManagers.registerId, set: { memberId, assignedBy: m.id, assignedAt: nowIso() } });
    });
    return json({ ok: true });
  }, 'business');
}
