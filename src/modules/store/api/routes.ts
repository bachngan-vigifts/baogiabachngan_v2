/**
 * BÁO CÁO CỬA HÀNG TRƯỞNG (CHT) – khu vực `business`. Xem domain/reports.ts cho hạn nộp và Tiền Trách nhiệm.
 *  GET  /store/status                       cửa hàng mình phụ trách + quyền duyệt (+ danh sách cửa hàng / CHT cho người duyệt)
 *  GET  /store/reminders                    việc CHT cần làm lúc này (hộp nhắc 30 phút)
 *  GET  /store/reports?registerId&month     báo cáo trong tháng + Tiền Trách nhiệm tạm tính
 *  GET  /store/reports/draft?registerId&kind&period   số liệu CRM tự tính + nháp + báo cáo đã nộp + lịch sử nộp + điều kiện nộp
 *  PUT  /store/reports/draft                CHT lưu NHÁP (chỉ phần CHT nhập; nháp không tính là đã nộp / đúng hạn)
 *  POST /store/reports                      CHT NỘP CHÍNH THỨC / nộp lại (kỳ phải kết thúc; giữ giờ nộp chính thức đầu tiên;
 *                                           mỗi lần nộp lưu một bản chụp số liệu vào lịch sử; đã duyệt thì khoá)
 *  GET  /store/settings?registerId          cấu hình báo cáo của cửa hàng (quỹ giữ lại, lịch nộp tiền, ngưỡng giải trình kiểm tồn)
 *  PUT  /store/settings                     Manager đặt cấu hình
 *  GET/PUT /store/restock-rules             ngưỡng tồn tối thiểu theo mã của kho cửa hàng (Manager đặt; căn cứ hàng cần bổ sung)
 *  POST /store/reports/:id/review           người duyệt (Manager / quyền store.review): đạt, sai sổ quỹ, đề xuất sai, miễn…
 *  POST /store/reports/:id/explain          CHT giải trình
 *  PUT  /store/managers                     Manager gán / bỏ CHT cho cửa hàng
 *  /store/reports/files…                    tệp đính kèm báo cáo – xem api/file-routes.ts
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
import { customerPayments, salesOrderLines, salesOrders } from '../../sales/schema.ts';
import { cashEntries } from '../../sales/cash-schema.ts';
import { posExchangeAllocations, posRefunds, posReturns } from '../../sales/return-schema.ts';
import { inventoryAdjustments, stockBalances, stockTransferLines, stockTransfers } from '../../inventory/schema.ts';
import { posReturnLines } from '../../sales/return-schema.ts';
import { reservedBySku } from '../../sales/api/pos-store.ts';
import type { StoreAttendanceOf, StoreTargetOf } from '../../../core/contracts/store-report.ts';
import { productMovements, products } from '../../catalog/schema.ts';
import { readyFiles, registerStoreFileRoutes } from './file-routes.ts';
import { storeRestockRules } from '../schema.ts';
import { storeManagers, storeReportDrafts, storeReportVersions, storeReports, storeSettings } from '../schema.ts';
import {
  DEPOSIT_SCHEDULES, DEPOSIT_SCHEDULE_LABEL, REVIEW_FOR, STORE_LIMITS, STORE_REPORT_KINDS, STORE_REPORT_LABEL, STORE_REVIEW_LABEL, canSubmitOfficial, cashDue, storeReportsLaunchAt,
  deadlineOf, isPeriod, nextMonth, periodEndsAt, periodStarted, remindersAt, responsibilityOf, slotState, vnClock, weeksDueIn,
  compareMonth, prevMonth, restockNeeds, stocktakeGaps,
  type DepositSchedule, type StoreReportKind, type StoreReviewStatus,
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
type Settings = { cashFloat: number | null; depositSchedule: DepositSchedule | null; stocktakeExplainThreshold: number | null; updatedAt: string | null };
async function settingsOf(db: AnyDb, registerId: string): Promise<Settings> {
  const [r] = await db.select().from(storeSettings).where(eq(storeSettings.registerId, registerId)).limit(1);
  return { cashFloat: r?.cashFloat ?? null, depositSchedule: r?.depositSchedule ?? null, stocktakeExplainThreshold: r?.stocktakeExplainThreshold ?? null, updatedAt: r?.updatedAt ?? null };
}
const IN_KINDS = ['other_income', 'cash_in'], SPENT_KINDS = ['petty_expense', 'advance', 'customer_refund'];
/**
 * Báo cáo ngày – tính trực tiếp từ ca POS (kể cả ca còn mở → số liệu tạm tính), đơn, phiếu thu khách, Sổ quỹ, trả / đổi / hoàn.
 * Ca thuộc ngày theo `business_date` (ca qua nửa đêm vẫn thuộc ngày mở ca). Tiền đầu ngày = tiền thực đếm lúc mở ca đầu tiên;
 * tiền bàn giao giữa các ca không cộng lại. Nộp két ("cash_out") là tiền đã nộp, không trừ thêm khi tính tiền phải nộp.
 */
async function dailyFacts(db: AnyDb, registerId: string, day: string, settings: Settings, declared: number | null) {
  const shifts = await db.select({ id: posShifts.id, member: employees.name, openedAt: posShifts.openedAt, closedAt: posShifts.closedAt, openingCash: posShifts.openingCash,
    expectedCash: posShifts.expectedCash, countedCash: posShifts.countedCash, cashDifference: posShifts.cashDifference, differenceReason: posShifts.differenceReason })
    .from(posShifts).leftJoin(employees, eq(employees.id, posShifts.memberId)).where(and(eq(posShifts.registerId, registerId), eq(posShifts.businessDate, day))).orderBy(asc(posShifts.openedAt), asc(posShifts.id));
  const ids = shifts.length ? shifts.map(s => s.id) : ['-'];
  const [orders, payments, entries, returns] = await Promise.all([
    db.select({ shiftId: salesOrders.shiftId, revenue: sql<number>`coalesce(sum(${salesOrders.total}),0)`.mapWith(Number), bills: sql<number>`count(*)`.mapWith(Number) })
      .from(salesOrders).where(and(inArray(salesOrders.shiftId, ids), ne(salesOrders.status, 'cancelled'))).groupBy(salesOrders.shiftId),
    db.select({ shiftId: customerPayments.shiftId, method: customerPayments.method, amount: sql<number>`coalesce(sum(${customerPayments.amount}),0)`.mapWith(Number) })
      .from(customerPayments).where(and(inArray(customerPayments.shiftId, ids), isNull(customerPayments.voidedAt))).groupBy(customerPayments.shiftId, customerPayments.method),
    db.select({ kind: cashEntries.kind, direction: cashEntries.direction, status: cashEntries.status, amount: sql<number>`coalesce(sum(${cashEntries.amount}),0)`.mapWith(Number), n: sql<number>`count(*)`.mapWith(Number) })
      .from(cashEntries).where(and(inArray(cashEntries.shiftId, ids), inArray(cashEntries.status, ['posted', 'pending']))).groupBy(cashEntries.kind, cashEntries.direction, cashEntries.status),
    db.select({ id: posReturns.id, returnNo: posReturns.returnNo, kind: posReturns.kind, status: posReturns.status, total: posReturns.total, orderId: posReturns.orderId, orderNo: salesOrders.orderNo, createdAt: posReturns.createdAt })
      .from(posReturns).leftJoin(salesOrders, eq(salesOrders.id, posReturns.orderId)).where(and(eq(posReturns.registerId, registerId), inArray(posReturns.createdShiftId, ids))).orderBy(asc(posReturns.createdAt)),
  ]);
  const retIds = returns.length ? returns.map(r => r.id) : ['-'];
  const [refunds, exchanges] = await Promise.all([
    db.select({ id: posRefunds.id, refundNo: posRefunds.refundNo, returnId: posRefunds.returnId, returnNo: posReturns.returnNo, method: posRefunds.method, amount: posRefunds.amount,
      cashEntryId: posRefunds.cashEntryId, shiftId: posRefunds.shiftId, confirmedAt: posRefunds.confirmedAt })
      .from(posRefunds).innerJoin(posReturns, eq(posReturns.id, posRefunds.returnId))
      .where(and(eq(posReturns.registerId, registerId), or(inArray(posRefunds.shiftId, ids), inArray(posRefunds.returnId, retIds)))).orderBy(asc(posRefunds.confirmedAt)),
    db.select({ returnId: posExchangeAllocations.returnId, amount: posExchangeAllocations.amount, status: posExchangeAllocations.status, orderId: posExchangeAllocations.replacementOrderId, orderNo: salesOrders.orderNo })
      .from(posExchangeAllocations).leftJoin(salesOrders, eq(salesOrders.id, posExchangeAllocations.replacementOrderId))
      .where(and(inArray(posExchangeAllocations.returnId, retIds), ne(posExchangeAllocations.status, 'cancelled'))),
  ]);
  const pay = (shiftId: string, method?: string) => payments.filter(p => p.shiftId === shiftId && (method ? p.method === method : !['cash', 'transfer'].includes(p.method))).reduce((n, p) => n + p.amount, 0);
  const list = shifts.map(s => { const o = orders.find(x => x.shiftId === s.id);
    return { id: s.id, member: s.member ?? '', openedAt: s.openedAt, closedAt: s.closedAt, open: !s.closedAt, bills: o?.bills ?? 0, revenue: o?.revenue ?? 0,
      cash: pay(s.id, 'cash'), transfer: pay(s.id, 'transfer'), other: pay(s.id), openingCash: s.openingCash,
      expectedCash: s.closedAt ? s.expectedCash : null, countedCash: s.closedAt ? s.countedCash : null, cashDifference: s.closedAt ? s.cashDifference : null, differenceReason: s.differenceReason }; });
  const sum = (k: 'bills' | 'revenue' | 'cash' | 'transfer' | 'other') => list.reduce((n, x) => n + Number(x[k] || 0), 0);
  const posted = (kinds: readonly string[]) => entries.filter(e => e.status === 'posted' && kinds.includes(e.kind)).reduce((n, e) => n + e.amount, 0);
  const adjustments = entries.filter(e => e.status === 'posted' && e.kind === 'adjustment').reduce((n, e) => n + (e.direction === 'in' ? e.amount : -e.amount), 0);
  const pending = entries.filter(e => e.status === 'pending'), cashIn = sum('cash') + posted(IN_KINDS), spent = posted(SPENT_KINDS), depositedBook = posted(['cash_out']);
  const differences = list.filter(x => x.cashDifference), returnsDone = returns.filter(r => r.status === 'completed');
  const cash = { ...cashDue({ opening: list[0]?.openingCash ?? null, cashIn, spent, depositedBook, retained: settings.cashFloat, schedule: settings.depositSchedule, declared }),
    opening: list[0]?.openingCash ?? null, cashSales: sum('cash'), otherIn: posted(IN_KINDS), spent, refundsCash: posted(['customer_refund']), adjustments,
    pendingEntries: pending.reduce((n, e) => n + e.n, 0), pendingAmount: pending.reduce((n, e) => n + e.amount, 0),
    retained: settings.cashFloat, schedule: settings.depositSchedule };
  return { shifts: list, openShifts: list.filter(x => x.open).length,
    totals: { bills: sum('bills'), revenue: sum('revenue'), cash: sum('cash'), transfer: sum('transfer'), other: sum('other'),
      // Lệch thiếu và lệch thừa tách riêng – không cộng bù thành 0.
      shortage: differences.filter(x => x.cashDifference! < 0).reduce((n, x) => n + x.cashDifference!, 0), surplus: differences.filter(x => x.cashDifference! > 0).reduce((n, x) => n + x.cashDifference!, 0),
      cashDifference: differences.reduce((n, x) => n + x.cashDifference!, 0), returnsValue: returnsDone.reduce((n, r) => n + r.total, 0) },
    cash,
    returns: returns.map(r => ({ ...r, exchanges: exchanges.filter(x => x.returnId === r.id).map(x => ({ orderId: x.orderId, orderNo: x.orderNo, amount: x.amount, status: x.status })) })),
    refunds: refunds.map(r => ({ ...r, inShift: ids.includes(r.shiftId ?? '') })) };
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
type Deps = { targetOf?: StoreTargetOf; attendanceOf?: StoreAttendanceOf };
const vnStart = (day: string) => new Date(Date.parse(day + 'T00:00:00+07:00')).toISOString();
const NO_TARGET = { configured: false as const, reason: 'Chưa nối nguồn chỉ tiêu cửa hàng.' };
/** Giá nhập gần nhất theo mã (lịch sử sản phẩm, dòng Nhập hàng) – cùng phương pháp với phiếu kiểm kê. */
async function lastCosts(db: AnyDb, skus: readonly string[]) {
  if (!skus.length) return new Map<string, number>();
  return new Map((await db.selectDistinctOn([productMovements.sku], { sku: productMovements.sku, price: productMovements.unitPrice }).from(productMovements)
    .where(and(inArray(productMovements.sku, [...skus]), eq(productMovements.kind, 'purchase'), sql`${productMovements.unitPrice} is not null`))
    .orderBy(productMovements.sku, desc(productMovements.occurredAt))).map(r => [r.sku, Number(r.price)]));
}
/**
 * Kiểm tồn của tháng: phiếu kiểm kê (dòng nguồn "stocktake") của ĐÚNG kho cửa hàng, lập từ 00h ngày 01 tới hạn nộp (00h ngày 02 tháng sau, giờ VN).
 * Phiếu chờ duyệt vẫn tính (không bắt buộc đã duyệt). Phạm vi: mã đã đếm so với mã đang có tồn. Thừa / thiếu tách riêng; hàng hỏng từ phiếu trả.
 */
async function stocktakeFacts(db: AnyDb, warehouseId: string, month: string, threshold: number | null) {
  const from = vnStart(month + '-01'), to = vnStart(nextMonth(month) + '-02');
  const rows = await db.select({ id: inventoryAdjustments.id, refNo: inventoryAdjustments.refNo, status: inventoryAdjustments.status, createdAt: inventoryAdjustments.createdAt, lines: inventoryAdjustments.lines })
    .from(inventoryAdjustments).where(and(eq(inventoryAdjustments.warehouseId, warehouseId), gte(inventoryAdjustments.createdAt, from), lt(inventoryAdjustments.createdAt, to),
      sql`${inventoryAdjustments.lines}::jsonb @> '[{"source":"stocktake"}]'::jsonb`)).orderBy(asc(inventoryAdjustments.createdAt));
  type L = { sku: string; qty: number; countedQty?: number; expectedQty?: number };
  const live = rows.filter(r => r.status !== 'rejected');
  const counted = new Set(live.flatMap(r => ((parse(r.lines) ?? []) as L[]).map(l => l.sku)));
  // Lệch theo mã: lấy phiếu mới nhất của mỗi mã (đếm lại thay cho lần trước), không cộng dồn giữa các phiếu.
  const latest = new Map<string, L & { status: string }>();
  for (const r of live) for (const l of (parse(r.lines) ?? []) as L[]) latest.set(l.sku, { ...l, status: r.status });
  const costs = await lastCosts(db, [...latest.values()].filter(l => l.qty).map(l => l.sku));
  const lines = [...latest.values()].map(l => ({ sku: l.sku, qty: l.qty, status: l.status, value: l.qty ? (costs.has(l.sku) ? Math.round(Math.abs(l.qty) * costs.get(l.sku)!) : null) : 0 }));
  const gaps = stocktakeGaps(lines, threshold);
  const [stocked, damaged, names] = await Promise.all([
    db.select({ sku: stockBalances.sku }).from(stockBalances).where(and(eq(stockBalances.warehouseId, warehouseId), sql`${stockBalances.qty} > 0`)),
    db.select({ sku: posReturnLines.sku, name: posReturnLines.name, qty: sql<number>`sum(${posReturnLines.receivedQty} - ${posReturnLines.restockQty})`.mapWith(Number) })
      .from(posReturnLines).innerJoin(posReturns, eq(posReturns.id, posReturnLines.returnId))
      .where(and(eq(posReturns.warehouseId, warehouseId), eq(posReturnLines.disposition, 'damaged'), sql`${posReturns.receivedAt} is not null`, gte(posReturns.receivedAt, vnStart(month + '-01')), lt(posReturns.receivedAt, vnStart(nextMonth(month) + '-01'))))
      .groupBy(posReturnLines.sku, posReturnLines.name),
    latest.size ? db.select({ sku: products.sku, name: products.name }).from(products).where(inArray(products.sku, [...latest.keys()])) : Promise.resolve([]),
  ]);
  const notCounted = stocked.map(s => s.sku).filter(sku => !counted.has(sku)).sort();
  const name = new Map(names.map(n => [n.sku, n.name]));
  return { from, to, valuation: 'Giá nhập gần nhất (lịch sử sản phẩm, dòng Nhập hàng) × |SL lệch|. Chỉ để đánh giá, không phải tiền bồi thường. Mã thiếu giá không tính giá trị.',
    counts: rows.map(r => { const ls = ((parse(r.lines) ?? []) as L[]);
      return { id: r.id, refNo: r.refNo, status: r.status, createdAt: r.createdAt, countedSkus: ls.length, gapSkus: ls.filter(l => l.qty).length, noGap: ls.length > 0 && ls.every(l => !l.qty) }; }),
    scope: { countedSkus: counted.size, stockedSkus: stocked.length, notCounted: notCounted.length, notCountedSample: notCounted.slice(0, 20) },
    lines: lines.filter(l => l.qty).map(l => ({ ...l, name: name.get(l.sku) ?? '', mustExplain: gaps.mustExplain.includes(l.sku) })).sort((a, b) => (b.value ?? 0) - (a.value ?? 0)),
    surplus: gaps.surplus, shortage: gaps.shortage, missingCost: gaps.missingCost, noGap: live.length > 0 && gaps.noGap,
    pending: rows.filter(r => r.status === 'pending').length, damaged: damaged.filter(d => d.qty > 0), threshold };
}
/** Hàng cần bổ sung của kho cửa hàng theo ngưỡng đã cấu hình. Đang về = phiếu điều chuyển tới kho đã duyệt / đã gửi, chưa nhận. */
async function restockFacts(db: AnyDb, warehouseId: string) {
  const rules = await db.select({ sku: storeRestockRules.sku, minQty: storeRestockRules.minQty, name: products.name }).from(storeRestockRules)
    .leftJoin(products, eq(products.sku, storeRestockRules.sku)).where(eq(storeRestockRules.warehouseId, warehouseId));
  if (!rules.length) return { configured: false as const, rules: 0, items: [] };
  const skus = rules.map(r => r.sku);
  const [balances, held, incoming] = await Promise.all([
    db.select({ sku: stockBalances.sku, qty: stockBalances.qty }).from(stockBalances).where(and(eq(stockBalances.warehouseId, warehouseId), inArray(stockBalances.sku, skus))),
    reservedBySku(db as never, skus, warehouseId),
    db.select({ sku: stockTransferLines.sku, qty: sql<number>`sum(coalesce(${stockTransferLines.shippedQty}, ${stockTransferLines.qty}))`.mapWith(Number) })
      .from(stockTransferLines).innerJoin(stockTransfers, eq(stockTransfers.id, stockTransferLines.transferId))
      .where(and(eq(stockTransfers.toWarehouseId, warehouseId), inArray(stockTransfers.status, ['approved', 'shipped']), inArray(stockTransferLines.sku, skus))).groupBy(stockTransferLines.sku),
  ]);
  const items = restockNeeds(rules.map(r => ({ sku: r.sku, minQty: r.minQty, onHand: balances.find(b => b.sku === r.sku)?.qty ?? 0, held: held.get(r.sku) ?? 0, incoming: incoming.find(i => i.sku === r.sku)?.qty ?? 0 })));
  const name = new Map(rules.map(r => [r.sku, r.name ?? '']));
  return { configured: true as const, rules: rules.length, items: items.map(i => ({ ...i, name: name.get(i.sku) ?? '' })) };
}
/** Doanh thu POS theo thương hiệu (trường thương hiệu trong danh mục); trống → "Chưa phân loại". Không đoán từ tên sản phẩm. */
async function brandSales(db: AnyDb, registerId: string, from: string, to: string) {
  const rows = await db.select({ brand: sql<string>`coalesce(nullif(trim(${products.brand}), ''), '')`, amount: sql<number>`sum(${salesOrderLines.amount})`.mapWith(Number), qty: sql<number>`sum(${salesOrderLines.qty})`.mapWith(Number) })
    .from(salesOrderLines).innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.orderId)).innerJoin(posShifts, eq(posShifts.id, salesOrders.shiftId))
    .leftJoin(products, eq(products.sku, salesOrderLines.sku))
    .where(and(eq(posShifts.registerId, registerId), gte(posShifts.businessDate, from), lte(posShifts.businessDate, to), ne(salesOrders.status, 'cancelled')))
    .groupBy(sql`1`).orderBy(desc(sql`sum(${salesOrderLines.amount})`));
  return rows.map(r => ({ group: r.brand || 'Chưa phân loại', unclassified: !r.brand, amount: r.amount, qty: r.qty }));
}
/** Lệch quỹ khi kết ca trong khoảng ngày: thiếu và thừa riêng (không cộng bù). */
async function cashGaps(db: AnyDb, registerId: string, from: string, to: string) {
  const rows = await db.select({ diff: posShifts.cashDifference }).from(posShifts)
    .where(and(eq(posShifts.registerId, registerId), gte(posShifts.businessDate, from), lte(posShifts.businessDate, to), sql`${posShifts.closedAt} is not null`, sql`coalesce(${posShifts.cashDifference},0) <> 0`));
  const short = rows.filter(r => r.diff! < 0), over = rows.filter(r => r.diff! > 0);
  return { shortage: short.reduce((n, r) => n + r.diff!, 0), shortageShifts: short.length, surplus: over.reduce((n, r) => n + r.diff!, 0), surplusShifts: over.length };
}
async function returnsTotal(db: AnyDb, registerId: string, from: string, to: string) {
  const [r] = await db.select({ total: sql<number>`coalesce(sum(${posReturns.total}),0)`.mapWith(Number) }).from(posReturns)
    .where(and(eq(posReturns.registerId, registerId), eq(posReturns.status, 'completed'), gte(posReturns.updatedAt, vnStart(from)), lt(posReturns.updatedAt, vnStart(addDays(to, 1)))));
  return r?.total ?? 0;
}
async function factsFor(db: AnyDb, store: { id: string; warehouseId: string }, kind: StoreReportKind, period: string, declared: number | null = null, deps: Deps = {}) {
  if (kind === 'daily') return dailyFacts(db, store.id, period, await settingsOf(db, store.id), declared);
  if (kind === 'weekly') { const to = addDays(period, 6), month = to.slice(0, 7);
    const [days, top, slow, restock, target] = await Promise.all([salesByDay(db, store.id, period, to), topProducts(db, store.id, period, to),
      slowProducts(db, store.id, store.warehouseId, to), restockFacts(db, store.warehouseId), deps.targetOf ? deps.targetOf(db, store.id, month) : NO_TARGET]);
    return { from: period, to, days, revenue: days.reduce((n, d) => n + d.revenue, 0), bills: days.reduce((n, d) => n + d.bills, 0), returns: await returnsTotal(db, store.id, period, to),
      top, slow, restock, target: { month, ...target } }; }
  if (kind === 'monthly') { const from = period + '-01', to = addDays(nextMonth(period) + '-01', -1), prev = prevMonth(period);
    const pFrom = prev + '-01', pTo = addDays(period + '-01', -1);
    const [days, prevDays, prevShiftDays, top, brands, gaps, staffRows, target, prevTarget, returns] = await Promise.all([salesByDay(db, store.id, from, to), salesByDay(db, store.id, pFrom, pTo), shiftDays(db, store.id, pFrom, pTo),
      topProducts(db, store.id, from, to, 15), brandSales(db, store.id, from, to), cashGaps(db, store.id, from, to),
      db.select({ memberId: posShifts.memberId, member: employees.name, shifts: sql<number>`count(distinct ${posShifts.id})`.mapWith(Number), days: sql<number>`count(distinct ${posShifts.businessDate})`.mapWith(Number) })
        .from(posShifts).leftJoin(employees, eq(employees.id, posShifts.memberId)).where(and(eq(posShifts.registerId, store.id), gte(posShifts.businessDate, from), lte(posShifts.businessDate, to)))
        .groupBy(posShifts.memberId, employees.name),
      deps.targetOf ? deps.targetOf(db, store.id, period) : NO_TARGET, deps.targetOf ? deps.targetOf(db, store.id, prev) : NO_TARGET, returnsTotal(db, store.id, from, to)]);
    // Tháng trước "có dữ liệu" khi cửa hàng có mở ca (không bán gì → 0 thật); không mở ca nào → thiếu dữ liệu.
    const prevOpen = prevShiftDays.length > 0, revenue = days.reduce((n, d) => n + d.revenue, 0), prevRevenue = prevOpen ? prevDays.reduce((n, d) => n + d.revenue, 0) : null;
    const hr = deps.attendanceOf ? await deps.attendanceOf(db, staffRows.map(s => s.memberId), period) : null;
    const t = target.configured ? target.revenue : null, pt = prevTarget.configured ? prevTarget.revenue : null;
    return { from, to, revenue, bills: days.reduce((n, d) => n + d.bills, 0), returns, days, top, brands, cashGaps: gaps,
      // So tháng trước: cùng quầy, cùng cách tính; tháng trước không có ca → thiếu dữ liệu (không coi là 0).
      previous: { month: prev, revenue: prevRevenue, bills: prevOpen ? prevDays.reduce((n, d) => n + d.bills, 0) : null, posCompare: compareMonth(revenue, prevRevenue),
        targetRevenue: pt, targetCompare: compareMonth(t, pt) },
      target: { month: period, ...target },
      staff: staffRows.map(s => ({ member: s.member, shifts: s.shifts, days: s.days, hrWorked: hr?.get(s.memberId)?.recorded ? hr.get(s.memberId)!.worked : null, hrRecorded: hr?.get(s.memberId)?.recorded ?? null })) }; }
  return stocktakeFacts(db, store.warehouseId, period, (await settingsOf(db, store.id)).stocktakeExplainThreshold);
}
/** Giá vốn / giá trị lệch kiểm kê chỉ Manager xem (cùng quy tắc phiếu kiểm kê). */
function redactCosts(kind: StoreReportKind, facts: any, canSeeCost: boolean) {
  if (kind !== 'stocktake' || canSeeCost || !facts) return facts;
  const hide = (x: any) => x ? { ...x, value: null } : x;
  return { ...facts, lines: (facts.lines ?? []).map(hide), surplus: hide(facts.surplus), shortage: hide(facts.shortage), counts: (facts.counts ?? []).map((c: any) => ({ ...c, gapValue: undefined })), costHidden: true };
}

/** Phần CHT nhập theo loại báo cáo (chỉ nhận đúng các ô này; số liệu CRM không bao giờ lấy từ client). */
function inputsFor(kind: StoreReportKind, b: Record<string, unknown>) {
  if (kind === 'daily') return { bankDeposit: money(b.bankDeposit, 'Tiền nộp ngân hàng'), bankRef: text(b.bankRef, 200), cashExplanation: text(b.cashExplanation), incidents: text(b.incidents), note: text(b.note) };
  if (kind === 'weekly') return { orderProposal: text(b.orderProposal), orderRefs: text(b.orderRefs, 500), slowAction: text(b.slowAction), roster: text(b.roster), nextWeekPlan: text(b.nextWeekPlan, 1000), note: text(b.note) };
  if (kind === 'monthly') return { groupAnalysis: text(b.groupAnalysis), staffReview: text(b.staffReview), nextMonthPlan: text(b.nextMonthPlan), note: text(b.note) };
  const sku = (b.skuExplanations && typeof b.skuExplanations === 'object' ? b.skuExplanations : {}) as Record<string, unknown>;
  return { counted: b.counted === true, scopeNote: text(b.scopeNote), damagedNote: text(b.damagedNote), gapExplanation: text(b.gapExplanation), note: text(b.note),
    skuExplanations: Object.fromEntries(Object.entries(sku).slice(0, 200).map(([k, v]) => [text(k, 200), text(v, 1000)]).filter(([k, v]) => k && v)) };
}
type Inputs = ReturnType<typeof inputsFor>;
/** Điều kiện nộp chính thức (nháp không cần đủ). */
function officialProblems(kind: StoreReportKind, v: Inputs, facts: any) {
  const out: string[] = [];
  if (kind === 'daily') {
    const d = v as Extract<Inputs, { bankDeposit: unknown }>;
    if (facts?.cash?.schedule === 'daily' && d.bankDeposit === null) out.push('Nhập số tiền đã nộp ngân hàng hôm nay (nhập 0 nếu chưa nộp).');
    if (facts?.cash?.needsExplanation && d.cashExplanation.length < 3) out.push('Có chênh lệch tiền nộp – nhập giải trình chênh lệch.');
  }
  if (kind === 'weekly' && (v as { orderProposal: string }).orderProposal.length < 3) out.push('Nhập đề xuất đặt hàng (Sale-in) cho tuần tới.');
  if (kind === 'monthly' && (v as { staffReview: string }).staffReview.length < 3) out.push('Nhập đánh giá ngày công và năng lực NVBH.');
  if (kind === 'stocktake') {
    const st = v as { counted: boolean; skuExplanations: Record<string, string> };
    if (!st.counted) out.push('Xác nhận đã kiểm kê theo đúng quy trình.');
    const miss = (facts?.lines ?? []).filter((l: { mustExplain: boolean; sku: string }) => l.mustExplain && (st.skuExplanations[l.sku] ?? '').length < 3).map((l: { sku: string }) => l.sku);
    if (miss.length) out.push(`Giải trình riêng các mã lệch vượt ngưỡng: ${miss.slice(0, 10).join(', ')}${miss.length > 10 ? '…' : ''}.`);
  }
  return out;
}
/** Nguồn số liệu ghi kèm bản chụp. */
const SOURCES: Record<StoreReportKind, string[]> = {
  daily: ['pos_shifts', 'sales_orders', 'customer_payments', 'cash_entries', 'pos_returns', 'pos_refunds', 'pos_exchange_allocations', 'store_settings'],
  weekly: ['pos_shifts', 'sales_orders', 'sales_order_lines', 'stock_balances', 'stock_holds', 'order_stock_holds', 'stock_transfers', 'store_restock_rules', 'pos_returns', 'store-target-source'],
  monthly: ['pos_shifts', 'sales_orders', 'sales_order_lines', 'products.brand', 'pos_returns', 'hr_attendance', 'store-target-source'],
  stocktake: ['inventory_adjustments', 'stock_balances', 'product_movements', 'pos_return_lines', 'store_settings'],
};
const provisionalOf = (kind: StoreReportKind, facts: any) => kind === 'daily' && Number(facts?.openShifts || 0) > 0;

export function registerStoreRoutes(router: Router<StaffEnv>, deps: Deps = {}) {
  registerStoreFileRoutes(router, { storeFor, myStore });
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
    const rows = await db.select({ id: storeReports.id, kind: storeReports.kind, period: storeReports.period, submittedAt: storeReports.submittedAt, updatedAt: storeReports.updatedAt, data: storeReports.data,
      review: storeReports.review, reviewNote: storeReports.reviewNote, reviewedAt: storeReports.reviewedAt, explanation: storeReports.explanation, member: employees.name })
      .from(storeReports).leftJoin(employees, eq(employees.id, storeReports.memberId))
      .where(and(eq(storeReports.registerId, store.id), or(and(inArray(storeReports.kind, ['monthly', 'stocktake']), eq(storeReports.period, month)),
        and(eq(storeReports.kind, 'daily'), gte(storeReports.period, from), lte(storeReports.period, last)), and(eq(storeReports.kind, 'weekly'), inArray(storeReports.period, weeks.length ? weeks : ['-'])))))
      .orderBy(asc(storeReports.period));
    const drafts = await db.select({ kind: storeReportDrafts.kind, period: storeReportDrafts.period, updatedAt: storeReportDrafts.updatedAt }).from(storeReportDrafts).where(eq(storeReportDrafts.registerId, store.id));
    const reports = rows.map(({ data, ...r }) => ({ ...r, provisional: !!parse(data)?.meta?.provisional, deadline: deadlineOf(r.kind, r.period), state: slotState(r.kind, r.period, r.submittedAt, now) }));
    const responsibility = responsibilityOf({ month, dailyDays, weeks, now, reports: rows.map(r => ({ kind: r.kind, period: r.period, submittedAt: r.submittedAt, review: r.review })) });
    return json({ store: { registerId: store.id, name: store.name }, isManager: store.isManager, canReview: reviews(me(c)), canConfigure: me(c).role === 'manager', launchAt: storeReportsLaunchAt(), month, dailyDays, weeks, reports, drafts, responsibility });
  }, 'business');

  router.get('/store/reports/draft', async c => {
    const q = c.url.searchParams, store = await storeFor(c, q.get('registerId')), kind = kindOf(q.get('kind')), period = q.get('period'), db = c.env.db, now = nowIso();
    if (!isPeriod(kind, period)) throw new AppError(400, 'Kỳ báo cáo không hợp lệ.');
    const [[existing], [draft]] = await Promise.all([
      db.select().from(storeReports).where(and(eq(storeReports.registerId, store.id), eq(storeReports.kind, kind), eq(storeReports.period, period))).limit(1),
      db.select().from(storeReportDrafts).where(and(eq(storeReportDrafts.registerId, store.id), eq(storeReportDrafts.kind, kind), eq(storeReportDrafts.period, period))).limit(1),
    ]);
    const versions = existing ? await db.select({ version: storeReportVersions.version, submittedAt: storeReportVersions.submittedAt, provisional: storeReportVersions.provisional, member: employees.name })
      .from(storeReportVersions).leftJoin(employees, eq(employees.id, storeReportVersions.memberId)).where(eq(storeReportVersions.reportId, existing.id)).orderBy(asc(storeReportVersions.version)) : [];
    const draftInputs = draft ? parse(draft.inputs) : null, reportData = existing ? parse(existing.data) : null;
    // Ô "đã nộp ngân hàng" ảnh hưởng chênh lệch: ưu tiên số trong nháp, rồi số đã nộp chính thức.
    const declared = kind === 'daily' ? money((draftInputs ?? reportData?.inputs ?? {}).bankDeposit, 'Tiền nộp ngân hàng') : null;
    const facts = redactCosts(kind, await factsFor(db, store, kind, period, declared, deps), me(c).role === 'manager');
    const started = periodStarted(kind, period, now), official = canSubmitOfficial(kind, period, now);
    const locked = !!existing && existing.review !== 'pending';
    return json({ kind, period, deadline: deadlineOf(kind, period), opensAt: periodEndsAt(kind, period), factsAt: now, facts, provisional: provisionalOf(kind, facts),
      settings: kind === 'daily' ? await settingsOf(db, store.id) : undefined, scheduleLabels: DEPOSIT_SCHEDULE_LABEL,
      canEdit: store.isManager && started && !locked, canSubmit: store.isManager && official && !locked,
      blockers: [...(!started ? ['Kỳ báo cáo chưa bắt đầu.'] : []), ...(started && !official ? [`Kỳ chưa kết thúc – chỉ lưu nháp; nộp chính thức từ ${new Date(periodEndsAt(kind, period)).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}.`] : []),
        ...(locked ? ['Báo cáo đã được duyệt – không sửa được. Dùng "Giải trình" nếu cần.'] : [])],
      draft: draft ? { inputs: draftInputs, updatedAt: draft.updatedAt } : null, versions,
      report: existing ? { ...existing, data: reportData ? { ...reportData, facts: redactCosts(kind, reportData.facts, me(c).role === 'manager') } : null, state: slotState(kind, period, existing.submittedAt, now) } : null });
  }, 'business');

  /** Lưu nháp: chỉ CHT của cửa hàng, kỳ đã bắt đầu, báo cáo chưa duyệt. Không tính là đã nộp. */
  router.put('/store/reports/draft', async c => {
    const b = await readJson(c.req, 30_000), m = me(c), db = c.env.db, kind = kindOf(b.kind), period = b.period, now = nowIso();
    if (!isPeriod(kind, period)) throw new AppError(400, 'Kỳ báo cáo không hợp lệ.');
    const mine = await myStore(db, m.id);
    if (!mine || mine.registerId !== text(b.registerId, 80)) throw new AppError(403, 'Chỉ Cửa hàng trưởng của cửa hàng này được lưu báo cáo.');
    if (!periodStarted(kind, period, now)) throw new AppError(400, 'Kỳ báo cáo chưa bắt đầu.');
    const [existing] = await db.select({ review: storeReports.review }).from(storeReports).where(and(eq(storeReports.registerId, mine.registerId), eq(storeReports.kind, kind), eq(storeReports.period, period))).limit(1);
    if (existing && existing.review !== 'pending') throw new AppError(409, 'Báo cáo đã được duyệt, không sửa được.');
    const inputs = JSON.stringify(inputsFor(kind, (b.inputs ?? {}) as Record<string, unknown>));
    await db.insert(storeReportDrafts).values({ registerId: mine.registerId, kind, period, memberId: m.id, inputs, updatedAt: now })
      .onConflictDoUpdate({ target: [storeReportDrafts.registerId, storeReportDrafts.kind, storeReportDrafts.period], set: { inputs, memberId: m.id, updatedAt: now } });
    return json({ ok: true, draft: true, updatedAt: now });
  }, 'business');

  router.post('/store/reports', async c => {
    const b = await readJson(c.req, 30_000), m = me(c), db = c.env.db, kind = kindOf(b.kind), period = b.period, clientKey = text(b.clientKey, 80);
    if (!isPeriod(kind, period)) throw new AppError(400, 'Kỳ báo cáo không hợp lệ.');
    if (clientKey.length < 8) throw new AppError(400, 'Thiếu mã chống gửi lặp. Tải lại trang rồi thử lại.');
    const mine = await myStore(db, m.id);
    if (!mine || mine.registerId !== text(b.registerId, 80)) throw new AppError(403, 'Chỉ Cửa hàng trưởng của cửa hàng này được nộp báo cáo.');
    const now = nowIso();
    if (!periodStarted(kind, period, now)) throw new AppError(400, 'Kỳ báo cáo chưa bắt đầu.');
    if (!canSubmitOfficial(kind, period, now)) throw new AppError(409, 'Kỳ báo cáo chưa kết thúc – chỉ lưu nháp được, chưa nộp chính thức.', 'STORE_PERIOD_OPEN');
    const inputs = inputsFor(kind, (b.inputs ?? {}) as Record<string, unknown>);
    const [replay] = await db.select({ id: storeReports.id }).from(storeReports).where(and(eq(storeReports.memberId, m.id), eq(storeReports.clientKey, clientKey))).limit(1);
    if (replay) return json({ ok: true, id: replay.id, replayed: true });
    // Số liệu CRM luôn tính ở máy chủ lúc nộp – bỏ qua mọi "facts" client gửi lên.
    const facts = await factsFor(db, { id: mine.registerId, warehouseId: mine.warehouseId }, kind, period, kind === 'daily' ? (inputs as { bankDeposit: number | null }).bankDeposit : null, deps);
    const problems = officialProblems(kind, inputs, facts);
    if (problems.length) throw new AppError(400, problems.join(' '));
    const provisional = provisionalOf(kind, facts);
    const attached = await readyFiles(db, mine.registerId, kind, period);
    const data = JSON.stringify({ facts, inputs, meta: { factsAt: now, sources: SOURCES[kind], provisional, openShifts: kind === 'daily' ? (facts as { openShifts: number }).openShifts : 0,
      files: attached.map(f => ({ id: f.id, name: f.name, purpose: f.purpose, sha256: f.sha256 })) } });
    const result = await db.transaction(async tx => {
      const [existing] = await tx.select().from(storeReports).where(and(eq(storeReports.registerId, mine.registerId), eq(storeReports.kind, kind), eq(storeReports.period, period))).limit(1).for('update');
      if (existing) {
        if (existing.review !== 'pending') throw new AppError(409, 'Báo cáo đã được duyệt, không sửa được. Dùng "Giải trình" nếu cần.');
        const [last] = await tx.select({ v: sql<number>`coalesce(max(${storeReportVersions.version}),0)`.mapWith(Number) }).from(storeReportVersions).where(eq(storeReportVersions.reportId, existing.id));
        const version = (last?.v ?? 0) + 1;
        // Giữ giờ nộp chính thức đầu tiên (submitted_at); lịch sử giữ mọi bản đã nộp.
        await tx.update(storeReports).set({ data, updatedAt: now, clientKey, memberId: m.id }).where(and(eq(storeReports.id, existing.id), eq(storeReports.review, 'pending')));
        await tx.insert(storeReportVersions).values({ id: crypto.randomUUID(), reportId: existing.id, version, memberId: m.id, data, provisional, submittedAt: now });
        await tx.delete(storeReportDrafts).where(and(eq(storeReportDrafts.registerId, mine.registerId), eq(storeReportDrafts.kind, kind), eq(storeReportDrafts.period, period)));
        return { status: 200, body: { ok: true, id: existing.id, updated: true, version, provisional, state: slotState(kind, period, existing.submittedAt, now) } };
      }
      const id = crypto.randomUUID();
      const inserted = await tx.insert(storeReports).values({ id, registerId: mine.registerId, kind, period, memberId: m.id, data, submittedAt: now, updatedAt: now, clientKey })
        .onConflictDoNothing().returning({ id: storeReports.id });
      if (!inserted.length) throw new AppError(409, 'Báo cáo kỳ này vừa được nộp ở máy khác. Tải lại trang.');
      await tx.insert(storeReportVersions).values({ id: crypto.randomUUID(), reportId: id, version: 1, memberId: m.id, data, provisional, submittedAt: now });
      await tx.delete(storeReportDrafts).where(and(eq(storeReportDrafts.registerId, mine.registerId), eq(storeReportDrafts.kind, kind), eq(storeReportDrafts.period, period)));
      return { status: 201, body: { ok: true, id, version: 1, provisional, state: slotState(kind, period, now, now) } };
    });
    return json(result.body, result.status);
  }, 'business');

  router.get('/store/settings', async c => {
    const store = await storeFor(c, c.url.searchParams.get('registerId'));
    return json({ registerId: store.id, settings: await settingsOf(c.env.db, store.id), canEdit: me(c).role === 'manager', scheduleLabels: DEPOSIT_SCHEDULE_LABEL });
  }, 'business');

  /** Ngưỡng tồn tối thiểu của kho cửa hàng (hàng cần bổ sung). CHT / người duyệt xem; Manager thay cả danh sách. */
  router.get('/store/restock-rules', async c => {
    const store = await storeFor(c, c.url.searchParams.get('registerId'));
    const rules = await c.env.db.select({ sku: storeRestockRules.sku, minQty: storeRestockRules.minQty, name: products.name, updatedAt: storeRestockRules.updatedAt })
      .from(storeRestockRules).leftJoin(products, eq(products.sku, storeRestockRules.sku)).where(eq(storeRestockRules.warehouseId, store.warehouseId)).orderBy(asc(storeRestockRules.sku));
    return json({ registerId: store.id, rules, canEdit: me(c).role === 'manager' });
  }, 'business');
  router.put('/store/restock-rules', async c => {
    const m = me(c); if (m.role !== 'manager') throw new AppError(403, 'Chỉ Manager được đặt ngưỡng tồn.');
    const b = await readJson(c.req, 200_000), db = c.env.db, registerId = text(b.registerId, 80);
    const [reg] = await db.select({ warehouseId: posRegisters.warehouseId }).from(posRegisters).where(eq(posRegisters.id, registerId)).limit(1);
    if (!reg) throw new AppError(404, 'Không tìm thấy cửa hàng.');
    const raw = Array.isArray(b.rules) ? b.rules : null;
    if (!raw || raw.length > 2000) throw new AppError(400, 'Danh sách ngưỡng không hợp lệ (tối đa 2.000 mã).');
    const rules = new Map<string, number>();
    for (const r of raw as Record<string, unknown>[]) {
      const sku = text(r?.sku, 200), min = Number(r?.minQty);
      if (!sku || !Number.isFinite(min) || min <= 0 || min > 1e9) throw new AppError(400, `Ngưỡng của mã "${sku || '?'}" không hợp lệ (phải > 0).`);
      if (rules.has(sku)) throw new AppError(400, `Mã ${sku} bị lặp.`);
      rules.set(sku, Math.round(min * 1000) / 1000);
    }
    const known = rules.size ? new Set((await db.select({ sku: products.sku }).from(products).where(inArray(products.sku, [...rules.keys()]))).map(p => p.sku)) : new Set<string>();
    const unknown = [...rules.keys()].filter(s => !known.has(s));
    if (unknown.length) throw new AppError(400, `Không có trong danh mục: ${unknown.slice(0, 10).join(', ')}.`);
    const now = nowIso();
    await db.transaction(async tx => {
      await tx.delete(storeRestockRules).where(eq(storeRestockRules.warehouseId, reg.warehouseId));
      if (rules.size) await tx.insert(storeRestockRules).values([...rules].map(([sku, minQty]) => ({ warehouseId: reg.warehouseId, sku, minQty, updatedBy: m.id, updatedAt: now })));
    });
    return json({ ok: true, count: rules.size });
  }, 'business');

  router.put('/store/settings', async c => {
    const m = me(c); if (m.role !== 'manager') throw new AppError(403, 'Chỉ Manager được cấu hình báo cáo cửa hàng.');
    const b = await readJson(c.req, 2_000), db = c.env.db, registerId = text(b.registerId, 80);
    const [reg] = await db.select({ id: posRegisters.id }).from(posRegisters).where(eq(posRegisters.id, registerId)).limit(1);
    if (!reg) throw new AppError(404, 'Không tìm thấy cửa hàng.');
    // Chỉ đổi các ô được gửi lên; ô không gửi giữ nguyên.
    const cur = await settingsOf(db, registerId), has = (k: string) => Object.hasOwn(b, k);
    const schedule = !has('depositSchedule') ? cur.depositSchedule : b.depositSchedule === null || b.depositSchedule === '' ? null : b.depositSchedule;
    if (schedule !== null && !DEPOSIT_SCHEDULES.includes(schedule as never)) throw new AppError(400, 'Lịch nộp tiền không hợp lệ.');
    const values = { cashFloat: has('cashFloat') ? money(b.cashFloat, 'Quỹ được giữ lại') : cur.cashFloat, depositSchedule: schedule as DepositSchedule | null,
      stocktakeExplainThreshold: has('stocktakeExplainThreshold') ? money(b.stocktakeExplainThreshold, 'Ngưỡng giải trình kiểm tồn') : cur.stocktakeExplainThreshold, updatedBy: m.id, updatedAt: nowIso() };
    await db.insert(storeSettings).values({ registerId, ...values }).onConflictDoUpdate({ target: storeSettings.registerId, set: values });
    return json({ ok: true, settings: await settingsOf(db, registerId) });
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
