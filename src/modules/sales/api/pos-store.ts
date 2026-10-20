import { posOrderReservations, posPaymentIntents } from '../pos-order-flow-schema.ts';
import { flowInitialAmount, flowHoldUntil, saleFlowOf } from '../domain/pos-order-flow.ts';
import { exchangeForCart, returnAccount } from './pos-return-credit.ts';
import { posExchangeAllocations, posReturns, posRefunds } from '../return-schema.ts';
import { posOrderNote } from '../domain/pos-order-note.ts';
import { posFeeInput, calculatePosFees } from '../domain/pos-fees.ts';
import { cashLock, cashShiftTotals, cashAudit, openingCashComparison } from './cash-store.ts';
import { and, asc, count, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import type { StaffEnv, SessionState } from '../../staff/api/auth-routes.ts';
import { can } from '../../staff/domain/permissions.ts';
import { employees } from '../../staff/schema.ts';
import { products, productPrices, productBarcodes, warehouses, pricePolicies } from '../../catalog/schema.ts';
import { stockBalances, stockMoves } from '../../inventory/schema.ts';
import { postMoves } from '../../inventory/api/ledger.ts';
import { customers, customerStaff } from '../../customers/schema.ts';
import { posRegisters, posShifts, posShiftTemplates, posStockCounts, posPaymentRequests } from '../pos-schema.ts';
import {
  salesOrders,
  salesOrderLines,
  customerPayments,
  paymentSchedules,
  deliveries,
  stockHolds,
  packingSlips,
} from '../schema.ts';
import { nextDocNo, vietnamDate } from '../domain/sales.ts';
import { posLine, posMoney } from '../domain/pos-money.ts';
import { sha256Hex } from '../../staff/domain/session.ts';
import { createScheduledDelivery } from './delivery-store.ts';
import { orderHolds } from './hold-routes.ts';
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
export function assertOpen(s: typeof posShifts.$inferSelect, m: PosMember) {
  if (s.memberId !== m.id) throw new AppError(403, 'Chỉ người mở ca thao tác bán/thu tiền trong ca.');
  if (s.closedAt) throw new AppError(409, 'Ca đã kết, hãy mở ca mới.');
}
export async function assertOpening(db: PosDb, warehouseId: string) {
  const [x] = await db
    .select({ id: stockMoves.id })
    .from(stockMoves)
    .where(and(eq(stockMoves.warehouseId, warehouseId), eq(stockMoves.refType, 'opening')))
    .limit(1);
  if (!x)
    throw new AppError(
      409,
      'Kho chưa chốt tồn đầu kỳ. Manager cần chốt sổ kho trước khi mở POS.',
      'POS_OPENING_REQUIRED',
    );
}
export const emptyCart = (b: Record<string, unknown>) => {
  const note = posOrderNote(b.note);
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
  const lines = raw.map((x, i) => {
    const f = found.find((f) => f.p.sku === skus[i]);
    if (!f || f.price == null) throw new AppError(400, 'Mã hàng chưa có giá hoặc chưa được duyệt: ' + skus[i]);
    return {
      sku: f.p.sku,
      name: f.p.name,
      unit: f.p.unit,
      ...posLine({
        price: f.price,
        qty: x.qty,
        discountType: x.discountType,
        discountValue: x.discountValue,
        taxRate: withVat ? r.taxRate : 0,
        priceIncludesVat: withVat,
        vatEnabled: withVat,
      }),
    };
  });
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
    rows: lines.map((l) => ({ sku: l.sku, qty: l.qty, discountType: l.discountType, discountValue: l.discountValue })),
  };
  return {
    register: r,
    customer,
    note: input.note ?? '',
    exchange, payable,
    fees,
    lines,
    subtotal,
    tax,
    discount,
    total,
    canonical,
    fingerprint: sha256Hex(JSON.stringify({ canonical, lines, total })),
  };
}
export async function reservedBySku(db: PosDb, skus: string[], warehouseId?: string) {
  const now = posNow();
  const [quotes, orders] = await Promise.all([
    db
      .select({ sku: stockHolds.sku, qty: sql<number>`sum(${stockHolds.qty})`.mapWith(Number) })
      .from(stockHolds)
      .where(and(inArray(stockHolds.sku, skus), eq(stockHolds.status, 'active'), sql`${stockHolds.expiresAt}>${now}`))
      .groupBy(stockHolds.sku),
    orderHolds(db, skus, warehouseId),
  ]);
  const issued =
    warehouseId && orders.length
      ? await db
          .select({
            orderId: packingSlips.orderId,
            sku: stockMoves.sku,
            qty: sql<number>`-sum(${stockMoves.qty})`.mapWith(Number),
          })
          .from(stockMoves)
          .innerJoin(packingSlips, eq(packingSlips.id, stockMoves.refId))
          .where(
            and(
              eq(stockMoves.refType, 'packing_slip'),
              eq(stockMoves.warehouseId, warehouseId),
              inArray(
                packingSlips.orderId,
                orders.map((o) => o.orderId),
              ),
            ),
          )
          .groupBy(packingSlips.orderId, stockMoves.sku)
      : [];
  const out = new Map<string, number>();
  for (const r of quotes) out.set(r.sku, (out.get(r.sku) ?? 0) + r.qty);
  for (const r of orders) {
    const quantity = Math.max(0, r.qty - (r.timed ? 0 : issued.find((x) => x.orderId === r.orderId && x.sku === r.sku)?.qty ?? 0));
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
        discount:
          sql<number>`coalesce(sum((select coalesce(sum(${salesOrderLines.discountAmount}),0) from ${salesOrderLines} where ${salesOrderLines.orderId}=${salesOrders.id})),0)`.mapWith(
            Number,
          ),
      })
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.shiftId, s.id),
          ne(salesOrders.status, 'cancelled'),
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
  for(const [id,amount] of pendingByOrder){const a=await returnAccount(db,id,cutoff);const remaining=Math.min(amount,Math.max(0,a.balance));if(remaining>0){pendingCount++;pendingAmount+=remaining;}}
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
      credit: Number((await db.select({n:sql<number>`coalesce(sum(${posReturns.total}),0)`}).from(posReturns).where(eq(posReturns.receivedShiftId,s.id)))[0]?.n||0),
      refundedCash: Number((await db.select({n:sql<number>`coalesce(sum(${posRefunds.amount}),0)`}).from(posRefunds).where(and(eq(posRefunds.shiftId,s.id),eq(posRefunds.method,'cash'))))[0]?.n||0),
      refundedTransfer: Number((await db.select({n:sql<number>`coalesce(sum(${posRefunds.amount}),0)`}).from(posRefunds).where(and(eq(posRefunds.shiftId,s.id),eq(posRefunds.method,'transfer'))))[0]?.n||0),
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
    cashSales: drawer.cashSales,
    cashCod: drawer.cashCod,
    expectedCash: s.openingCash + cash + drawer.manualNet,
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
  const key = posKey(b.key),
    shiftId = posText(b.shiftId),
    mode = flow ? (flow === 'prepaid' ? 'delivery' : 'counter') : b.fulfillmentMode === 'cod' ? 'cod' : 'counter',
    method = b.method === 'cash' ? 'cash' : b.method === 'transfer' ? 'transfer' : null;
  const depositAmount = flow ? 0 : posMoney(b.depositAmount ?? 0, 'Tiền thu trước COD');
  if (depositAmount > 0 && mode !== 'cod') throw new AppError(400, 'Thu trước chỉ áp dụng cho đơn giao COD.');
  if (depositAmount > 0 && !method) throw new AppError(400, 'Chọn hình thức thu trước COD.');
  if (depositAmount > 0 && method === 'transfer' && b.confirmed !== true)
    throw new AppError(400, 'Xác nhận cửa hàng đã thực nhận tiền chuyển khoản thu trước.');
  const requestHash = sha256Hex(JSON.stringify({ ...emptyCart(b), fulfillmentMode: mode, method, ...(depositAmount ? { depositAmount } : {}), ...(flow ? { saleFlow: flow, initialAmount: b.initialAmount ?? null, confirmed: b.confirmed === true, delivery: b.delivery ?? null } : {}) }));
  if (!method && mode !== 'cod') throw new AppError(400, 'Chọn tiền mặt hoặc chuyển khoản.');
  if (method === 'transfer' && b.confirmed !== true && mode !== 'cod' && !flow)
    throw new AppError(400, 'Nhân viên cần xác nhận đã thực nhận chuyển khoản.');
  return env.db.transaction(async (tx) => {
    await cashLock(tx);
    const s = await shiftOf(tx, m, shiftId, true);
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
    const initialAmount = flow ? flowInitialAmount(flow, c.total, b.initialAmount) : 0;
    const receivedInitial = flow && (method === 'cash' || b.confirmed === true) ? initialAmount : 0;
    if (flow && (c.exchange.amount || b.paymentRequestId)) throw new AppError(400, 'Đơn cọc/trả trước không dùng QR hoặc tín dụng giỏ đang thanh toán.');
    if (c.exchange.amount && mode === 'cod') throw new AppError(400, 'Đổi hàng thanh toán tại quầy, không chuyển COD.');
    if (depositAmount > c.total) throw new AppError(400, 'Tiền thu trước không được vượt tổng đơn.');
    if (c.total === 0 && mode === 'cod') throw new AppError(400, 'Đơn COD phải có số tiền cần thu.');
    await assertOpening(tx, c.register.warehouseId);
    let qr: typeof posPaymentRequests.$inferSelect | undefined;
    if (b.paymentRequestId) {
      [qr] = await tx
        .select()
        .from(posPaymentRequests)
        .where(and(eq(posPaymentRequests.id, posText(b.paymentRequestId)), eq(posPaymentRequests.shiftId, s.id)))
        .for('update');
      if (
        !qr ||
        (qr.expiresAt < posNow() && !qr.confirmedAt) ||
        qr.fingerprint !== c.fingerprint ||
        qr.amount !== c.payable ||
        method !== 'transfer' ||
        mode === 'cod'
      )
        throw new AppError(409, 'Yêu cầu QR hết hạn hoặc giỏ/giá đã đổi. Tạo QR mới.');
    }
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('stock_holds'))`);
    const skus = c.lines.map((l) => l.sku).sort();
    const balances = await tx
      .select()
      .from(stockBalances)
      .where(and(eq(stockBalances.warehouseId, c.register.warehouseId), inArray(stockBalances.sku, skus)))
      .orderBy(asc(stockBalances.sku))
      .for('update');
    const reserved = await reservedBySku(tx, skus, c.register.warehouseId);
    for (const l of c.lines) {
      const available = (balances.find((x) => x.sku === l.sku)?.qty ?? 0) - (reserved.get(l.sku) ?? 0);
      if (l.qty > available + 1e-9)
        throw new AppError(409, `${l.name}: chỉ còn khả dụng ${Math.max(0, available)}.`, 'POS_STOCK_SHORT');
    }
    const tendered = flow ? receivedInitial : mode === 'cod' ? depositAmount : method === 'cash' ? posMoney(b.tendered, 'Tiền khách đưa') : c.payable;
    if (!flow && mode === 'counter' && tendered < c.payable) throw new AppError(400, 'Tiền khách đưa chưa đủ.');
    const now = posNow(),
      date = vietnamDate().iso;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'pos-number:' + date}))`);
    const numbers = await tx
      .select({ no: salesOrders.orderNo })
      .from(salesOrders)
      .where(sql`${salesOrders.orderNo} like ${'POS_' + date.replaceAll('-', '') + '_%'}`);
    const id = crypto.randomUUID(),
      orderNo = nextDocNo(
        'POS',
        date,
        numbers.map((x) => x.no),
      );
    const snapshot = {
      register: c.register,
      customer: c.customer?.name ?? 'Khách lẻ',
      note: c.note,
      lines: c.lines,
      fees: c.fees,
      subtotal: c.subtotal,
      tax: c.tax,
      discount: c.discount,
      total: c.total,
      method: flow || (mode === 'cod' ? 'cod' : method),
      ...(flow ? { saleFlow: flow, initialAmount, receivedAmount: receivedInitial, remaining: c.total - receivedInitial, paymentMethod: method, pendingTransfer: method === 'transfer' && !receivedInitial, holdUntil: flowHoldUntil(now, flow === 'prepaid' && receivedInitial === c.total) } : {}),
      ...(depositAmount ? { depositAmount, depositMethod: method, codAmount: c.total - depositAmount, codDeliveryId: '' } : {}),
      tendered,
      change: !flow && mode === 'counter' ? tendered - c.payable : 0,
      ...(c.exchange.amount ? { exchangeCredit: c.exchange.amount, payable: c.payable } : {}),
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
      await tx.update(deliveries).set({ codAmount: c.total - depositAmount }).where(eq(deliveries.id, d.id));
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
