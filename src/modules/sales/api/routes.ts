import { stockMoves } from '../../inventory/schema.ts';
import { saleFlowOf, flowHoldUntil } from '../domain/pos-order-flow.ts';
import { posOrderReservations } from '../pos-order-flow-schema.ts';
import { assertPosFlowFulfillable, flowIssued } from './pos-order-flow-guards.ts';
import { assertNoReturnActivity, returnAdjustments, netReturnInputs } from './pos-return-credit.ts';
import { posReturns, posRefunds, posExchangeAllocations } from '../return-schema.ts';
import { snapshotPosFees } from '../domain/pos-fees.ts';
import { editPosOrder } from './pos-order-edit.ts';
import { cashLock, drawerOf, cashAudit, voidClosedCashEffect } from './cash-store.ts';
import { issuePosDelivery } from './pos-delivery-stock.ts';
import { posShifts } from '../pos-schema.ts';
import { createScheduledDelivery } from './delivery-store.ts';
import { departmentOwner } from '../../staff/api/department.ts';
import { seesAllAsSaleAdmin } from '../../staff/domain/roles.ts';
import { can, canApprove, type PermissionMember } from '../../staff/domain/permissions.ts';
import { quotationPredicate } from '../../quotes/api/department-access.ts';
import { orderNotesFromQuote, orderDeliveryAddress } from '../domain/order-notes.ts';
import { cleanOrderInput } from '../domain/order-input.ts';
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
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
import { contractCounters } from '../../contracts/schema.ts';
import { customerPayments, deliveries, deliveryLines, paymentSchedules, salesContracts, salesOrderLines, salesOrders, packingSlipLines, packingSlips, stockHolds } from '../schema.ts';
import { recordMovements, removeMovements } from '../../catalog/api/product-history.ts';
import { docRef } from '../domain/doc-ref.ts';
import { progressOf } from './progress.ts';
import { closeSlipsOfDeliveredOrders } from './packing-close.ts';
import { reverseRef } from '../../inventory/api/ledger.ts';
import { parsePhotos, photoUrls, savePhotos, WH_PHOTO_MAX, WH_PHOTO_MAX_CHARS } from '../../inventory/api/photos.ts';
import { DEFAULT_SAPO_BASE } from '../../integrations/api/sapo-client.ts';
import { prepareSapoPush, sapoLocationOf, sapoPreview, sapoPushRequired, sapoPushViaClaw, sendOrderToClaw, wantsSapoPush, type SapoPushOutcome } from './sapo-push.ts';
import { amendmentLines, amendmentSchedules } from '../domain/amendments.ts';
import { CONTRACT_STATUSES, DELIVERY_STATUSES, PAYMENT_METHODS } from '../domain/statuses.ts';
import {
  addDays, compactCode, contractNumber, debtAging, debtCounts, contractSchedules, legalCode, nextDocNo, orderLinesFromQuote, orderStatusFromLines,
  orderTotals, receivable, vietnamDate, type OrderStatus,
} from '../domain/sales.ts';

type Ctx = RouteContext<StaffEnv>;
type Tx = Parameters<Parameters<StaffEnv['db']['transaction']>[0]>[0];
const viewer = (c: Ctx) => (c.state.session as SessionState).member;
const nowIso = () => new Date().toISOString();
const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z'));
const text = (v: unknown, max = 500) => { if (v !== undefined && v !== null && typeof v !== 'string') throw new AppError(400, 'Dữ liệu không hợp lệ.'); return String(v ?? '').trim().slice(0, max); };
const money = (v: unknown, what: string) => { const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > 1e13) throw new AppError(400, `${what} không hợp lệ.`); return Math.round(n); };

/** Huỷ phiếu thu ghi nhầm: Manager hoặc chức vụ có quyền "Huỷ phiếu thu" (mặc định Kế toán). */
export const canVoidPayment = (m: PermissionMember) => can(m, 'payments.void');
/** Kế toán (chức vụ `accounting`): xem mọi đơn / HĐKT để nhập số hoá đơn, theo dõi công nợ. */
export const isAccountant = (m: { role: string; positionId?: string | null }) => m.role === 'employee' && m.positionId === 'accounting';
/** Ai nhập được số hoá đơn: Manager và Kế toán. */
/** Nhập số hoá đơn: Manager, Kế toán và nhân viên (chỉ trên đơn mình được xem – `loadOrder` kiểm phạm vi). */
export const canIssueInvoice = (m: { role: string; positionId?: string | null }) => m.role === 'manager' || (m.role === 'employee' && m.positionId !== 'warehouse') || isAccountant(m);
/**
 * Ai thấy đơn: Manager và Kế toán thấy tất cả; nhân viên thấy đơn mình phụ trách hoặc mình tạo, và mọi đơn của khách hàng
 * mình phụ trách / được chia sẻ (`customer_staff`). Mọi bảng con theo quyền của đơn.
 */
export const orderScopeFor = (m: { id: string; role: string; positionId?: string | null; dataScope?: string | null; approver?: boolean | null }): SQL | undefined => m.role === 'manager' || isAccountant(m) || seesAllAsSaleAdmin(m) ? undefined
  : or(eq(salesOrders.ownerId, m.id), eq(salesOrders.createdBy, m.id), departmentOwner(salesOrders.ownerId, m), departmentOwner(salesOrders.createdBy, m),
    sql`EXISTS (SELECT 1 FROM ${customerStaff} WHERE ${customerStaff.customerId} = ${salesOrders.customerId} AND ${customerStaff.memberId} = ${m.id})`,
    // Người được duyệt mở được đơn / HĐKT đang chờ duyệt (đã gửi duyệt) để kiểm tra rồi duyệt.
    canApprove(m) ? and(eq(salesOrders.status, 'draft'), isNotNull(salesOrders.submittedAt)) : undefined);
const orderScope = (c: Ctx): SQL | undefined => orderScopeFor(viewer(c));
/** Lịch giao hàng: nhóm Kho (chức vụ `warehouse`) xem và đổi trạng thái mọi chuyến giao (không xem được đơn / công nợ). */
const isWarehouseMember = (m: { role: string; positionId?: string | null }) => m.role === 'employee' && m.positionId === 'warehouse';
const deliveryScope = (c: Ctx): SQL | undefined => { const m = viewer(c); return m.role === 'employee' && m.positionId === 'warehouse' ? undefined : orderScope(c); };

async function loadOrder(c: Ctx, id: string, db: StaffEnv['db'] | Tx = c.env.db) {
  const [order] = await db.select().from(salesOrders).where(and(eq(salesOrders.id, id), orderScope(c))).limit(1);
  if (!order) throw new AppError(404, 'Không tìm thấy đơn hàng / HĐKT.');
  return order;
}
/** Integration writes obey the existing approved-document lock. Shared viewers cannot push. */
export const canCreateSapoFor = (m: { id: string; role: string }, o: typeof salesOrders.$inferSelect) =>
  o.status !== 'cancelled' && (m.role === 'manager' || (m.role === 'employee' && o.status === 'draft' && (o.ownerId === m.id || o.createdBy === m.id)));
const linkedSapo = (c: Ctx, o: typeof salesOrders.$inferSelect) => ({ status: 'existing', id: o.sapoOrderId, code: o.sapoOrderCode,
  url: `${(c.env.sapoAdminBase || DEFAULT_SAPO_BASE).replace(/\/+$/, '')}/orders/${encodeURIComponent(o.sapoOrderId!)}`, warnings: [] });
async function canCreateSapoInDepartment(c: Ctx, o: typeof salesOrders.$inferSelect, db: StaffEnv['db'] | Tx = c.env.db) {
  if (canCreateSapoFor(viewer(c), o)) return true;
  if (o.status !== 'draft') return false;
  const [peer] = await db.select({ id: employees.id }).from(employees).where(and(inArray(employees.id, [o.ownerId, o.createdBy]), departmentOwner(employees.id, viewer(c)) ?? sql`false`)).limit(1);
  return !!peer;
}
/**
 * Sửa / huỷ / gửi duyệt chứng từ: Manager; nhân viên chỉ khi còn nháp và là người phụ trách / người tạo / cùng phòng (phạm vi "Cả phòng ban").
 * Người chỉ được XEM (Kế toán, Sale Admin "Toàn công ty (chỉ xem)", người được duyệt mở đơn chờ duyệt) không sửa chứng từ của người khác.
 */
async function assertCanEditOrder(c: Ctx, o: typeof salesOrders.$inferSelect, what = 'đơn hàng / HĐKT', db: StaffEnv['db'] | Tx = c.env.db) {
  if (!await canCreateSapoInDepartment(c, o, db)) throw new AppError(403, `Chỉ người phụ trách / người tạo được sửa ${what} nháp; ${what} đã duyệt chỉ Manager được sửa hoặc huỷ.`, 'ORDER_EDIT_FORBIDDEN');
}
async function assertCanCreateSapo(c: Ctx, o: typeof salesOrders.$inferSelect) {
  if (o.channel === 'pos') throw new AppError(409, 'Đơn POS ghi sổ kho CRM, không đẩy Sapo từ luồng này.');
  if (o.status === 'cancelled') throw new AppError(409, 'Đơn hàng / HĐKT đã huỷ, không tạo đơn Sapo.', 'ORDER_CANCELLED');
  if (!await canCreateSapoInDepartment(c, o)) throw new AppError(403, 'Chỉ người phụ trách/người tạo được đẩy chứng từ nháp. Chứng từ đã duyệt chỉ Manager được đẩy Sapo.', 'SAPO_PUSH_FORBIDDEN');
}
async function receivableOf(db: StaffEnv['db'] | Tx, orderIds: string[]) {
  if (!orderIds.length) return new Map<string, ReturnType<typeof receivable>>();
  const [sch, pay] = await Promise.all([
    db.select().from(paymentSchedules).where(inArray(paymentSchedules.orderId, orderIds)),
    db.select().from(customerPayments).where(and(inArray(customerPayments.orderId, orderIds), isNull(customerPayments.voidedAt))),
  ]);
  const today = vietnamDate().iso;
  const adjustments=await returnAdjustments(db,orderIds);
  return new Map(orderIds.map(id => {const net=netReturnInputs(sch.filter(s => s.orderId === id),pay.filter(p => p.orderId === id),adjustments.get(id));return [id,receivable(net.schedules,net.payments,today)];}));
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
/** Ngày giao dự kiến: đơn nháp hoặc Manager (đơn đã duyệt nhân viên lên lịch chuyến không đổi ngày đã chốt với khách). */
export async function setExpectedDeliveryDate(c: Ctx, order: typeof salesOrders.$inferSelect, date: string) {
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
export async function createOrderFromQuote(db: StaffEnv['db'], quote: QuoteRow, o: { createdBy: string; status: 'confirmed' | 'draft'; submitted?: boolean; note?: string; deliveryDate?: string | null; orderDate?: string; deliveryAddress?: string;
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
    // Báo giá đang giữ hàng: lập đơn / HĐKT thì tự bỏ treo (hàng đi theo đơn).
    await tx.update(stockHolds).set({ status: 'converted', closedAt: now, closedBy: o.createdBy }).where(and(eq(stockHolds.quoteId, quote.id), eq(stockHolds.status, 'active')));
    await tx.insert(salesOrders).values({
      id, orderNo: nextDocNo('DH', today, used), quoteId: quote.id, quoteNo: quote.quoteNo, quoteType: quote.quoteType, customerId,
      customerName: text(data.customer) || quote.customer, contact: text(data.contact), phone: text(data.phone, 100), email: text(data.email, 254),
      taxCode: text(data.customerTaxCode, 100), address: o.deliveryAddress === undefined ? text(orderDeliveryAddress(data), 2000) : text(o.deliveryAddress, 2000),
      ownerId: quote.assigneeId ?? quote.creatorId, createdBy: o.createdBy, orderDate: o.orderDate ?? today,
      expectedDeliveryDate: o.deliveryDate === null ? null : isDate(o.deliveryDate) ? o.deliveryDate : isDate(data.deliveryDate) ? data.deliveryDate : null, status: o.status, submittedAt: o.submitted === false ? null : now, ...t, note: text(o.note ?? orderNotesFromQuote(data), 20000), createdAt: now, updatedAt: now,
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
  // Hàng đã lên phiếu đóng gói (chưa huỷ) cũng không được cắt bớt dưới mức đó (phiếu kho đã đóng đã ghi xuất sổ kho).
  if (oldLines.length) {
    const slipQty = await tx.select({ id: packingSlipLines.orderLineId, qty: sql<number>`sum(${packingSlipLines.qty})`.mapWith(Number) }).from(packingSlipLines)
      .innerJoin(packingSlips, eq(packingSlips.id, packingSlipLines.slipId))
      .where(and(inArray(packingSlipLines.orderLineId, oldLines.map(l => l.id)), ne(packingSlips.status, 'cancelled'))).groupBy(packingSlipLines.orderLineId);
    for (const x of slipQty) if (x.id) reserved.set(x.id, Math.max(reserved.get(x.id) || 0, x.qty));
  }
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
  const payments = await tx.select({ id: customerPayments.scheduleId }).from(customerPayments).where(and(eq(customerPayments.orderId, order.id), isNull(customerPayments.voidedAt)));
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
  /** Claw báo kết quả sau khi n8n tạo đơn Sapo; dùng cùng Bearer SAPO_SYNC_TOKEN, không dùng phiên trình duyệt. */
  router.post('/integrations/sapo/order-status', async c => {
    const body = await readJson(c.req, 128_000), status = text(body.status, 40), code = text(body.quote_number ?? body.sapo_order_code, 160);
    const sapoId = text(body.sapo_order_id == null ? '' : String(body.sapo_order_id), 80), sapoCode = text(body.sapo_order_code, 160) || code;
    if (!code) throw new AppError(400, 'Thiếu số đơn / HĐKT để cập nhật trạng thái Sapo.');
    // Dry-run hoặc lỗi chỉ xác nhận callback; không ghi liên kết giả vào chứng từ.
    if (!sapoId || !['created', 'created_after_error', 'existing'].includes(status)) return json({ ok: true, ignored: true });
    const [found] = await c.env.db.select({ id: salesOrders.id }).from(salesOrders).leftJoin(salesContracts, eq(salesContracts.orderId, salesOrders.id))
      .where(or(eq(salesOrders.orderNo, code), eq(salesContracts.contractNo, code))).limit(1);
    if (!found) throw new AppError(404, 'Không tìm thấy đơn hàng / HĐKT tương ứng trên CRM.');
    await c.env.db.update(salesOrders).set({ sapoOrderId: sapoId, sapoOrderCode: sapoCode, sapoPushedAt: text(body.updated_at, 60) || nowIso(), updatedAt: nowIso() }).where(eq(salesOrders.id, found.id));
    return json({ ok: true, orderId: found.id });
  }, 'sapo-sync');

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
    // Số đơn đang chờ xuất hoá đơn (cùng phạm vi + luồng, không theo ô tìm / bộ lọc) cho nút lọc "Chờ xuất hoá đơn".
    const pendingWhere = and(orderScope(c), ne(salesOrders.status, 'cancelled'), eq(salesOrders.invoiceStatus, 'requested'),
      flow === 'order' ? sql`NOT EXISTS (SELECT 1 FROM ${salesContracts} WHERE ${salesContracts.orderId} = ${salesOrders.id})` : undefined);
    const [[{ n: total = 0 } = {}], rows, [{ n: invoicePending = 0 } = {}]] = await Promise.all([
      c.env.db.select({ n: count() }).from(salesOrders).where(where),
      c.env.db.select().from(salesOrders).where(where).orderBy(desc(salesOrders.orderDate), desc(salesOrders.createdAt), desc(salesOrders.id)).limit(limit).offset(offset),
      c.env.db.select({ n: count() }).from(salesOrders).where(pendingWhere),
    ]);
    const ids = rows.map(r => r.id);
    const [debts, contracts] = await Promise.all([
      receivableOf(c.env.db, ids),
      ids.length ? c.env.db.select({ orderId: salesContracts.orderId, id: salesContracts.id, contractNo: salesContracts.contractNo, status: salesContracts.status }).from(salesContracts).where(inArray(salesContracts.orderId, ids)) : [],
    ]);
    return json({ orders: rows.map(r => { const contract = contracts.find(x => x.orderId === r.id) ?? null;
      // debtCounts = false (đơn chờ xác nhận chưa ký HĐKT / đã huỷ): chưa phát sinh công nợ.
      return { ...r, receivable: debts.get(r.id), debtCounts: debtCounts(r.status, contract?.status), contract }; }), total: Number(total), limit, offset, invoicePending: Number(invoicePending) });
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

  router.put('/orders/:id/pos', async c => {
    const b = await readJson(c.req, 100000);
    return json(await c.env.db.transaction(async tx => {
      await cashLock(tx);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('stock_holds'))`);
      const o = await loadOrder(c, c.params.id!, tx);
      await assertCanEditOrder(c, o, 'đơn POS', tx);
      const [locked] = await tx.select().from(salesOrders).where(eq(salesOrders.id, o.id)).for('update');
      const result = await editPosOrder(tx, locked!, viewer(c), b);
      await removeMovements(tx, `sale:${o.id}:`);
      await recordSaleMovements(tx, o.id);
      return result;
    }));
  }, 'business');

  router.get('/orders/:id', async c => {
    const db = c.env.db, order = await loadOrder(c, c.params.id!);
    const [lines, contract, ships, schedules, payments] = await Promise.all([
      db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, order.id)).orderBy(asc(salesOrderLines.lineNo)),
      db.select().from(salesContracts).where(eq(salesContracts.orderId, order.id)).limit(1),
      db.select().from(deliveries).where(eq(deliveries.orderId, order.id)).orderBy(asc(deliveries.plannedDate)),
      db.select().from(paymentSchedules).where(eq(paymentSchedules.orderId, order.id)).orderBy(asc(paymentSchedules.dueDate)),
      db.select().from(customerPayments).where(eq(customerPayments.orderId, order.id)).orderBy(asc(customerPayments.paidAt)),
    ]);
    const [shipLines, shipPhotos] = ships.length ? await Promise.all([db.select().from(deliveryLines).where(inArray(deliveryLines.deliveryId, ships.map(s => s.id))),
      photoUrls(db, c.env.files, 'delivery', ships.filter(s => s.status === 'delivered').map(s => s.id))]) : [[], new Map<string, string[]>()];
    // Cho bản in đơn đặt hàng: mã khách hàng, người phụ trách, người soạn.
    const [cust] = order.customerId ? await db.select({ code: customers.customerCode, email: customers.email }).from(customers).where(eq(customers.id, order.customerId)).limit(1) : [];
    const people = await db.select({ id: employees.id, name: employees.name, phone: employees.phone, role: employees.role }).from(employees)
      .where(inArray(employees.id, [order.ownerId, order.createdBy, order.invoiceRequestedBy, order.invoiceIssuedBy, ...payments.map(p => p.voidedBy)].filter((x): x is string => !!x)));
    const person = (id: string) => people.find(p => p.id === id);
    const adjustment=(await returnAdjustments(db,[order.id])).get(order.id);
    const net=netReturnInputs(schedules,payments.filter(p=>!p.voidedAt),adjustment);
    return json({
      returnAdjustment: adjustment || null,
      effectiveSchedules: net.schedules,
      order: { ...order, posFees: order.channel === 'pos' ? snapshotPosFees(JSON.parse(order.posSnapshot || '{}')) : null, customerCode: cust?.code ?? '', customerEmail: cust?.email ?? '', ownerName: person(order.ownerId)?.name ?? '', ownerPhone: person(order.ownerId)?.phone ?? '',
        createdByName: person(order.createdBy)?.name ?? '', createdByCustomer: person(order.createdBy)?.role === 'customer',
        invoiceRequestedByName: order.invoiceRequestedBy ? person(order.invoiceRequestedBy)?.name ?? '' : '', invoiceIssuedByName: order.invoiceIssuedBy ? person(order.invoiceIssuedBy)?.name ?? '' : '',
        canIssueInvoice: canIssueInvoice(viewer(c)), canCreateSapo: !order.sapoOrderId && await canCreateSapoInDepartment(c, order), canEdit: await canCreateSapoInDepartment(c, order),
        // Đơn Sapo đã đẩy (mã đang giữ chỗ "pending:…" khi đang đẩy thì chưa tính).
        sapoOrderCode: order.sapoOrderId ? order.sapoOrderCode : null,
        sapoOrderUrl: order.sapoOrderId ? `${(c.env.sapoAdminBase || DEFAULT_SAPO_BASE).replace(/\/+$/, '')}/orders/${encodeURIComponent(order.sapoOrderId)}` : '' }, lines, contract: contract[0] ? { ...contract[0], canEditFinancial: viewer(c).role === 'manager', canEdit: await canCreateSapoInDepartment(c, order), data: JSON.parse(contract[0].data) } : null,
      deliveries: ships.map(s => ({ ...s, lines: shipLines.filter(l => l.deliveryId === s.id), photos: shipPhotos.get(s.id) ?? [] })),
      // Phiếu đã huỷ vẫn trả về (hiện gạch ngang + lý do) nhưng không tính vào đã thu.
      schedules, payments: payments.map(p => ({ ...p, voidedByName: p.voidedBy ? person(p.voidedBy)?.name ?? '' : '' })),
      receivable: receivable(net.schedules, net.payments, vietnamDate().iso), canVoidPayment: canVoidPayment(viewer(c)),
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
      const [contract] = await c.env.db.select({ no: salesContracts.contractNo }).from(salesContracts).where(eq(salesContracts.orderId, o.id)).limit(1);
      return json(await sapoPreview(c, { code: contract?.no || o.orderNo, ownerId: o.ownerId, lines: lines.map(l => ({ sku: l.sku.trim() })), customerName: o.customerName }));
    }
    const [quote] = await c.env.db.select().from(quotations).where(and(eq(quotations.id, text(p.get('quoteId'), 80)), quotationPredicate(me))).limit(1);
    if (!quote) throw new AppError(404, 'Không tìm thấy báo giá.');
    const data = JSON.parse(quote.data);
    return json(await sapoPreview(c, { code: '', ownerId: quote.assigneeId ?? quote.creatorId, lines: orderLinesFromQuote(data).map(l => ({ sku: String(l.sku ?? '').trim() })), customerName: text(data.customer) || quote.customer }));
  }, 'business');

  /** Tạo đơn từ báo giá (người xem được báo giá mới tạo được). Mỗi báo giá một đơn đang hiệu lực. */
  router.post('/orders', async c => {
    const body = await readJson(c.req, 128_000), me = viewer(c), quoteId = text(body.quoteId, 80);
    const [quote] = await c.env.db.select().from(quotations).where(and(eq(quotations.id, quoteId), quotationPredicate(me))).limit(1);
    if (!quote) throw new AppError(404, 'Không tìm thấy báo giá.');
    if (quote.approvalStatus !== 'approved') throw new AppError(409, 'Báo giá chưa được duyệt. Chỉ báo giá đã duyệt mới tạo được đơn hàng.', 'QUOTE_NOT_APPROVED');
    const input = cleanOrderInput(body);
    // Đơn sinh từ báo giá luôn là NHÁP – kể cả Manager tạo – chờ Manager duyệt.
    // Có tạo đơn Sapo (mặc định): đẩy trong cùng giao dịch (Sapo lỗi → không tạo đơn); `pushSapo: false` → chỉ tạo đơn web. HĐKT là luồng riêng: POST /contracts { quoteId }.
    const viaClaw = wantsSapoPush(c, body) && sapoPushViaClaw(c);
    const push = wantsSapoPush(c, body) && !viaClaw ? await prepareSapoPush(c, sapoLocationOf(body)) : null;
    let sapo: SapoPushOutcome = null;
    // Nhân viên sinh đơn: NHÁP, chỉ gửi Manager khi bấm "Gửi duyệt" (POST /orders/:id/submit). Manager sinh đơn: coi như đã gửi.
    const submitted = me.role === 'manager';
    const id = await createOrderFromQuote(c.env.db, quote, { createdBy: me.id, status: 'draft', submitted, ...input,
      inTx: push ? async (tx, orderId) => { sapo = await push.push(tx, orderId); } : undefined }).finally(() => push?.done());
    if (viaClaw) sapo = await sendOrderToClaw(c, id, 'order');
    const [o] = await c.env.db.select({ orderNo: salesOrders.orderNo, customerName: salesOrders.customerName, total: salesOrders.total }).from(salesOrders).where(eq(salesOrders.id, id)).limit(1);
    if (submitted) await notifyMany(c.env, 'approvers', { eventType: 'order_pending', title: 'Đơn hàng mới chờ duyệt', body: `${me.name}: ${o!.orderNo} – ${o!.customerName} · ${new Intl.NumberFormat('vi-VN').format(o!.total)} đ`,
      url: `/index.html#/orders/${id}`, actorId: me.id, data: { orderId: id } });
    return json({ id, sapo }, 201);
  }, 'business');

  /** Nhân viên xem kỹ đơn / HĐKT nháp rồi bấm "Gửi duyệt" → Manager nhận thông báo + việc "Duyệt". */
  router.post('/orders/:id/submit', async c => {
    const me = viewer(c), order = await loadOrder(c, c.params.id!);
    if (order.status !== 'draft') throw new AppError(409, 'Chỉ gửi duyệt được đơn / HĐKT còn nháp.');
    await assertCanEditOrder(c, order);
    if (order.submittedAt) return json({ ok: true, submittedAt: order.submittedAt });
    const now = nowIso();
    const rows = await c.env.db.update(salesOrders).set({ submittedAt: now, updatedAt: now, revision: sql`${salesOrders.revision} + 1` })
      .where(and(eq(salesOrders.id, order.id), eq(salesOrders.status, 'draft'), isNull(salesOrders.submittedAt))).returning({ id: salesOrders.id });
    if (rows.length) {
      const [k] = await c.env.db.select({ no: salesContracts.contractNo }).from(salesContracts).where(eq(salesContracts.orderId, order.id)).limit(1);
      await notifyMany(c.env, 'approvers', k
        ? { eventType: 'contract_pending', title: 'HĐKT mới chờ duyệt', body: `${me.name}: ${k.no} – ${order.customerName}`, url: `/index.html#/contracts/${order.id}`, actorId: me.id, data: { orderId: order.id } }
        : { eventType: 'order_pending', title: 'Đơn hàng mới chờ duyệt', body: `${me.name}: ${order.orderNo} – ${order.customerName} · ${new Intl.NumberFormat('vi-VN').format(order.total)} đ`, url: `/index.html#/orders/${order.id}`, actorId: me.id, data: { orderId: order.id } });
    }
    return json({ ok: true, submittedAt: now });
  }, 'business');

  /** Push an existing document; never create another CRM order/contract. Row lock serializes double clicks. */
  router.post('/orders/:id/sapo', async c => {
    const body = await readJson(c.req, 1_024), order = await loadOrder(c, c.params.id!);
    if (order.sapoOrderId) return json({ sapo: linkedSapo(c, order) });
    // Công tắc tắt đẩy Sapo (SAPO_ORDER_PUSH=off) áp dụng cho cả nút "Tạo đơn Sapo" trên chứng từ có sẵn.
    if (!sapoPushRequired(c)) throw new AppError(409, 'Đẩy đơn sang Sapo đang tắt trên hệ thống.', 'SAPO_PUSH_DISABLED');
    await assertCanCreateSapo(c, order);
    if (sapoPushViaClaw(c)) return json({ sapo: await sendOrderToClaw(c, order.id, (await c.env.db.select({ id: salesContracts.id }).from(salesContracts).where(eq(salesContracts.orderId, order.id)).limit(1)).length ? 'hdkt' : 'order') });
    const push = await prepareSapoPush(c, sapoLocationOf(body));
    const sapo = await c.env.db.transaction(async tx => {
      const [locked] = await tx.select().from(salesOrders).where(and(eq(salesOrders.id, order.id), orderScope(c))).limit(1).for('update');
      if (!locked) throw new AppError(404, 'Không tìm thấy đơn hàng / HĐKT.');
      if (locked.sapoOrderId) return linkedSapo(c, locked);
      await assertCanCreateSapo(c, locked);
      return push.push(tx, locked.id);
    }).finally(() => push.done());
    return json({ sapo });
  }, 'business');

  router.put('/orders/:id/status', async c => {
    const body = await readJson(c.req, 1_024), status = body.status;
    if (status !== 'cancelled' && status !== 'confirmed') throw new AppError(400, 'Chỉ đổi được sang "Đã xác nhận" hoặc "Huỷ".');
    const order = await loadOrder(c, c.params.id!);
    if (order.status !== 'draft' && viewer(c).role !== 'manager') throw new AppError(403, 'Đơn đã duyệt. Chỉ Manager được chỉnh sửa hoặc huỷ.', 'ORDER_APPROVED');
    if (status === 'cancelled' && saleFlowOf(order.posSnapshot)) throw new AppError(409,'Đơn cọc/trả trước: dùng Huỷ/hoàn tại POS để xử lý tiền và hàng.');
    if (status === 'cancelled') await assertCanEditOrder(c, order);
    if (status === 'cancelled') {
      const [paid] = await c.env.db.select({ n: sql<number>`count(*)` }).from(customerPayments).where(and(eq(customerPayments.orderId, order.id), isNull(customerPayments.voidedAt)));
      const lines = await c.env.db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, order.id));
      if (Number(paid?.n) > 0 || lines.some(l => l.deliveredQty > 0)) throw new AppError(409, 'Đơn đã giao hoặc đã thu tiền, không huỷ được.');
    }
    if (status === 'confirmed' && !canApprove(viewer(c))) throw new AppError(403, 'Chỉ Manager hoặc người được Manager chỉ định duyệt đơn hàng / HĐKT.', 'APPROVER_ONLY');
    if (status === 'confirmed' && order.status !== 'draft') throw new AppError(409, 'Chỉ duyệt được đơn đang chờ duyệt.');
    // Bước xác thực: nhân viên phải đánh dấu đã kiểm tra các thông tin quan trọng trước khi duyệt đơn.
    if (status === 'confirmed' && body.verified !== true) throw new AppError(400, 'Kiểm tra và đánh dấu đủ các thông tin quan trọng trước khi xác nhận đơn.', 'VERIFY_REQUIRED');
    await c.env.db.transaction(async tx => {
      // Khoá đơn rồi kiểm lại trong giao dịch: phiếu thu / chuyến giao vừa ghi cùng lúc không lọt qua khi huỷ.
      const [locked] = await tx.select({ status: salesOrders.status }).from(salesOrders).where(eq(salesOrders.id, order.id)).for('update');
      if (locked?.status !== order.status) throw new AppError(409, 'Đơn hàng / HĐKT vừa thay đổi. Tải lại trang.', 'ORDER_CHANGED');
      if (status === 'cancelled') {
        const [[paidNow], shippedNow] = await Promise.all([
          tx.select({ n: count() }).from(customerPayments).where(and(eq(customerPayments.orderId, order.id), isNull(customerPayments.voidedAt))),
          tx.select({ id: salesOrderLines.id }).from(salesOrderLines).where(and(eq(salesOrderLines.orderId, order.id), sql`${salesOrderLines.deliveredQty} > 0`)).limit(1),
        ]);
        if (Number(paidNow?.n) > 0 || shippedNow.length) throw new AppError(409, 'Đơn đã giao hoặc đã thu tiền, không huỷ được.');
      }
      await tx.update(salesOrders).set({ status, updatedAt: nowIso(), revision: sql`${salesOrders.revision} + 1` }).where(eq(salesOrders.id, order.id));
      // Huỷ: dọn việc còn treo của đơn – phiếu đóng gói chưa đóng / chuyến giao chưa giao huỷ theo (việc kho / giao tự đóng);
      // phiếu kho đã đóng (đã ghi xuất sổ kho) thì ghi dòng đảo – hàng về lại kho – rồi huỷ phiếu.
      if (status === 'cancelled') {
        const now = nowIso(), me = viewer(c);
        const packed = await tx.update(packingSlips).set({ status: 'cancelled', updatedAt: now, revision: sql`${packingSlips.revision} + 1` })
          .where(and(eq(packingSlips.orderId, order.id), inArray(packingSlips.status, ['draft', 'sent', 'packed']))).returning({ id: packingSlips.id, no: packingSlips.slipNo });
        for (const s of packed) await reverseRef(tx, me.id, 'packing_slip', s.id, `Huỷ ${order.orderNo}: hàng đã đóng của phiếu ${s.no} về lại kho`, now);
        await tx.update(deliveries).set({ status: 'cancelled', updatedAt: now }).where(and(eq(deliveries.orderId, order.id), inArray(deliveries.status, ['planned', 'in_transit'])));
      }
      // Khách đặt hàng thẳng (báo giá chưa duyệt): nhân viên xác nhận đơn = duyệt luôn báo giá của đơn.
      if (status === 'confirmed' && order.quoteId)
        await tx.update(quotations).set({ approvalStatus: 'approved', approvedAt: nowIso(), approvedBy: viewer(c).id })
          .where(and(eq(quotations.id, order.quoteId), inArray(quotations.approvalStatus, ['draft', 'pending'])));
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

  /** Nhân viên / Kế toán / Manager nhập số hoá đơn (sửa lại được khi nhập nhầm). Việc "Xuất hoá đơn" tự hoàn thành. */
  router.put('/orders/:id/invoice', async c => {
    if (!canIssueInvoice(viewer(c))) throw new AppError(403, 'Bạn không có quyền nhập số hoá đơn.');
    const body = await readJson(c.req, 4_096), order = await loadOrder(c, c.params.id!);
    if (order.status === 'cancelled' || order.status === 'draft') throw new AppError(409, order.status === 'draft' ? 'Đơn chưa được duyệt, chưa nhập số hoá đơn được.' : 'Đơn đã huỷ.');
    const invoiceNo = text(body.invoiceNo, 200), invoiceDate = body.invoiceDate ? String(body.invoiceDate) : vietnamDate().iso;
    if (!invoiceNo) throw new AppError(400, 'Nhập số hoá đơn.');
    if (!isDate(invoiceDate)) throw new AppError(400, 'Ngày hoá đơn không hợp lệ.');
    const now = nowIso();
    await c.env.db.update(salesOrders).set({ invoiceStatus: 'issued', invoiceNo, invoiceDate, invoiceIssuedAt: now, invoiceIssuedBy: viewer(c).id,
      invoiceRequestedAt: order.invoiceRequestedAt ?? now, updatedAt: now, revision: sql`${salesOrders.revision} + 1` }).where(eq(salesOrders.id, order.id));
    if (order.invoiceStatus !== 'issued') {
      const ref = docRef(order.id, order.orderNo, (await contractNosOf(c.env.db, [order.id])).get(order.id));
      await notifyMany(c.env, [order.ownerId, order.invoiceRequestedBy], { eventType: 'invoice_issued', title: 'Đã xuất hoá đơn', body: `${ref.no} – ${order.customerName} · HĐ ${invoiceNo}`,
        url: `/index.html${ref.link}`, actorId: viewer(c).id, data: { orderId: order.id } }).catch(() => 0);
    }
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
      .from(quotations).where(and(quotationPredicate(viewer(c)), eq(quotations.approvalStatus, 'approved'),
        sql`NOT EXISTS (SELECT 1 FROM ${salesOrders} WHERE ${salesOrders.quoteId} = ${quotations.id} AND ${salesOrders.status} <> 'cancelled')`,
        matchAllWords(foldSql(quotations.quoteNo, quotations.customer), c.url.searchParams.get('q'))))
      .orderBy(desc(quotations.updatedAt)).limit(30);
    return json({ quotes: rows });
  }, 'business');

  // ================= HĐKT =================
  router.get('/contracts', async c => {
    const { limit, offset } = paging(c.url, 200, 500);
    const invoice = c.url.searchParams.get('invoice') || '';
    const where = and(orderScope(c), matchAllWords(foldSql(salesContracts.contractNo, salesOrders.quoteNo, salesOrders.customerName), c.url.searchParams.get('q')),
      invoice === 'requested' || invoice === 'issued' || invoice === 'none' ? eq(salesOrders.invoiceStatus, invoice) : undefined);
    const [[{ n: total = 0 } = {}], rows, [{ n: invoicePending = 0 } = {}]] = await Promise.all([
      c.env.db.select({ n: count() }).from(salesContracts).innerJoin(salesOrders, eq(salesOrders.id, salesContracts.orderId)).where(where),
      c.env.db.select({ contract: salesContracts, orderNo: salesOrders.orderNo, customerName: salesOrders.customerName, quoteNo: salesOrders.quoteNo, orderStatus: salesOrders.status,
      invoiceStatus: salesOrders.invoiceStatus, invoiceNo: salesOrders.invoiceNo })
      .from(salesContracts).innerJoin(salesOrders, eq(salesOrders.id, salesContracts.orderId))
      .where(where).orderBy(desc(salesContracts.createdAt), desc(salesContracts.id)).limit(limit).offset(offset),
      c.env.db.select({ n: count() }).from(salesContracts).innerJoin(salesOrders, eq(salesOrders.id, salesContracts.orderId))
        .where(and(orderScope(c), ne(salesOrders.status, 'cancelled'), eq(salesOrders.invoiceStatus, 'requested'))),
    ]);
    const debts = await receivableOf(c.env.db, [...new Set(rows.map(r => r.contract.orderId))]);
    return json({ contracts: rows.map(r => ({ ...r.contract, data: undefined, orderNo: r.orderNo, customerName: r.customerName, quoteNo: r.quoteNo, orderStatus: r.orderStatus,
      invoiceStatus: r.invoiceStatus, invoiceNo: r.invoiceNo,
      receivable: debts.get(r.contract.orderId), debtCounts: debtCounts(r.orderStatus, r.contract.status) })), total: Number(total), limit, offset, invoicePending: Number(invoicePending) });
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
    const [quote] = await c.env.db.select().from(quotations).where(and(eq(quotations.id, quoteId), quotationPredicate(me))).limit(1);
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
    const [quote] = await c.env.db.select().from(quotations).where(and(eq(quotations.id, quoteId), quotationPredicate(me))).limit(1);
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
    const viaClaw = wantsSapoPush(c, body) && sapoPushViaClaw(c);
    const push = wantsSapoPush(c, body) && !viaClaw ? await prepareSapoPush(c, sapoLocationOf(body)) : null;
    let contractNo = '', sapo: SapoPushOutcome = null;
    let orderId = '';
    try {
      orderId = await createOrderFromQuote(c.env.db, quote, { createdBy: me.id, status: 'draft', submitted: me.role === 'manager', inTx: async (tx, oid) => {
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
    if (viaClaw) sapo = await sendOrderToClaw(c, orderId, 'hdkt');
    if (me.role === 'manager') await notifyMany(c.env, 'approvers', { eventType: 'contract_pending', title: 'HĐKT mới chờ duyệt',
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
      await assertCanEditOrder(c, found.order, 'HĐKT', tx);
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
    const focusId = c.url.searchParams.get('id');
    const from = focusId ? null : c.url.searchParams.get('from'), to = focusId ? null : c.url.searchParams.get('to'), status = focusId ? '' : c.url.searchParams.get('status') || '';
    const rows = await c.env.db.select({ d: deliveries, orderNo: salesOrders.orderNo, contractNo: salesContracts.contractNo, customerName: salesOrders.customerName,
      contact: salesOrders.contact, phone: salesOrders.phone, orderAddress: salesOrders.address })
      .from(deliveries).innerJoin(salesOrders, eq(salesOrders.id, deliveries.orderId)).leftJoin(salesContracts, eq(salesContracts.orderId, deliveries.orderId))
      .where(and(deliveryScope(c), focusId ? eq(deliveries.id, focusId) : undefined, isDate(from) ? gte(deliveries.plannedDate, from!) : undefined, isDate(to) ? lte(deliveries.plannedDate, to!) : undefined,
        status ? eq(deliveries.status, status as never) : undefined))
      .orderBy(desc(deliveries.plannedDate), desc(deliveries.createdAt), desc(deliveries.id)).limit(500);
    // `contractNo` có → chuyến giao của HĐKT (hiện số HĐKT, mở #/contracts/…), không phải của đơn hàng.
    // Liên hệ / địa chỉ của khách trên đơn: kho (không xem được danh bạ khách) vẫn có đủ thông tin để liên hệ giao hàng.
    const photos = await photoUrls(c.env.db, c.env.files, 'delivery', rows.filter(r => r.d.status === 'delivered').map(r => r.d.id));
    return json({ canCancel: !isWarehouseMember(viewer(c)), deliveries: rows.map(r => ({ ...r.d, shippingFee: isWarehouseMember(viewer(c)) ? null : r.d.shippingFee, orderNo: r.orderNo, contractNo: r.contractNo ?? null, customerName: r.customerName,
      customerContact: r.contact, customerPhone: r.phone, customerAddress: r.orderAddress, photos: photos.get(r.d.id) ?? [] })) });
  }, 'business');

  /** Lên lịch giao: số lượng mỗi dòng không vượt phần còn lại (đã trừ hàng đã giao và các chuyến đang chờ giao). */
  /** Đổi ngày giao dự kiến của đơn (nhân viên chọn ở ô Lịch giao hàng). Đơn khách đặt: khách thấy ngày mới và nhận thông báo. */
  router.put('/orders/:id/delivery-date', async c => {
    const body = await readJson(c.req, 1_024), date = String(body.date || '');
    if (!isDate(date)) throw new AppError(400, 'Chọn ngày giao hợp lệ.');
    const order = await loadOrder(c, c.params.id!);
    if (order.status !== 'draft' && viewer(c).role !== 'manager') throw new AppError(403, 'Đơn đã duyệt. Chỉ Manager được đổi ngày giao.', 'ORDER_APPROVED');
    // Người được duyệt chốt ngày giao ngay trong hộp "Duyệt" của đơn đã gửi duyệt (không phải người phụ trách vẫn được).
    if (!(canApprove(viewer(c)) && order.status === 'draft' && order.submittedAt)) await assertCanEditOrder(c, order);
    if (order.status === 'cancelled' || order.status === 'delivered') throw new AppError(409, 'Đơn đã huỷ hoặc đã giao xong, không đổi ngày giao được.');
    await setExpectedDeliveryDate(c, order, date);
    return json({ ok: true, expectedDeliveryDate: date });
  }, 'business');

  router.post('/deliveries', async c => {
    const body = await readJson(c.req, 64_000), me = viewer(c);
    const order = await loadOrder(c, text(body.orderId, 80));
    if (order.status === 'cancelled') throw new AppError(409, 'Đơn đã huỷ.');
    if (order.status === 'draft') throw new AppError(409, 'Đơn chưa được Manager duyệt, chưa lên lịch giao được.', 'ORDER_NOT_APPROVED');
    const made = await c.env.db.transaction(tx => createScheduledDelivery(tx, order.id, body, me.id));
    const { id, plannedDate } = made;
    // Ngày lên lịch giao trở thành ngày giao dự kiến của đơn (đơn của khách cũng cập nhật theo).
    await setExpectedDeliveryDate(c, order, plannedDate);
    return json({ id }, 201);
  }, 'business');

  /**
   * Đổi trạng thái chuyến giao. "Đã giao" cộng số lượng vào đơn (chỉ một lần), cập nhật trạng thái đơn và hạn công nợ.
   * Kho bấm "Đã giao" phải kèm 1–3 ảnh (hàng đã giao / biên bản ký nhận); người khác tuỳ chọn. Kho không huỷ được chuyến (Sale / Manager huỷ).
   */
  router.put('/deliveries/:id/status', async c => {
    const body = await readJson(c.req, 2_000 + WH_PHOTO_MAX * WH_PHOTO_MAX_CHARS), status = body.status as typeof DELIVERY_STATUSES[number], me = viewer(c);
    if (!DELIVERY_STATUSES.includes(status)) throw new AppError(400, 'Trạng thái giao hàng không hợp lệ.');
    if (status === 'cancelled' && isWarehouseMember(me)) throw new AppError(403, 'Kho không huỷ được chuyến giao. Báo nhân viên phụ trách đơn hoặc Manager.');
    const photos = status === 'delivered' ? parsePhotos(body.photos, { min: isWarehouseMember(me) ? 1 : 0, required: 'Chụp 1–3 ảnh hàng đã giao hoặc biên bản ký nhận.' }) : [];
    const [row] = await c.env.db.select({ d: deliveries, status: salesOrders.status }).from(deliveries).innerJoin(salesOrders, eq(salesOrders.id, deliveries.orderId))
      .where(and(eq(deliveries.id, c.params.id!), deliveryScope(c))).limit(1);
    if (!row) throw new AppError(404, 'Không tìm thấy lịch giao.');
    if (row.d.status === 'delivered') throw new AppError(409, 'Chuyến này đã giao xong, không đổi trạng thái được.');
    if (row.d.status === 'cancelled') throw new AppError(409, 'Chuyến đã huỷ. Lên lịch chuyến mới nếu cần giao lại.');
    if (row.status === 'cancelled' && status !== 'cancelled') throw new AppError(409, 'Đơn hàng / HĐKT đã huỷ, không giao được.');
    // Chỉ đi tới: Chờ giao ⇄ Đang giao → Đã giao / Thất bại; Thất bại → Chờ giao (giao lại); huỷ khi chưa giao. "Đã giao" chỉ từ Chờ / Đang giao.
    const from: Record<string, readonly string[]> = { planned: ['in_transit', 'failed'], in_transit: ['planned', 'failed'], failed: ['planned'], delivered: ['planned', 'in_transit'], cancelled: ['planned', 'in_transit', 'failed'] };
    if (!from[status]!.includes(row.d.status)) throw new AppError(409, 'Không đổi được trạng thái chuyến giao theo thứ tự này.', 'DELIVERY_STATUS_FLOW');
    const deliveredOn = status === 'delivered' ? (isDate(body.deliveredOn) ? String(body.deliveredOn) : vietnamDate().iso) : null;
    await c.env.db.transaction(async tx => {
      const [flowOrder] = await tx.select().from(salesOrders).where(eq(salesOrders.id,row.d.orderId));
      if(saleFlowOf(flowOrder?.posSnapshot)){await cashLock(tx);if(['in_transit','delivered'].includes(status))await assertPosFlowFulfillable(tx,row.d.orderId);if(status==='cancelled'&&(await tx.select({id:stockMoves.id}).from(stockMoves).where(and(eq(stockMoves.refType,'pos_delivery'),eq(stockMoves.refId,row.d.id))).limit(1)).length)throw new AppError(409,'Chuyến đã xuất hàng: dùng yêu cầu trả/thu hồi, không huỷ lịch thẳng.');}
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('stock_holds'))`);
      // Đổi có điều kiện trạng thái cũ (trong giao dịch): hai lần bấm "Đã giao" cùng lúc chỉ một lần cộng số đã giao.
      const done = await tx.update(deliveries).set({ status, deliveredAt: deliveredOn, updatedAt: nowIso() })
        .where(and(eq(deliveries.id, row.d.id), inArray(deliveries.status, [...from[status]!] as typeof DELIVERY_STATUSES[number][]))).returning({ id: deliveries.id });
      if (!done.length) throw new AppError(409, 'Chuyến giao vừa được người khác cập nhật. Tải lại trang.', 'DELIVERY_CHANGED');
      if(status==='in_transit'&&saleFlowOf(flowOrder?.posSnapshot)==='prepaid')await issuePosDelivery(tx,row.d.orderId,row.d.id,me.id,true);
      if (status !== 'delivered') return;
      await savePhotos(tx, c.env.files, me.id, 'delivery', row.d.id, photos);
      for (const l of await tx.select().from(deliveryLines).where(eq(deliveryLines.deliveryId, row.d.id)))
        await tx.update(salesOrderLines).set({ deliveredQty: sql`LEAST(${salesOrderLines.qty}, ${salesOrderLines.deliveredQty} + ${l.qty})` }).where(eq(salesOrderLines.id, l.orderLineId));
      if (status === 'delivered') await issuePosDelivery(tx, row.d.orderId, row.d.id, me.id);
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
    // Giao xong / giao thất bại: báo nhân viên phụ trách đơn (giao lại, đòi tiền, xuất hoá đơn).
    if (status === 'delivered' || status === 'failed') {
      const [o] = await c.env.db.select({ orderNo: salesOrders.orderNo, ownerId: salesOrders.ownerId, customerName: salesOrders.customerName }).from(salesOrders).where(eq(salesOrders.id, row.d.orderId)).limit(1);
      const ref = docRef(row.d.orderId, o?.orderNo ?? '', (await contractNosOf(c.env.db, [row.d.orderId])).get(row.d.orderId));
      if (o) await notifyMany(c.env, [o.ownerId], { eventType: status === 'delivered' ? 'delivery_done' : 'delivery_failed', title: status === 'delivered' ? 'Đã giao hàng' : 'Giao hàng không thành công',
        body: `${row.d.deliveryNo} · ${ref.no} – ${o.customerName}`, url: `/index.html${ref.link}`, actorId: me.id, data: { orderId: row.d.orderId, deliveryId: row.d.id } }).catch(() => 0);
    }
    return json({ ok: true });
  }, 'business');

  // ================= CÔNG NỢ =================
  /** Công nợ theo đơn: chỉ đơn đã xác nhận hoặc có HĐKT đã ký (đơn nháp / huỷ không tính). `?status=open|overdue|paid` lọc theo tình trạng. */
  router.get('/receivables', async c => {
    const want = c.url.searchParams.get('status') || '';
    // Lọc trong SQL trước khi giới hạn số dòng: chỉ đơn có công nợ (đã duyệt hoặc HĐKT đã ký) và – trừ khi xem "Đã thu đủ" – còn phải thu,
    // để đơn cũ còn nợ không bị đơn mới đã thu đủ đẩy ra khỏi danh sách.
    const due = sql`((SELECT coalesce(sum(${paymentSchedules.amount}), 0) FROM ${paymentSchedules} WHERE ${paymentSchedules.orderId} = ${salesOrders.id}) - (select coalesce(sum(${posReturns.total}),0) from ${posReturns} where ${posReturns.orderId}=${salesOrders.id} and ${posReturns.creditEffectiveAt} is not null))`;
    const paid = sql`((SELECT coalesce(sum(${customerPayments.amount}), 0) FROM ${customerPayments} WHERE ${customerPayments.orderId} = ${salesOrders.id} AND ${customerPayments.voidedAt} IS NULL) - (select coalesce(sum(${posRefunds.amount}),0) from ${posRefunds} inner join ${posReturns} on ${posReturns.id}=${posRefunds.returnId} where ${posReturns.orderId}=${salesOrders.id}) - (select coalesce(sum(${posExchangeAllocations.amount}),0) from ${posExchangeAllocations} inner join ${posReturns} on ${posReturns.id}=${posExchangeAllocations.returnId} where ${posReturns.orderId}=${salesOrders.id} and ${posExchangeAllocations.status}='applied'))`;
    const rows = await c.env.db.select().from(salesOrders).where(and(orderScope(c), ne(salesOrders.status, 'cancelled'),
      or(ne(salesOrders.status, 'draft'), sql`EXISTS (SELECT 1 FROM ${salesContracts} WHERE ${salesContracts.orderId} = ${salesOrders.id} AND ${salesContracts.status} IN ('signed', 'completed'))`),
      want === 'paid' ? sql`${due} > 0 AND ${paid} >= ${due}` : sql`${due} > ${paid}`,
      matchAllWords(foldSql(salesOrders.orderNo, salesOrders.customerName, salesOrders.phone, salesOrders.taxCode,
        sql`(SELECT ${salesContracts.contractNo} FROM ${salesContracts} WHERE ${salesContracts.orderId} = ${salesOrders.id})`), c.url.searchParams.get('q'))))
      .orderBy(desc(salesOrders.orderDate)).limit(2000);
    const contracts = rows.length ? await c.env.db.select({ orderId: salesContracts.orderId, status: salesContracts.status, no: salesContracts.contractNo }).from(salesContracts).where(inArray(salesContracts.orderId, rows.map(r => r.id))) : [];
    const counted = rows.filter(r => debtCounts(r.status, contracts.find(x => x.orderId === r.id)?.status)), ids = counted.map(r => r.id);
    const [sch, pay] = ids.length ? await Promise.all([
      c.env.db.select().from(paymentSchedules).where(inArray(paymentSchedules.orderId, ids)),
      c.env.db.select().from(customerPayments).where(and(inArray(customerPayments.orderId, ids), isNull(customerPayments.voidedAt))),
    ]) : [[], []];
    const today = vietnamDate().iso, owners = new Map((ids.length ? await c.env.db.select({ id: employees.id, name: employees.name }).from(employees)
      .where(inArray(employees.id, [...new Set(counted.map(r => r.ownerId))])) : []).map(e => [e.id, e.name]));
    const adjustments=await returnAdjustments(c.env.db,ids);
    const list = counted.map(r => {
      const net=netReturnInputs(sch.filter(x=>x.orderId===r.id),pay.filter(x=>x.orderId===r.id),adjustments.get(r.id)),s=net.schedules,p=net.payments;
      return { orderId: r.id, orderNo: r.orderNo, contractNo: contracts.find(x => x.orderId === r.id)?.no ?? null, customerId: r.customerId, customerName: r.customerName, phone: r.phone,
        orderDate: r.orderDate, orderStatus: r.status, invoiceNo: r.invoiceNo, ownerName: owners.get(r.ownerId) ?? '', ...receivable(s, p, today), aging: debtAging(s, p, today) };
    })
      .filter(r => r.status !== 'none' && (!want || r.status === want || (want === 'open' && r.status === 'overdue')));
    const sum = (k: 'due' | 'paid' | 'balance' | 'overdue') => list.reduce((s, r) => s + r[k], 0);
    const aged = (k: 'd30' | 'd60' | 'over60') => list.reduce((s, r) => s + r.aging.buckets[k], 0);
    return json({ receivables: list, totals: { due: sum('due'), paid: sum('paid'), balance: sum('balance'), overdue: sum('overdue'), aging: { d30: aged('d30'), d60: aged('d60'), over60: aged('over60') } } });
  }, 'business');

  /** Ghi nhận phiếu thu. Không thu vượt số còn phải thu của đơn. */
  router.post('/payments', async c => {
    const body = await readJson(c.req, 8_192), me = viewer(c);
    const order = await loadOrder(c, text(body.orderId, 80));
    if(saleFlowOf(order.posSnapshot))throw new AppError(409,'Đơn cọc/trả trước: dùng Thu tiền trong POS để kiểm tra ca và giữ hàng.');
    if (order.status === 'cancelled') throw new AppError(409, 'Đơn hàng / HĐKT đã huỷ, không ghi thu được.');
    if (order.status === 'draft') throw new AppError(409, 'Đơn hàng / HĐKT chưa được duyệt, chưa ghi thu được (chưa phát sinh công nợ).', 'ORDER_NOT_APPROVED');
    const posReceipt = order.channel === 'pos';
    if(posReceipt && order.fulfillmentMode==='cod') throw new AppError(409,'Thu COD tại Bán hàng nhanh để gắn đúng chuyến giao.','POS_PAYMENT_REQUIRED');
    if(posReceipt && !can(me,'pos.sell')) throw new AppError(403,'Cần quyền POS để ghi lại khoản thu vào ca.');
    const amount = money(body.amount, 'Số tiền');
    if (amount <= 0) throw new AppError(400, 'Số tiền phải lớn hơn 0.');
    const paidAt = String(body.paidAt || vietnamDate().iso);
    if (!isDate(paidAt)) throw new AppError(400, 'Ngày thu không hợp lệ.');
    if (paidAt > vietnamDate().iso) throw new AppError(400, 'Ngày thu không được sau hôm nay.');
    const method = (body.method ?? 'transfer') as typeof PAYMENT_METHODS[number];
    if (!PAYMENT_METHODS.includes(method)) throw new AppError(400, 'Hình thức thanh toán không hợp lệ.');
    const requestKey = posReceipt ? text(body.key,100) : null;
    if(posReceipt && (!requestKey || !/^[a-zA-Z0-9_-]{16,100}$/.test(requestKey) || !Number.isSafeInteger(amount) || !['cash','transfer'].includes(method) || body.confirmed!==true)) throw new AppError(400,'Xác nhận đã thực nhận tiền, chọn tiền mặt/chuyển khoản và cung cấp mã chống lặp hợp lệ.');
    const scheduleId = body.scheduleId ? text(body.scheduleId, 80) : null;
    if (scheduleId && !(await c.env.db.select({ id: paymentSchedules.id }).from(paymentSchedules).where(and(eq(paymentSchedules.id, scheduleId), eq(paymentSchedules.orderId, order.id))).limit(1)).length)
      throw new AppError(400, 'Kỳ thanh toán không thuộc đơn này.');
    const id = crypto.randomUUID();
    let receiptId:string=id;
    // Khoá dòng đơn rồi mới tính số còn phải thu: hai lần bấm / hai người ghi cùng lúc không thu vượt.
    await c.env.db.transaction(async tx => {
      await cashLock(tx);
      if(requestKey){const [prior]=await tx.select().from(customerPayments).where(eq(customerPayments.requestKey,requestKey));if(prior){if(prior.orderId!==order.id||prior.amount!==amount||prior.method!==method||prior.createdBy!==me.id||prior.voidedAt)throw new AppError(409,'Mã ghi thu đã dùng cho giao dịch khác.');receiptId=prior.id;return;}}
      let cashShiftId:string|null=null;
      const [cashShift] = await tx.select().from(posShifts).where(and(eq(posShifts.memberId, me.id), isNull(posShifts.closedAt)));
      if (posReceipt || (method === 'cash' && (cashShift || (await drawerOf(tx)).openingSetAt))) {
        if (!cashShift) throw new AppError(409, 'Cần ca đang mở để ghi tiền mặt vào két.');
        if (posReceipt && order.shiftId) {
          const [originalShift] = await tx.select().from(posShifts).where(eq(posShifts.id, order.shiftId));
          if (!originalShift || originalShift.cashDrawerId !== cashShift.cashDrawerId) throw new AppError(409, 'Cần mở ca tại đúng két của đơn POS để ghi thu.');
        }
        if (paidAt !== vietnamDate().iso) throw new AppError(400, 'Tiền vào két ghi nhận ngày thực thu hôm nay.');
        cashShiftId = cashShift.id;
      }
      await tx.select({ id: salesOrders.id }).from(salesOrders).where(eq(salesOrders.id, order.id)).for('update');
      const debt = (await receivableOf(tx, [order.id])).get(order.id)!;
      if (amount > debt.balance) throw new AppError(400, `Đơn chỉ còn phải thu ${debt.balance.toLocaleString('vi-VN')} đ.`);
      await tx.insert(customerPayments).values({ id, orderId: order.id, scheduleId, customerId: order.customerId, shiftId:cashShiftId, requestKey, paymentSource:posReceipt?'pos':'manual', amount, paidAt, method, reference: text(body.reference, 200), note: text(body.note, 2000), createdBy: me.id, createdAt: nowIso() });
      if(cashShiftId)await cashAudit(tx,me.id,'receipt','payments',id,{orderId:order.id,shiftId:cashShiftId,amount,method});
    });
    return json({ id:receiptId }, 201);
  }, 'business');

  /** Huỷ phiếu thu ghi nhầm (bắt buộc lý do). Phiếu giữ lại trong lịch sử, không tính vào đã thu; muốn sửa thì huỷ rồi ghi phiếu mới. */
  router.post('/payments/:id/void', async c => {
    const me = viewer(c), body = await readJson(c.req, 2_000), reason = text(body.reason, 500);
    if (!canVoidPayment(me)) throw new AppError(403, 'Chỉ Manager hoặc người có quyền "Huỷ phiếu thu" huỷ được phiếu thu.');
    if (reason.length < 3) throw new AppError(400, 'Ghi lý do huỷ phiếu thu.');
    const [p] = await c.env.db.select({ id: customerPayments.id, orderId: customerPayments.orderId, voidedAt: customerPayments.voidedAt, shiftId: customerPayments.shiftId, paymentSource: customerPayments.paymentSource, amount: customerPayments.amount }).from(customerPayments)
      .innerJoin(salesOrders, eq(salesOrders.id, customerPayments.orderId)).where(and(eq(customerPayments.id, c.params.id!), orderScope(c))).limit(1);
    if (!p) throw new AppError(404, 'Không tìm thấy phiếu thu.');
    if (p.voidedAt) throw new AppError(409, 'Phiếu thu đã huỷ.');
    await c.env.db.transaction(async tx=>{
    await cashLock(tx);
    await assertNoReturnActivity(tx,p.orderId);
    const done = await tx.update(customerPayments).set({ voidedAt: nowIso(), voidedBy: me.id, voidReason: reason })
      .where(and(eq(customerPayments.id, p.id), isNull(customerPayments.voidedAt))).returning({ id: customerPayments.id });
    if (!done.length) throw new AppError(409, 'Phiếu thu vừa được người khác huỷ.');
    if (p.paymentSource === 'pos_cod_deposit') {
      const [order] = await tx.select({ snapshot: salesOrders.posSnapshot }).from(salesOrders).where(eq(salesOrders.id, p.orderId));
      const deliveryId = JSON.parse(order?.snapshot || '{}').codDeliveryId;
      if (deliveryId) await tx.update(deliveries).set({ codAmount: sql`${deliveries.codAmount} + ${p.amount}`, updatedAt: nowIso() })
        .where(and(eq(deliveries.id, deliveryId), eq(deliveries.orderId, p.orderId)));
    }
    const [flowOrder] = await tx.select().from(salesOrders).where(eq(salesOrders.id,p.orderId));
    if(saleFlowOf(flowOrder?.posSnapshot) && ((await flowIssued(tx,p.orderId)).some(r=>r.qty>0)||flowOrder?.status==='delivered'))throw new AppError(409,'Đã xuất hàng: xử lý trả/hoàn thay vì huỷ phiếu thu.');
    if (saleFlowOf(flowOrder?.posSnapshot) && flowOrder?.status!=='delivered') await tx.update(posOrderReservations).set({expiresAt:sql`least(${posOrderReservations.expiresAt},${flowHoldUntil(nowIso())})`,updatedAt:nowIso()}).where(and(eq(posOrderReservations.orderId,p.orderId),eq(posOrderReservations.status,'active')));
    if(p.shiftId) await voidClosedCashEffect(tx,p.shiftId,me.id,`Huỷ phiếu thu ${p.id}: ${reason}`);
    await cashAudit(tx,me.id,'void','payments',p.id,{reason,shiftId:p.shiftId});
    });
    return json({ ok: true, orderId: p.orderId });
  }, 'business');
}
