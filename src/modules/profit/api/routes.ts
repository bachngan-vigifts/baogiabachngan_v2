/**
 * PHÂN TÍCH LỢI NHUẬN – khu vực `business`, CHỈ MANAGER (có giá vốn). Xem domain/profit.ts cho công thức.
 *  GET /profit?from&to&grain&branch&owner&customer   tổng quan + theo kỳ / chi nhánh / nhân viên / khách / sản phẩm / đơn
 *  GET /profit/orders/:id                            từng dòng của một đơn: giá bán, giá vốn (nguồn), in, hoa hồng
 * Chỉ đọc. Đơn tính như công nợ / doanh số: bỏ đơn huỷ; đơn nháp chỉ tính khi HĐKT đã ký.
 */
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, lte, ne } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import { json, readJson, type Router } from '../../../core/http/router.ts';
import type { AnyDb } from '../../../core/db/client.ts';
import { cachedReport, dropReportCache } from '../../../core/cache/report-cache.ts';
/** Khoá cache trang Phân tích lợi nhuận; sửa giá vốn / loại phiếu két thì bỏ để lần xem sau tính lại. */
const PROFIT_CACHE = 'profit';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees } from '../../staff/schema.ts';
import { deliveries, salesContracts, salesOrderLines, salesOrders } from '../../sales/schema.ts';
import { posRegisters, posShifts } from '../../sales/pos-schema.ts';
import { posReturnLines, posReturns } from '../../sales/return-schema.ts';
import { debtCounts } from '../../sales/domain/sales.ts';
import { quotations } from '../../quotes/schema.ts';
import { commissionOf, printingInfo, quoteStockSku, type QuoteDoc, type QuoteRow } from '../../quotes/domain/quote-math.ts';
import { productMovements } from '../../catalog/schema.ts';
import { salesLineCosts } from '../../sales/line-cost-schema.ts';
import { adjustLineCost } from '../../sales/api/line-costs.ts';
import { salesLineCostHistory } from '../../sales/line-cost-schema.ts';
import { LINE_COST_CONFIDENCE_LABEL, pickLineCost, quoteLineCost } from '../../sales/domain/line-cost.ts';
import type { LineCostFallbackOf, SkuFallbackCosts } from '../../../core/contracts/line-cost-fallback.ts';
import { cashEntryClasses } from '../schema.ts';
import { posFeeFacts } from '../domain/pos-fees.ts';
import { allocate, fullMonths, isMonthEnd, vnDay } from '../domain/allocation.ts';
import type { StaffCost, StaffCostOf } from '../../../core/contracts/staff-cost.ts';
import { cashEntries } from '../../sales/cash-schema.ts';
import { CASH_CLASSES, CASH_CLASS_LABEL, classifyCashEntry, type CashClass } from '../domain/branch-costs.ts';
import {
  COST_SOURCE_LABEL, GRAINS, addStaffCost, applyOrderFees, emptyRow, bucketLabel, bucketOf, groupBy, groupByProduct, orderProfit, type Grain, type LineInput, type OrderProfit,
} from '../domain/profit.ts';

type Ctx = Parameters<Parameters<Router<StaffEnv>['get']>[1]>[0];
const member = (c: Ctx) => (c.state.session as SessionState).member;
const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z'));
const MAX_DAYS = 3 * 366;
const CRM_BRANCH = 'crm';
const parseDoc = (s: string | null): QuoteDoc | null => { try { const d = JSON.parse(s || 'null'); return d && Array.isArray(d.rows) ? d : null; } catch { return null; } };

function requireManager(c: Ctx) {
  if (member(c).role !== 'manager') throw new AppError(403, 'Chỉ Manager xem phân tích lợi nhuận (có giá vốn).');
}

/** Lợi nhuận từng đơn trong khoảng ngày đơn [from, to]. `orderIds` để lấy riêng một đơn. */
async function profitOrders(db: AnyDb, from: string, to: string, orderIds?: string[], onlyConfirmed = false, fallbackOf?: LineCostFallbackOf) {
  const orders = await db.select({
    id: salesOrders.id, orderNo: salesOrders.orderNo, orderDate: salesOrders.orderDate, status: salesOrders.status, channel: salesOrders.channel,
    shiftId: salesOrders.shiftId, ownerId: salesOrders.ownerId, customerId: salesOrders.customerId, customerName: salesOrders.customerName,
    quoteType: salesOrders.quoteType, quoteData: quotations.data, posSnapshot: salesOrders.posSnapshot,
  }).from(salesOrders).leftJoin(quotations, eq(quotations.id, salesOrders.quoteId))
    .where(and(ne(salesOrders.status, 'cancelled'), orderIds ? inArray(salesOrders.id, orderIds) : and(gte(salesOrders.orderDate, from), lte(salesOrders.orderDate, to))));
  const ids = orders.map(o => o.id);
  if (!ids.length) return [];
  const shiftIds = [...new Set(orders.map(o => o.shiftId).filter((x): x is string => !!x))];
  const [lines, contracts, ships, returned, shifts, snaps, feeRefunds] = await Promise.all([
    db.select().from(salesOrderLines).where(inArray(salesOrderLines.orderId, ids)).orderBy(asc(salesOrderLines.lineNo)),
    db.select({ orderId: salesContracts.orderId, status: salesContracts.status }).from(salesContracts).where(and(inArray(salesContracts.orderId, ids), ne(salesContracts.status, 'cancelled'))),
    db.select({ orderId: deliveries.orderId, fee: deliveries.shippingFee }).from(deliveries).where(and(inArray(deliveries.orderId, ids), ne(deliveries.status, 'cancelled'))),
    // Hàng trả đã ghi nhận công nợ (creditEffectiveAt) mới trừ doanh thu / giá vốn.
    db.select({ orderLineId: posReturnLines.orderLineId, qty: posReturnLines.requestedQty, subtotal: posReturnLines.subtotal })
      .from(posReturnLines).innerJoin(posReturns, eq(posReturns.id, posReturnLines.returnId))
      .where(and(inArray(posReturns.orderId, ids), isNotNull(posReturns.creditEffectiveAt))),
    shiftIds.length ? db.select({ id: posShifts.id, registerId: posShifts.registerId }).from(posShifts).where(inArray(posShifts.id, shiftIds)) : [],
    db.select({ lineId: salesLineCosts.orderLineId, sku: salesLineCosts.sku, unitCost: salesLineCosts.unitCost, source: salesLineCosts.source, confidence: salesLineCosts.confidence })
      .from(salesLineCosts).where(inArray(salesLineCosts.orderId, ids)),
    // Phí dịch vụ / ship đã hoàn khi trả hàng (gồm VAT) – chỉ phiếu có hiệu lực công nợ.
    db.select({ orderId: posReturns.orderId, service: posReturns.approvedServiceFee, shipping: posReturns.approvedShippingFee }).from(posReturns)
      .where(and(inArray(posReturns.orderId, ids), isNotNull(posReturns.creditEffectiveAt))),
  ]);
  const snapOf = new Map(snaps.map(x => [x.lineId, x]));
  const skus = [...new Set(lines.map(l => l.sku).filter(Boolean))];
  const buys = skus.length ? await db.select({ sku: productMovements.sku, at: productMovements.occurredAt, price: productMovements.unitPrice }).from(productMovements)
    .where(and(inArray(productMovements.sku, skus), eq(productMovements.kind, 'purchase'), isNotNull(productMovements.unitPrice))) : [];
  const history = new Map<string, { at: string; price: number }[]>();
  // Dòng chưa có snapshot: tính lại theo cùng nguyên tắc lúc bán (báo giá → giá nhập → đơn NCC đã duyệt → công thức thương hiệu).
  const missingSkus = [...new Set(lines.filter(l => l.sku && !snapOf.has(l.id)).map(l => l.sku))];
  const fallback = fallbackOf && missingSkus.length ? await fallbackOf(db, missingSkus) : new Map<string, SkuFallbackCosts>();
  for (const b of buys) (history.get(b.sku) ?? history.set(b.sku, []).get(b.sku)!).push({ at: b.at, price: Number(b.price) });
  const registerOf = new Map(shifts.map(s => [s.id, s.registerId]));
  const out: OrderProfit[] = [];
  for (const o of orders) {
    if (!debtCounts(o.status, contracts.find(k => k.orderId === o.id)?.status)) continue;
    const doc = parseDoc(o.quoteData), rows = (doc?.rows ?? []).filter(r => String(r.name || '').trim() && Number(r.qty) > 0);
    const mine = lines.filter(l => l.orderId === o.id);
    const printRows = rows.filter(r => doc && printingInfo({ type: doc.type, rows: [r] }).enabled);
    const docPrint = doc && !printRows.some(r => Number.isFinite(r.printing?.unitPrice)) ? Math.max(0, Number(doc.printing?.totalCost) || 0) : 0;
    const printQty = printRows.reduce((n, r) => n + Number(r.qty || 0), 0);
    const inputs: LineInput[] = mine.map(l => {
      // Dòng báo giá cùng vị trí, cùng mã + tên (như doanh số net KPI) – lệch thì không dùng số liệu báo giá cho dòng đó.
      const r: QuoteRow | undefined = rows[l.lineNo - 1];
      const match = !!r && quoteStockSku(r) === l.sku && String(r.name || '').trim() === l.name.trim();
      const ret = returned.filter(x => x.orderLineId === l.id);
      const snap = snapOf.get(l.id);
      const base: LineInput = { id: l.id, sku: l.sku, name: l.name, qty: l.qty, revenue: l.amount, unit: l.unit,
        snapshot: snap && snap.sku === l.sku ? { unitCost: snap.unitCost, source: snap.source, confidence: snap.confidence } : null,
        returnedQty: ret.reduce((n, x) => n + x.qty, 0), returnedRevenue: ret.reduce((n, x) => n + x.subtotal, 0) };
      if (!match || !doc) return base;
      const printing = printingInfo({ type: doc.type, rows: [r] }).enabled
        ? (Number.isFinite(r.printing?.unitPrice) ? Math.max(0, Number(r.printing!.unitPrice)) * l.qty : printQty > 0 ? docPrint * Number(r.qty || 0) / printQty * (l.qty / Math.max(1, Number(r.qty || 0))) : 0) : 0;
      const commission = commissionOf({ ...r, price: Math.max(0, l.unitPrice - (o.quoteType === 'HRC' ? 0 : Number(r.printFee || 0))), discount: 0, qty: l.qty });
      const cost = quoteLineCost(r, null)?.unitCost;
      return { ...base, quoteCost: cost, printingCost: Math.round(printing), commission };
    });
    const shippingCost = doc?.shipping?.payer === 'sender' ? ships.filter(s => s.orderId === o.id).reduce((n, s) => n + Math.max(0, s.fee || 0), 0) : 0;
    const branchId = o.channel === 'pos' && o.shiftId ? registerOf.get(o.shiftId) ?? 'pos' : CRM_BRANCH;
    const profit = orderProfit({ id: o.id, orderNo: o.orderNo, orderDate: o.orderDate, ownerId: o.ownerId, customerId: o.customerId, customerName: o.customerName, branchId, shippingCost },
      inputs, (sku, line) => { const c = pickLineCost(null, null, history.get(sku), o.orderDate, sku, fallback.get(sku), line.unit); return c ? { cost: c.unitCost, source: c.source } : null; }, onlyConfirmed);
    if (o.channel === 'pos') {
      const refunded = feeRefunds.filter(r => r.orderId === o.id).reduce((n, r) => n + (r.service || 0) + (r.shipping || 0), 0);
      const f = posFeeFacts(o.posSnapshot, refunded);
      let ghnShipped = false; try { ghnShipped = !!JSON.parse(o.posSnapshot || '{}')?.ghn?.orderCode; } catch { /* bill lỗi dữ liệu */ }
      applyOrderFees(profit, { feeRevenue: f.feeRevenue, carrierFee: f.carrierFee, carrierUnknown: ghnShipped && !f.carrierKnown });
    }
    out.push(profit);
  }
  return out;
}

async function names(db: AnyDb, orders: readonly OrderProfit[]) {
  const ownerIds = [...new Set(orders.map(o => o.ownerId))];
  const [people, regs] = await Promise.all([
    ownerIds.length ? db.select({ id: employees.id, name: employees.name }).from(employees).where(inArray(employees.id, ownerIds)) : [],
    // Mọi quầy (bảng nhỏ): chi phí chi nhánh có thể thuộc quầy không có đơn trong kỳ (chỉ có ca / lương) – vẫn cần tên.
    db.select({ id: posRegisters.id, name: posRegisters.name }).from(posRegisters),
  ]);
  const owner = new Map(people.map(p => [p.id, p.name])), reg = new Map(regs.map(r => [r.id, r.name]));
  return { owner: (id: string) => owner.get(id) ?? id, branch: (id: string) => id === CRM_BRANCH ? 'Văn phòng / CRM' : id === 'pos' ? 'Quầy POS (không rõ quầy)' : reg.get(id) ?? `Quầy không còn trong danh sách (${id.slice(0, 8)})` };
}

/** Chức vụ được tính "chi phí bán hàng" (lương + thưởng Sale) vào đơn mình phụ trách. */
const SELLING_POSITIONS = ['sale', 'sale-admin'];
type StaffUnallocated = { month: string; memberId: string; name: string; salary: number; bonus: number; status: string; reason: string };
/**
 * Chi phí nhân sự bán hàng (PR-C): mỗi tháng TRỌN trong kỳ lọc, lương + phụ cấp và thưởng của Sale / Sale Admin (bảng lương)
 * phân bổ vào đơn của chính người đó trong tháng theo doanh thu ĐỦ GIÁ VỐN (giữ nguyên tổng, làm tròn dồn phần lẻ).
 * Không có đơn đủ giá vốn → "chưa phân bổ". Phân bổ trên MỌI đơn rồi mới lọc, để tổng không đổi theo bộ lọc.
 */
async function applyStaffCosts(db: AnyDb, orders: OrderProfit[], from: string, to: string, staffCostOf?: StaffCostOf | ((db: AnyDb, m: string) => Promise<StaffCost[]>)) {
  const months = fullMonths(from, to), unallocated: StaffUnallocated[] = [];
  const payroll = { salary: 0, bonus: 0, estimateMembers: 0, confirmedMembers: 0 };
  if (!staffCostOf) return { available: false, months, payroll, unallocated };
  for (const month of months) {
    const costs = (await staffCostOf(db, month)).filter(c => SELLING_POSITIONS.includes(c.positionId ?? ''));
    for (const c of costs) {
      payroll.salary += c.salary; payroll.bonus += c.bonus;
      if (c.status === 'estimate') payroll.estimateMembers++; else payroll.confirmedMembers++;
      const mine = orders.filter(o => o.ownerId === c.memberId && o.orderDate.slice(0, 7) === month && o.coveredRevenue > 0);
      const weights = mine.map(o => o.coveredRevenue), sal = allocate(c.salary, weights), bon = allocate(c.bonus, weights);
      if (!sal || !bon) { unallocated.push({ month, memberId: c.memberId, name: c.name, salary: c.salary, bonus: c.bonus, status: c.status, reason: 'Không có đơn đủ giá vốn trong tháng' }); continue; }
      mine.forEach((o, i) => addStaffCost(o, sal[i]!, bon[i]!));
    }
  }
  return { available: true, months, payroll, unallocated };
}

/**
 * Chi phí chi nhánh (PR-D) – tính cho chi nhánh, KHÔNG chia xuống đơn:
 *  - Chi vặt két (phiếu đã ghi sổ, chưa huỷ, theo ngày VN trong kỳ) phân loại bằng `classifyCashEntry`; chỉ loại "chi phí hoạt động" được trừ.
 *  - Lương NVBH / CHT (người không thuộc Sale / Sale Admin) của tháng TRỌN: chia cho quầy theo số ca đã mở trong tháng (giữ nguyên tổng).
 *  - Người không có ca và không phải Sale (văn phòng, kho, quản lý…) → "chi phí chung chưa phân bổ" (chỉ hiện khi không lọc).
 * Đối soát: Σ LN sau chi phí chi nhánh − lương Sale chưa phân bổ − chi phí chung = LN công ty; bảng lương = Sale (phân bổ + chưa) + quầy + chung.
 */
async function branchCosts(db: AnyDb, orders: OrderProfit[], from: string, to: string, getCosts: ((m: string) => Promise<StaffCost[]>) | null, branchName: (id: string) => string) {
  const start = new Date(from + 'T00:00:00+07:00').toISOString(), end = new Date(Date.parse(to + 'T00:00:00+07:00') + 86400_000).toISOString();
  const entries = await db.select({ id: cashEntries.id, entryNo: cashEntries.entryNo, kind: cashEntries.kind, direction: cashEntries.direction, amount: cashEntries.amount,
    reason: cashEntries.reason, createdAt: cashEntries.createdAt, registerId: posShifts.registerId })
    .from(cashEntries).innerJoin(posShifts, eq(posShifts.id, cashEntries.shiftId))
    .where(and(eq(cashEntries.status, 'posted'), isNull(cashEntries.voidedAt), gte(cashEntries.createdAt, start), lt(cashEntries.createdAt, end)));
  // Loại Manager đã xác nhận / sửa thắng phân loại tự động (theo loại phiếu + từ khoá).
  const manual = new Map(entries.length ? (await db.select({ id: cashEntryClasses.entryId, cls: cashEntryClasses.cls }).from(cashEntryClasses)
    .where(inArray(cashEntryClasses.entryId, entries.map(e => e.id)))).map(r => [r.id, r.cls as CashClass]) : []);
  const byBranch = new Map<string, { petty: number; staff: number }>(), get = (id: string) => byBranch.get(id) ?? byBranch.set(id, { petty: 0, staff: 0 }).get(id)!;
  const classes = new Map<CashClass, { amount: number; count: number }>(), review: { id: string; entryNo: string; branch: string; amount: number; cls: CashClass; auto: CashClass; manual: boolean; reason: string; day: string }[] = [];
  for (const e of entries) {
    const auto = classifyCashEntry(e), cls = manual.get(e.id) ?? auto, x = classes.get(cls) ?? classes.set(cls, { amount: 0, count: 0 }).get(cls)!;
    const signed = cls === 'adjustment' && e.direction === 'in' ? -e.amount : e.amount;
    x.amount += signed; x.count++;
    if (cls === 'operating') get(e.registerId).petty += e.amount;
    // Cần Manager xem: chi vặt tự phân loại là "không tính" (từ khoá), điều chỉnh két, và mọi phiếu đã được sửa tay.
    if (manual.has(e.id) || (e.kind === 'petty_expense' && auto !== 'operating') || auto === 'adjustment')
      review.push({ id: e.id, entryNo: e.entryNo, branch: branchName(e.registerId), amount: e.amount, cls, auto, manual: manual.has(e.id), reason: e.reason.replace(/^Tên phiếu: /, '').slice(0, 160), day: vnDay(e.createdAt) });
  }
  const months = fullMonths(from, to), overhead: { month: string; name: string; amount: number; status: string }[] = [];
  let storeStaff = 0, payrollTotal = 0;
  if (getCosts) for (const month of months) {
    const [y, m] = month.split('-').map(Number) as [number, number], last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const [costs, shifts] = await Promise.all([getCosts(month),
      db.select({ memberId: posShifts.memberId, registerId: posShifts.registerId }).from(posShifts).where(and(gte(posShifts.businessDate, month + '-01'), lte(posShifts.businessDate, last)))]);
    for (const c of costs) {
      payrollTotal += c.gross;
      if (SELLING_POSITIONS.includes(c.positionId ?? '')) continue;
      const mine = shifts.filter(x => x.memberId === c.memberId), regs = [...new Set(mine.map(x => x.registerId))];
      const parts = allocate(c.gross, regs.map(r => mine.filter(x => x.registerId === r).length));
      if (!parts) { overhead.push({ month, name: c.name, amount: c.gross, status: c.status }); continue; }
      regs.forEach((r, i) => { get(r).staff += parts[i]!; storeStaff += parts[i]!; });
    }
  }
  for (const o of orders) if (o.branchId !== CRM_BRANCH) get(o.branchId);
  get(CRM_BRANCH);
  const rows = [...byBranch].map(([id, v]) => { const ordersNet = orders.filter(o => o.branchId === id).reduce((n, o) => n + o.net, 0);
    return { id, name: branchName(id), ordersNet, petty: v.petty, staff: v.staff, net: ordersNet - v.petty - v.staff }; }).sort((a, b) => b.net - a.net);
  return { months, rows, storeStaff, payrollTotal, overhead, overheadTotal: overhead.reduce((n, x) => n + x.amount, 0), review,
    cash: CASH_CLASSES.filter(k => classes.has(k)).map(k => ({ cls: k, ...CASH_CLASS_LABEL[k], ...classes.get(k)! })),
    officeExpenses: { available: false, note: 'CRM chưa ghi nhận chi phí văn phòng (thuê, điện, nước văn phòng…) – chưa tính.' } };
}

export function registerProfitRoutes(router: Router<StaffEnv>, deps: { staffCostOf?: StaffCostOf; lineCostFallbackOf?: LineCostFallbackOf } = {}) {
  router.get('/profit', async c => {
    requireManager(c);
    const q = c.url.searchParams, from = q.get('from'), to = q.get('to'), grain = (q.get('grain') || 'month') as Grain;
    if (!isDay(from) || !isDay(to) || from > to) throw new AppError(400, 'Khoảng ngày không hợp lệ.');
    if ((Date.parse(to) - Date.parse(from)) / 86400_000 > MAX_DAYS) throw new AppError(400, 'Khoảng ngày tối đa 3 năm.');
    if (!GRAINS.includes(grain)) throw new AppError(400, 'Kỳ không hợp lệ (ngày / tuần / tháng / năm).');
    const costs = q.get('costs') === 'confirmed' ? 'confirmed' : 'all';
    // Tính một lần cho mọi Manager (số liệu không phụ thuộc người xem), giữ 30 phút; "Cập nhật" (refresh=1) tính lại ngay.
    return json(await cachedReport(c.env.db, { scope: PROFIT_CACHE, viewer: 'manager', params: q, refresh: q.get('refresh') === '1' }, async () => {
    const all = await profitOrders(c.env.db, from, to, undefined, costs === 'confirmed', deps.lineCostFallbackOf), n = await names(c.env.db, all);
    const branch = q.get('branch') || '', owner = q.get('owner') || '', customer = q.get('customer') || '';
    // Bảng lương mỗi tháng chỉ tính một lần cho cả chi phí Sale (PR-C) và chi nhánh (PR-D).
    const cache = new Map<string, Promise<StaffCost[]>>(), getCosts = deps.staffCostOf ? (m: string) => cache.get(m) ?? cache.set(m, deps.staffCostOf!(c.env.db, m)).get(m)! : null;
    const staff = await applyStaffCosts(c.env.db, all, from, to, getCosts ? (_db, m) => getCosts(m) : undefined);
    const bc = await branchCosts(c.env.db, all, from, to, getCosts, n.branch);
    const saleUnallocated = staff.unallocated.reduce((s, u) => s + u.salary + u.bonus, 0);
    const branchRows = bc.rows.filter(r => !branch || r.id === branch);
    const companyNet = bc.rows.reduce((s, r) => s + r.net, 0) - saleUnallocated - bc.overheadTotal;
    const filtered = !!(branch || owner || customer);
    const orders = all.filter(o => (!branch || o.branchId === branch) && (!owner || o.ownerId === owner) && (!customer || o.customerId === customer));
    const [summary] = groupBy(orders, () => 'all', () => 'Tổng');
    // So với kỳ trước (cùng độ dài; chọn trọn tháng thì so với các tháng liền trước): DT, LN gộp, biên. Không tính lại bảng lương.
    const compare = q.get('compare') === '0' ? null : await (async () => {
      const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400_000) + 1, wholeMonths = from.slice(8) === '01' && isMonthEnd(to);
      let pFrom: string, pTo: string;
      if (wholeMonths) {
        const n = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) + 1;
        const start = new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1 - n, 1));
        pFrom = start.toISOString().slice(0, 10); pTo = new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, 0)).toISOString().slice(0, 10);
      } else {
        pTo = new Date(Date.parse(from) - 86400_000).toISOString().slice(0, 10); pFrom = new Date(Date.parse(pTo) - (days - 1) * 86400_000).toISOString().slice(0, 10);
      }
      const prev = (await profitOrders(c.env.db, pFrom, pTo, undefined, costs === 'confirmed', deps.lineCostFallbackOf))
        .filter(o => (!branch || o.branchId === branch) && (!owner || o.ownerId === owner) && (!customer || o.customerId === customer));
      const [p] = groupBy(prev, () => 'all', () => 'Kỳ trước');
      return { from: pFrom, to: pTo, revenue: p?.revenue ?? 0, gross: p?.gross ?? 0, coveredRevenue: p?.coveredRevenue ?? 0, margin: p?.margin ?? null, orders: p?.orders ?? 0 };
    })();
    const customerKey = (o: OrderProfit) => o.customerId ?? `name:${o.customerName}`;
    const customerName = new Map(orders.map(o => [customerKey(o), o.customerName]));
    return {
      from, to, grain, costs, compare, costSources: COST_SOURCE_LABEL, confidenceLabels: LINE_COST_CONFIDENCE_LABEL,
      summary: summary ?? emptyRow('all', 'Tổng'),
      direct: { printing: orders.reduce((s, o) => s + o.printing, 0), commission: orders.reduce((s, o) => s + o.commission, 0), shipping: orders.reduce((s, o) => s + o.shipping, 0) },
      cardFees: { available: false, note: 'CRM chưa ghi nhận thanh toán thẻ / phí cổng thanh toán – chưa tính.' },
      branchCosts: { months: bc.months, rows: branchRows, cash: bc.cash, classOptions: CASH_CLASSES.map(k => ({ cls: k, ...CASH_CLASS_LABEL[k] })), review: bc.review.filter(r => !branch || r.branch === n.branch(branch)), officeExpenses: bc.officeExpenses,
        // Toàn công ty: chỉ khi không lọc (chi phí chung / lương Sale chưa phân bổ không thuộc riêng chi nhánh / nhân viên nào).
        company: filtered ? null : {
          ordersNet: all.reduce((s, o) => s + o.net, 0), petty: bc.rows.reduce((s, r) => s + r.petty, 0), storeStaff: bc.storeStaff, saleUnallocated,
          overhead: bc.overheadTotal, overheadItems: bc.overhead, net: companyNet,
          reconcile: {
            // Tính độc lập theo đơn: mọi đơn phải nằm trong đúng một chi nhánh.
            branches: bc.rows.reduce((s, r) => s + r.net, 0),
            ok: all.reduce((s, o) => s + o.net, 0) - saleUnallocated - bc.rows.reduce((s, r) => s + r.petty + r.staff, 0) - bc.overheadTotal === companyNet,
            payroll: bc.payrollTotal, payrollParts: { sale: staff.payroll.salary + staff.payroll.bonus, store: bc.storeStaff, overhead: bc.overheadTotal },
            payrollOk: staff.payroll.salary + staff.payroll.bonus + bc.storeStaff + bc.overheadTotal === bc.payrollTotal,
          } } },
      staff: (() => {
        const unalloc = staff.unallocated.filter(u => !owner || u.memberId === owner), allocated = all.reduce((n, o) => n + o.staffSalary + o.staffBonus, 0);
        const unTotal = staff.unallocated.reduce((n, u) => n + u.salary + u.bonus, 0);
        return { available: staff.available, months: staff.months, /** Kỳ lọc có phần tháng lẻ: chi phí nhân sự tháng đó chưa tính. */ partial: from.slice(8) !== '01' || !isMonthEnd(to),
          payroll: staff.payroll, unallocated: unalloc, unallocatedTotal: unalloc.reduce((n, u) => n + u.salary + u.bonus, 0),
          // Đối soát toàn công ty (không theo bộ lọc): phân bổ + chưa phân bổ = bảng lương.
          reconcile: { payroll: staff.payroll.salary + staff.payroll.bonus, allocated, unallocated: unTotal, ok: allocated + unTotal === staff.payroll.salary + staff.payroll.bonus } };
      })(),
      series: groupBy(orders, o => bucketOf(o.orderDate, grain), k => bucketLabel(k, grain), 'key'),
      branches: groupBy(orders, o => o.branchId, n.branch),
      owners: groupBy(orders, o => o.ownerId, n.owner),
      customers: groupBy(orders, customerKey, k => customerName.get(k) ?? k).slice(0, 300),
      products: groupByProduct(orders).slice(0, 300),
      orders: [...orders].sort((a, b) => b.orderDate.localeCompare(a.orderDate) || b.revenue - a.revenue).slice(0, 500)
        .map(o => ({ id: o.id, orderNo: o.orderNo, orderDate: o.orderDate, customerName: o.customerName, ownerName: n.owner(o.ownerId), branch: n.branch(o.branchId),
          revenue: o.revenue, cost: o.cost, direct: o.printing + o.commission + o.shipping, gross: o.gross, margin: o.coveredRevenue > 0 ? o.gross / o.coveredRevenue : null, missingLines: o.missingLines, unconfirmedLines: o.unconfirmedLines,
          feeRevenue: o.feeRevenue, carrierFee: o.carrierFee, staffCost: o.staffSalary + o.staffBonus, net: o.net, carrierUnknown: o.carrierUnknown })),
      ordersTotal: orders.length,
      filterOptions: { branches: groupBy(all, o => o.branchId, n.branch).map(r => ({ id: r.key, name: r.label })), owners: groupBy(all, o => o.ownerId, n.owner).map(r => ({ id: r.key, name: r.label })) },
    };
    }));
  }, 'business');

  router.get('/profit/orders/:id', async c => {
    requireManager(c);
    const [o] = await profitOrders(c.env.db, '', '', [String(c.params.id)], false, deps.lineCostFallbackOf);
    if (!o) throw new AppError(404, 'Không tìm thấy đơn (hoặc đơn không tính doanh số).');
    const n = await names(c.env.db, [o]);
    const [snaps, history] = await Promise.all([
      c.env.db.select({ lineId: salesLineCosts.orderLineId, revision: salesLineCosts.revision, costAt: salesLineCosts.costAt, capturedAt: salesLineCosts.capturedAt, note: salesLineCosts.note })
        .from(salesLineCosts).where(eq(salesLineCosts.orderId, o.id)),
      c.env.db.select().from(salesLineCostHistory).where(eq(salesLineCostHistory.orderId, o.id)).orderBy(asc(salesLineCostHistory.at)),
    ]);
    const actors = await names(c.env.db, history.filter(h => h.actorId).map(h => ({ ownerId: h.actorId!, branchId: CRM_BRANCH } as OrderProfit)));
    return json({ ...o, ownerName: n.owner(o.ownerId), branch: n.branch(o.branchId), margin: o.coveredRevenue > 0 ? o.gross / o.coveredRevenue : null,
      lines: o.lines.map(l => { const s = snaps.find(x => x.lineId === l.id);
        return { ...l, costSourceLabel: COST_SOURCE_LABEL[l.costSource], confidenceLabel: l.confidence ? LINE_COST_CONFIDENCE_LABEL[l.confidence] : 'Thiếu',
          snapshot: s ? { revision: s.revision, costAt: s.costAt, capturedAt: s.capturedAt, note: s.note } : null,
          history: history.filter(h => h.orderLineId === l.id).map(h => ({ at: h.at, reason: h.reason, unitCost: h.unitCost, previousUnitCost: h.previousUnitCost, source: h.source,
            confidence: h.confidence, note: h.note, actor: h.actorId ? actors.owner(h.actorId) : 'Hệ thống' })) }; }) });
  }, 'business');

  // Manager điều chỉnh giá vốn một dòng (bắt buộc lý do; kiểm tra phiên bản); ghi lịch sử, mức tin cậy "chính xác".
  router.put('/profit/line-costs/:lineId', async c => {
    requireManager(c);
    const b = await readJson(c.req, 4_000);
    const r = await adjustLineCost(c.env.db, String(c.params.lineId), { unitCost: Number(String(b.unitCost ?? '').replace(/[^\d.]/g, '')), reason: String(b.reason ?? ''),
      revision: b.revision === null || b.revision === undefined ? null : Number(b.revision) }, member(c).id);
    await dropReportCache(c.env.db, PROFIT_CACHE);
    return json({ ok: true, ...r });
  }, 'business');

  /**
   * Dòng VẪN thiếu giá vốn sau khi áp đủ nguyên tắc (báo giá → giá nhập → đơn NCC đã duyệt → công thức thương hiệu), gom theo mã + đơn vị,
   * để Manager nhập giá một lần cho mỗi mã. Chỉ đọc.
   */
  async function missingCosts(db: AnyDb, from: string, to: string, scope: 'missing' | 'unconfirmed' = 'missing') {
    const all = await profitOrders(db, from, to, undefined, scope === 'unconfirmed', deps.lineCostFallbackOf);
    const units = new Map((all.length ? await db.select({ id: salesOrderLines.id, unit: salesOrderLines.unit }).from(salesOrderLines)
      .where(inArray(salesOrderLines.orderId, all.map(o => o.id))) : []).map(l => [l.id, l.unit]));
    type Line = { lineId: string; orderId: string; orderNo: string; orderDate: string; qty: number; revenue: number; unitCost: number | null; source: string | null };
    const groups = new Map<string, { sku: string; name: string; unit: string; qty: number; revenue: number; suggested: number | null; sources: string[]; lines: Line[] }>();
    for (const o of all) for (const l of o.lines) {
      // missing: không có nguồn giá nào · unconfirmed: có giá ước tính / tham chiếu chưa được Manager xác nhận.
      if (!l.sku || (scope === 'missing' ? l.costSource !== 'missing' || l.pending : !l.pending)) continue;
      const unit = units.get(l.id) ?? '', key = l.sku + '\u0000' + unit;
      const g = groups.get(key) ?? groups.set(key, { sku: l.sku, name: l.name, unit, qty: 0, revenue: 0, suggested: null, sources: [], lines: [] }).get(key)!;
      g.qty += l.qty; g.revenue += l.revenue;
      g.lines.push({ lineId: l.id, orderId: o.id, orderNo: o.orderNo, orderDate: o.orderDate, qty: l.qty, revenue: l.revenue, unitCost: l.pending?.unitCost ?? null, source: l.pending?.source ?? null });
      if (l.pending && !g.sources.includes(COST_SOURCE_LABEL[l.pending.source])) g.sources.push(COST_SOURCE_LABEL[l.pending.source]);
    }
    for (const g of groups.values()) {
      // Giá gợi ý = giá xuất hiện nhiều nhất trên các dòng của mã (ước tính / tham chiếu) – Manager sửa được trước khi xác nhận.
      const freq = new Map<number, number>(); for (const l of g.lines) if (l.unitCost !== null) freq.set(l.unitCost, (freq.get(l.unitCost) ?? 0) + 1);
      g.suggested = [...freq].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? null;
    }
    return [...groups.values()].sort((a, b) => b.revenue - a.revenue || a.sku.localeCompare(b.sku));
  }
  const range = (q: URLSearchParams | Record<string, unknown>) => {
    const get = (k: string) => String((q instanceof URLSearchParams ? q.get(k) : q[k]) ?? '');
    const from = get('from'), to = get('to');
    if (!isDay(from) || !isDay(to) || from > to) throw new AppError(400, 'Khoảng ngày không hợp lệ.');
    return { from, to };
  };
  /** Manager xác nhận / sửa loại một phiếu két (tính hay không tính vào chi phí chi nhánh). `cls` rỗng = bỏ, quay về tự phân loại. */
  router.put('/profit/cash-classes/:entryId', async c => {
    requireManager(c);
    const b = await readJson(c.req, 4_000), id = String(c.params.entryId), cls = String(b.cls ?? '');
    const [e] = await c.env.db.select({ id: cashEntries.id }).from(cashEntries).where(eq(cashEntries.id, id)).limit(1);
    if (!e) throw new AppError(404, 'Không tìm thấy phiếu két.');
    if (!cls) { await c.env.db.delete(cashEntryClasses).where(eq(cashEntryClasses.entryId, id)); await dropReportCache(c.env.db, PROFIT_CACHE); return json({ ok: true, cls: null }); }
    if (!(CASH_CLASSES as readonly string[]).includes(cls)) throw new AppError(400, 'Loại phiếu không hợp lệ.');
    const values = { cls: cls as CashClass, note: String(b.note ?? '').trim().slice(0, 300), updatedBy: member(c).id, updatedAt: new Date().toISOString() };
    await c.env.db.insert(cashEntryClasses).values({ entryId: id, ...values }).onConflictDoUpdate({ target: cashEntryClasses.entryId, set: values });
    await dropReportCache(c.env.db, PROFIT_CACHE);
    return json({ ok: true, cls });
  }, 'business');
  router.get('/profit/missing-costs', async c => {
    requireManager(c);
    const { from, to } = range(c.url.searchParams), scope = c.url.searchParams.get('scope') === 'unconfirmed' ? 'unconfirmed' : 'missing';
    const items = await missingCosts(c.env.db, from, to, scope);
    return json({ from, to, scope, items, lines: items.reduce((n, i) => n + i.lines.length, 0) });
  }, 'business');
  /** Manager nhập giá vốn theo mã cho các dòng còn thiếu trong kỳ (mỗi dòng ghi snapshot "Manager điều chỉnh" + lịch sử, có lý do). */
  router.post('/profit/missing-costs', async c => {
    requireManager(c);
    const b = await readJson(c.req, 64_000), { from, to } = range(b), scope = b.scope === 'unconfirmed' ? 'unconfirmed' : 'missing';
    const reason = String(b.reason ?? '').trim();
    if (reason.length < 3) throw new AppError(400, 'Nhập lý do / căn cứ giá vốn.');
    const wanted = Array.isArray(b.items) ? b.items.slice(0, 500) : [];
    const prices = new Map<string, number>();
    for (const x of wanted) {
      const sku = String(x?.sku ?? ''), unit = String(x?.unit ?? ''), cost = Number(x?.unitCost);
      if (!sku || !Number.isFinite(cost) || cost < 0 || cost > 1e12) throw new AppError(400, `Giá vốn mã ${sku || '(trống)'} không hợp lệ.`);
      prices.set(sku + '\u0000' + unit, cost);
    }
    if (!prices.size) throw new AppError(400, 'Chưa nhập giá vốn cho mã nào.');
    // Tính lại danh sách thiếu ngay lúc ghi: dòng đã có giá (người khác vừa nhập / nguồn mới) không bị ghi đè.
    let written = 0;
    const groups = (await missingCosts(c.env.db, from, to, scope)).filter(g => prices.has(g.sku + '\u0000' + g.unit));
    const lineIds = groups.flatMap(g => g.lines.map(l => l.lineId));
    // Dòng đã có snapshot (giá ước tính): ghi đè đúng phiên bản đang xem (adjustLineCost kiểm phiên bản – người khác vừa sửa thì 409).
    const revisions = new Map(lineIds.length ? (await c.env.db.select({ id: salesLineCosts.orderLineId, revision: salesLineCosts.revision }).from(salesLineCosts)
      .where(inArray(salesLineCosts.orderLineId, lineIds))).map(r => [r.id, r.revision]) : []);
    const verb = scope === 'unconfirmed' ? 'Xác nhận giá vốn' : 'Nhập giá vốn';
    for (const g of groups) {
      const cost = prices.get(g.sku + '\u0000' + g.unit)!;
      for (const l of g.lines) {
        const note = `${verb} theo mã ${g.sku}${l.source ? ` (gợi ý: ${COST_SOURCE_LABEL[l.source as keyof typeof COST_SOURCE_LABEL] ?? l.source} ${l.unitCost})` : ''}: ${reason}`;
        await adjustLineCost(c.env.db, l.lineId, { unitCost: cost, reason: note.slice(0, 500), revision: revisions.get(l.lineId) ?? null }, member(c).id); written++;
      }
    }
    await dropReportCache(c.env.db, PROFIT_CACHE);
    return json({ ok: true, written });
  }, 'business');
}
