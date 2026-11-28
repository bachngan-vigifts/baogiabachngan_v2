import {posDeliveryMethod} from '../domain/pos-delivery-method.ts';
import { ensureLineCosts } from './line-costs.ts';
import {cartPromotion} from './pos-promotions.ts';
import { orderNoForCheckout, posOrderPrefixFor } from './pos-number.ts';
import { posCustomerIssue } from '../domain/pos-customer.ts';
import { posOrderReservations, posPaymentIntents } from '../pos-order-flow-schema.ts';
import { flowInitialAmount, flowHoldUntil, saleFlowOf } from '../domain/pos-order-flow.ts';
import { exchangeForCart, returnBalances } from './pos-return-credit.ts';
import { posExchangeAllocations, posReturns, posRefunds } from '../return-schema.ts';
import { posOrderNote } from '../domain/pos-order-note.ts';
import { posFeeInput, calculatePosFees } from '../domain/pos-fees.ts';
import { cashLock, cashShiftTotals, cashAudit, openingCashComparison } from './cash-store.ts';
import { cashEntries } from '../cash-schema.ts';
import { and, asc, count, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import type { StaffEnv, SessionState } from '../../staff/api/auth-routes.ts';
import { can } from '../../staff/domain/permissions.ts';
import { employees, positions } from '../../staff/schema.ts';
import { posSharedShiftStoreScope } from './pos-access.ts';
import { products, productPrices, productBarcodes, warehouses, pricePolicies } from '../../catalog/schema.ts';
import { stockBalances } from '../../inventory/schema.ts';
import { postMoves, lockLedger, assertWarehousesOpened } from '../../inventory/api/ledger.ts';
import { customers, customerStaff } from '../../customers/schema.ts';
import { posRegisters, posShifts, posShiftTemplates, posStockCounts, posPaymentRequests } from '../pos-schema.ts';
import {
  salesOrders,
  salesOrderLines,
  customerPayments,
  paymentSchedules,
  deliveries,
  stockHolds,
} from '../schema.ts';
import { vietnamDate } from '../domain/sales.ts';
import { allocatePosVoucher, parsePosVoucher, posLine, posMoney } from '../domain/pos-money.ts';
import { parseGhnShip } from '../domain/pos-ghn.ts';
import { sha256Hex } from '../../staff/domain/session.ts';
import { createScheduledDelivery } from './delivery-store.ts';
import { orderHolds } from './hold-routes.ts';
import { readCatalogStock } from '../../catalog/api/stock-source.ts';
export type PosDb = StaffEnv['db'] | Parameters<Parameters<StaffEnv['db']['transaction']>[0]>[0];
export type PosMember = SessionState['member'];
export const posNow = () => new Date().toISOString();
export const posText = (v: unknown, max = 500) => {
  if (v != null && typeof v !== 'string') throw new AppError(400, 'Dữ liệu chữ không hợp lệ.');
  return String(v ?? '')
    .trim()
    .slice(0, max);
};
export const posKey = (v: unknown) => {
  const s = posText(v, 100);
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(s)) throw new AppError(400, 'Thiếu mã chống ghi lặp.');
  return s;
};
export function posPermission(m: PosMember) {
  if (!can(m, 'pos.sell')) throw new AppError(403, 'Chưa được cấp quyền bán hàng nhanh.');
}
export async function registerOf(db: PosDb, id: string) {
  const [r] = await db
    .select()
    .from(posRegisters)
    .where(and(eq(posRegisters.id, id), eq(posRegisters.active, true)));
  if (!r) throw new AppError(404, 'Không tìm thấy quầy đang hoạt động.');
  return r;
}
export async function shiftOf(db: PosDb, m: PosMember, id: string, lock = false) {
  const q = db
    .select()
    .from(posShifts)
    .where(and(eq(posShifts.id, id), m.role === 'manager' ? undefined : eq(posShifts.memberId, m.id)));
  const [s] = lock ? await q.for('update') : await q;
  if (!s) throw new AppError(404, 'Không tìm thấy ca của bạn.');
  return s;
}
export async function sharedSaleShiftScope(db: PosDb, m: PosMember) {
  if (!can(m, 'pos.sell')) return;
  if (m.role === 'manager') return sql`true`;
  const [p] = m.positionId ? await db.select({ name: positions.name }).from(positions).where(eq(positions.id, m.positionId)) : [];
  return posSharedShiftStoreScope({ ...m, positionName: p?.name });
}
/** Authorizes sales/receipts only. Report access and cash closing keep their existing owner checks. */
export async function saleShiftOf(db: PosDb, m: PosMember, id: string, lock = false) {
  posPermission(m);
  const shared = await sharedSaleShiftScope(db, m);
  const q = db.select().from(posShifts).where(and(eq(posShifts.id, id), or(eq(posShifts.memberId, m.id), shared)));
  const [s] = lock ? await q.for('update') : await q;
  if (!s) throw new AppError(404, 'Không tìm thấy ca được phép bán hàng.');
  return s;
}
/** Call after saleShiftOf has checked the seller's store/ownership. */
export function assertOpen(s: typeof posShifts.$inferSelect, m: PosMember) {
  posPermission(m);
  if (s.closedAt) throw new AppError(409, 'Ca đã kết, hãy mở ca mới.');
}
export async function assertOpening(db: PosDb, warehouseId: string) {
  await assertWarehousesOpened(db, [warehouseId]);
}
export const emptyCart = (b: Record<string, unknown>) => {
  const note = posOrderNote(b.note), voucher = parsePosVoucher(b.voucher);
  return {
    registerId: posText(b.registerId),
    shiftId: posText(b.shiftId),
    pricePolicyId: posText(b.pricePolicyId),
    customerId: posText(b.customerId),
    vatEnabled: b.vatEnabled !== false,
    rows: b.rows,
    ...posFeeInput(b),
    ...(note ? { note } : {}),
    ...(b.exchangeAllocationId ? { exchangeAllocationId: posKey(b.exchangeAllocationId) } : {}),
    ...(voucher ? { voucher } : {}),
    ...(b.promotionOptOutReason?{promotionOptOutReason:b.promotionOptOutReason}:{}),
    ...(b.promotionRevision!==undefined?{promotionRevision:b.promotionRevision}:{}),
  };
};
export async function calculateCart(db: PosDb, b: Record<string, unknown>) {
  const input = emptyCart(b),
    r = await registerOf(db, input.registerId);
  const policy = input.pricePolicyId || r.pricePolicyId;
  if (![r.pricePolicyId, r.secondPricePolicyId].includes(policy))
    throw new AppError(400, 'Bảng giá không thuộc hai chính sách của quầy.');
  if (!Array.isArray(input.rows) || !input.rows.length || input.rows.length > 150)
    throw new AppError(400, 'Giỏ cần từ 1 đến 150 dòng.');
  const raw = input.rows as Record<string, unknown>[];
  if (raw.some((x) => !x || typeof x !== 'object')) throw new AppError(400, 'Dòng hàng không hợp lệ.');
  const skus = raw.map((x) => posText(x.sku, 100));
  if (new Set(skus).size !== skus.length) throw new AppError(400, 'Gộp số lượng của các dòng trùng mã.');
  const found = await db
    .select({ p: products, price: productPrices.price })
    .from(products)
    .innerJoin(productPrices, and(eq(productPrices.sku, products.sku), eq(productPrices.policyId, policy)))
    .where(and(inArray(products.sku, skus), eq(products.active, true), eq(products.approvalStatus, 'approved')));
  const withVat = policy === r.pricePolicyId;
  const lineOf = (voucherShares: readonly number[]) => raw.map((x, i) => {
    const f = found.find((f) => f.p.sku === skus[i]);
    if (!f || f.price == null) throw new AppError(400, 'Mã hàng chưa có giá hoặc chưa được duyệt: ' + skus[i]);
    return {
      sku: f.p.sku,
      name: f.p.name,
      unit: f.p.unit,
      ...(posOrderNote(x.note)?{note:posOrderNote(x.note)}:{}),
      ...posLine({
        price: f.price,
        qty: x.qty,
        discountType: x.discountType,
        discountValue: x.discountValue,
        taxRate: withVat ? r.taxRate : 0,
        priceIncludesVat: withVat,
        vatEnabled: withVat,
        voucherAmount: voucherShares[i] ?? 0,
      }),
    };
  });
  // Voucher của đơn: chia vào các dòng theo tiền hàng sau chiết khấu dòng, trừ thẳng vào giá đã gồm VAT, VAT tách lại (pos-money.ts › allocatePosVoucher).
  const base = lineOf([]), voucherSplit = allocatePosVoucher(base.map((l) => l.listAmount - l.discountAmount), input.voucher ?? null);
  const lines = voucherSplit.amount ? lineOf(voucherSplit.shares) : base;
  const offer=await cartPromotion(db,r.id,lines.reduce((n,l)=>n+l.total,0),b.promotionOptOutReason,withVat?r.taxRate:0);
  if(offer.gift)lines.push(offer.gift);
  const voucher = input.voucher ? { ...input.voucher, amount: voucherSplit.amount } : null;
  const [customer] = input.customerId
    ? await db
        .select()
        .from(customers)
        .where(and(eq(customers.id, input.customerId), eq(customers.approvalStatus, 'approved')))
    : [];
  if (input.customerId && !customer) throw new AppError(400, 'Khách hàng chưa dùng được.');
  const fees = calculatePosFees(b, withVat ? r.taxRate : 0);
  const subtotal = posMoney(lines.reduce((s, l) => s + l.subtotal, 0) + fees.subtotal),
    tax = posMoney(lines.reduce((s, l) => s + l.tax, 0) + fees.tax),
    discount = lines.reduce((s, l) => s + l.discountAmount, 0),
    total = posMoney(subtotal + tax);
  const exchange = await exchangeForCart(db, input.exchangeAllocationId || '', input.shiftId, r.id, total, input.customerId);
  const payable = total - exchange.amount;
  const canonical = {
    registerId: r.id,
    shiftId: input.shiftId,
    pricePolicyId: policy,
    customerId: input.customerId,
    vatEnabled: withVat,
    ...posFeeInput(b),
    ...(input.exchangeAllocationId ? { exchangeAllocationId: input.exchangeAllocationId } : {}),
    ...(input.voucher ? { voucher: input.voucher } : {}),
    rows: raw.map((l) => ({ sku: posText(l.sku,100), qty: Number(l.qty), discountType: l.discountType??'percent', discountValue: Number(l.discountValue||0) })),
    ...(offer.promotion?{promotionRevision:offer.promotion.revision,promotionOptOutReason:offer.promotion.optOutReason}:{}),
  };
  // Gifts change fulfillment, not the amount already collected by the bank. Keep paid QR detection stable when a free offer changes.
  const financialCanonical={...canonical};delete financialCanonical.promotionRevision;delete financialCanonical.promotionOptOutReason;
  return {
    register: r,
    customer,
    note: input.note ?? '',
    exchange, payable,
    fees,
    lines,
    promotion:offer.promotion,
    subtotal,
    tax,
    discount,
    voucher,
    total,
    canonical,
    fingerprint: sha256Hex(JSON.stringify({ canonical:financialCanonical, lines:offer.gift?lines.slice(0,-1):lines, total })),
  };
}
/** Phần giữ không gắn kho (báo giá, đơn chưa chọn kho) rơi vào `warehouseId`: tổng giữ trừ tồn trống ở các kho thật khác (tồn − hàng đơn đang giữ ở kho đó). */
async function quoteHoldShare(db: PosDb, quotes: { sku: string; qty: number }[], warehouseId: string, knownHere?: Awaited<ReturnType<typeof orderHolds>>) {
  const skus = quotes.map(q => q.sku), wanted = new Set(skus);
  // `knownHere`: hàng đơn giữ ở kho này cho tập mã rộng hơn (reservedBySku vừa đọc, cùng tham số) – lọc lại theo mã, khỏi đọc lần hai.
  const [stock, whs, allOrders, hereOrders] = await Promise.all([
    readCatalogStock(db, skus),
    db.select({ id: warehouses.id }).from(warehouses).where(and(eq(warehouses.kind, 'stock'), eq(warehouses.active, true))),
    orderHolds(db, skus, undefined, undefined, true),
    knownHere ? knownHere.filter(r => wanted.has(r.sku)) : orderHolds(db, skus, warehouseId, undefined, true),
  ]);
  const others = new Set(whs.map(w => w.id).filter(id => id !== warehouseId)), free = new Map<string, number>();
  for (const r of stock) if (others.has(r.warehouseId)) free.set(r.sku, (free.get(r.sku) ?? 0) + Math.max(0, r.quantity));
  // Đơn giữ ở kho khác (đơn chưa gắn kho đã tính vào kho này – nằm trong cả hai danh sách nên tự triệt tiêu).
  for (const r of allOrders) free.set(r.sku, (free.get(r.sku) ?? 0) - r.qty);
  for (const r of hereOrders) free.set(r.sku, (free.get(r.sku) ?? 0) + r.qty);
  return new Map(quotes.map(q => [q.sku, Math.max(0, q.qty - Math.max(0, free.get(q.sku) ?? 0))]));
}
/**
 * Hàng đang giữ theo mã. `skus` bỏ trống = mọi mã (snapshot POS đọc cả danh mục): không gửi danh sách hàng nghìn mã vào từng truy vấn
 * giữ hàng – CSDL tốn công phân tích / lập kế hoạch cho danh sách dài, trong khi số dòng giữ hàng thật chỉ vài trăm.
 */
export async function reservedBySku(db: PosDb, skus: string[] | undefined, warehouseId?: string, exceptOrderId?: string) {
  const now = posNow();
  const [quotes, allOrders] = await Promise.all([
    db
      .select({ sku: stockHolds.sku, qty: sql<number>`sum(${stockHolds.qty})`.mapWith(Number) })
      .from(stockHolds)
      .where(and(skus ? inArray(stockHolds.sku, skus) : undefined, eq(stockHolds.status, 'active'), sql`${stockHolds.expiresAt}>${now}`))
      .groupBy(stockHolds.sku),
    orderHolds(db, skus, warehouseId, undefined, true),
  ]);
  const orders=exceptOrderId?allOrders.filter(order=>order.orderId!==exceptOrderId):allOrders;
  const out = new Map<string, number>();
  // Giữ hàng KHÔNG gắn kho – báo giá giữ hàng và đơn / HĐKT cũ chưa chọn kho bán – tính trên TỔNG tồn mọi kho. Kho quầy chỉ gánh
  // phần mà tồn trống ở các kho khác không đủ che: hàng giữ cho khách sỉ ở kho VIGIFTS không làm kho cửa hàng hiện "Hết hàng" (23/10/2026).
  const global = new Map(quotes.map(r => [r.sku, r.qty]));
  for (const r of orders) if (r.unassigned) global.set(r.sku, (global.get(r.sku) ?? 0) + r.qty);
  const share = warehouseId && global.size ? await quoteHoldShare(db, [...global].map(([sku, qty]) => ({ sku, qty })), warehouseId, allOrders) : global;
  for (const [sku, qty] of share) if (qty > 0) out.set(sku, (out.get(sku) ?? 0) + qty);
  for (const r of orders) {
    if (r.unassigned) continue;
    const quantity = r.qty; // orderHolds already removes quantities issued by packing or POS delivery.
    out.set(r.sku, (out.get(r.sku) ?? 0) + quantity);
  }
  return out;
}
export async function shiftReport(db: PosDb, s: typeof posShifts.$inferSelect, cutoff = posNow()) {
  const [payments, bills, pending, received] = await Promise.all([
    db
      .select({
        method: customerPayments.method,
        source: customerPayments.paymentSource,
        total: sql<number>`coalesce(sum(${customerPayments.amount}),0)`.mapWith(Number),
        count: count(),
      })
      .from(customerPayments)
      .where(
        and(
          eq(customerPayments.shiftId, s.id),
          sql`${customerPayments.createdAt} <= ${cutoff}`,
          or(isNull(customerPayments.voidedAt), sql`${customerPayments.voidedAt}>${cutoff}`),
        ),
      )
      .groupBy(customerPayments.method, customerPayments.paymentSource),
    db
      .select({
        count: count(),
        revenue: sql<number>`coalesce(sum(${salesOrders.total}),0)`.mapWith(Number),
        // Cột trong select bị render không kèm tên bảng → viết rõ bảng (trước đây `id` hiểu nhầm thành id dòng → chiết khấu luôn 0).
        // Chiết khấu = CK từng dòng + voucher đã chia vào dòng.
        discount:
          sql<number>`coalesce(sum((select coalesce(sum(sol.discount_amount),0) from ${salesOrderLines} sol where sol.order_id = ${salesOrders}.id)),0)`.mapWith(
            Number,
          ),
      })
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.shiftId, s.id),
          // Quick cancellations carry a compensating return: retain original gross, subtract the return once.
          or(ne(salesOrders.status, 'cancelled'), sql`${salesOrders.posSnapshot}::jsonb->'quickCancellation' is not null`),
          sql`${salesOrders.createdAt} <= ${cutoff}`,
        ),
      ),
    db
      .select({
        orderId: salesOrders.id,
        amount: sql<number>`greatest(0,${deliveries.codAmount}-(select coalesce(sum(${customerPayments.amount}),0) from ${customerPayments} where ${customerPayments.deliveryId}=${deliveries.id} and ${customerPayments.createdAt}<=${cutoff} and (${customerPayments.voidedAt} is null or ${customerPayments.voidedAt}>${cutoff})))`.mapWith(Number),
      })
      .from(deliveries)
      .innerJoin(salesOrders, eq(salesOrders.id, deliveries.orderId))
      .innerJoin(posShifts, eq(posShifts.id, salesOrders.shiftId))
      .where(
        and(
          eq(posShifts.cashDrawerId, s.cashDrawerId),
          eq(deliveries.status, 'delivered'),
          sql`${deliveries.updatedAt}<=${cutoff}`,
          sql`${deliveries.codAmount}>(select coalesce(sum(${customerPayments.amount}),0) from ${customerPayments} where ${customerPayments.deliveryId}=${deliveries.id} and ${customerPayments.createdAt}<=${cutoff} and (${customerPayments.voidedAt} is null or ${customerPayments.voidedAt}>${cutoff}))`,
        ),
      ),
    db
      .select({
        previous: sql<boolean>`${deliveries.updatedAt}<${s.openedAt}`,
        count: sql<number>`count(distinct ${deliveries.id})`.mapWith(Number),
        amount: sql<number>`sum(${customerPayments.amount})`.mapWith(Number),
      })
      .from(customerPayments)
      .innerJoin(deliveries, eq(deliveries.id, customerPayments.deliveryId))
      .where(
        and(
          eq(customerPayments.shiftId, s.id),
          eq(deliveries.status, 'delivered'),
          sql`${customerPayments.createdAt}<=${cutoff}`,
          or(isNull(customerPayments.voidedAt), sql`${customerPayments.voidedAt}>${cutoff}`),
        ),
      )
      .groupBy(sql`1`),
  ]);
  const cash = payments.filter((p) => p.method === 'cash').reduce((v, p) => v + p.total, 0),
    transfer = payments.filter((p) => p.method === 'transfer').reduce((v, p) => v + p.total, 0);
  const pendingByOrder=new Map<string,number>();
  for(const p of pending)pendingByOrder.set(p.orderId,(pendingByOrder.get(p.orderId)||0)+p.amount);
  let pendingCount=0,pendingAmount=0;
  const pendingBalances=await returnBalances(db,[...pendingByOrder.keys()],cutoff);
  for(const [id,amount] of pendingByOrder){const remaining=Math.min(amount,Math.max(0,pendingBalances.get(id)??0));if(remaining>0){pendingCount++;pendingAmount+=remaining;}}
  const flowOrders = await db.select({amount:sql<number>`greatest(0,${salesOrders.total}-(select coalesce(sum(${customerPayments.amount}),0) from ${customerPayments} where ${customerPayments.orderId}=${salesOrders.id} and ${customerPayments.createdAt}<=${cutoff} and (${customerPayments.voidedAt} is null or ${customerPayments.voidedAt}>${cutoff})))`.mapWith(Number)}).from(salesOrders).innerJoin(posShifts,eq(posShifts.id,salesOrders.shiftId)).where(and(eq(posShifts.cashDrawerId,s.cashDrawerId),sql`${salesOrders.posSnapshot}::jsonb->>'saleFlow' in ('deposit','prepaid')`,inArray(salesOrders.status,['draft','confirmed','delivering']),sql`${salesOrders.createdAt}<=${cutoff}`));
  const flowPending = await db.select({n:count(),amount:sql<number>`coalesce(sum(${posPaymentIntents.amount}),0)`.mapWith(Number)}).from(posPaymentIntents).where(and(eq(posPaymentIntents.requestedShiftId,s.id),sql`${posPaymentIntents.createdAt}<=${cutoff}`,sql`(${posPaymentIntents.confirmedAt} is null or ${posPaymentIntents.confirmedAt}>${cutoff}) and (${posPaymentIntents.cancelledAt} is null or ${posPaymentIntents.cancelledAt}>${cutoff})`));
  let flowOutstandingCount=0,flowOutstandingAmount=0;
  for(const {amount} of flowOrders){if(amount>0){flowOutstandingCount++;flowOutstandingAmount+=amount;}}
  const flowSum=(source:string)=>payments.filter(p=>p.source===source).reduce((n,p)=>n+p.total,0);
  const drawer = await cashShiftTotals(db, s.id);
  const r = await registerOf(db, s.registerId);
  const [person] = await db.select({ name: employees.name }).from(employees).where(eq(employees.id, s.memberId));
  const [counted] = await db.select({ count: count() }).from(posStockCounts).where(eq(posStockCounts.shiftId, s.id));
  return {
    shift: s,
    memberName: person?.name ?? s.memberId,
    openingComparison: await openingCashComparison(db, s.id),
    register: r,
    asOf: cutoff,
    returns: {
      credit: Number((await db.select({n:sql<number>`coalesce(sum(${posReturns.total}),0)`}).from(posReturns).where(and(eq(posReturns.receivedShiftId,s.id),sql`${posReturns.creditEffectiveAt}<=${cutoff}`)))[0]?.n||0),
      refundedCash: Number((await db.select({n:sql<number>`coalesce(sum(${posRefunds.amount}),0)`}).from(posRefunds).where(and(eq(posRefunds.shiftId,s.id),eq(posRefunds.method,'cash'),sql`${posRefunds.confirmedAt}<=${cutoff} and (${posRefunds.voidedAt} is null or ${posRefunds.voidedAt}>${cutoff})`)))[0]?.n||0),
      refundedTransfer: Number((await db.select({n:sql<number>`coalesce(sum(${posRefunds.amount}),0)`}).from(posRefunds).where(and(eq(posRefunds.shiftId,s.id),eq(posRefunds.method,'transfer'),sql`${posRefunds.confirmedAt}<=${cutoff} and (${posRefunds.voidedAt} is null or ${posRefunds.voidedAt}>${cutoff})`)))[0]?.n||0),
      exchanged: payments.filter(p=>p.source==='pos_exchange_credit').reduce((n,p)=>n+p.total,0),
    },
    openingCount: counted?.count ? { scope: 'partial', count: counted.count } : null,
    bills: bills[0] ?? { count: 0, revenue: 0, discount: 0 },
    payments,
    orderFlows:{deposit:flowSum('pos_deposit'),balance:flowSum('pos_balance'),prepaid:flowSum('pos_prepaid'),pending:{count:flowPending[0]?.n||0,amount:flowPending[0]?.amount||0},outstanding:{count:flowOutstandingCount,amount:flowOutstandingAmount}},
    cash,
    transfer,
    manual: drawer.manual,
    bookAdjustments: drawer.bookAdjustments,
    pendingEntries: drawer.pending,
    // Từng phiếu thu / chi tay trong ca (giờ, loại, nội dung, trạng thái) cho bảng trên báo cáo ca – không đổi công thức két.
    entries: await db.select({ id: cashEntries.id, entryNo: cashEntries.entryNo, at: cashEntries.createdAt, kind: cashEntries.kind, direction: cashEntries.direction,
      amount: cashEntries.amount, reason: cashEntries.reason, status: cashEntries.status }).from(cashEntries)
      .where(and(eq(cashEntries.shiftId, s.id), sql`${cashEntries.createdAt} <= ${cutoff}`)).orderBy(asc(cashEntries.createdAt)).limit(200),
    cashSales: drawer.cashSales,
    cashCod: drawer.cashCod,
    currentAdjustmentNet: drawer.currentAdjustmentNet,
    expectedCash: s.openingCash + cash + drawer.manualNet + drawer.currentAdjustmentNet,
    cod: {
      pending: {count:pendingCount,amount:pendingAmount},
      receivedInShift: received
        .filter((x) => !x.previous)
        .reduce((a, x) => ({ count: a.count + x.count, amount: a.amount + x.amount }), { count: 0, amount: 0 }),
      receivedFromPrevious: received
        .filter((x) => x.previous)
        .reduce((a, x) => ({ count: a.count + x.count, amount: a.amount + x.amount }), { count: 0, amount: 0 }),
    },
  };
}
export async function checkout(env: StaffEnv, m: PosMember, b: Record<string, unknown>) {
  posPermission(m);
  const flow = saleFlowOf(b);
  if (b.saleFlow !== undefined && !flow) throw new AppError(400, 'Chọn loại đơn cọc/trả trước hợp lệ.');
  // Đã bỏ tạo mới đơn cọc / ship trả trước (21/10/2026). Đơn cũ vẫn thu nốt / nhận hàng / huỷ / trả hàng bình thường.
  if (flow && !env.posOrderFlowCreate) throw new AppError(410, 'Đã ngừng tạo đơn cọc / ship trả trước. Bán tại quầy hoặc Ship COD.', 'POS_ORDER_FLOW_DISABLED');
  const key = posKey(b.key),
    shiftId = posText(b.shiftId),
    mode = flow ? (flow === 'prepaid' ? 'delivery' : 'counter') : b.fulfillmentMode === 'cod' ? 'cod' : 'counter',
    method = b.method === 'cash' ? 'cash' : b.method === 'transfer' ? 'transfer' : null;
  const depositAmount = flow ? 0 : posMoney(b.depositAmount ?? 0, 'Tiền thu trước COD');
  if (depositAmount > 0 && mode !== 'cod') throw new AppError(400, 'Thu trước chỉ áp dụng cho đơn giao COD.');
  if (depositAmount > 0 && !method) throw new AppError(400, 'Chọn hình thức thu trước COD.');
  const selectedDelivery = mode==='cod'?posDeliveryMethod(b.delivery&&typeof b.delivery==='object'?b.delivery as Record<string,unknown>:{}):null;
  const requestHash = sha256Hex(JSON.stringify({ ...emptyCart(b), fulfillmentMode: mode, method, ...(selectedDelivery&&((b.delivery as Record<string,unknown>)?.deliveryMethod)?{delivery:b.delivery}:{}), ...(depositAmount ? { depositAmount } : {}), ...(flow ? { saleFlow: flow, initialAmount: b.initialAmount ?? null, confirmed: b.confirmed === true, delivery: b.delivery ?? null } : {}) }));
  if (!method && mode !== 'cod') throw new AppError(400, 'Chọn tiền mặt hoặc chuyển khoản.');
  if (method === 'transfer' && b.confirmed !== true && mode !== 'cod' && !flow)
    throw new AppError(400, 'Nhân viên cần xác nhận đã thực nhận chuyển khoản.');
  return env.db.transaction(async (tx) => {
    await cashLock(tx);
    const s = await saleShiftOf(tx, m, shiftId, true);
    const [prior] = await tx.select().from(salesOrders).where(eq(salesOrders.checkoutKey, key));
    if (prior) {
      if (prior.shiftId !== s.id) throw new AppError(409, 'Mã giao dịch đã dùng ở ca khác.');
      const snap = JSON.parse(prior.posSnapshot ?? '{}');
      if (snap.requestHash !== requestHash)
        throw new AppError(409, 'Mã giao dịch đã dùng cho giỏ khác.');
      return { id: prior.id, orderNo: prior.orderNo, ...snap, replayed: true };
    }
    assertOpen(s, m);
    if (posText(b.registerId) !== s.registerId) throw new AppError(400, 'Quầy không khớp ca.');
    const c = await calculateCart(tx, b);
    if(c.promotion&&b.promotionRevision!==c.promotion.revision)throw new AppError(409,'Chương trình khuyến mãi vừa thay đổi. Tính lại giỏ trước khi thanh toán.','POS_PROMOTION_CHANGED');
    const customerIssue = posCustomerIssue(c.customer);
    if (customerIssue) throw new AppError(400, customerIssue, 'POS_CUSTOMER_REQUIRED');
    const initialAmount = flow ? flowInitialAmount(flow, c.total, b.initialAmount) : 0;
    const receivedInitial = flow && (method === 'cash' || b.confirmed === true) ? initialAmount : 0;
    if (flow && (c.exchange.amount || b.paymentRequestId)) throw new AppError(400, 'Đơn cọc/trả trước không dùng QR hoặc tín dụng giỏ đang thanh toán.');
    // Giỏ này đã được ngân hàng xác nhận chuyển khoản qua QR nhưng chưa gắn vào đơn nào:
    // không cho thu lại bằng tiền mặt / COD / cọc (khách bị thu hai lần, két lệch).
    // Thanh toán "Chuyển khoản" không kèm mã QR (vd. tải lại trang mất mã) thì tự gắn khoản QR đó.
    let paymentRequestId = posText(b.paymentRequestId);
    if (!paymentRequestId) {
      const [paidQr]=await tx.select({id:posPaymentRequests.id,amount:posPaymentRequests.amount,cart:posPaymentRequests.cart}).from(posPaymentRequests).where(and(eq(posPaymentRequests.shiftId,s.id),eq(posPaymentRequests.fingerprint,c.fingerprint),sql`${posPaymentRequests.confirmedAt} is not null`,sql`not exists(select 1 from ${salesOrders} where ${salesOrders.posPaymentRequestId}=${posPaymentRequests.id})`)).limit(1);
      if (paidQr) {
        if (flow) throw new AppError(409,'Giỏ đã nhận chuyển khoản qua QR. Hoàn tất giao dịch QR trước, không chuyển thành đơn cọc/trả trước.', 'POS_QR_ALREADY_PAID');
        if (method !== 'transfer' || (mode==='cod'?(JSON.parse(paidQr.cart).codDepositAmount!==depositAmount||paidQr.amount!==depositAmount):(JSON.parse(paidQr.cart).codDepositAmount!==undefined||paidQr.amount!==c.payable)))
          throw new AppError(409,'Giỏ này đã nhận chuyển khoản qua QR. Chọn "Chuyển khoản" để hoàn tất đúng khoản đã nhận, không thu lại.', 'POS_QR_ALREADY_PAID');
        paymentRequestId = paidQr.id;
      }
    }
    // Thu ngân tự xác nhận "đã nhận chuyển khoản" trước khi SePay báo về: vẫn gắn đúng QR đang hiện cho giỏ này,
    // để đơn lấy đúng số đã in trên nội dung chuyển khoản (không cấp số mới, không bỏ rơi khoản QR).
    if (!paymentRequestId && !flow && method === 'transfer' && (mode !== 'cod'||depositAmount>0)) {
      const [openQr] = await tx.select({ id: posPaymentRequests.id }).from(posPaymentRequests).where(and(
        eq(posPaymentRequests.shiftId, s.id), eq(posPaymentRequests.fingerprint, c.fingerprint), eq(posPaymentRequests.amount, mode==='cod'?depositAmount:c.payable),
        mode==='cod'?sql`${posPaymentRequests.cart}::jsonb->>'codDepositAmount'=${String(depositAmount)}`:sql`${posPaymentRequests.cart}::jsonb->>'codDepositAmount' is null`,
        sql`${posPaymentRequests.confirmedAt} is null`, sql`${posPaymentRequests.expiresAt} >= ${posNow()}`,
        sql`not exists(select 1 from ${salesOrders} where ${salesOrders.posPaymentRequestId}=${posPaymentRequests.id})`,
      )).orderBy(desc(posPaymentRequests.createdAt)).limit(1);
      if (openQr) paymentRequestId = openQr.id;
    }

    if (c.exchange.amount && mode === 'cod') throw new AppError(400, 'Đổi hàng thanh toán tại quầy, không chuyển COD.');
    if (depositAmount > c.total) throw new AppError(400, 'Tiền thu trước không được vượt tổng đơn.');
    if (c.total === 0 && mode === 'cod') throw new AppError(400, 'Đơn COD phải có số tiền cần thu.');
    await assertOpening(tx, c.register.warehouseId);
    let qr: typeof posPaymentRequests.$inferSelect | undefined;
    if (paymentRequestId) {
      [qr] = await tx
        .select()
        .from(posPaymentRequests)
        .where(and(eq(posPaymentRequests.id, paymentRequestId), eq(posPaymentRequests.shiftId, s.id)))
        .for('update');
      if (
        !qr ||
        (qr.expiresAt < posNow() && !qr.confirmedAt) ||
        qr.fingerprint !== c.fingerprint ||
        qr.amount !== (mode==='cod'?depositAmount:c.payable) ||
        (mode==='cod'?JSON.parse(qr.cart).codDepositAmount!==depositAmount:JSON.parse(qr.cart).codDepositAmount!==undefined) ||
        method !== 'transfer'
      )
        throw new AppError(409, 'Yêu cầu QR hết hạn hoặc giỏ/giá đã đổi. Tạo QR mới.');
    }
    if(qr){
      const [used]=await tx.select({id:salesOrders.id}).from(salesOrders).where(eq(salesOrders.posPaymentRequestId,qr.id)).limit(1);
      if(used)throw new AppError(409,'QR đã được ghi nhận vào đơn khác. Không thu lại.');
      if(mode==='cod'){
        const [otherPaid]=await tx.select({id:posPaymentRequests.id}).from(posPaymentRequests).where(and(eq(posPaymentRequests.shiftId,s.id),eq(posPaymentRequests.fingerprint,c.fingerprint),sql`${posPaymentRequests.id}<>${qr.id}`,sql`${posPaymentRequests.confirmedAt} is not null`,sql`not exists(select 1 from ${salesOrders} where ${salesOrders.posPaymentRequestId}=${posPaymentRequests.id})`)).limit(1);
        if(otherPaid)throw new AppError(409,'Giỏ có thêm khoản QR đã nhận. Cần đối soát trước khi hoàn tất.');
      }
    }
    if(depositAmount>0&&method==='transfer'&&b.confirmed!==true&&!qr?.confirmedAt)throw new AppError(400,'Xác nhận cửa hàng đã thực nhận tiền chuyển khoản thu trước.');
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('stock_holds'))`);
    await lockLedger(tx);
    await assertWarehousesOpened(tx, [c.register.warehouseId]);
    const skus = c.lines.map((l) => l.sku).sort();
    const balances = await tx
      .select()
      .from(stockBalances)
      .where(and(eq(stockBalances.warehouseId, c.register.warehouseId), inArray(stockBalances.sku, skus)))
      .orderBy(asc(stockBalances.sku))
      .for('update');
    const reserved = await reservedBySku(tx, skus, c.register.warehouseId);
    const quantities=new Map<string,number>();for(const l of c.lines)quantities.set(l.sku,(quantities.get(l.sku)||0)+l.qty);
    for (const [sku,qty] of quantities) {
      const l=c.lines.find(l=>l.sku===sku)!;
      const available = (balances.find((x) => x.sku === l.sku)?.qty ?? 0) - (reserved.get(l.sku) ?? 0);
      if (qty > available + 1e-9)
        throw new AppError(409, `${l.name}: chỉ còn khả dụng ${Math.max(0, available)}.`, 'POS_STOCK_SHORT');
    }
    const tendered = flow ? receivedInitial : mode === 'cod' ? depositAmount : method === 'cash' ? posMoney(b.tendered, 'Tiền khách đưa') : c.payable;
    if (!flow && mode === 'counter' && tendered < c.payable) throw new AppError(400, 'Tiền khách đưa chưa đủ.');
    // Ship COD: địa chỉ chuẩn GHN + khối lượng / cách xem hàng → posSnapshot.ghn (tạo vận đơn GHN ngay sau khi lưu, pos-ghn-create.ts).
    const shipInput = b.delivery && typeof b.delivery === 'object' ? (b.delivery as Record<string, unknown>) : {};
    const ghnShip = mode === 'cod' && selectedDelivery?.method==='ghn' ? parseGhnShip(shipInput) : null;
    const now = posNow(),
      date = vietnamDate().iso;
    const id = crypto.randomUUID(),
      orderNo = await orderNoForCheckout(tx, date, qr, await posOrderPrefixFor(tx, c.register));
    const snapshot = {
      register: c.register,
      customer: c.customer?.name ?? 'Khách lẻ',
      note: c.note,
      lines: c.lines,
      ...(c.promotion?{promotion:c.promotion}:{}),
      fees: c.fees,
      subtotal: c.subtotal,
      tax: c.tax,
      discount: c.discount,
      ...(c.voucher ? { voucher: c.voucher } : {}),
      total: c.total,
      method: flow || (mode === 'cod' ? 'cod' : method),
      ...(flow ? { saleFlow: flow, initialAmount, receivedAmount: receivedInitial, remaining: c.total - receivedInitial, paymentMethod: method, pendingTransfer: method === 'transfer' && !receivedInitial, holdUntil: flowHoldUntil(now, flow === 'prepaid' && receivedInitial === c.total) } : {}),
      ...(depositAmount ? { depositAmount, depositMethod: method, codAmount: c.total - depositAmount, codDeliveryId: '' } : {}),
      tendered,
      change: !flow && mode === 'counter' ? tendered - c.payable : 0,
      ...(c.exchange.amount ? { exchangeCredit: c.exchange.amount, payable: c.payable } : {}),
      ...(ghnShip ? { ghn: ghnShip } : {}),
      ...(selectedDelivery?{deliveryMethod:selectedDelivery}:{}),
      createdAt: now,
      memberName: m.name,
      pricePolicyId: c.canonical.pricePolicyId,
      vatEnabled: c.canonical.vatEnabled,
      requestHash,
    };
    await tx.insert(salesOrders).values({
      id,
      orderNo,
      quoteType: 'HRC',
      channel: 'pos',
      shiftId: s.id,
      checkoutKey: key,
      posPaymentRequestId: qr?.id,
      posSnapshot: JSON.stringify(snapshot),
      fulfillmentMode: mode,
      customerId: c.customer?.id,
      customerName: snapshot.customer,
      note: c.note,
      contact: c.customer?.contact ?? '',
      phone: c.customer?.phone ?? '',
      email: c.customer?.email ?? '',
      address: c.customer?.address ?? '',
      ownerId: m.id,
      createdBy: m.id,
      orderDate: date,
      status: flow || mode === 'cod' ? 'confirmed' : 'delivered',
      holdsStock: flow ? false : mode === 'cod',
      subtotal: c.subtotal,
      tax: c.tax,
      total: c.total,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(salesOrderLines).values(
      c.lines.map((l, i) => ({
        id: crypto.randomUUID(),
        orderId: id,
        lineNo: i + 1,
        sku: l.sku,
        name: l.name,
        unit: l.unit,
        qty: l.qty,
        unitPrice: l.unitPrice,
        listUnitPrice: l.listUnitPrice,
        discountType: l.discountType,
        discountValue: l.discountValue,
        discountAmount: l.discountAmount,
        taxRate: l.taxRate,
        amount: l.subtotal,
        deliveredQty: !flow && mode === 'counter' ? l.qty : 0,
      })),
    );
    await ensureLineCosts(tx, id, 'pos', m.id); // giá vốn lúc bán (snapshot)
    const scheduleId = crypto.randomUUID();
    await tx.insert(paymentSchedules).values({
      id: scheduleId,
      orderId: id,
      kind: 'balance',
      amount: c.total,
      dueDate: !flow && mode === 'counter' ? date : null,
      note: flow === 'deposit' ? 'Đặt cọc - nhận sau' : flow === 'prepaid' ? 'Ship trả trước 100%' : mode === 'cod' ? 'Ship COD' : 'POS',
      createdAt: now,
    });
    if (flow) {
      const orderLines = await tx.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, id));
      await tx.insert(posOrderReservations).values(orderLines.map(line => ({ id: crypto.randomUUID(), orderId: id, orderLineId: line.id, warehouseId: c.register.warehouseId, qty: line.qty, status: 'active', expiresAt: flowHoldUntil(now, flow === 'prepaid' && receivedInitial === c.total), createdBy: m.id, createdAt: now, updatedAt: now })));
      if (receivedInitial > 0) await tx.insert(customerPayments).values({ id: crypto.randomUUID(), orderId: id, scheduleId, customerId: c.customer?.id, shiftId: s.id, amount: receivedInitial, method: method!, requestKey: key, paymentSource: flow === 'deposit' ? 'pos_deposit' : 'pos_prepaid', note: flow === 'deposit' ? 'Đặt cọc nhận sau' : 'Ship trả trước', paidAt: date, createdBy: m.id, createdAt: now });
      else await tx.insert(posPaymentIntents).values({ id: crypto.randomUUID(), orderId: id, requestedShiftId: s.id, kind: flow === 'deposit' ? 'deposit' : 'prepaid', method: 'transfer', amount: initialAmount, requestKey: key, requestHash, status: 'pending', createdBy: m.id, createdAt: now });
      if (flow === 'prepaid') {
        const ship = b.delivery && typeof b.delivery === 'object' ? b.delivery as Record<string, unknown> : {};
        if (!posText(ship.address)) throw new AppError(400, 'Nhập địa chỉ ship trả trước.');
        await createScheduledDelivery(tx, id, { ...ship, plannedDate: ship.plannedDate || date }, m.id);
      }
    } else if (mode === 'counter') {
      await postMoves(
        tx,
        m.id,
        c.lines.map((l) => ({
          sku: l.sku,
          warehouseId: c.register.warehouseId,
          qty: -l.qty,
          kind: 'issue',
          refType: 'pos_order',
          refId: id,
          refNo: orderNo,
        })),
        now,
      );
      if (c.payable > 0)
        await tx.insert(customerPayments).values({
          id: crypto.randomUUID(),
          orderId: id,
          scheduleId,
          customerId: c.customer?.id,
          shiftId: s.id,
          amount: c.payable,
          method: method!,
          requestKey: key,
          paymentSource: qr ? 'vietqr' : 'pos',
          paidAt: date,
          createdBy: m.id,
          createdAt: now,
        });
    } else {
      const ship = b.delivery && typeof b.delivery === 'object' ? (b.delivery as Record<string, unknown>) : {};
      if (!posText(ship.address)) throw new AppError(400, 'Nhập địa chỉ giao COD.');
      const d = await createScheduledDelivery(tx, id, { ...ship, plannedDate: ship.plannedDate || date }, m.id);
      await tx.update(deliveries).set({ codAmount: c.total - depositAmount, ...(selectedDelivery&&selectedDelivery.method!=='ghn'?{carrier:selectedDelivery.name,trackingCode:selectedDelivery.trackingCode,note:[posText(ship.note),selectedDelivery.phone?'Điện thoại đơn vị giao: '+selectedDelivery.phone:''].filter(Boolean).join(' · ')}:{}) }).where(eq(deliveries.id, d.id));
      if (depositAmount > 0) {
        snapshot.codDeliveryId = d.id;
        await tx.update(salesOrders).set({ posSnapshot: JSON.stringify(snapshot) }).where(eq(salesOrders.id, id));
        await tx.insert(customerPayments).values({
          id: crypto.randomUUID(), orderId: id, scheduleId, customerId: c.customer?.id,
          shiftId: s.id, amount: depositAmount, method: method!, requestKey: key,
          paymentSource: 'pos_cod_deposit', note: 'Thu trước / tạm ứng Ship COD', paidAt: date, createdBy: m.id, createdAt: now,
        });
      }
    }
    if (c.exchange.allocation) {
      const allocation = c.exchange.allocation, paymentId = crypto.randomUUID();
      await tx.insert(customerPayments).values({id:paymentId,orderId:id,scheduleId,customerId:c.customer?.id,shiftId:s.id,amount:allocation.amount,method:'other',paymentSource:'pos_exchange_credit',requestKey:allocation.id,reference:allocation.returnId,paidAt:date,createdBy:m.id,createdAt:now});
      await tx.update(posExchangeAllocations).set({status:'applied',paymentId,replacementOrderId:id,appliedAt:now}).where(eq(posExchangeAllocations.id,allocation.id));
      await cashAudit(tx,m.id,'apply-exchange','pos-returns',allocation.returnId,{allocationId:allocation.id,orderId:id,amount:allocation.amount});
    }
    if (qr) await tx.update(posPaymentRequests).set({ confirmedAt: now }).where(eq(posPaymentRequests.id, qr.id));
    await cashAudit(tx, m.id, 'sale', 'orders', id, { orderNo, total: c.total, method, mode, shiftId: s.id, ...(depositAmount ? { depositAmount, codAmount: c.total - depositAmount } : {}) });
    return { id, orderNo, ...snapshot, replayed: false };
  });
}
