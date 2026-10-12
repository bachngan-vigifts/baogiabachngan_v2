import { cleanOrderInput } from '../domain/order-input.ts';
import { and, asc, count, desc, eq, gte, inArray, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import { foldSql, matchAllWords, paging } from '../../../core/text/fold.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { customers, customerStaff } from '../../customers/schema.ts';
import { quotations } from '../../quotes/schema.ts';
import { quoteSaveHooks } from '../../quotes/api/routes.ts';
import { employees } from '../../staff/schema.ts';
import { notify, notifyMany } from '../../notifications/api/routes.ts';
import { quotationScope, type SqlScope } from '../../quotes/domain/access.ts';
import { contractCounters } from '../../contracts/schema.ts';
import { customerPayments, deliveries, deliveryLines, paymentSchedules, salesContracts, salesOrderLines, salesOrders, packingSlipLines, packingSlips } from '../schema.ts';
import { recordMovements, removeMovements } from '../../catalog/api/product-history.ts';
import { docRef } from '../domain/doc-ref.ts';
import { progressOf } from './progress.ts';
import { closeSlipsOfDeliveredOrders } from './packing-close.ts';
import { DEFAULT_SAPO_BASE } from '../../integrations/api/sapo-client.ts';
import { prepareSapoPush, sapoLocationOf, sapoPreview, sapoPushRequired, wantsSapoPush, type SapoPushOutcome } from './sapo-push.ts';
import { amendmentLines, amendmentSchedules } from '../domain/amendments.ts';
import { CONTRACT_STATUSES, DELIVERY_STATUSES, PAYMENT_METHODS } from '../domain/statuses.ts';
import {
  addDays, compactCode, contractNumber, debtCounts, contractSchedules, legalCode, nextDocNo, orderLinesFromQuote, orderStatusFromLines,
  orderTotals, receivable, vietnamDate, type OrderStatus,
} from '../domain/sales.ts';

type Ctx = RouteContext<StaffEnv>;
type Tx = Parameters<Parameters<StaffEnv['db']['transaction']>[0]>[0];
const viewer = (c: Ctx) => (c.state.session as SessionState).member;
const nowIso = () => new Date().toISOString();
const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z'));
const text = (v: unknown, max = 500) => { if (v !== undefined && v !== null && typeof v !== 'string') throw new AppError(400, 'Dữ liệu không hợp lệ.'); return String(v ?? '').trim().slice(0, max); };
const money = (v: unknown, what: string) => { const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > 1e13) throw new AppError(400, `${what} không hợp lệ.`); return Math.round(n); };

/** Kế toán (chức vụ `accounting`): xem mọi đơn / HĐKT để nhập số hoá đơn, theo dõi công nợ. */
export const isAccountant = (m: { role: string; positionId?: string | null }) => m.role === 'employee' && m.positionId === 'accounting';
/** Ai nhập được số hoá đơn: Manager và Kế toán. */
export const canIssueInvoice = (m: { role: string; positionId?: string | null }) => m.role === 'manager' || isAccountant(m);
/**
 * Ai thấy đơn: Manager và Kế toán thấy tất cả; nhân viên thấy đơn mình phụ trách hoặc mình tạo, và mọi đơn của khách hàng
 * mình phụ trách / được chia sẻ (`customer_staff`). Mọi bảng con theo quyền của đơn.
 */
export const orderScopeFor = (m: { id: string; role: string; positionId?: string | null }): SQL | undefined => m.role === 'manager' || isAccountant(m) ? undefined
  : or(eq(salesOrders.ownerId, m.id), eq(salesOrders.createdBy, m.id),
    sql`EXISTS (SELECT 1 FROM ${customerStaff} WHERE ${customerStaff.customerId} = ${salesOrders.customerId} AND ${customerStaff.memberId} = ${m.id})`);
const orderScope = (c: Ctx): SQL | undefined => orderScopeFor(viewer(c));
/** Lịch giao hàng: nhóm Kho (chức vụ `warehouse`) xem và đổi trạng thái mọi chuyến giao (không xem được đơn / công nợ). */
const deliveryScope = (c: Ctx): SQL | undefined => { const m = viewer(c); return m.role === 'employee' && m.positionId === 'warehouse' ? undefined : orderScope(c); };
const quotePredicate = (scope: SqlScope) => {
  const parts = scope.sql.replace(/\bq\./g, 'staff_quotations.').split('?');
  return sql.join(parts.flatMap((p, i) => i < scope.bindings.length ? [sql.raw(p), sql`${scope.bindings[i]}`] : [sql.raw(p)]), sql.raw(''));
};
async function loadOrder(c: Ctx, id: string, db: StaffEnv['db'] | Tx = c.env.db) {
  const [order] = await db.select().from(salesOrders).where(and(eq(salesOrders.id, id), orderScope(c))).limit(1);
  if (!order) throw new AppError(404, 'Không tìm thấy đơn hàng / HĐKT.');
  return order;
}
async function receivableOf(db: StaffEnv['db'] | Tx, orderIds: string[]) {
  if (!orderIds.length) return new Map<string, ReturnType<typeof receivable>>();
  const [sch, pay] = await Promise.all([
    db.select().from(paymentSchedules).where(inArray(paymentSchedules.orderId, orderIds)),
    db.select().from(customerPayments).where(inArray(customerPayments.orderId, orderIds)),
  ]);
  const today = vietnamDate().iso;
  return new Map(orderIds.map(id => [id, receivable(sch.filter(s => s.orderId === id), pay.filter(p => p.orderId === id), today)]));
}
/** Lịch sử sản phẩm: các dòng (có mã hàng) của đơn đã xác nhận → biến động "Bán" (khoá `sale:<đơn>:<dòng>`). */
export async function recordSaleMovements(db: StaffEnv['db'] | Tx, orderId: string) {
  const [order] = await db.select().from(salesOrders).where(eq(salesOrders.id, orderId)).limit(1);
  if (!order || order.status === 'draft' || order.status === 'cancelled') return;
  const lines = await db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, orderId));
  const ref = docRef(orderId, order.orderNo, (await contractNosOf(db, [orderId])).get(orderId));
  await recordMovements(db, lines.map(l => ({ refKey: `sale:${orderId}:${l.id}`, sku: l.sku, kind: 'sale', name: l.name, qty: l.qty, unit: l.unit, unitPrice: l.unitPrice,
    partner: order.customerName, refCode: ref.no, link: ref.link, status: 'Đã xác nhận', occurredAt: order.createdAt })));
}
/** Ghi ngày giao dự kiến mới cho đơn; đơn do khách đặt thì báo khách ngày mới. */
async function setExpectedDeliveryDate(c: Ctx, order: typeof salesOrders.$inferSelect, date: string) {
  if (order.expectedDeliveryDate === date || (order.status !== 'draft' && viewer(c).role !== 'manager')) return;
  await c.env.db.update(salesOrders).set({ expectedDeliveryDate: date, updatedAt: nowIso(), revision: sql`${salesOrders.revision} + 1` }).where(eq(salesOrders.id, order.id));
  const [by] = await c.env.db.select({ role: employees.role }).from(employees).where(eq(employees.id, order.createdBy)).limit(1);
  if (by?.role === 'customer') await notify(c.env, { eventType: 'order_delivery_date', targetMemberId: order.createdBy, actorId: viewer(c).id, title: 'Đổi ngày giao dự kiến',
    body: `${docRef(order.id, order.orderNo, (await contractNosOf(c.env.db, [order.id])).get(order.id)).Label}: giao dự kiến ${date.split('-').reverse().join('/')}`, url: '/customer.html#orders', data: { orderId: order.id, date } });
}
/** Cập nhật trạng thái đơn theo số đã giao; khi giao xong thì kỳ "còn lại" chưa có hạn được đặt hạn = ngày giao xong + số ngày thanh toán. */
async function refreshOrderStatus(tx: Tx, orderId: string, deliveredOn: string | null) {
  const [order] = await tx.select().from(salesOrders).where(eq(salesOrders.id, orderId)).limit(1);
  const lines = await tx.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, orderId));
  const status = orderStatusFromLines(order!.status as OrderStatus, lines);
  if (status !== order!.status) await tx.update(salesOrders).set({ status, updatedAt: nowIso() }).where(eq(salesOrders.id, orderId));
  // Giao xong mà chưa ai yêu cầu xuất hoá đơn → tự yêu cầu (sinh việc cho nhóm Kế toán).
  if (status === 'delivered' && order!.invoiceStatus === 'none')
    await tx.update(salesOrders).set({ invoiceStatus: 'requested', invoiceRequestedAt: nowIso(), invoiceRequestedBy: null, invoiceRequestNote: 'Tự động: đơn đã giao xong.', invoiceEmail: order!.invoiceEmail || order!.email, invoiceMode: 'issue' }).where(eq(salesOrders.id, orderId));
  // Giao xong → phiếu đóng gói còn treo của đơn tự hoàn tất.
  if (status === 'delivered') await closeSlipsOfDeliveredOrders(tx, [orderId]);
  if (status === 'delivered' && deliveredOn) {
    const [contract] = await tx.select().from(salesContracts).where(eq(salesContracts.orderId, orderId)).limit(1);
    await tx.update(paymentSchedules).set({ dueDate: addDays(deliveredOn, contract?.paymentDays ?? 0) })
      .where(and(eq(paymentSchedules.orderId, orderId), eq(paymentSchedules.kind, 'balance'), sql`${paymentSchedules.dueDate} IS NULL`));
  }
}

/** Số HĐKT của các bản ghi (bản ghi có HĐKT là HĐKT, không phải đơn hàng – xem domain/doc-ref.ts). */
export async function contractNosOf(db: StaffEnv['db'] | Tx, orderIds: string[]) {
  const ids = [...new Set(orderIds)];
  const rows = ids.length ? await db.select({ orderId: salesContracts.orderId, no: salesContracts.contractNo }).from(salesContracts).where(inArray(salesContracts.orderId, ids)) : [];
  return new Map(rows.map(r => [r.orderId, r.no]));
}
type QuoteRow = typeof quotations.$inferSelect;
/** Mã khách dùng trong số HĐKT: mã KH trong danh bạ, không có thì MST trên báo giá / danh bạ. */
async function contractCustomerCode(db: StaffEnv['db'] | Tx, quote: QuoteRow) {
  const data = JSON.parse(quote.data);
  const [cust] = data.customerId ? await db.select().from(customers).where(eq(customers.id, String(data.customerId))).limit(1) : [];
  return compactCode(cust?.customerCode || data.customerTaxCode || cust?.taxCode);
}
/**
 * Tạo đơn đặt hàng từ một báo giá (dùng chung cho nhân viên và trang khách hàng). Mỗi báo giá chỉ một đơn đang hiệu lực
 * (409 ORDER_EXISTS). `status`: nhân viên tạo = 'confirmed'; khách đặt hàng = 'draft' (chờ nhân viên phụ trách xác nhận).
 */
export async function createOrderFromQuote(db: StaffEnv['db'], quote: QuoteRow, o: { createdBy: string; status: 'confirmed' | 'draft'; note?: string; deliveryDate?: string | null; orderDate?: string; deliveryAddress?: string;
  /** Chạy cuối giao dịch tạo đơn (vd. đẩy đơn sang Sapo); lỗi → huỷ, không có đơn. */
  inTx?: (tx: Tx, orderId: string) => Promise<void> }) {
  const [existing] = await db.select({ id: salesOrders.id, orderNo: salesOrders.orderNo }).from(salesOrders)
    .where(and(eq(salesOrders.quoteId, quote.id), ne(salesOrders.status, 'cancelled'))).limit(1);
  if (existing) {
    const [k] = await db.select({ no: salesContracts.contractNo }).from(salesContracts).where(eq(salesContracts.orderId, existing.id)).limit(1);
    throw new AppError(409, k ? `Báo giá này đã có HĐKT ${k.no}.` : `Báo giá này đã có đơn hàng ${existing.orderNo}.`, 'ORDER_EXISTS');
  }
  const data = JSON.parse(quote.data), lines = orderLinesFromQuote(data);
  if (!lines.length) throw new AppError(400, 'Báo giá chưa có dòng sản phẩm nào có số lượng.');
  const t = orderTotals(lines), today = vietnamDate().iso, now = nowIso(), id = crypto.randomUUID();
  const [cust] = data.customerId ? await db.select({ id: customers.id, name: customers.name, approvalStatus: customers.approvalStatus }).from(customers).where(eq(customers.id, data.customerId)).limit(1) : [];
  // Khách mới do nhân viên tạo phải được Manager duyệt mới đặt hàng được.
  if (cust?.approvalStatus === 'pending') throw new AppError(409, `Khách hàng "${cust.name}" đang chờ Manager duyệt, chưa tạo đơn được.`, 'CUSTOMER_PENDING');
  const customerId = cust ? cust.id : null;
  await db.transaction(async tx => {
    const used = (await tx.select({ n: salesOrders.orderNo }).from(salesOrders).where(sql`${salesOrders.orderNo} LIKE ${'DH_' + today.replaceAll('-', '') + '_%'}`)).map(r => r.n);
    await tx.insert(salesOrders).values({
      id, orderNo: nextDocNo('DH', today, used), quoteId: quote.id, quoteNo: quote.quoteNo, quoteType: quote.quoteType, customerId,
      customerName: text(data.customer) || quote.customer, contact: text(data.contact), phone: text(data.phone, 100), email: text(data.email, 254),
      taxCode: text(data.customerTaxCode, 100), address: o.deliveryAddress === undefined ? text(data.customerAddress, 2000) : text(o.deliveryAddress, 2000),
      ownerId: quote.assigneeId ?? quote.creatorId, createdBy: o.createdBy, orderDate: o.orderDate ?? today,
      expectedDeliveryDate: o.deliveryDate === null ? null : isDate(o.deliveryDate) ? o.deliveryDate : isDate(data.deliveryDate) ? data.deliveryDate : null, status: o.status, ...t, note: text(o.note ?? data.notes, 20000), createdAt: now, updatedAt: now,
    });
    await tx.insert(salesOrderLines).values(lines.map(l => ({ id: crypto.randomUUID(), orderId: id, ...l })));
    // Chưa có HĐKT: phải thu toàn bộ, hạn khi giao xong.
    await tx.insert(paymentSchedules).values({ id: crypto.randomUUID(), orderId: id, kind: 'balance', amount: t.total, dueDate: null, note: 'Thanh toán khi giao hàng', createdAt: now });
    // Khách chưa có nhân viên phụ trách: người phụ trách đơn đầu tiên thành người phụ trách khách.
    if (customerId) await tx.execute(sql`INSERT INTO ${customerStaff} (customer_id, member_id, role, created_by, created_at)
      SELECT ${customerId}, ${quote.assigneeId ?? quote.creatorId}, 'owner', ${o.createdBy}, ${now}
      WHERE NOT EXISTS (SELECT 1 FROM ${customerStaff} WHERE ${customerStaff.customerId} = ${customerId} AND ${customerStaff.role} = 'owner')
        AND EXISTS (SELECT 1 FROM ${employees} WHERE ${employees.id} = ${quote.assigneeId ?? quote.creatorId} AND ${employees.role} IN ('employee', 'manager'))
      ON CONFLICT DO NOTHING`);
    if (o.inTx) await o.inTx(tx, id);
  });
  if (o.status === 'confirmed') await recordSaleMovements(db, id);
  return id;
}

/** Nhân viên sửa khi còn nháp; Manager được sửa cả chứng từ đã duyệt. Đồng bộ trong giao dịch lưu báo giá. */
async function linkedOrder(tx: Tx, quoteId: string) {
  const [order] = await tx.select().from(salesOrders).where(and(eq(salesOrders.quoteId, quoteId), ne(salesOrders.status, 'cancelled'))).limit(1).for('update');
  return order ?? null;
}
export async function syncDraftOrderFromQuote(tx: Tx, quote: QuoteRow, member: { role: string }) {
  const order = await linkedOrder(tx, quote.id);
  if (!order || (order.status !== 'draft' && member.role !== 'manager')) return;
  const data = JSON.parse(quote.data), lines = orderLinesFromQuote(data);
  if (!lines.length) throw new AppError(400, `Báo giá đã sinh ${docRef(order.id, order.orderNo, (await contractNosOf(tx, [order.id])).get(order.id)).label}: phải còn ít nhất một dòng có số lượng.`);
  const t = orderTotals(lines), now = nowIso();
  const oldLines = await tx.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, order.id));
  const links = await tx.select({ id: deliveryLines.orderLineId, qty: deliveryLines.qty, status: deliveries.status })
    .from(deliveryLines).innerJoin(deliveries, eq(deliveries.id, deliveryLines.deliveryId)).where(eq(deliveries.orderId, order.id));
  const packed = oldLines.length ? await tx.select({ id: packingSlipLines.orderLineId }).from(packingSlipLines)
    .where(inArray(packingSlipLines.orderLineId, oldLines.map(l => l.id))) : [];
  const reserved = new Map<string, number>();
  for (const l of links) if (l.status !== 'cancelled') reserved.set(l.id, (reserved.get(l.id) || 0) + l.qty);
  let plan: ReturnType<typeof amendmentLines>;
  try { plan = amendmentLines(oldLines, lines, reserved, new Set([...links, ...packed].map(l => l.id))); }
  catch (e) { throw new AppError(409, (e as Error).message, 'ORDER_LINE_IN_USE'); }
  // Tạm chuyển thứ tự để sắp xếp lại không đụng unique (order_id, line_no).
  for (const l of oldLines) await tx.update(salesOrderLines).set({ lineNo: -l.lineNo }).where(eq(salesOrderLines.id, l.id));
  for (const l of plan.remove) await tx.delete(salesOrderLines).where(eq(salesOrderLines.id, l.id));
  for (const l of plan.updates) {
    const { id, ...values } = l;
    if (id) await tx.update(salesOrderLines).set(values).where(eq(salesOrderLines.id, id));
    else await tx.insert(salesOrderLines).values({ id: crypto.randomUUID(), orderId: order.id, ...values });
  }
  await tx.update(salesOrders).set({ ...t, quoteNo: quote.quoteNo, quoteType: quote.quoteType,
    customerName: text(data.customer) || quote.customer, contact: text(data.contact), phone: text(data.phone, 100), email: text(data.email, 254),
    taxCode: text(data.customerTaxCode, 100), address: text(data.customerAddress, 2000),
    ...(isDate(data.deliveryDate) ? { expectedDeliveryDate: data.deliveryDate } : {}), updatedAt: now, revision: sql`${salesOrders.revision} + 1` }).where(eq(salesOrders.id, order.id));
  const [k] = await tx.select().from(salesContracts).where(and(eq(salesContracts.orderId, order.id), ne(salesContracts.status, 'cancelled'))).limit(1).for('update');
  if (k) {
    // Các đoạn Word đã sửa dựa trên hàng / tổng cũ không được che dữ liệu báo giá mới.
    const doc = JSON.parse(k.data);
    if (doc.edits && Object.values(doc.edits).some(v => Array.isArray(v) && v.length)) {
      doc.editHistory = [...(Array.isArray(doc.editHistory) ? doc.editHistory : []), { quoteRevision: quote.revision, savedAt: now, edits: doc.edits }].slice(-10);
      delete doc.edits;
    }
    await tx.update(salesContracts).set({ value: t.total, depositAmount: Math.round(t.total * k.depositRate / 100), data: JSON.stringify(doc), updatedAt: now, revision: sql`${salesContracts.revision} + 1` }).where(eq(salesContracts.id, k.id));
  }
  await syncPaymentSchedules(tx, { ...order, ...t, status: orderStatusFromLines(order.status, plan.updates) }, k);
  if (order.status !== 'draft') {
    await refreshOrderStatus(tx, order.id, null);
    await removeMovements(tx, `sale:${order.id}:`);
    await recordSaleMovements(tx, order.id);
  }
}
/** Không nhân đôi kỳ đã thu; giữ liên kết phiếu thu và tính lại hạn phần còn lại khi đã giao xong. */
async function syncPaymentSchedules(tx: Tx, order: typeof salesOrders.$inferSelect, contract?: typeof salesContracts.$inferSelect) {
  const schedules = await tx.select().from(paymentSchedules).where(eq(paymentSchedules.orderId, order.id));
  const payments = await tx.select({ id: customerPayments.scheduleId }).from(customerPayments).where(eq(customerPayments.orderId, order.id));
  const plans = contract ? contractSchedules(order.total, contract.depositRate, contract.signedDate || vietnamDate().iso)
    : [{ kind: 'balance' as const, amount: order.total, dueDate: null as string | null, note: 'Thanh toán khi giao hàng' }];
  const [latest] = await tx.select({ date: deliveries.deliveredAt }).from(deliveries)
    .where(and(eq(deliveries.orderId, order.id), eq(deliveries.status, 'delivered'))).orderBy(desc(deliveries.deliveredAt)).limit(1);
  if (order.status === 'delivered' && latest?.date) for (const p of plans) if (p.kind === 'balance') p.dueDate = addDays(latest.date, contract?.paymentDays ?? 0);
  const plan = amendmentSchedules(schedules, plans, new Set(payments.map(p => p.id).filter((id): id is string => !!id)));
  for (const id of plan.remove) await tx.delete(paymentSchedules).where(eq(paymentSchedules.id, id));
  for (const item of plan.updates) {
    const { id, ...values } = item;
    if (id) await tx.update(paymentSchedules).set({ ...values, contractId: contract?.id ?? null }).where(eq(paymentSchedules.id, id));
    else await tx.insert(paymentSchedules).values({ id: crypto.randomUUID(), orderId: order.id, contractId: contract?.id ?? null, ...values, createdAt: nowIso() });
  }
}
quoteSaveHooks.beforeSave.push(async (tx, old, member) => {
  const order = await linkedOrder(tx, old.id);
  if (order && order.status !== 'draft' && member.role !== 'manager') throw new AppError(409, `${docRef(order.id, order.orderNo, (await contractNosOf(tx, [order.id])).get(order.id)).Label} đã duyệt. Chỉ Manager được sửa báo giá và cập nhật chứng từ liên quan.`, 'ORDER_APPROVED');
});
quoteSaveHooks.afterSave.push(syncDraftOrderFromQuote);

export function registerSalesRoutes(router: Router<StaffEnv>) {
  // ================= ĐƠN ĐẶT HÀNG =================
  router.get('/orders', async c => {
    const q = c.url.searchParams.get('q'), status = c.url.searchParams.get('status') || '', flow = c.url.searchParams.get('flow') || '';
    const invoice = c.url.searchParams.get('invoice') || '';
    const { limit, offset } = paging(c.url, 200, 500);
    const where = and(
      orderScope(c),
      status ? eq(salesOrders.status, status as OrderStatus) : undefined,
      // Đơn hàng và HĐKT là 2 luồng song song: trang Đơn hàng (flow=order) chỉ hiện đơn KHÔNG có HĐKT (khách đã có HĐ nguyên tắc).
      flow === 'order' ? sql`NOT EXISTS (SELECT 1 FROM ${salesContracts} WHERE ${salesContracts.orderId} = ${salesOrders.id})` : undefined,
      invoice === 'requested' || invoice === 'issued' || invoice === 'none' ? eq(salesOrders.invoiceStatus, invoice) : undefined,
      matchAllWords(foldSql(salesOrders.orderNo, salesOrders.quoteNo, salesOrders.customerName, salesOrders.phone), q),
    );
    const [[{ n: total = 0 } = {}], rows] = await Promise.all([
      c.env.db.select({ n: count() }).from(salesOrders).where(where),
      c.env.db.select().from(salesOrders).where(where).orderBy(desc(salesOrders.orderDate), desc(salesOrders.createdAt), desc(salesOrders.id)).limit(limit).offset(offset),
    ]);
    const ids = rows.map(r => r.id);
    const [debts, contracts] = await Promise.all([
      receivableOf(c.env.db, ids),
      ids.length ? c.env.db.select({ orderId: salesContracts.orderId, id: salesContracts.id, contractNo: salesContracts.contractNo, status: salesContracts.status }).from(salesContracts).where(inArray(salesContracts.orderId, ids)) : [],
    ]);
    return json({ orders: rows.map(r => { const contract = contracts.find(x => x.orderId === r.id) ?? null;
      // debtCounts = false (đơn chờ xác nhận chưa ký HĐKT / đã huỷ): chưa phát sinh công nợ.
      return { ...r, receivable: debts.get(r.id), debtCounts: debtCounts(r.status, contract?.status), contract }; }), total: Number(total), limit, offset });
  }, 'business');

  /** Hồ sơ đang hiệu lực của báo giá: dùng ID chính xác, giữ nguyên quyền xem đơn. */
  router.get('/orders/by-quote/:quoteId', async c => {
    const [order] = await c.env.db.select({
      id: salesOrders.id, orderNo: salesOrders.orderNo, contractNo: salesContracts.contractNo,
    }).from(salesOrders).leftJoin(salesContracts, eq(salesContracts.orderId, salesOrders.id))
      .where(and(eq(salesOrders.quoteId, c.params.quoteId!), ne(salesOrders.status, 'cancelled'), orderScope(c))).limit(1);
    return json({ order: order ?? null });
  }, 'business');

  // The form checks capabilities so a UI deploy cannot silently lose notes on an older API.
  router.get('/orders/create-config', async () => json({ version: 1, noteMaxLength: 20000 }), 'business');

  router.get('/orders/:id', async c => {
    const db = c.env.db, order = await loadOrder(c, c.params.id!);
    const [lines, contract, ships, schedules, payments] = await Promise.all([
      db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, order.id)).orderBy(asc(salesOrderLines.lineNo)),
      db.select().from(salesContracts).where(eq(salesContracts.orderId, order.id)).limit(1),
      db.select().from(deliveries).where(eq(deliveries.orderId, order.id)).orderBy(asc(deliveries.plannedDate)),
      db.select().from(paymentSchedules).where(eq(paymentSchedules.orderId, order.id)).orderBy(asc(paymentSchedules.dueDate)),
      db.select().from(customerPayments).where(eq(customerPayments.orderId, order.id)).orderBy(asc(customerPayments.paidAt)),
    ]);
    const shipLines = ships.length ? await db.select().from(deliveryLines).where(inArray(deliveryLines.deliveryId, ships.map(s => s.id))) : [];
    // Cho bản in đơn đặt hàng: mã khách hàng, người phụ trách, người soạn.
    const [cust] = order.customerId ? await db.select({ code: customers.customerCode, email: customers.email }).from(customers).where(eq(customers.id, order.customerId)).limit(1) : [];
    const people = await db.select({ id: employees.id, name: employees.name, phone: employees.phone, role: employees.role }).from(employees)
      .where(inArray(employees.id, [order.ownerId, order.createdBy, order.invoiceRequestedBy, order.invoiceIssuedBy].filter((x): x is string => !!x)));
    const person = (id: string) => people.find(p => p.id === id);
    return json({
      order: { ...order, customerCode: cust?.code ?? '', customerEmail: cust?.email ?? '', ownerName: person(order.ownerId)?.name ?? '', ownerPhone: person(order.ownerId)?.phone ?? '',
        createdByName: person(order.createdBy)?.name ?? '', createdByCustomer: person(order.createdBy)?.role === 'customer',
        invoiceRequestedByName: order.invoiceRequestedBy ? person(order.invoiceRequestedBy)?.name ?? '' : '', invoiceIssuedByName: order.invoiceIssuedBy ? person(order.invoiceIssuedBy)?.name ?? '' : '',
        canIssueInvoice: canIssueInvoice(viewer(c)),
        // Đơn Sapo đã đẩy (mã đang giữ chỗ "pending:…" khi đang đẩy thì chưa tính).
        sapoOrderCode: order.sapoOrderId ? order.sapoOrderCode : null,
        sapoOrderUrl: order.sapoOrderId ? `${(c.env.sapoAdminBase || DEFAULT_SAPO_BASE).replace(/\/+$/, '')}/orders/${encodeURIComponent(order.sapoOrderId)}` : '' }, lines, contract: contract[0] ? { ...contract[0], canEditFinancial: viewer(c).role === 'manager', canEdit: viewer(c).role === 'manager' || order.status === 'draft', data: JSON.parse(contract[0].data) } : null,
      deliveries: ships.map(s => ({ ...s, lines: shipLines.filter(l => l.deliveryId === s.id) })),
      schedules, payments, receivable: receivable(schedules, payments, vietnamDate().iso),
      progress: (await progressOf(db, [order.id])).get(order.id),
    });
  }, 'business');

  /**
   * Xem trước đẩy Sapo cho popup chọn kho: `?quoteId=` (trước khi sinh đơn) hoặc `?orderId=` (trước khi lập HĐKT).
   * Trả kho Sapo, NV phụ trách trên Sapo, lỗi dữ liệu; đơn đã có trên Sapo thì trả `pushed`.
   */
  router.get('/sapo/preview', async c => {
    const p = c.url.searchParams, me = viewer(c);
    if (p.get('orderId')) {
      const o = await loadOrder(c, p.get('orderId')!);
      if (o.sapoOrderId) return json({ pushed: { code: o.sapoOrderCode, url: `${(c.env.sapoAdminBase || DEFAULT_SAPO_BASE).replace(/\/+$/, '')}/orders/${encodeURIComponent(o.sapoOrderId)}` }, required: sapoPushRequired(c) });
      const lines = await c.env.db.select({ sku: salesOrderLines.sku }).from(salesOrderLines).where(eq(salesOrderLines.orderId, o.id));
      return json(await sapoPreview(c, { code: o.quoteNo || o.orderNo, ownerId: o.ownerId, lines: lines.map(l => ({ sku: l.sku.trim() })), customerName: o.customerName }));
    }
    const [quote] = await c.env.db.select().from(quotations).where(and(eq(quotations.id, text(p.get('quoteId'), 80)), quotePredicate(quotationScope(me)))).limit(1);
    if (!quote) throw new AppError(404, 'Không tìm thấy báo giá.');
    const data = JSON.parse(quote.data);
    return json(await sapoPreview(c, { code: quote.quoteNo, ownerId: quote.assigneeId ?? quote.creatorId, lines: orderLinesFromQuote(data).map(l => ({ sku: String(l.sku ?? '').trim() })), customerName: text(data.customer) || quote.customer }));
  }, 'business');

  /** Tạo đơn từ báo giá (người xem được báo giá mới tạo được). Mỗi báo giá một đơn đang hiệu lực. */
  router.post('/orders', async c => {
    const body = await readJson(c.req, 128_000), me = viewer(c), quoteId = text(body.quoteId, 80);
    const [quote] = await c.env.db.select().from(quotations).where(and(eq(quotations.id, quoteId), quotePredicate(quotationScope(me)))).limit(1);
    if (!quote) throw new AppError(404, 'Không tìm thấy báo giá.');
    if (quote.approvalStatus !== 'approved') throw new AppError(409, 'Báo giá chưa được duyệt. Chỉ báo giá đã duyệt mới tạo được đơn hàng.', 'QUOTE_NOT_APPROVED');
    const input = cleanOrderInput(body);
    // Đơn sinh từ báo giá luôn là NHÁP – kể cả Manager tạo – chờ Manager duyệt.
    // Có tạo đơn Sapo (mặc định): đẩy trong cùng giao dịch (Sapo lỗi → không tạo đơn); `pushSapo: false` → chỉ tạo đơn web. HĐKT là luồng riêng: POST /contracts { quoteId }.
    const push = wantsSapoPush(c, body) ? await prepareSapoPush(c, sapoLocationOf(body)) : null;
    let sapo: SapoPushOutcome = null;
    const id = await createOrderFromQuote(c.env.db, quote, { createdBy: me.id, status: 'draft', ...input,
      inTx: push ? async (tx, orderId) => { sapo = await push.push(tx, orderId); } : undefined }).finally(() => push?.done());
    const [o] = await c.env.db.select({ orderNo: salesOrders.orderNo, customerName: salesOrders.customerName, total: salesOrders.total }).from(salesOrders).where(eq(salesOrders.id, id)).limit(1);
    await notifyMany(c.env, 'managers', { eventType: 'order_pending', title: 'Đơn hàng mới chờ duyệt', body: `${me.name}: ${o!.orderNo} – ${o!.customerName} · ${new Intl.NumberFormat('vi-VN').format(o!.total)} đ`,
      url: `/index.html#/orders/${id}`, actorId: me.id, data: { orderId: id } });
    return json({ id, sapo }, 201);
  }, 'business');

  router.put('/orders/:id/status', async c => {
    const body = await readJson(c.req, 1_024), status = body.status;
    if (status !== 'cancelled' && status !== 'confirmed') throw new AppError(400, 'Chỉ đổi được sang "Đã xác nhận" hoặc "Huỷ".');
    const order = await loadOrder(c, c.params.id!);
    if (order.status !== 'draft' && viewer(c).role !== 'manager') throw new AppError(403, 'Đơn đã duyệt. Chỉ Manager được chỉnh sửa hoặc huỷ.', 'ORDER_APPROVED');
    if (status === 'cancelled') {
      const [paid] = await c.env.db.select({ n: sql<number>`count(*)` }).from(customerPayments).where(eq(customerPayments.orderId, order.id));
      const lines = await c.env.db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, order.id));
      if (Number(paid?.n) > 0 || lines.some(l => l.deliveredQty > 0)) throw new AppError(409, 'Đơn đã giao hoặc đã thu tiền, không huỷ được.');
    }
    if (status === 'confirmed' && viewer(c).role !== 'manager') throw new AppError(403, 'Chỉ Manager được duyệt đơn hàng / HĐKT.');
    if (status === 'confirmed' && order.status !== 'draft') throw new AppError(409, 'Chỉ duyệt được đơn đang chờ duyệt.');
    // Bước xác thực: nhân viên phải đánh dấu đã kiểm tra các thông tin quan trọng trước khi duyệt đơn.
    if (status === 'confirmed' && body.verified !== true) throw new AppError(400, 'Kiểm tra và đánh dấu đủ các thông tin quan trọng trước khi xác nhận đơn.', 'VERIFY_REQUIRED');
    await c.env.db.transaction(async tx => {
      await tx.update(salesOrders).set({ status, updatedAt: nowIso(), revision: sql`${salesOrders.revision} + 1` }).where(eq(salesOrders.id, order.id));
      // Khách đặt hàng thẳng (báo giá chưa duyệt): nhân viên xác nhận đơn = duyệt luôn báo giá của đơn.
      if (status === 'confirmed' && order.quoteId)
        await tx.update(quotations).set({ approvalStatus: 'approved', approvedAt: nowIso(), approvedBy: viewer(c).id })
          .where(and(eq(quotations.id, order.quoteId), eq(quotations.approvalStatus, 'pending')));
    });
    // Lịch sử sản phẩm: thêm "Bán" khi xác nhận, bỏ khi huỷ.
    if (status === 'confirmed') await recordSaleMovements(c.env.db, order.id);
    else await removeMovements(c.env.db, `sale:${order.id}:`);
    // Đơn khách đặt từ trang khách hàng: báo cho khách.
    const [by] = await c.env.db.select({ role: employees.role }).from(employees).where(eq(employees.id, order.createdBy)).limit(1);
    // Người phụ trách / người lập đơn (nhân viên) nhận thông báo đơn đã duyệt / bị huỷ.
    const ref = docRef(order.id, order.orderNo, (await contractNosOf(c.env.db, [order.id])).get(order.id)), what = ref.kind === 'contract' ? 'HĐKT' : 'Đơn hàng';
    await notifyMany(c.env, [order.ownerId, by?.role === 'customer' ? null : order.createdBy], { eventType: status === 'confirmed' ? 'order_approved' : 'order_cancelled',
      title: status === 'confirmed' ? `${what} đã được duyệt` : `${what} đã bị huỷ`, body: `${ref.no} – ${order.customerName} · ${viewer(c).name}`,
      url: `/index.html${ref.link}`, actorId: viewer(c).id, data: { orderId: order.id } });
    if (by?.role === 'customer') await notify(c.env, { eventType: status === 'confirmed' ? 'order_confirmed' : 'order_cancelled', targetMemberId: order.createdBy, actorId: viewer(c).id,
      title: status === 'confirmed' ? `${what} đã được xác nhận` : `${what} đã bị huỷ`, body: `${ref.no} · ${order.customerName}`, url: '/customer.html#orders', data: { orderId: order.id } });
    return json({ ok: true });
  }, 'business');

  /**
   * XOÁ HẲN đơn hàng / HĐKT ĐÃ HUỶ (chỉ Manager) – dọn danh sách. Không xoá được nếu đã thu tiền hoặc đã giao hàng
   * (chứng từ có tiền / hàng phải giữ). Xoá kèm dòng hàng, HĐKT, lịch thanh toán, chuyến giao, phiếu đóng gói, tiến trình.
   * Nhật ký thay đổi vẫn giữ (ai huỷ / xoá, lúc nào); báo giá gốc lập đơn / HĐKT lại được. Đơn nháp trên Sapo (nếu có) không bị xoá.
   */
  router.delete('/orders/:id', async c => {
    if (viewer(c).role !== 'manager') throw new AppError(403, 'Chỉ Manager được xoá đơn hàng / HĐKT.');
    const order = await loadOrder(c, c.params.id!);
    if (order.status !== 'cancelled') throw new AppError(409, 'Chỉ xoá được đơn hàng / HĐKT đã huỷ. Huỷ trước rồi xoá.', 'ORDER_NOT_CANCELLED');
    await c.env.db.transaction(async tx => {
      const [[paid], lines, [shipped]] = await Promise.all([
        tx.select({ n: count() }).from(customerPayments).where(eq(customerPayments.orderId, order.id)),
        tx.select({ deliveredQty: salesOrderLines.deliveredQty }).from(salesOrderLines).where(eq(salesOrderLines.orderId, order.id)),
        tx.select({ n: count() }).from(deliveries).where(and(eq(deliveries.orderId, order.id), eq(deliveries.status, 'delivered'))),
      ]);
      if (Number(paid?.n) > 0 || Number(shipped?.n) > 0 || lines.some(l => l.deliveredQty > 0))
        throw new AppError(409, 'Đơn / HĐKT đã thu tiền hoặc đã giao hàng, không xoá được (chứng từ cần giữ lại).', 'ORDER_HAS_HISTORY');
      // Thứ tự theo khoá ngoại: chứng từ con trước, đơn sau (dòng giao / dòng đóng gói / ảnh tự xoá theo phiếu).
      await tx.delete(packingSlips).where(eq(packingSlips.orderId, order.id));
      await tx.delete(deliveries).where(eq(deliveries.orderId, order.id));
      await tx.delete(paymentSchedules).where(eq(paymentSchedules.orderId, order.id));
      await tx.delete(salesContracts).where(eq(salesContracts.orderId, order.id));
      await tx.delete(salesOrders).where(eq(salesOrders.id, order.id));
    });
    await removeMovements(c.env.db, `sale:${order.id}:`);
    return json({ ok: true });
  }, 'business');

  // ================= XUẤT HOÁ ĐƠN =================
  /** Nhân viên phụ trách (người xem được đơn) yêu cầu xuất hoá đơn → sinh việc cho nhóm Kế toán. Giao xong thì tự yêu cầu. */
  router.post('/orders/:id/invoice-request', async c => {
    const body = await readJson(c.req, 4_096), order = await loadOrder(c, c.params.id!);
    if (order.status === 'cancelled' || order.status === 'draft') throw new AppError(409, 'Đơn chưa xác nhận hoặc đã huỷ, chưa yêu cầu xuất hoá đơn được.');
    if (order.invoiceStatus === 'issued') throw new AppError(409, `Đơn đã xuất hoá đơn ${order.invoiceNo}.`, 'INVOICE_ISSUED');
    // Email nhận hoá đơn: một hoặc nhiều địa chỉ (cách nhau bởi dấu phẩy / chấm phẩy). Phát hành chính thức hay gửi bản nháp.
    const emails = text(body.email, 500).split(/[,;\s]+/).filter(Boolean);
    if (emails.some(e => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) || emails.length > 5) throw new AppError(400, 'Email nhận hoá đơn không hợp lệ.');
    const mode = body.mode === 'draft' ? 'draft' as const : body.mode === undefined || body.mode === 'issue' ? 'issue' as const : null;
    if (!mode) throw new AppError(400, 'Chọn phát hành hoá đơn hoặc gửi bản nháp.');
    const fields = { invoiceRequestNote: text(body.note, 1000), invoiceEmail: emails.join(', '), invoiceMode: mode };
    // Đã yêu cầu (vd tự động khi giao xong) mà kế toán chưa xuất: cập nhật email / ghi chú / cách xuất.
    if (order.invoiceStatus === 'requested') {
      await c.env.db.update(salesOrders).set({ ...fields, updatedAt: nowIso(), revision: sql`${salesOrders.revision} + 1` }).where(and(eq(salesOrders.id, order.id), eq(salesOrders.invoiceStatus, 'requested')));
      return json({ ok: true, updated: true });
    }
    await c.env.db.update(salesOrders).set({ invoiceStatus: 'requested', invoiceRequestedAt: nowIso(), invoiceRequestedBy: viewer(c).id, ...fields,
      updatedAt: nowIso(), revision: sql`${salesOrders.revision} + 1` }).where(and(eq(salesOrders.id, order.id), eq(salesOrders.invoiceStatus, 'none')));
    return json({ ok: true });
  }, 'business');

  /** Kế toán / Manager nhập số hoá đơn (sửa lại được khi nhập nhầm). Việc "Xuất hoá đơn" tự hoàn thành. */
  router.put('/orders/:id/invoice', async c => {
    if (!canIssueInvoice(viewer(c))) throw new AppError(403, 'Chỉ Kế toán hoặc Manager nhập được số hoá đơn.');
    const body = await readJson(c.req, 4_096), order = await loadOrder(c, c.params.id!);
    if (order.status === 'cancelled') throw new AppError(409, 'Đơn đã huỷ.');
    const invoiceNo = text(body.invoiceNo, 200), invoiceDate = body.invoiceDate ? String(body.invoiceDate) : vietnamDate().iso;
    if (!invoiceNo) throw new AppError(400, 'Nhập số hoá đơn.');
    if (!isDate(invoiceDate)) throw new AppError(400, 'Ngày hoá đơn không hợp lệ.');
    const now = nowIso();
    await c.env.db.update(salesOrders).set({ invoiceStatus: 'issued', invoiceNo, invoiceDate, invoiceIssuedAt: now, invoiceIssuedBy: viewer(c).id,
      invoiceRequestedAt: order.invoiceRequestedAt ?? now, updatedAt: now, revision: sql`${salesOrders.revision} + 1` }).where(eq(salesOrders.id, order.id));
    return json({ ok: true });
  }, 'business');

  /** Báo giá đã duyệt, chưa có đơn đang hiệu lực (để bấm ＋ ở trang Đơn hàng / HĐKT tạo nhanh). */
  /**
   * Đơn hàng / HĐKT (chưa huỷ) sinh từ các báo giá – trang danh sách báo giá hiện nút "Xem đơn hàng / HĐKT".
   * `?ids=a,b,c` (tối đa 200). Chỉ trả chứng từ người xem được (như danh sách đơn).
   */
  router.get('/quote-docs', async c => {
    const ids = [...new Set((c.url.searchParams.get('ids') || '').split(',').map(s => s.trim()).filter(Boolean))].slice(0, 200);
    if (!ids.length) return json({ docs: {} });
    const rows = await c.env.db.select({ id: salesOrders.id, quoteId: salesOrders.quoteId, orderNo: salesOrders.orderNo, status: salesOrders.status }).from(salesOrders)
      .where(and(inArray(salesOrders.quoteId, ids), ne(salesOrders.status, 'cancelled'), orderScope(c)));
    const kNo = await contractNosOf(c.env.db, rows.map(r => r.id));
    const docs: Record<string, { orderId: string; orderNo: string; contractNo: string | null; status: string }> = {};
    for (const r of rows) if (r.quoteId) docs[r.quoteId] = { orderId: r.id, orderNo: r.orderNo, contractNo: kNo.get(r.id) ?? null, status: r.status };
    return json({ docs });
  }, 'business');

  router.get('/order-quote-candidates', async c => {
    const rows = await c.env.db.select({ id: quotations.id, quoteNo: quotations.quoteNo, customer: quotations.customer, quoteType: quotations.quoteType, quoteDate: quotations.quoteDate })
      .from(quotations).where(and(quotePredicate(quotationScope(viewer(c))), eq(quotations.approvalStatus, 'approved'),
        sql`NOT EXISTS (SELECT 1 FROM ${salesOrders} WHERE ${salesOrders.quoteId} = ${quotations.id} AND ${salesOrders.status} <> 'cancelled')`,
        matchAllWords(foldSql(quotations.quoteNo, quotations.customer), c.url.searchParams.get('q'))))
      .orderBy(desc(quotations.updatedAt)).limit(30);
    return json({ quotes: rows });
  }, 'business');

  // ================= HĐKT =================
  router.get('/contracts', async c => {
    const { limit, offset } = paging(c.url, 200, 500);
    const where = and(orderScope(c), matchAllWords(foldSql(salesContracts.contractNo, salesOrders.quoteNo, salesOrders.customerName), c.url.searchParams.get('q')));
    const [[{ n: total = 0 } = {}], rows] = await Promise.all([
      c.env.db.select({ n: count() }).from(salesContracts).innerJoin(salesOrders, eq(salesOrders.id, salesContracts.orderId)).where(where),
      c.env.db.select({ contract: salesContracts, orderNo: salesOrders.orderNo, customerName: salesOrders.customerName, quoteNo: salesOrders.quoteNo, orderStatus: salesOrders.status,
      invoiceStatus: salesOrders.invoiceStatus, invoiceNo: salesOrders.invoiceNo })
      .from(salesContracts).innerJoin(salesOrders, eq(salesOrders.id, salesContracts.orderId))
      .where(where).orderBy(desc(salesContracts.createdAt), desc(salesContracts.id)).limit(limit).offset(offset),
    ]);
    const debts = await receivableOf(c.env.db, [...new Set(rows.map(r => r.contract.orderId))]);
    return json({ contracts: rows.map(r => ({ ...r.contract, data: undefined, orderNo: r.orderNo, customerName: r.customerName, quoteNo: r.quoteNo, orderStatus: r.orderStatus,
      invoiceStatus: r.invoiceStatus, invoiceNo: r.invoiceNo,
      receivable: debts.get(r.contract.orderId), debtCounts: debtCounts(r.orderStatus, r.contract.status) })), total: Number(total), limit, offset });
  }, 'business');

  /**
   * Lập HĐKT THẲNG TỪ BÁO GIÁ – luồng độc lập với Đơn hàng (không sinh đơn hàng trước). Cấp số theo `contract_counters`
   * (như web cũ), kỳ phải thu = cọc + phần còn lại. Dòng hàng / giao hàng / công nợ của HĐKT nằm trong bản ghi `sales_orders`
   * đi kèm (ẩn với người dùng: mọi nơi hiện số HĐKT). Cùng giao dịch: đẩy đơn nháp sang Sapo (Sapo lỗi → không có HĐKT).
   */
  /**
   * Xem trước SỐ HĐKT sẽ cấp (popup Lập HĐKT điền sẵn, cho sửa): `?quoteId=&legalEntity=`. Không giữ số –
   * lúc lập mới cấp thật (ai lập trước lấy số trước); nhân viên sửa số thì dùng đúng số đã sửa.
   */
  router.get('/contracts/next-no', async c => {
    const me = viewer(c), quoteId = text(c.url.searchParams.get('quoteId'), 80), entity = legalCode(c.url.searchParams.get('legalEntity'));
    if (!entity) throw new AppError(400, 'Chọn pháp nhân bên bán.');
    const [quote] = await c.env.db.select().from(quotations).where(and(eq(quotations.id, quoteId), quotePredicate(quotationScope(me)))).limit(1);
    if (!quote) throw new AppError(404, 'Không tìm thấy báo giá.');
    const customerCode = await contractCustomerCode(c.env.db, quote);
    if (!customerCode) return json({ contractNo: '', error: 'Báo giá chưa có mã khách hàng hoặc MST để cấp số HĐKT.' });
    const { year, month } = vietnamDate();
    const [row] = await c.env.db.select({ seq: contractCounters.lastSequence }).from(contractCounters).where(eq(contractCounters.id, `HDKT:${year}:${month}:${entity}`)).limit(1);
    return json({ contractNo: contractNumber(entity, customerCode, (row?.seq ?? 0) + 1) });
  }, 'business');

  router.post('/contracts', async c => {
    const body = await readJson(c.req, 64_000), me = viewer(c), quoteId = text(body.quoteId, 80);
    if (!quoteId) throw new AppError(400, 'Chọn báo giá đã duyệt để lập HĐKT.');
    const [quote] = await c.env.db.select().from(quotations).where(and(eq(quotations.id, quoteId), quotePredicate(quotationScope(me)))).limit(1);
    if (!quote) throw new AppError(404, 'Không tìm thấy báo giá.');
    if (quote.approvalStatus !== 'approved') throw new AppError(409, 'Báo giá chưa được duyệt. Chỉ báo giá đã duyệt mới lập được HĐKT.', 'QUOTE_NOT_APPROVED');
    const entity = legalCode(body.legalEntity);
    if (!entity) throw new AppError(400, 'Chọn pháp nhân bên bán: Bách Ngân (BN), Vigifts (VG) hoặc QTV.');
    const depositRate = Number(body.depositRate ?? 0), paymentDays = Number(body.paymentDays ?? 0);
    if (!(depositRate >= 0 && depositRate <= 100)) throw new AppError(400, 'Tỷ lệ đặt cọc phải từ 0 đến 100%.');
    if (!Number.isInteger(paymentDays) || paymentDays < 0 || paymentDays > 3650) throw new AppError(400, 'Số ngày thanh toán không hợp lệ.');
    const signedDate = body.signedDate ? String(body.signedDate) : vietnamDate().iso;
    if (!isDate(signedDate)) throw new AppError(400, 'Ngày ký không hợp lệ.');
    const data = JSON.parse(quote.data);
    const customerCode = await contractCustomerCode(c.env.db, quote);
    if (!customerCode) throw new AppError(400, 'Báo giá chưa có mã khách hàng hoặc MST để cấp số HĐKT.');
    // Số HĐKT nhân viên sửa trong popup (trống = cấp tự động).
    const customNo = text(body.contractNo, 120).replace(/\s+/g, ' ');
    if (customNo && /[\u0000-\u001f<>]/.test(customNo)) throw new AppError(400, 'Số HĐKT không hợp lệ.');
    const now = nowIso(), id = crypto.randomUUID(), { year, month } = vietnamDate();
    const push = wantsSapoPush(c, body) ? await prepareSapoPush(c, sapoLocationOf(body)) : null;
    let contractNo = '', sapo: SapoPushOutcome = null;
    let orderId = '';
    try {
      orderId = await createOrderFromQuote(c.env.db, quote, { createdBy: me.id, status: 'draft', inTx: async (tx, oid) => {
        const [order] = await tx.select().from(salesOrders).where(eq(salesOrders.id, oid)).limit(1);
        const counterId = `HDKT:${year}:${month}:${entity}`;
        const [row] = await tx.insert(contractCounters).values({ id: counterId, type: 'HDKT', year: Number(year), month: Number(month), legalEntity: entity, lastSequence: 1, updatedAt: now })
          .onConflictDoUpdate({ target: contractCounters.id, set: { lastSequence: sql`${contractCounters.lastSequence} + 1`, updatedAt: now } }).returning({ seq: contractCounters.lastSequence });
        contractNo = contractNumber(entity, customerCode, row!.seq);
        if (customNo && customNo !== contractNo) {
          // Dùng số đã sửa: trả lại số thứ tự vừa lấy (dòng đếm đang khoá trong giao dịch này) để không nhảy số.
          await tx.update(contractCounters).set({ lastSequence: sql`${contractCounters.lastSequence} - 1` })
            .where(and(eq(contractCounters.id, counterId), eq(contractCounters.lastSequence, row!.seq)));
          contractNo = customNo;
          const [taken] = await tx.select({ id: salesContracts.id }).from(salesContracts).where(eq(salesContracts.contractNo, customNo)).limit(1);
          if (taken) throw new AppError(409, `Số HĐKT ${customNo} đã dùng cho HĐKT khác. Vui lòng đổi số.`, 'CONTRACT_NO_EXISTS');
        }
        await tx.insert(salesContracts).values({
          id, contractNo, orderId: oid, quoteId: quote.id, customerId: order!.customerId, legalEntity: entity, status: 'draft', signedDate: null,
          value: order!.total, depositRate, depositAmount: Math.round(order!.total * depositRate / 100), paymentDays,
          paymentMethod: text(body.paymentMethod, 1000), deliveryAddress: text(body.deliveryAddress, 2000) || order!.address,
          data: JSON.stringify(body.details && typeof body.details === 'object' ? body.details : {}), createdBy: me.id, createdAt: now, updatedAt: now,
        });
        // Kỳ phải thu theo HĐKT (cọc + phần còn lại) thay cho kỳ "thanh toán khi giao" mặc định.
        await tx.delete(paymentSchedules).where(eq(paymentSchedules.orderId, oid));
        const plans = contractSchedules(order!.total, depositRate, signedDate);
        if (plans.length) await tx.insert(paymentSchedules).values(plans.map(p => ({ id: crypto.randomUUID(), orderId: oid, contractId: id, ...p, createdAt: now })));
        if (push) sapo = await push.push(tx, oid);
      } });
    } catch (e) {
      const pg = e as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
      if ((pg.code ?? pg.cause?.code) === '23505') {
        if (/contracts_no/.test(pg.constraint ?? pg.cause?.constraint ?? '') || (customNo && /contracts_no/.test(String((e as Error).message) + String((pg.cause as Error | undefined)?.message))))
          throw new AppError(409, `Số HĐKT ${contractNo} đã dùng cho HĐKT khác. Vui lòng đổi số.`, 'CONTRACT_NO_EXISTS');
        throw new AppError(409, 'Báo giá này đã có HĐKT.', 'CONTRACT_EXISTS');
      }
      throw e;
    } finally { await push?.done(); }
    await notifyMany(c.env, 'managers', { eventType: 'contract_pending', title: 'HĐKT mới chờ duyệt',
      body: `${me.name}: ${contractNo} – ${text(data.customer) || quote.customer}`, url: `/index.html#/contracts/${orderId}`, actorId: me.id, data: { orderId, contractId: id } });
    return json({ id, orderId, contractNo, sapo }, 201);
  }, 'business');

  router.put('/contracts/:id', async c => {
    const body = await readJson(c.req, 600_000), me = viewer(c);
    await c.env.db.transaction(async tx => {
      const [found] = await tx.select({ order: salesOrders }).from(salesOrders).innerJoin(salesContracts, eq(salesOrders.id, salesContracts.orderId))
        .where(and(eq(salesContracts.id, c.params.id!), orderScope(c))).limit(1).for('update', { of: salesOrders });
      if (!found) throw new AppError(404, 'Không tìm thấy HĐKT.');
      if (found.order.status !== 'draft' && me.role !== 'manager') throw new AppError(403, 'HĐKT đã duyệt. Chỉ Manager được chỉnh sửa hoặc huỷ.', 'CONTRACT_APPROVED');
      const [contract] = await tx.select().from(salesContracts).where(eq(salesContracts.id, c.params.id!)).limit(1).for('update');
      if (!contract) throw new AppError(404, 'Không tìm thấy HĐKT.');
      if (contract.status !== 'draft' && me.role !== 'manager') throw new AppError(403, 'HĐKT đã ký / hoàn tất. Chỉ Manager được chỉnh sửa hoặc huỷ.', 'CONTRACT_APPROVED');
      if (body.revision !== undefined && (!Number.isSafeInteger(body.revision) || body.revision !== contract.revision))
        throw new AppError(409, 'HĐKT đã thay đổi. Vui lòng mở lại trước khi lưu.', 'CONTRACT_CHANGED');
      const financial = body.depositRate !== undefined || body.paymentDays !== undefined;
      if (financial && me.role !== 'manager') throw new AppError(403, 'Chỉ Manager được sửa tỷ lệ cọc và thời hạn thanh toán.');
      const set: Partial<typeof salesContracts.$inferInsert> = { updatedAt: nowIso() };
      if (body.status !== undefined) { if (!CONTRACT_STATUSES.includes(body.status as never)) throw new AppError(400, 'Trạng thái HĐKT không hợp lệ.'); set.status = body.status as never; }
      if ((body.status === 'signed' || body.status === 'completed') && found.order.status === 'draft') throw new AppError(409, 'HĐKT chưa được Manager duyệt (đơn đang chờ duyệt), chưa đánh dấu ký được.', 'ORDER_NOT_APPROVED');
      if (body.signedDate !== undefined) { if (body.signedDate && !isDate(body.signedDate)) throw new AppError(400, 'Ngày ký không hợp lệ.'); set.signedDate = (body.signedDate as string) || null; }
      if (body.depositRate !== undefined) {
        const rate = Number(body.depositRate);
        if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new AppError(400, 'Tỷ lệ đặt cọc phải từ 0 đến 100%.');
        set.depositRate = rate; set.depositAmount = Math.round(contract.value * rate / 100);
      }
      if (body.paymentDays !== undefined) {
        const days = Number(body.paymentDays);
        if (!Number.isInteger(days) || days < 0 || days > 3650) throw new AppError(400, 'Số ngày thanh toán không hợp lệ.');
        set.paymentDays = days;
      }
      if (body.paymentMethod !== undefined) set.paymentMethod = text(body.paymentMethod, 1000);
      if (body.deliveryAddress !== undefined) set.deliveryAddress = text(body.deliveryAddress, 2000);
      if (body.details !== undefined) set.data = JSON.stringify(body.details && typeof body.details === 'object' ? body.details : {});
      const [saved] = await tx.update(salesContracts).set({ ...set, revision: contract.revision + 1 }).where(eq(salesContracts.id, contract.id)).returning();
      if (financial || body.signedDate !== undefined) await syncPaymentSchedules(tx, found.order, saved);
    });
    return json({ ok: true });
  }, 'business');

  // ================= LỊCH GIAO HÀNG =================
  router.get('/deliveries', async c => {
    const from = c.url.searchParams.get('from'), to = c.url.searchParams.get('to'), status = c.url.searchParams.get('status') || '';
    const rows = await c.env.db.select({ d: deliveries, orderNo: salesOrders.orderNo, contractNo: salesContracts.contractNo, customerName: salesOrders.customerName,
      contact: salesOrders.contact, phone: salesOrders.phone, orderAddress: salesOrders.address })
      .from(deliveries).innerJoin(salesOrders, eq(salesOrders.id, deliveries.orderId)).leftJoin(salesContracts, eq(salesContracts.orderId, deliveries.orderId))
      .where(and(deliveryScope(c), isDate(from) ? gte(deliveries.plannedDate, from!) : undefined, isDate(to) ? lte(deliveries.plannedDate, to!) : undefined,
        status ? eq(deliveries.status, status as never) : undefined))
      .orderBy(asc(deliveries.plannedDate), asc(deliveries.timeSlot)).limit(500);
    // `contractNo` có → chuyến giao của HĐKT (hiện số HĐKT, mở #/contracts/…), không phải của đơn hàng.
    // Liên hệ / địa chỉ của khách trên đơn: kho (không xem được danh bạ khách) vẫn có đủ thông tin để liên hệ giao hàng.
    return json({ deliveries: rows.map(r => ({ ...r.d, orderNo: r.orderNo, contractNo: r.contractNo ?? null, customerName: r.customerName,
      customerContact: r.contact, customerPhone: r.phone, customerAddress: r.orderAddress })) });
  }, 'business');

  /** Lên lịch giao: số lượng mỗi dòng không vượt phần còn lại (đã trừ hàng đã giao và các chuyến đang chờ giao). */
  /** Đổi ngày giao dự kiến của đơn (nhân viên chọn ở ô Lịch giao hàng). Đơn khách đặt: khách thấy ngày mới và nhận thông báo. */
  router.put('/orders/:id/delivery-date', async c => {
    const body = await readJson(c.req, 1_024), date = String(body.date || '');
    if (!isDate(date)) throw new AppError(400, 'Chọn ngày giao hợp lệ.');
    const order = await loadOrder(c, c.params.id!);
    if (order.status !== 'draft' && viewer(c).role !== 'manager') throw new AppError(403, 'Đơn đã duyệt. Chỉ Manager được đổi ngày giao.', 'ORDER_APPROVED');
    if (order.status === 'cancelled' || order.status === 'delivered') throw new AppError(409, 'Đơn đã huỷ hoặc đã giao xong, không đổi ngày giao được.');
    await setExpectedDeliveryDate(c, order, date);
    return json({ ok: true, expectedDeliveryDate: date });
  }, 'business');

  router.post('/deliveries', async c => {
    const body = await readJson(c.req, 64_000), me = viewer(c);
    const order = await loadOrder(c, text(body.orderId, 80));
    if (order.status === 'cancelled') throw new AppError(409, 'Đơn đã huỷ.');
    if (order.status === 'draft') throw new AppError(409, 'Đơn chưa được Manager duyệt, chưa lên lịch giao được.', 'ORDER_NOT_APPROVED');
    const plannedDate = String(body.plannedDate || '');
    if (!isDate(plannedDate)) throw new AppError(400, 'Chọn ngày giao hợp lệ.');
    const wanted = Array.isArray(body.lines) ? body.lines as { orderLineId?: unknown; qty?: unknown }[] : [];
    const id = crypto.randomUUID(), now = nowIso();
    await c.env.db.transaction(async tx => {
      const lines = await tx.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, order.id));
      const pending = await tx.select({ lineId: deliveryLines.orderLineId, qty: deliveryLines.qty }).from(deliveryLines)
        .innerJoin(deliveries, eq(deliveries.id, deliveryLines.deliveryId)).where(and(eq(deliveries.orderId, order.id), inArray(deliveries.status, ['planned', 'in_transit'])));
      const remaining = (l: typeof lines[number]) => l.qty - l.deliveredQty - pending.filter(p => p.lineId === l.id).reduce((s, p) => s + p.qty, 0);
      // Không chỉ định dòng nào = giao hết phần còn lại.
      const picks = (wanted.length ? wanted.map(w => ({ line: lines.find(l => l.id === w.orderLineId), qty: Number(w.qty) })) : lines.map(l => ({ line: l, qty: remaining(l) }))).filter(p => p.qty > 0);
      if (!picks.length) throw new AppError(400, 'Không còn hàng nào cần giao cho đơn này.');
      for (const p of picks) {
        if (!p.line) throw new AppError(400, 'Dòng hàng không thuộc đơn.');
        if (!(p.qty > 0) || p.qty > remaining(p.line) + 1e-9) throw new AppError(400, `"${p.line.name}" chỉ còn ${remaining(p.line)} ${p.line.unit} chưa lên lịch giao.`);
      }
      const used = (await tx.select({ n: deliveries.deliveryNo }).from(deliveries).where(sql`${deliveries.deliveryNo} LIKE ${'GH_' + plannedDate.replaceAll('-', '') + '_%'}`)).map(r => r.n);
      await tx.insert(deliveries).values({
        id, deliveryNo: nextDocNo('GH', plannedDate, used), orderId: order.id, plannedDate, timeSlot: text(body.timeSlot, 100),
        address: text(body.address, 2000) || order.address, receiverName: text(body.receiverName) || order.contact, receiverPhone: text(body.receiverPhone, 100) || order.phone,
        carrier: text(body.carrier, 200), shippingFee: money(body.shippingFee ?? 0, 'Phí giao hàng'), status: 'planned', assigneeId: body.assigneeId ? text(body.assigneeId, 80) : null,
        note: text(body.note, 2000), createdBy: me.id, createdAt: now, updatedAt: now,
      });
      await tx.insert(deliveryLines).values(picks.map(p => ({ deliveryId: id, orderLineId: p.line!.id, qty: p.qty })));
    });
    // Ngày lên lịch giao trở thành ngày giao dự kiến của đơn (đơn của khách cũng cập nhật theo).
    await setExpectedDeliveryDate(c, order, plannedDate);
    return json({ id }, 201);
  }, 'business');

  /** Đổi trạng thái chuyến giao. "Đã giao" cộng số lượng vào đơn (chỉ một lần), cập nhật trạng thái đơn và hạn công nợ. */
  router.put('/deliveries/:id/status', async c => {
    const body = await readJson(c.req, 1_024), status = body.status as typeof DELIVERY_STATUSES[number];
    if (!DELIVERY_STATUSES.includes(status)) throw new AppError(400, 'Trạng thái giao hàng không hợp lệ.');
    const [row] = await c.env.db.select({ d: deliveries }).from(deliveries).innerJoin(salesOrders, eq(salesOrders.id, deliveries.orderId))
      .where(and(eq(deliveries.id, c.params.id!), deliveryScope(c))).limit(1);
    if (!row) throw new AppError(404, 'Không tìm thấy lịch giao.');
    if (row.d.status === 'delivered') throw new AppError(409, 'Chuyến này đã giao xong, không đổi trạng thái được.');
    const deliveredOn = status === 'delivered' ? (isDate(body.deliveredOn) ? String(body.deliveredOn) : vietnamDate().iso) : null;
    await c.env.db.transaction(async tx => {
      await tx.update(deliveries).set({ status, deliveredAt: deliveredOn, updatedAt: nowIso() }).where(eq(deliveries.id, row.d.id));
      if (status !== 'delivered') return;
      for (const l of await tx.select().from(deliveryLines).where(eq(deliveryLines.deliveryId, row.d.id)))
        await tx.update(salesOrderLines).set({ deliveredQty: sql`LEAST(${salesOrderLines.qty}, ${salesOrderLines.deliveredQty} + ${l.qty})` }).where(eq(salesOrderLines.id, l.orderLineId));
      await refreshOrderStatus(tx, row.d.orderId, deliveredOn);
    });
    // Lịch sử sản phẩm: chuyến "Đã giao" = xuất kho cho khách.
    if (status === 'delivered') {
      const [o] = await c.env.db.select().from(salesOrders).where(eq(salesOrders.id, row.d.orderId)).limit(1);
      const lines = await c.env.db.select({ id: deliveryLines.orderLineId, qty: deliveryLines.qty, sku: salesOrderLines.sku, name: salesOrderLines.name, unit: salesOrderLines.unit, unitPrice: salesOrderLines.unitPrice })
        .from(deliveryLines).innerJoin(salesOrderLines, eq(salesOrderLines.id, deliveryLines.orderLineId)).where(eq(deliveryLines.deliveryId, row.d.id));
      const ref = docRef(row.d.orderId, o?.orderNo ?? '', (await contractNosOf(c.env.db, [row.d.orderId])).get(row.d.orderId));
      await recordMovements(c.env.db, lines.map(l => ({ refKey: `delivery:${row.d.id}:${l.id}`, sku: l.sku, kind: 'delivery', name: l.name, qty: l.qty, unit: l.unit, unitPrice: l.unitPrice,
        partner: o?.customerName ?? '', location: row.d.address, refCode: `${row.d.deliveryNo} · ${ref.no}`, link: ref.link, status: 'Đã giao', occurredAt: nowIso() })));
    }
    return json({ ok: true });
  }, 'business');

  // ================= CÔNG NỢ =================
  /** Công nợ theo đơn: chỉ đơn đã xác nhận hoặc có HĐKT đã ký (đơn nháp / huỷ không tính). `?status=open|overdue|paid` lọc theo tình trạng. */
  router.get('/receivables', async c => {
    const want = c.url.searchParams.get('status') || '';
    const rows = await c.env.db.select().from(salesOrders).where(and(orderScope(c), ne(salesOrders.status, 'cancelled'),
      matchAllWords(foldSql(salesOrders.orderNo, salesOrders.customerName, salesOrders.phone, salesOrders.taxCode,
        sql`(SELECT ${salesContracts.contractNo} FROM ${salesContracts} WHERE ${salesContracts.orderId} = ${salesOrders.id})`), c.url.searchParams.get('q'))))
      .orderBy(desc(salesOrders.orderDate)).limit(500);
    const contracts = rows.length ? await c.env.db.select({ orderId: salesContracts.orderId, status: salesContracts.status, no: salesContracts.contractNo }).from(salesContracts).where(inArray(salesContracts.orderId, rows.map(r => r.id))) : [];
    const counted = rows.filter(r => debtCounts(r.status, contracts.find(x => x.orderId === r.id)?.status));
    const debts = await receivableOf(c.env.db, counted.map(r => r.id));
    const list = counted.map(r => ({ orderId: r.id, orderNo: r.orderNo, contractNo: contracts.find(x => x.orderId === r.id)?.no ?? null, customerId: r.customerId, customerName: r.customerName, phone: r.phone, orderDate: r.orderDate, orderStatus: r.status, ...debts.get(r.id)! }))
      .filter(r => r.status !== 'none' && (!want || r.status === want || (want === 'open' && r.status === 'overdue')));
    const sum = (k: 'due' | 'paid' | 'balance' | 'overdue') => list.reduce((s, r) => s + r[k], 0);
    return json({ receivables: list, totals: { due: sum('due'), paid: sum('paid'), balance: sum('balance'), overdue: sum('overdue') } });
  }, 'business');

  /** Ghi nhận phiếu thu. Không thu vượt số còn phải thu của đơn. */
  router.post('/payments', async c => {
    const body = await readJson(c.req, 8_192), me = viewer(c);
    const order = await loadOrder(c, text(body.orderId, 80));
    const amount = money(body.amount, 'Số tiền');
    if (amount <= 0) throw new AppError(400, 'Số tiền phải lớn hơn 0.');
    const paidAt = String(body.paidAt || vietnamDate().iso);
    if (!isDate(paidAt)) throw new AppError(400, 'Ngày thu không hợp lệ.');
    const method = (body.method ?? 'transfer') as typeof PAYMENT_METHODS[number];
    if (!PAYMENT_METHODS.includes(method)) throw new AppError(400, 'Hình thức thanh toán không hợp lệ.');
    const debt = (await receivableOf(c.env.db, [order.id])).get(order.id)!;
    if (amount > debt.balance) throw new AppError(400, `Đơn chỉ còn phải thu ${debt.balance.toLocaleString('vi-VN')} đ.`);
    const scheduleId = body.scheduleId ? text(body.scheduleId, 80) : null;
    if (scheduleId && !(await c.env.db.select({ id: paymentSchedules.id }).from(paymentSchedules).where(and(eq(paymentSchedules.id, scheduleId), eq(paymentSchedules.orderId, order.id))).limit(1)).length)
      throw new AppError(400, 'Kỳ thanh toán không thuộc đơn này.');
    const id = crypto.randomUUID();
    await c.env.db.insert(customerPayments).values({ id, orderId: order.id, scheduleId, customerId: order.customerId, amount, paidAt, method, reference: text(body.reference, 200), note: text(body.note, 2000), createdBy: me.id, createdAt: nowIso() });
    return json({ id }, 201);
  }, 'business');
}


