import { orderExportDetails } from './order-export.ts';
import {registerWebOrderEdits} from './web-order-edit.ts';
import {webDocumentPage,webDocumentDetail} from './web-order-documents.ts';
import {cashCollections} from '../cash-collection-schema.ts';
import {registerCashCollectionRoutes,cashCollectionsForOrder,heldCashForOrder} from './cash-collections.ts';
import {canCollectCrmCashWithoutDrawer} from '../domain/crm-cash-receipt.ts';
import {orderReturnSummary} from './order-return-summary.ts';
import {registerContractLiquidationRoutes,assertNoLiquidationHistory} from './contract-liquidation.ts';
import { editPosOrderWithGhn } from './pos-ghn-edit.ts';
import { pendingGhnEdit, assertNoPendingGhnEdit } from '../domain/pos-ghn-edit.ts';
import { syncContractQuoteTerms } from './contract-quote-terms.ts';
import { contractTermsFromQuote } from '../domain/contract-quote-terms.ts';
import { balancePaymentDays, setBalanceDueOnDelivery, vnDay } from './payment-terms.ts';
import { registerCrmReturnRoutes } from './crm-return-routes.ts';
import { assertNotDispatched, recordDispatch } from './cancellation-guards.ts';
import { canConfirmDelivery, deliveryConfirmations } from './delivery-confirmation.ts';
import { auditLogs } from '../../../core/db/schema.ts';
import { isGhnTracked } from '../domain/ghn-status.ts';
import { assertCrmOrderCompletion } from './crm-stock-lifecycle.ts';
import { sha256Hex } from '../../staff/domain/session.ts';
import { autoHoldExpiry, holdOrderStock, lockHolds, releaseOrderHolds, retimeAutoHolds } from './order-hold-store.ts';
import { ensurePackingSchedule } from './delivery-store.ts';
import { saveQuoteStockPlan, assertPlannedDispatch } from './quote-sourcing-routes.ts';
import { documentNumberPatterns } from '../../../core/document-number.ts';
import { cancelGhnShipments } from './pos-ghn-cancel.ts';
import { approvalDebt, assertApprovalDebt, approvalCosts } from './approval-preflight.ts';
import { invoiceTasksChanged } from './invoice-task-hooks.ts';
import { posOrderStoreScope } from './pos-access.ts';
import { stockMoves } from '../../inventory/schema.ts';
import { saleFlowOf, flowHoldUntil } from '../domain/pos-order-flow.ts';
import { posOrderReservations } from '../pos-order-flow-schema.ts';
import { assertPosFlowFulfillable, assertNoStockRecovery, flowIssued } from './pos-order-flow-guards.ts';
import { assertNoReturnActivity, returnAdjustments, netReturnInputs } from './pos-return-credit.ts';
import { posReturns, posRefunds, posExchangeAllocations } from '../return-schema.ts';
import { snapshotPosFees } from '../domain/pos-fees.ts';
import { editPosOrder } from './pos-order-edit.ts';
import { cashLock, drawerOf, cashAudit, voidClosedCashEffect } from './cash-store.ts';
import { issuePosDelivery } from './pos-delivery-stock.ts';
import { posRegisters, posShifts } from '../pos-schema.ts';
import { createScheduledDelivery } from './delivery-store.ts';
import { departmentOwner } from '../../staff/api/department.ts';
import { seesAllAsSaleAdmin } from '../../staff/domain/roles.ts';
import { can, canApprove, type PermissionMember } from '../../staff/domain/permissions.ts';
import { quotationPredicate } from '../../quotes/api/department-access.ts';
import { orderNotesFromQuote, orderDeliveryAddress } from '../domain/order-notes.ts';
import { cleanOrderInput } from '../domain/order-input.ts';
import { and, asc, count, desc, eq, getTableColumns, gte, inArray, isNotNull, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import { foldSql, matchAllWords, paging, rankFirst, searchRank } from '../../../core/text/fold.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { customers, customerStaff } from '../../customers/schema.ts';
import { quotations } from '../../quotes/schema.ts';
import { quoteSaveHooks } from '../../quotes/api/routes.ts';
import { employees } from '../../staff/schema.ts';
import { notify, notifyMany } from '../../notifications/api/routes.ts';
import { contractCounters } from '../../contracts/schema.ts';
import { customerPayments, deliveries, deliveryLines, paymentSchedules, salesContracts, salesOrderLines, salesOrders, packingSlipLines, packingSlips, stockHolds, orderStockHolds } from '../schema.ts';
import { recordMovements, removeMovements } from '../../catalog/api/product-history.ts';
import { docRef } from '../domain/doc-ref.ts';
import { progressOf } from './progress.ts';
import { closeSlipsOfDeliveredOrders } from './packing-close.ts';
import { reverseRef, syncSaleMoves, saleMovesPosted } from '../../inventory/api/ledger.ts';
import { hiddenWarehouseIds, sellableWarehouses, sellersConfigured } from '../../inventory/api/warehouse-access.ts';
import { readCatalogStock } from '../../catalog/api/stock-source.ts';
import { warehouses } from '../../catalog/schema.ts';
import { parsePhotos, photoUrls, savePhotos, WH_PHOTO_MAX, WH_PHOTO_MAX_CHARS } from '../../inventory/api/photos.ts';
import { DEFAULT_SAPO_BASE } from '../../integrations/api/sapo-client.ts';
import { prepareSapoPush, sapoLocationOf, sapoPreview, sapoPushRequired, sapoPushViaClaw, sendOrderToClaw, wantsSapoPush, type SapoPushOutcome } from './sapo-push.ts';
import { amendmentLines, amendmentSchedules } from '../domain/amendments.ts';
import { CONTRACT_STATUSES, DELIVERY_STATUSES, LEGAL_ENTITIES, ORDER_STATUSES, PAYMENT_METHODS } from '../domain/statuses.ts';
import {
  addDays, compactCode, contractNumber, debtAging, debtCounts, contractSchedules, legalCode, nextDocNo, orderLinesFromQuote, orderStatusFromLines,
  orderTotals, receivable, vietnamDate, type OrderStatus,
} from '../domain/sales.ts';

type Ctx = RouteContext<StaffEnv>;
/** Báo giá nguồn để tính số ngày thanh toán (balancePaymentDays). */
const quoteTermsSource = (quote: { id: string; data: string }) => { const id = JSON.parse(quote.data).customerId; return { quoteId: quote.id, customerId: typeof id === 'string' && id ? id : null }; };
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
export const orderScopeFor = (m: {
  id: string;
  role: string;
  positionId?: string | null;
  positionName?: string | null;
  dataScope?: string | null;
  approver?: boolean | null;
}): SQL | undefined =>
  and(
    posOrderStoreScope(m),
    m.role === 'manager' || isAccountant(m) || seesAllAsSaleAdmin(m)
      ? undefined
      : or(
          eq(salesOrders.ownerId, m.id),
          eq(salesOrders.createdBy, m.id),
          departmentOwner(salesOrders.ownerId, m),
          departmentOwner(salesOrders.createdBy, m),
          can(m, 'pos.sell')
            ? and(
                eq(salesOrders.channel, 'pos'),
                sql`${salesOrders.posSnapshot}::jsonb->>'saleFlow' in ('deposit','prepaid')`,
              )
            : undefined,
          sql`EXISTS (SELECT 1 FROM ${customerStaff} WHERE ${customerStaff.customerId} = ${salesOrders.customerId} AND ${customerStaff.memberId} = ${m.id})`,
          // Người được duyệt mở được đơn / HĐKT đang chờ duyệt (đã gửi duyệt) để kiểm tra rồi duyệt.
          canApprove(m)
            ? and(
                eq(salesOrders.status, 'draft'),
                isNotNull(salesOrders.submittedAt),
              )
            : undefined,
        ),
  );
const orderScope = (c: Ctx): SQL | undefined => orderScopeFor(viewer(c));
/** Lịch giao hàng: nhóm Kho (chức vụ `warehouse`) xem và đổi trạng thái mọi chuyến giao (không xem được đơn / công nợ). */
const isWarehouseMember = (m: { role: string; positionId?: string | null }) => m.role === 'employee' && m.positionId === 'warehouse';
const deliveryScope = (c: Ctx): SQL | undefined => { const m = viewer(c); return m.role === 'employee' && m.positionId === 'warehouse' ? undefined : orderScope(c); };

async function loadOrder(c: Ctx, id: string, db: StaffEnv['db'] | Tx = c.env.db) {
  const [order] = await db.select().from(salesOrders).where(and(eq(salesOrders.id, id), orderScope(c))).limit(1);
  if (!order) throw new AppError(404, 'Không tìm thấy đơn hàng / HĐKT.');
  if (pendingGhnEdit(order.posSnapshot) && c.req.method !== 'GET' && !c.url.pathname.endsWith('/pos')) assertNoPendingGhnEdit(order.posSnapshot);
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
  await c.env.db.transaction(async tx => {
    await lockHolds(tx);
    await tx.update(salesOrders).set({ expectedDeliveryDate: date, updatedAt: nowIso(), revision: sql`${salesOrders.revision} + 1` }).where(eq(salesOrders.id, order.id));
    if (order.channel !== 'crm' || order.holdMode !== 'capped' || !['confirmed', 'delivering'].includes(order.status)) return;
    // Phần giữ tự động theo hạn mới; đơn duyệt khi chưa có ngày giao (chưa giữ) thì giữ tự động từ lúc có ngày giao.
    await retimeAutoHolds(tx, order.id, date);
    if (order.warehouseId && !(await tx.select({ id: orderStockHolds.id }).from(orderStockHolds).where(eq(orderStockHolds.orderId, order.id)).limit(1)).length)
      await holdOrderStock(tx, { ...order, expectedDeliveryDate: date }, viewer(c).id, { source: 'auto', expiresAt: autoHoldExpiry(date) });
  });
  const [by] = await c.env.db.select({ role: employees.role }).from(employees).where(eq(employees.id, order.createdBy)).limit(1);
  if (by?.role === 'customer') await notify(c.env, { eventType: 'order_delivery_date', targetMemberId: order.createdBy, actorId: viewer(c).id, title: 'Đổi ngày giao dự kiến',
    body: `${docRef(order.id, order.orderNo, (await contractNosOf(c.env.db, [order.id])).get(order.id)).Label}: giao dự kiến ${date.split('-').reverse().join('/')}`, url: '/customer.html#orders', data: { orderId: order.id, date } });
}
/** Dấu nội dung yêu cầu lập lịch giao (các trường quyết định chuyến + dòng hàng sắp theo dòng đơn). */
function deliveryRequestHash(body: Record<string, unknown>) {
  const f = (k: string) => String(body[k] ?? '').trim();
  const lines = Array.isArray(body.lines) ? (body.lines as Record<string, unknown>[]).map(l => [String(l?.orderLineId ?? ''), Number(l?.qty)] as const).sort(([a], [b]) => a.localeCompare(b)) : null;
  return sha256Hex(JSON.stringify([f('plannedDate'), f('timeSlot'), f('address'), f('receiverName'), f('receiverPhone'), f('carrier'), f('ghnOrderCode'), Number(body.shippingFee ?? 0), f('assigneeId'), f('note'), lines]));
}
/** Lịch sử sản phẩm: chuyến "Đã giao" = giao hàng cho khách (khoá `delivery:<chuyến>:<dòng>`). Gọi trong giao dịch đánh dấu đã giao. */
export async function recordDeliveryMovements(tx: Tx, d: { id: string; orderId: string; deliveryNo: string; address: string }) {
  const [o] = await tx.select().from(salesOrders).where(eq(salesOrders.id, d.orderId)).limit(1);
  const lines = await tx.select({ id: deliveryLines.orderLineId, qty: deliveryLines.qty, sku: salesOrderLines.sku, name: salesOrderLines.name, unit: salesOrderLines.unit, unitPrice: salesOrderLines.unitPrice })
    .from(deliveryLines).innerJoin(salesOrderLines, eq(salesOrderLines.id, deliveryLines.orderLineId)).where(eq(deliveryLines.deliveryId, d.id));
  const ref = docRef(d.orderId, o?.orderNo ?? '', (await contractNosOf(tx, [d.orderId])).get(d.orderId));
  await recordMovements(tx, lines.map(l => ({ refKey: `delivery:${d.id}:${l.id}`, sku: l.sku, kind: 'delivery' as const, name: l.name, qty: l.qty, unit: l.unit, unitPrice: l.unitPrice,
    partner: o?.customerName ?? '', location: d.address, refCode: `${d.deliveryNo} · ${ref.no}`, link: ref.link, status: 'Đã giao', occurredAt: nowIso() })));
}
/** Cập nhật trạng thái đơn theo số đã giao; khi giao xong thì kỳ "còn lại" chưa có hạn được đặt hạn = ngày giao xong + số ngày thanh toán (payment-terms.ts). */
export async function refreshOrderStatus(tx: Tx, orderId: string, deliveredOn: string | null) {
  const [order] = await tx.select().from(salesOrders).where(eq(salesOrders.id, orderId)).limit(1).for('update');
  const lines = await tx.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, orderId));
  const status = orderStatusFromLines(order!.status as OrderStatus, lines);
  if (status === 'delivered') await assertCrmOrderCompletion(tx, orderId);
  if (status !== order!.status) await tx.update(salesOrders).set({ status, updatedAt: nowIso() }).where(eq(salesOrders.id, orderId));
  // Giao xong mà chưa ai yêu cầu xuất hoá đơn → tự yêu cầu (sinh việc cho nhóm Kế toán).
  if (status === 'delivered' && order!.invoiceStatus === 'none')
    await tx.update(salesOrders).set({ invoiceStatus: 'requested', invoiceRequestedAt: nowIso(), invoiceRequestedBy: null, invoiceRequestNote: 'Tự động: đơn đã giao xong.', invoiceEmail: order!.invoiceEmail || order!.email, invoiceMode: 'issue' }).where(eq(salesOrders.id, orderId));
  // Giao xong → phiếu đóng gói còn treo của đơn tự hoàn tất.
  if (status === 'delivered') await closeSlipsOfDeliveredOrders(tx, [orderId]);
  if (status === 'delivered' && deliveredOn) await setBalanceDueOnDelivery(tx, order!, deliveredOn);
}

/** Số HĐKT của các bản ghi (bản ghi có HĐKT là HĐKT, không phải đơn hàng – xem domain/doc-ref.ts). */
/**
 * Kho bán của đơn (docs/SO-KHO.md "Kho bán theo chức vụ"): phải là kho chức vụ của người phụ trách đơn được bán; Manager chọn mọi kho.
 * Không gửi kho: người phụ trách chỉ bán một kho → tự chọn kho đó. Chưa gán kho bán cho chức vụ nào (chưa bật) → kho nào cũng được, không bắt chọn.
 */
export async function pickSaleWarehouse(db: StaffEnv['db'] | Tx, ownerId: string, actor: { role: string }, requested: unknown): Promise<string | null> {
  const wanted = typeof requested === 'string' ? requested.trim().slice(0, 80) : '';
  const configured = await sellersConfigured(db);
  const [owner] = await db.select({ role: employees.role, positionId: employees.positionId }).from(employees).where(eq(employees.id, ownerId)).limit(1);
  const ownerList = owner ? await sellableWarehouses(db, owner) : [];
  const allowed = !configured || actor.role === 'manager' ? await sellableWarehouses(db, { role: 'manager' }) : ownerList;
  if (wanted) {
    if (!allowed.some(w => w.id === wanted)) throw new AppError(403, 'Kho này không thuộc kho bán của nhân viên phụ trách đơn. Xin điều chuyển hàng về kho của mình.', 'WAREHOUSE_NOT_ALLOWED');
    return wanted;
  }
  return configured && ownerList.length === 1 ? ownerList[0]!.id : null;
}
/** Approval only reserves stock. Physical issues are posted by packing confirmation.
 * Old approval debits are retained as history; cancellation may reverse those legacy debits.
 */
export async function syncOrderStock(tx: Tx, by: string, orderId: string, note: string) {
  const [o] = await tx.select({ id: salesOrders.id, orderNo: salesOrders.orderNo, status: salesOrders.status, channel: salesOrders.channel })
    .from(salesOrders).where(eq(salesOrders.id, orderId)).limit(1);
  if (!o || o.channel !== 'crm' || o.status !== 'cancelled' || !await saleMovesPosted(tx, orderId)) return 0;
  const no = docRef(o.id, o.orderNo, (await contractNosOf(tx, [o.id])).get(o.id)).no;
  return syncSaleMoves(tx, by, { id: o.id, no, warehouseId: null, active: false }, [], note);
}
async function assertCanCancelDocument(tx:Tx,orderId:string) {
  const [o]=await tx.select().from(salesOrders).where(eq(salesOrders.id,orderId));
  if(!o)throw new AppError(404,'Không tìm thấy đơn hàng / HĐKT.');
  if(saleFlowOf(o.posSnapshot))throw new AppError(409,'Đơn cọc/trả trước: dùng Huỷ/hoàn tại POS để xử lý tiền và hàng.');
  await assertNoReturnActivity(tx,orderId);
  const [[paid],shipped]=await Promise.all([
    tx.select({n:count()}).from(customerPayments).where(and(eq(customerPayments.orderId,orderId),isNull(customerPayments.voidedAt))),
    tx.select({id:salesOrderLines.id}).from(salesOrderLines).where(and(eq(salesOrderLines.orderId,orderId),sql`${salesOrderLines.deliveredQty}>0`)).limit(1),
  ]);
  if(Number(paid?.n)>0||shipped.length)throw new AppError(409,'Đơn đã giao hoặc đã thu tiền, không huỷ được.');
  await assertNotDispatched(tx,orderId);
}
async function cancelDocumentChildren(tx:Tx,order:typeof salesOrders.$inferSelect,by:string) {
  const now=nowIso();
  await tx.update(salesContracts).set({status:'cancelled',updatedAt:now,revision:sql`${salesContracts.revision}+1`}).where(and(eq(salesContracts.orderId,order.id),ne(salesContracts.status,'cancelled')));
  const slips=await tx.update(packingSlips).set({status:'cancelled',updatedAt:now,revision:sql`${packingSlips.revision}+1`})
    .where(and(eq(packingSlips.orderId,order.id),inArray(packingSlips.status,['draft','sent','packed']))).returning({id:packingSlips.id,no:packingSlips.slipNo});
  for(const slip of slips)await reverseRef(tx,by,'packing_slip',slip.id,`Huỷ ${order.orderNo}: hàng chưa giao của phiếu ${slip.no} về lại kho`,now);
  await tx.update(deliveries).set({status:'cancelled',updatedAt:now}).where(and(eq(deliveries.orderId,order.id),inArray(deliveries.status,['planned','in_transit','failed'])));
  await releaseOrderHolds(tx,order.id,by,now);
}
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
export async function createOrderFromQuote(db: StaffEnv['db'], quote: QuoteRow, o: { createdBy: string; status: 'confirmed' | 'draft'; debtWarningAccepted?: boolean; submitted?: boolean; note?: string; deliveryDate?: string | null; orderDate?: string; deliveryAddress?: string; receiverName?: string; receiverPhone?: string;
  /** Kho bán (đã kiểm quyền bằng pickSaleWarehouse). */ warehouseId?: string | null;
  orderNo?: string;
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
  const t = orderTotals(lines), today = vietnamDate().iso, orderDate = o.orderDate ?? today, now = nowIso(), id = crypto.randomUUID();
  const [cust] = data.customerId ? await db.select({ id: customers.id, name: customers.name, approvalStatus: customers.approvalStatus }).from(customers).where(eq(customers.id, data.customerId)).limit(1) : [];
  // Khách mới do nhân viên tạo phải được Manager duyệt mới đặt hàng được.
  if (cust?.approvalStatus === 'pending') throw new AppError(409, `Khách hàng "${cust.name}" đang chờ Manager duyệt, chưa tạo đơn được.`, 'CUSTOMER_PENDING');
  const customerId = cust ? cust.id : null;
  assertApprovalDebt(await approvalDebt(db, customerId, String(data.customerTaxCode || '')), o.debtWarningAccepted);
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'order-number:' + orderDate}))`);
    const used = (await tx.select({ n: salesOrders.orderNo }).from(salesOrders).where(or(...documentNumberPatterns('DH', orderDate).map(pattern => sql`${salesOrders.orderNo} LIKE ${pattern}`)))).map(r => r.n);
    const orderNo = o.orderNo || nextDocNo('DH', orderDate, used);
    const [duplicateNo] = await tx.select({ id: salesOrders.id }).from(salesOrders).where(eq(salesOrders.orderNo, orderNo)).limit(1);
    if (duplicateNo) throw new AppError(409, `Số đơn hàng ${orderNo} đã tồn tại. Vui lòng chọn số khác.`, 'ORDER_NO_EXISTS');
    // Báo giá đang giữ hàng: đơn mới (nháp) chưa giữ – phần giữ của báo giá còn hiệu lực tới khi đơn được duyệt
    // (lúc duyệt chuyển thành phần giữ của đơn, order-hold-store.ts) hoặc hết hạn.
    await tx.insert(salesOrders).values({
      id, orderNo, quoteId: quote.id, quoteNo: quote.quoteNo, quoteType: quote.quoteType, customerId,
      receiverName: o.receiverName ?? '', receiverPhone: o.receiverPhone ?? '',
      customerName: text(data.customer) || quote.customer, contact: text(data.contact), phone: text(data.phone, 100), email: text(data.email, 254),
      taxCode: text(data.customerTaxCode, 100), address: o.deliveryAddress === undefined ? text(orderDeliveryAddress(data), 2000) : text(o.deliveryAddress, 2000),
      ownerId: quote.assigneeId ?? quote.creatorId, createdBy: o.createdBy, warehouseId: o.warehouseId ?? null, orderDate,
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
export async function syncDraftOrderFromQuote(tx: Tx, quote: QuoteRow, member: { id: string; role: string }) {
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
  // Legacy approval debits must not silently follow edits to quantities or SKUs.
  const quantities = (rows: readonly { sku: string; qty: number }[]) => {
    const totals = new Map<string, number>(); for (const row of rows) totals.set(row.sku, (totals.get(row.sku) ?? 0) + row.qty);
    return JSON.stringify([...totals].sort(([a], [b]) => a.localeCompare(b)));
  };
  if (quantities(oldLines) !== quantities(plan.updates) && await saleMovesPosted(tx, order.id))
    throw new AppError(409, 'Đơn đã ghi trừ kho theo cơ chế cũ. Đối soát xuất/hoàn kho trước khi sửa mã hoặc số lượng.', 'ORDER_STOCK_POSTED');
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
  const linkedTerms = contractTermsFromQuote(data);
  const financialTerms = { ...(linkedTerms.depositRate !== undefined ? { depositRate: linkedTerms.depositRate } : {}), ...(linkedTerms.paymentDays !== undefined ? { paymentDays: linkedTerms.paymentDays } : {}) };
  if (k) {
    // Các đoạn Word đã sửa dựa trên hàng / tổng cũ không được che dữ liệu báo giá mới.
    const doc = JSON.parse(k.data);
    if (doc.edits && Object.values(doc.edits).some(v => Array.isArray(v) && v.length)) {
      doc.editHistory = [...(Array.isArray(doc.editHistory) ? doc.editHistory : []), { quoteRevision: quote.revision, savedAt: now, edits: doc.edits }].slice(-10);
      delete doc.edits;
    }
    doc.details = { ...(doc.details || {}), ...Object.fromEntries(Object.entries(linkedTerms).filter(([, v]) => v !== undefined)) };
    await tx.update(salesContracts).set({ ...financialTerms, ...(linkedTerms.deliveryAddress !== undefined ? { deliveryAddress: linkedTerms.deliveryAddress } : {}), value: t.total, depositAmount: Math.round(t.total * (linkedTerms.depositRate ?? k.depositRate) / 100), data: JSON.stringify(doc), updatedAt: now, revision: sql`${salesContracts.revision} + 1` }).where(eq(salesContracts.id, k.id));
  }
  await syncPaymentSchedules(tx, { ...order, ...t, status: orderStatusFromLines(order.status, plan.updates) }, k ? { ...k, ...financialTerms } : undefined);
  if (order.status !== 'draft') {
    await refreshOrderStatus(tx, order.id, null);
    // Sửa chứng từ không xuất kho; chỉ hoàn các dòng trừ kiểu cũ nếu chứng từ đã huỷ.
    await syncOrderStock(tx, member.id, order.id, `Manager sửa ${order.orderNo} theo báo giá ${quote.quoteNo}`);
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
  if (order.status === 'delivered' && latest?.date) {
    const days = await balancePaymentDays(tx, order, contract);
    for (const p of plans) if (p.kind === 'balance') p.dueDate = addDays(vnDay(latest.date), days);
  }
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

export function registerSalesRoutes(router: Router<StaffEnv>, options: { purchaseLinks?: (db: StaffEnv['db'], member: SessionState['member'], order: { id: string; quoteId: string | null }) => Promise<{ id: string; number: string; internalNo?: string; supplierName?: string }[]> } = {}) {
  registerWebOrderEdits(router);
  registerCrmReturnRoutes(router, loadOrder);
  registerCashCollectionRoutes(router,loadOrder,async(db,id)=>(await receivableOf(db,[id])).get(id)?.balance||0);
  registerContractLiquidationRoutes(router,loadOrder);
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
    const owner = c.url.searchParams.get('owner') || '', branch = c.url.searchParams.get('branch') || '', source = c.url.searchParams.get('source') || '';
    const from = c.url.searchParams.get('from') || '', to = c.url.searchParams.get('to') || '';
    if ((from && !isDate(from)) || (to && !isDate(to)) || (from && to && from > to)) throw new AppError(400, 'Khoảng ngày tạo không hợp lệ.');
    const exportMode = c.url.searchParams.get('export') === '1';
    const { limit, offset } = exportMode ? { limit: 5000, offset: 0 } : paging(c.url, 200, 500);
    const isGhn = or(eq(salesOrders.fulfillmentMode, 'cod'), sql`EXISTS (SELECT 1 FROM ${deliveries} WHERE ${deliveries.orderId}=${salesOrders.id} AND lower(${deliveries.carrier}) LIKE '%ghn%')`);
    const scopedFlow = and(orderScope(c), flow === 'order' ? sql`NOT EXISTS (SELECT 1 FROM ${salesContracts} WHERE ${salesContracts.orderId} = ${salesOrders.id})` : undefined);
    const where = and(
      scopedFlow, source === 'web' ? sql`false` : undefined,
      status === 'unsubmitted' ? and(eq(salesOrders.status, 'draft'), isNull(salesOrders.submittedAt))
        : status ? eq(salesOrders.status, status as OrderStatus) : undefined,
      // Đơn hàng và HĐKT là 2 luồng song song: trang Đơn hàng (flow=order) chỉ hiện đơn KHÔNG có HĐKT (khách đã có HĐ nguyên tắc).
      invoice === 'requested' || invoice === 'issued' || invoice === 'none' ? eq(salesOrders.invoiceStatus, invoice) : undefined,
      owner ? eq(salesOrders.ownerId, owner) : undefined,
      branch === 'crm' ? ne(salesOrders.channel, 'pos') : branch ? sql`EXISTS (SELECT 1 FROM ${posShifts} WHERE ${posShifts.id}=${salesOrders.shiftId} AND ${posShifts.registerId}=${branch})` : undefined,
      source === 'crm' ? ne(salesOrders.channel, 'pos') : source === 'pos' ? and(eq(salesOrders.channel, 'pos'), sql`NOT (${isGhn})`) : source === 'ghn' ? isGhn : undefined,
      from ? gte(salesOrders.createdAt, new Date(from + 'T00:00:00+07:00').toISOString()) : undefined,
      to ? lte(salesOrders.createdAt, new Date(to + 'T23:59:59.999+07:00').toISOString()) : undefined,
      matchAllWords(foldSql(salesOrders.orderNo, salesOrders.quoteNo, salesOrders.customerName, salesOrders.phone), q),
    );
    const webPage=await webDocumentPage(c,where,limit,offset);
    const crmPageIds=webPage.page.filter(x=>x.kind==='crm').map(x=>x.id);
    // Số đơn đang chờ xuất hoá đơn (cùng phạm vi + luồng, không theo ô tìm / bộ lọc) cho nút lọc "Chờ xuất hoá đơn".
    const pendingWhere = and(orderScope(c), ne(salesOrders.status, 'cancelled'), eq(salesOrders.invoiceStatus, 'requested'),
      flow === 'order' ? sql`NOT EXISTS (SELECT 1 FROM ${salesContracts} WHERE ${salesContracts.orderId} = ${salesOrders.id})` : undefined);
    const live = and(where, ne(salesOrders.status, 'cancelled'));
    const [[{ n: total = 0 } = {}], rows, [{ n: invoicePending = 0 } = {}], ownerOptions, branchOptions, [{ n: crmCount = 0 } = {}], [sum], [paidRow]] = await Promise.all([
      c.env.db.select({ n: count() }).from(salesOrders).where(where),
      c.env.db.select({ order: salesOrders, ownerName: employees.name,
        branchName: sql<string>`coalesce((select ${posRegisters.name} from ${posShifts} inner join ${posRegisters} on ${posRegisters.id}=${posShifts.registerId} where ${posShifts.id}=${salesOrders.shiftId} limit 1),'VIGIFTS / CRM')`,
        deliveryStatus: sql<string>`coalesce((select ${deliveries.status} from ${deliveries} where ${deliveries.orderId}=${salesOrders.id} and ${deliveries.status}<>'cancelled' order by ${deliveries.updatedAt} desc limit 1),'')`,
        deliveryCarrier: sql<string>`coalesce((select ${deliveries.carrier} from ${deliveries} where ${deliveries.orderId}=${salesOrders.id} and ${deliveries.status}<>'cancelled' order by ${deliveries.updatedAt} desc limit 1),'')`,
      }).from(salesOrders).leftJoin(employees, eq(employees.id, salesOrders.ownerId)).where(and(where,crmPageIds.length?inArray(salesOrders.id,crmPageIds):sql`false`)).orderBy(...rankFirst(searchRank([salesOrders.orderNo, salesOrders.quoteNo, salesOrders.phone], salesOrders.customerName, q)), desc(salesOrders.createdAt), desc(salesOrders.id)),
      c.env.db.select({ n: count() }).from(salesOrders).where(pendingWhere),
      c.env.db.selectDistinct({ id: employees.id, name: employees.name }).from(salesOrders).innerJoin(employees, eq(employees.id, salesOrders.ownerId)).where(scopedFlow).orderBy(asc(employees.name)),
      c.env.db.selectDistinct({ id: posRegisters.id, name: posRegisters.name }).from(salesOrders).innerJoin(posShifts, eq(posShifts.id, salesOrders.shiftId)).innerJoin(posRegisters, eq(posRegisters.id, posShifts.registerId)).where(scopedFlow).orderBy(asc(posRegisters.name)),
      c.env.db.select({ n: count() }).from(salesOrders).where(and(scopedFlow, ne(salesOrders.channel, 'pos'))),
      c.env.db.select({ n: count(), revenue: sql<number>`coalesce(sum(${salesOrders.total}), 0)::float8`,
        // Kỳ cọc CRM; POS dùng phiếu thu cọc/thu trước COD nếu không có kỳ cọc riêng.
        deposit: sql<number>`coalesce(sum(coalesce(
          (select sum(ps.amount) from ${paymentSchedules} ps where ps.order_id=${salesOrders}.id and ps.kind='deposit'),
          (select sum(cp.amount) from ${customerPayments} cp where cp.order_id=${salesOrders}.id and cp.voided_at is null and cp.payment_source in ('pos_deposit','pos_cod_deposit')), 0)), 0)::float8`,
      }).from(salesOrders).where(live),
      c.env.db.select({ paid: sql<number>`coalesce(sum(${customerPayments.amount}), 0)::float8` }).from(customerPayments)
        .innerJoin(salesOrders, eq(salesOrders.id, customerPayments.orderId)).where(and(live, isNull(customerPayments.voidedAt))),
    ]);
    const revenue = Number(sum?.revenue ?? 0), paid = Number(paidRow?.paid ?? 0);
    const summary = { count: Number(sum?.n ?? 0)+webPage.summary.count, cancelled: Number(total) - Number(sum?.n ?? 0)+webPage.total-webPage.summary.count, revenue:revenue+webPage.summary.revenue, deposit: Number(sum?.deposit ?? 0), paid:paid+webPage.summary.paid, remaining: Math.max(0, revenue - paid)+webPage.summary.remaining, ...(webPage.summary.unknownPaymentCount?{unknownPaymentCount:webPage.summary.unknownPaymentCount}:{}) };
    const ids = rows.map(r => r.order.id);
    const [debts, contracts, ghnShipments] = await Promise.all([
      receivableOf(c.env.db, ids),
      ids.length ? c.env.db.select({ orderId: salesContracts.orderId, id: salesContracts.id, contractNo: salesContracts.contractNo, status: salesContracts.status }).from(salesContracts).where(inArray(salesContracts.orderId, ids)) : [],
      ids.length ? c.env.db.select({orderId:deliveries.orderId,id:deliveries.id,trackingCode:deliveries.trackingCode,trackingStatus:deliveries.trackingStatus,trackingUpdatedAt:deliveries.trackingUpdatedAt,status:deliveries.status}).from(deliveries)
        .where(and(inArray(deliveries.orderId,ids),sql`lower(trim(${deliveries.carrier}))='ghn'`,sql`trim(${deliveries.trackingCode})<>''`)).orderBy(desc(deliveries.updatedAt),desc(deliveries.createdAt),asc(deliveries.id)) : [],
    ]);
    const crmDocuments=rows.map(({ order: r, ownerName, branchName, deliveryStatus, deliveryCarrier }) => { const contract = contracts.find(x => x.orderId === r.id) ?? null;
      // debtCounts = false (đơn chờ xác nhận chưa ký HĐKT / đã huỷ): chưa phát sinh công nợ.
      const orderSource = r.channel !== 'pos' ? 'crm' : r.fulfillmentMode === 'cod' || /ghn/i.test(deliveryCarrier) ? 'ghn' : 'pos';
      return { ...r, ownerName, branchName, deliveryStatus, deliveryCarrier, orderSource, ghnShipments:ghnShipments.filter(s=>s.orderId===r.id), receivable: debts.get(r.id), debtCounts: debtCounts(r.status, contract?.status), contract }; });
    const byId=new Map([...crmDocuments,...webPage.documents].map(o=>[o.id,o]));
    const ordered=webPage.page.map(p=>byId.get(p.kind==='web'?'web:'+p.id:p.id)).filter((o):o is NonNullable<typeof o>=>!!o);
    const exportDetails=exportMode?await orderExportDetails(c.env.db,ordered):undefined;
    return json({orders:ordered.map(o=>exportDetails?{...o,exportDetails:exportDetails.get(o.id)}:o),
      total: Number(total)+webPage.total, limit, offset, invoicePending: Number(invoicePending)+webPage.invoicePending, summary, filterOptions: { owners: ownerOptions, branches: [...(Number(crmCount) ? [{ id: 'crm', name: 'VIGIFTS / CRM' }] : []), ...new Map([...branchOptions,...webPage.branches].map(b=>[b.id,b])).values()] } });
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
  router.get('/orders/create-config', async () => json({ version: 2, noteMaxLength: 20000, recipientFields: true }), 'business');

  /** Xem trước số đơn kế tiếp; không giữ số, lúc tạo máy chủ kiểm tra/cấp lại để tránh trùng. */
  router.get('/orders/next-no', async c => {
    const me = viewer(c), quoteId = text(c.url.searchParams.get('quoteId'), 80);
    const orderDate = text(c.url.searchParams.get('orderDate'), 10) || vietnamDate().iso;
    if (!isDate(orderDate)) throw new AppError(400, 'Ngày đặt không hợp lệ.');
    const [quote] = await c.env.db.select({ id: quotations.id }).from(quotations).where(and(eq(quotations.id, quoteId), quotationPredicate(me))).limit(1);
    if (!quote) throw new AppError(404, 'Không tìm thấy báo giá.');
    const used = (await c.env.db.select({ n: salesOrders.orderNo }).from(salesOrders).where(or(...documentNumberPatterns('DH', orderDate).map(pattern => sql`${salesOrders.orderNo} LIKE ${pattern}`)))).map(r => r.n);
    return json({ orderNo: nextDocNo('DH', orderDate, used) });
  }, 'business');

  router.put('/orders/:id/pos', async c => {
    const b = await readJson(c.req, 100000);
    const checked = await loadOrder(c, c.params.id!);
    await assertCanEditOrder(c, checked, 'đơn POS');
    const tracked = await c.env.db.select({ id: deliveries.id }).from(deliveries).where(and(eq(deliveries.orderId, checked.id), ne(deliveries.status, 'cancelled'), ne(deliveries.trackingCode, ''))).limit(1);
    if (pendingGhnEdit(checked.posSnapshot) || b.resumeGhnEdit || b.cancelGhnEdit || (tracked.length && b.lines !== undefined)) {
      return json(await editPosOrderWithGhn(c.env, checked.id, viewer(c), b, async (tx, id) => { await removeMovements(tx, `sale:${id}:`); await recordSaleMovements(tx, id); }));
    }
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

  async function orderDetail(c: Ctx, id: string) {
    const db = c.env.db, order = await loadOrder(c, id);
    const [lines, contract, ships, schedules, payments] = await Promise.all([
      db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, order.id)).orderBy(asc(salesOrderLines.lineNo)),
      db.select({ contract: salesContracts, quoteData: quotations.data, quoteRevision: quotations.revision }).from(salesContracts)
        .leftJoin(quotations, eq(quotations.id, sql`coalesce(${salesContracts.quoteId}, ${order.quoteId})`))
        .where(eq(salesContracts.orderId, order.id)).limit(1)
        .then(rows => rows.map(({ contract, quoteData, quoteRevision }) => ({ ...contract, quoteRevision, sourceTerms: quoteData ? contractTermsFromQuote(JSON.parse(quoteData)) : undefined }))),
      db.select().from(deliveries).where(eq(deliveries.orderId, order.id)).orderBy(asc(deliveries.plannedDate)),
      db.select().from(paymentSchedules).where(eq(paymentSchedules.orderId, order.id)).orderBy(asc(paymentSchedules.dueDate)),
      db.select().from(customerPayments).where(eq(customerPayments.orderId, order.id)).orderBy(asc(customerPayments.paidAt)),
    ]);
    // Print/UI must follow the parent order's line order, never the delivery insertion/query order.
    const [shipLines, shipPhotos] = ships.length ? await Promise.all([db.select(getTableColumns(deliveryLines)).from(deliveryLines)
      .innerJoin(salesOrderLines, eq(salesOrderLines.id, deliveryLines.orderLineId))
      .where(inArray(deliveryLines.deliveryId, ships.map(s => s.id)))
      .orderBy(asc(deliveryLines.deliveryId), asc(salesOrderLines.lineNo), asc(deliveryLines.orderLineId)),
      photoUrls(db, c.env.files, 'delivery', ships.filter(s => s.status === 'delivered').map(s => s.id))]) : [[], new Map<string, string[]>()];
    const confirmations=await deliveryConfirmations(db,ships);
    // Cho bản in đơn đặt hàng: mã khách hàng, người phụ trách, người soạn.
    const [cust] = order.customerId ? await db.select({ code: customers.customerCode, email: customers.email }).from(customers).where(eq(customers.id, order.customerId)).limit(1) : [];
    const people = await db.select({ id: employees.id, name: employees.name, phone: employees.phone, role: employees.role }).from(employees)
      .where(inArray(employees.id, [order.ownerId, order.createdBy, order.invoiceRequestedBy, order.invoiceIssuedBy, ...payments.map(p => p.voidedBy)].filter((x): x is string => !!x)));
    const person = (id: string) => people.find(p => p.id === id);
    const purchases = can(viewer(c), 'page.purchases') && options.purchaseLinks ? await options.purchaseLinks(db, viewer(c), order) : [];
    const [returnSummary,adjustments]=await Promise.all([orderReturnSummary(db,order.id),returnAdjustments(db,[order.id])]);
    const adjustment=adjustments.get(order.id);
    const displayedLines=lines.map(l=>{const r=returnSummary.byLine.get(l.id)||{returnedQty:0,restockedQty:0,pendingReturnQty:0};return{...l,...r,customerKeptQty:Math.max(0,l.deliveredQty-r.returnedQty)};});
    const net=netReturnInputs(schedules,payments.filter(p=>!p.voidedAt),adjustment);
    const cashCollectionRows=order.channel==='crm'?await cashCollectionsForOrder(db,order.id):[];
    return {
      purchases,
      cashCollections: cashCollectionRows, cashHeld: cashCollectionRows.filter(r=>r.status==='held').reduce((sum,r)=>sum+r.amount,0), canConfirmCashCollection: viewer(c).role==='manager',
      canCollectCashWithoutDrawer: order.channel === 'crm' && canCollectCrmCashWithoutDrawer(viewer(c)),
      returnAdjustment: adjustment || null,
      returnSummary:{requests:returnSummary.requests,receivedQty:returnSummary.receivedQty,restockedQty:returnSummary.restockedQty},
      effectiveSchedules: net.schedules,
      order: { ...order, warehouseName: order.warehouseId ? (await db.select({ name: warehouses.name }).from(warehouses).where(eq(warehouses.id, order.warehouseId)).limit(1))[0]?.name ?? '' : '', posFees: order.channel === 'pos' ? snapshotPosFees(JSON.parse(order.posSnapshot || '{}')) : null, customerCode: cust?.code ?? '', customerEmail: cust?.email ?? '', ownerName: person(order.ownerId)?.name ?? '', ownerPhone: person(order.ownerId)?.phone ?? '',
        createdByName: person(order.createdBy)?.name ?? '', createdByCustomer: person(order.createdBy)?.role === 'customer',
        invoiceRequestedByName: order.invoiceRequestedBy ? person(order.invoiceRequestedBy)?.name ?? '' : '', invoiceIssuedByName: order.invoiceIssuedBy ? person(order.invoiceIssuedBy)?.name ?? '' : '',
        canIssueInvoice: canIssueInvoice(viewer(c)), canCreateSapo: !order.sapoOrderId && await canCreateSapoInDepartment(c, order), canEdit: await canCreateSapoInDepartment(c, order),
        // Đơn Sapo đã đẩy (mã đang giữ chỗ "pending:…" khi đang đẩy thì chưa tính).
        sapoOrderCode: order.sapoOrderId ? order.sapoOrderCode : null,
        sapoOrderUrl: order.sapoOrderId ? `${(c.env.sapoAdminBase || DEFAULT_SAPO_BASE).replace(/\/+$/, '')}/orders/${encodeURIComponent(order.sapoOrderId)}` : '' }, lines:displayedLines, contract: contract[0] ? { ...contract[0], canEditFinancial: viewer(c).role === 'manager', canEdit: await canCreateSapoInDepartment(c, order), data: JSON.parse(contract[0].data) } : null,
      deliveries: ships.map(s => ({ ...s,...confirmations.get(s.id),canConfirm:canConfirmDelivery(viewer(c),order),canCancel:!isWarehouseMember(viewer(c))&&canConfirmDelivery(viewer(c),order),lines: shipLines.filter(l => l.deliveryId === s.id), photos: shipPhotos.get(s.id) ?? [] })),
      // Phiếu đã huỷ vẫn trả về (hiện gạch ngang + lý do) nhưng không tính vào đã thu.
      schedules, payments: payments.map(p => ({ ...p, voidedByName: p.voidedBy ? person(p.voidedBy)?.name ?? '' : '' })),
      receivable: receivable(net.schedules, net.payments, vietnamDate().iso), canVoidPayment: canVoidPayment(viewer(c)),
      progress: (await progressOf(db, [order.id])).get(order.id),
    };
  }
  // A successful write remains successful if its optional read projection fails.
  async function confirmedDetail(c: Ctx, id: string) { try { return await orderDetail(c,id); } catch { return undefined; } }
  router.get('/orders/:id', async c => json(c.params.id!.startsWith('web:')?await webDocumentDetail(c,c.params.id!.slice(4)):await orderDetail(c,c.params.id!)), 'business');

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
    const customOrderNo = text(body.orderNo, 120).replace(/\s+/g, ' ');
    if (customOrderNo && /[\u0000-\u001f<>]/.test(customOrderNo)) throw new AppError(400, 'Số đơn hàng không hợp lệ.');
    // Đơn sinh từ báo giá luôn là NHÁP – kể cả Manager tạo – chờ Manager duyệt.
    // Có tạo đơn Sapo (mặc định): đẩy trong cùng giao dịch (Sapo lỗi → không tạo đơn); `pushSapo: false` → chỉ tạo đơn web. HĐKT là luồng riêng: POST /contracts { quoteId }.
    const viaClaw = wantsSapoPush(c, body) && sapoPushViaClaw(c);
    const push = wantsSapoPush(c, body) && !viaClaw ? await prepareSapoPush(c, sapoLocationOf(body)) : null;
    let sapo: SapoPushOutcome = null;
    // Nhân viên sinh đơn: NHÁP, chỉ gửi Manager khi bấm "Gửi duyệt" (POST /orders/:id/submit). Manager sinh đơn: coi như đã gửi.
    const submitted = me.role === 'manager';
    const warehouseId = await pickSaleWarehouse(c.env.db, quote.assigneeId ?? quote.creatorId, me, body.warehouseId);
    const id = await createOrderFromQuote(c.env.db, quote, { createdBy: me.id, status: 'draft', submitted, warehouseId, ...input,
      debtWarningAccepted: body.debtWarningAccepted === true, orderNo: customOrderNo || undefined,
      inTx: async (tx, orderId) => { await saveQuoteStockPlan(tx,orderId,me.id,body.stockPlan); if (push) sapo = await push.push(tx,orderId); } }).finally(() => push?.done());
    if (viaClaw) sapo = await sendOrderToClaw(c, id, 'order');
    const [o] = await c.env.db.select({ orderNo: salesOrders.orderNo, customerName: salesOrders.customerName, total: salesOrders.total }).from(salesOrders).where(eq(salesOrders.id, id)).limit(1);
    if (submitted) await notifyMany(c.env, 'approvers', { eventType: 'order_pending', title: 'Đơn hàng mới chờ duyệt', body: `${me.name}: ${o!.orderNo} – ${o!.customerName} · ${new Intl.NumberFormat('vi-VN').format(o!.total)} đ`,
      url: `/index.html#/orders/${id}`, actorId: me.id, data: { orderId: id } });
    return json({ id, orderNo: o!.orderNo, sapo }, 201);
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

  /**
   * Đổi kho bán của đơn / HĐKT. Nháp: người phụ trách / người tạo (kho người phụ trách được bán). Đã duyệt: chỉ Manager – sổ kho
   * chỉ đổi kho dự kiến trước khi xuất. Đơn cũ đã xuất kho qua phiếu đóng gói (trước khi có kho bán) thì không đổi được (tránh trừ hai lần).
   */
  router.put('/orders/:id/warehouse', async c => {
    const body = await readJson(c.req, 1_024), me = viewer(c), order = await loadOrder(c, c.params.id!);
    if (order.status === 'cancelled') throw new AppError(409, 'Đơn hàng / HĐKT đã huỷ.');
    if (order.channel !== 'crm') throw new AppError(409, 'Đơn POS / web xuất kho theo quầy, không đổi kho bán.');
    if (order.status !== 'draft' && me.role !== 'manager') throw new AppError(403, 'Đơn đã duyệt. Chỉ Manager đổi được kho bán.', 'ORDER_APPROVED');
    if (order.status === 'draft') await assertCanEditOrder(c, order);
    const warehouseId = await pickSaleWarehouse(c.env.db, order.ownerId, me, body.warehouseId);
    if (!warehouseId) throw new AppError(400, 'Chọn kho bán.');
    await c.env.db.transaction(async tx => {
      const [locked] = await tx.select({ status: salesOrders.status, warehouseId: salesOrders.warehouseId }).from(salesOrders).where(eq(salesOrders.id, order.id)).for('update');
      if (locked?.status !== order.status) throw new AppError(409, 'Đơn hàng / HĐKT vừa thay đổi. Tải lại trang.', 'ORDER_CHANGED');
      if (locked.warehouseId === warehouseId) return;
      if (await saleMovesPosted(tx, order.id)) throw new AppError(409, 'Đơn đã ghi trừ kho theo cơ chế cũ. Đối soát xuất/hoàn kho trước khi đổi kho bán.', 'ORDER_ALREADY_ISSUED');
      const planned = await tx.select({id:packingSlips.id}).from(packingSlips).where(and(eq(packingSlips.orderId,order.id),ne(packingSlips.status,'cancelled'))).limit(1);
      if (planned.length && !await saleMovesPosted(tx,order.id)) throw new AppError(409,'Huỷ các phiếu kế hoạch nguồn hàng rồi lập lại trước khi đổi kho bán.','STOCK_PLAN_IN_USE');
      if (order.status !== 'draft' && !locked.warehouseId) {
        const issued = await tx.select({ id: packingSlips.id }).from(packingSlips).where(and(eq(packingSlips.orderId, order.id), eq(packingSlips.status, 'packed'), isNotNull(packingSlips.stockWarehouseId))).limit(1);
        if (issued.length) throw new AppError(409, 'Đơn đã xuất kho qua phiếu đóng gói trước khi có kho bán – không gán kho bán được (tránh trừ hai lần).', 'ORDER_ALREADY_ISSUED');
      }
      await tx.update(salesOrders).set({ warehouseId, updatedAt: nowIso(), revision: sql`${salesOrders.revision} + 1` }).where(eq(salesOrders.id, order.id));
      await syncOrderStock(tx, me.id, order.id, `Đổi kho bán ${order.orderNo}`);
    });
    return json({ ok: true, warehouseId });
  }, 'business');

  /**
   * Kho bán chọn được cho đơn (người phụ trách được bán; Manager mọi kho) + tồn từng dòng tại từng kho đó – popup chọn kho / duyệt đơn.
   * Không trả kho riêng người xem không được thấy tồn.
   */
  router.get('/orders/:id/warehouses', async c => {
    const me = viewer(c), order = await loadOrder(c, c.params.id!), db = c.env.db;
    const configured = await sellersConfigured(db);
    const [owner] = await db.select({ role: employees.role, positionId: employees.positionId }).from(employees).where(eq(employees.id, order.ownerId)).limit(1);
    const list = !configured || me.role === 'manager' ? await sellableWarehouses(db, { role: 'manager' }) : owner ? await sellableWarehouses(db, owner) : [];
    const lines = await db.select({ sku: salesOrderLines.sku, name: salesOrderLines.name, qty: salesOrderLines.qty }).from(salesOrderLines).where(eq(salesOrderLines.orderId, order.id));
    const skus = [...new Set(lines.map(l => l.sku).filter(Boolean))];
    const stock = await readCatalogStock(db, skus);
    const hidden = await hiddenWarehouseIds(db, me);
    return json({ configured, warehouseId: order.warehouseId, warehouses: list.filter(w => !hidden.has(w.id) || w.id === order.warehouseId).map(w => ({ id: w.id, name: w.name,
      lines: hidden.has(w.id) ? [] : lines.filter(l => l.sku).map(l => ({ sku: l.sku, name: l.name, need: l.qty, stock: stock.find(s => s.sku === l.sku && s.warehouseId === w.id)?.quantity ?? 0 })) })) });
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

  router.get('/quotes/:id/approval-preflight', async c => {
    const [quote] = await c.env.db.select().from(quotations).where(and(eq(quotations.id, c.params.id!), quotationPredicate(viewer(c))));
    if (!quote) throw new AppError(404, 'Không tìm thấy báo giá.');
    const data = JSON.parse(quote.data);
    return json({ customerName: quote.customer, asOf: vietnamDate().iso,
      ...(canApprove(viewer(c)) ? { purchaseCostsReady: data.rows.filter((r: { qty?: number }) => Number(r.qty) > 0).every((r: { costPrice?: number }) => Number.isFinite(r.costPrice)) } : {}),
      debt: await approvalDebt(c.env.db, data.customerId || null, String(data.customerTaxCode || '')) });
  }, 'business');

  router.get('/orders/:id/approval-preflight', async c => {
    if (!canApprove(viewer(c))) throw new AppError(403, 'Chỉ người được duyệt xem kiểm tra phê duyệt.', 'APPROVER_ONLY');
    const order = await loadOrder(c, c.params.id!);
    const [quote] = order.quoteId ? await c.env.db.select().from(quotations).where(eq(quotations.id, order.quoteId)) : [];
    return json({ customerName: order.customerName, asOf: vietnamDate().iso,
      debt: await approvalDebt(c.env.db, order.customerId, order.taxCode, order.id),
      costs: quote ? approvalCosts(JSON.parse(quote.data)) : null,
      quoteId: can(viewer(c), 'page.quotes') ? order.quoteId : null });
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
      if (Number(paid?.n) > 0 && !lines.some(l => l.deliveredQty > 0) && order.channel === 'pos' && order.fulfillmentMode === 'cod')
        throw new AppError(409, 'Đơn Ship COD đã thu cọc: dùng "Đổi / trả hàng" của đơn (thu hồi đơn chưa giao) để nhận hàng hoàn về kho và hoàn cọc cho khách.', 'COD_DEPOSIT_RECOVER');
      if (Number(paid?.n) > 0 || lines.some(l => l.deliveredQty > 0)) throw new AppError(409, 'Đơn đã giao hoặc đã thu tiền, không huỷ được.');
    }
    if (status === 'confirmed' && !canApprove(viewer(c))) throw new AppError(403, 'Chỉ Manager hoặc người được Manager chỉ định duyệt đơn hàng / HĐKT.', 'APPROVER_ONLY');
    if (status === 'confirmed' && order.status !== 'draft') throw new AppError(409, 'Chỉ duyệt được đơn đang chờ duyệt.');
    // Bước xác thực: nhân viên phải đánh dấu đã kiểm tra các thông tin quan trọng trước khi duyệt đơn.
    if (status === 'confirmed' && body.verified !== true) throw new AppError(400, 'Kiểm tra và đánh dấu đủ các thông tin quan trọng trước khi xác nhận đơn.', 'VERIFY_REQUIRED');
    // Duyệt chỉ giữ hàng, chưa trừ tồn (đơn CRM): người duyệt chọn / đổi kho được (trong kho người phụ trách được bán); đã bật phân kho bán thì bắt buộc có kho.
    let warehouseId = order.warehouseId;
    let ghnDeliveryIds: string[] = [];
    const held: { lines?: Awaited<ReturnType<typeof holdOrderStock>>['lines'] } = {};
    if (status === 'confirmed' && order.channel === 'crm') {
      if (body.warehouseId !== undefined && body.warehouseId !== order.warehouseId) warehouseId = await pickSaleWarehouse(c.env.db, order.ownerId, viewer(c), body.warehouseId);
      if (!warehouseId) warehouseId = await pickSaleWarehouse(c.env.db, order.ownerId, viewer(c), undefined);
      if (!warehouseId && await sellersConfigured(c.env.db)) throw new AppError(409, 'Chọn kho dự kiến xuất hàng trước khi duyệt.', 'WAREHOUSE_REQUIRED');
    }
    await c.env.db.transaction(async tx => {
      // Duyệt có thể giữ hàng tự động: khoá giữ hàng trước khoá đơn (cùng thứ tự với xác nhận xuất kho / POS).
      if (status === 'confirmed' && order.channel === 'crm') await lockHolds(tx);
      // Khoá đơn rồi kiểm lại trong giao dịch: phiếu thu / chuyến giao vừa ghi cùng lúc không lọt qua khi huỷ.
      const [locked] = await tx.select({ status: salesOrders.status, warehouseId:salesOrders.warehouseId }).from(salesOrders).where(eq(salesOrders.id, order.id)).for('update');
      if (locked?.status !== order.status) throw new AppError(409, 'Đơn hàng / HĐKT vừa thay đổi. Tải lại trang.', 'ORDER_CHANGED');
      if (status === 'cancelled') await assertCanCancelDocument(tx,order.id);
      if (status === 'confirmed') {
        if (warehouseId !== locked.warehouseId && (await tx.select({id:packingSlips.id}).from(packingSlips).where(and(eq(packingSlips.orderId,order.id),ne(packingSlips.status,'cancelled'))).limit(1)).length) throw new AppError(409,'Huỷ các phiếu kế hoạch nguồn hàng rồi lập lại trước khi đổi kho bán.','STOCK_PLAN_IN_USE');
        assertApprovalDebt(await approvalDebt(tx, order.customerId, order.taxCode, order.id), body.debtWarningAccepted === true);
        const [quote] = order.quoteId ? await tx.select().from(quotations).where(eq(quotations.id, order.quoteId)) : [];
        if (quote) {
          const costs = approvalCosts(JSON.parse(quote.data));
          if (costs.missingPrinting) throw new AppError(409, 'Vui lòng nhập chi phí in/khắc trước khi duyệt.', 'PRINTING_COST_REQUIRED');
          if ((costs.missingCommission || costs.missingShipping) && body.costWarningsReviewed !== true)
            throw new AppError(409, 'Vui lòng kiểm tra CK khách và phí vận chuyển trước khi duyệt.', 'COST_REVIEW_REQUIRED');
        }
      }
      await tx.update(salesOrders).set({ status, warehouseId, updatedAt: nowIso(), revision: sql`${salesOrders.revision} + 1` }).where(eq(salesOrders.id, order.id));
      // Duyệt không ghi sổ kho; khi huỷ chỉ hoàn các dòng trừ kiểu cũ. Phiếu xuất được đảo ở cancelDocumentChildren.
      await syncOrderStock(tx, viewer(c).id, order.id, status === 'confirmed' ? `Duyệt bán – ${order.customerName}` : `Huỷ ${order.orderNo} – hàng về lại kho bán`);
      if (status === 'confirmed') await ensurePackingSchedule(tx,order.id,viewer(c).id);
      // Giữ hàng tự động lúc duyệt: chỉ khi có ngày giao dự kiến, tối đa có thể bán, hạn ngày giao + 3 ngày (order-hold-store.ts).
      if (status === 'confirmed' && order.channel === 'crm' && order.holdMode === 'capped') {
        // Phần giữ của báo giá gốc chuyển sang đơn: đóng trước rồi mới tính có thể bán (không đếm hai lần).
        const quoteHolds = order.quoteId && warehouseId ? await tx.update(stockHolds).set({ status: 'converted', closedAt: nowIso(), closedBy: viewer(c).id })
          .where(and(eq(stockHolds.quoteId, order.quoteId), eq(stockHolds.status, 'active'), sql`${stockHolds.expiresAt} > ${nowIso()}`)).returning({ expiresAt: stockHolds.expiresAt, sku: stockHolds.sku, qty: stockHolds.qty }) : [];
        const quoteUntil = quoteHolds.map(h => h.expiresAt).sort().at(-1);
        // Có ngày giao: giữ tự động tới ngày giao + 3 ngày. Không có ngày giao: chỉ giữ tiếp phần báo giá đã giữ, theo hạn của báo giá.
        const expiresAt = order.expectedDeliveryDate ? autoHoldExpiry(order.expectedDeliveryDate) : quoteUntil;
        if (expiresAt && warehouseId)
          held.lines = (await holdOrderStock(tx, { ...order, status: 'confirmed', warehouseId }, viewer(c).id, { source: order.expectedDeliveryDate ? 'auto' : 'manual', expiresAt,
            ...(order.expectedDeliveryDate ? {} : { limit: quoteHolds.reduce((m, h) => m.set(h.sku, (m.get(h.sku) ?? 0) + h.qty), new Map<string, number>()) }) })).lines;
      }
      // Huỷ: dọn việc còn treo của đơn – phiếu đóng gói chưa đóng / chuyến giao chưa giao huỷ theo (việc kho / giao tự đóng);
      // phiếu kho đã đóng (đã ghi xuất sổ kho) thì ghi dòng đảo – hàng về lại kho – rồi huỷ phiếu.
      if (status === 'cancelled') {
        ghnDeliveryIds = (await tx.select({ id: deliveries.id }).from(deliveries)
          .where(and(eq(deliveries.orderId, order.id), inArray(deliveries.status, ['planned', 'in_transit']), sql`${deliveries.trackingCode}<>''`))).map(d => d.id);
        await cancelDocumentChildren(tx, order, viewer(c).id);
      }
      // Khách đặt hàng thẳng (báo giá chưa duyệt): nhân viên xác nhận đơn = duyệt luôn báo giá của đơn.
      if (status === 'confirmed' && order.quoteId)
        await tx.update(quotations).set({ approvalStatus: 'approved', approvedAt: nowIso(), approvedBy: viewer(c).id })
          .where(and(eq(quotations.id, order.quoteId), inArray(quotations.approvalStatus, ['draft', 'pending'])));
    });
    // Huỷ đơn Ship COD quầy Lock đã có vận đơn: huỷ luôn vận đơn trên GHN (lỗi thì trả lý do, đơn CRM vẫn đã huỷ).
    const ghnCancel = status === 'cancelled' ? await cancelGhnShipments(c.env, ghnDeliveryIds) : null;
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
    return json({ ok: true, ...(ghnCancel ? { ghnCancel } : {}), ...(held.lines ? { hold: held.lines } : {}) });
  }, 'business');

  /**
   * HUỶ ĐƠN SAU GIAO THẤT BẠI (CRM, docs/SO-KHO.md › Giao thất bại): hàng đã xuất kho, chuyến đã rời kho rồi giao không thành công,
   * khách không nhận nữa. Huỷ thường bị chặn (RETURN_REQUIRED) vì chuyến đã rời kho; ở đây Manager xác nhận KHO ĐÃ NHẬN LẠI ĐỦ HÀNG
   * tại kho đã xuất → huỷ đơn và đảo đúng các phiếu xuất (hàng về kho đã xuất), cùng một giao dịch.
   * Điều kiện: chưa giao được món nào, chưa thu tiền, không có phiếu trả; mọi chuyến từng rời kho đều đang "Giao thất bại".
   * Hàng về bị hỏng: sau khi huỷ lập phiếu điều chỉnh hàng hỏng (có duyệt) – không tự trừ ở đây. Giao lại thì dùng luồng giao bình thường.
   */
  router.post('/orders/:id/cancel-after-failed-delivery', async c => {
    if (viewer(c).role !== 'manager') throw new AppError(403, 'Chỉ Manager huỷ đơn sau giao thất bại.');
    const body = await readJson(c.req, 4_000), reason = text(body.reason, 1000), key = text(body.key, 100);
    if (body.confirmedReceived !== true) throw new AppError(400, 'Chỉ huỷ khi kho đã nhận lại đủ hàng của các chuyến giao thất bại.');
    if (reason.length < 5) throw new AppError(400, 'Nhập lý do huỷ (ít nhất 5 ký tự).');
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(key)) throw new AppError(400, 'Thiếu mã chống gửi lặp – tải lại trang rồi thử lại.');
    const order = await loadOrder(c, c.params.id!);
    if (order.channel !== 'crm' || saleFlowOf(order.posSnapshot)) throw new AppError(409, 'Chỉ áp dụng đơn hàng / HĐKT CRM.');
    const replay = async (db: StaffEnv['db'] | Tx) => (await db.select({ id: auditLogs.id }).from(auditLogs)
      .where(and(eq(auditLogs.entityId, order.id), eq(auditLogs.action, 'cancel-after-failed-delivery'), sql`${auditLogs.data} like ${'%"key":"' + key + '"%'}`)).limit(1)).length > 0;
    let replayed = false;
    await c.env.db.transaction(async tx => {
      await cashLock(tx);
      const [locked] = await tx.select().from(salesOrders).where(eq(salesOrders.id, order.id)).for('update');
      if (!locked) throw new AppError(404, 'Không tìm thấy đơn hàng / HĐKT.');
      if (locked.status === 'cancelled') { if (await replay(tx)) { replayed = true; return; } throw new AppError(409, 'Đơn đã huỷ.'); }
      if (locked.status === 'draft') throw new AppError(409, 'Đơn chưa duyệt: dùng Huỷ thường.');
      await assertNoReturnActivity(tx, order.id);
      const [[paid], shipped, trips] = await Promise.all([
        tx.select({ n: count() }).from(customerPayments).where(and(eq(customerPayments.orderId, order.id), isNull(customerPayments.voidedAt))),
        tx.select({ id: salesOrderLines.id }).from(salesOrderLines).where(and(eq(salesOrderLines.orderId, order.id), sql`${salesOrderLines.deliveredQty}>0`)).limit(1),
        tx.select({ id: deliveries.id, no: deliveries.deliveryNo, status: deliveries.status }).from(deliveries).where(eq(deliveries.orderId, order.id)).for('update'),
      ]);
      if (Number(paid?.n) > 0 || shipped.length) throw new AppError(409, 'Đơn đã giao hoặc đã thu tiền: dùng Trả hàng để nhận hàng về kho.', 'ORDER_DELIVERED_OR_PAID');
      const moving = trips.filter(t => ['in_transit', 'delivered'].includes(t.status));
      if (moving.length) throw new AppError(409, `Chuyến ${moving.map(t => t.no).join(', ')} đang giao: chờ kết quả, đánh dấu "Giao thất bại" khi hàng quay về rồi mới huỷ.`, 'DELIVERY_IN_PROGRESS');
      const dispatched = (await tx.select({ id: auditLogs.entityId }).from(auditLogs).where(and(eq(auditLogs.entityType, 'deliveries'), eq(auditLogs.action, 'dispatch'),
        inArray(auditLogs.entityId, trips.length ? trips.map(t => t.id) : ['']))));
      const out = trips.filter(t => dispatched.some(d => d.id === t.id));
      if (!out.length) throw new AppError(409, 'Đơn chưa có chuyến rời kho: dùng Huỷ thường.', 'NOT_DISPATCHED');
      const notFailed = out.filter(t => t.status !== 'failed');
      if (notFailed.length) throw new AppError(409, `Chuyến ${notFailed.map(t => t.no).join(', ')} đã rời kho nhưng chưa ở trạng thái "Giao thất bại".`, 'DELIVERY_NOT_FAILED');
      const now = nowIso();
      await tx.update(salesOrders).set({ status: 'cancelled', updatedAt: now, revision: sql`${salesOrders.revision} + 1` }).where(eq(salesOrders.id, order.id));
      await syncOrderStock(tx, viewer(c).id, order.id, `Huỷ ${order.orderNo} sau giao thất bại – hàng về lại kho`);
      await cancelDocumentChildren(tx, locked, viewer(c).id);
      await tx.insert(auditLogs).values({ id: crypto.randomUUID(), actorId: viewer(c).id, module: 'sales', action: 'cancel-after-failed-delivery', entityType: 'sales_orders', entityId: order.id,
        data: JSON.stringify({ key, reason, deliveries: out.map(t => t.no), confirmedReceived: true }), createdAt: now });
    });
    if (!replayed) {
      await removeMovements(c.env.db, `sale:${order.id}:`);
      const ref = docRef(order.id, order.orderNo, (await contractNosOf(c.env.db, [order.id])).get(order.id));
      await notifyMany(c.env, [order.ownerId, order.createdBy], { eventType: 'order_cancelled', title: (ref.kind === 'contract' ? 'HĐKT' : 'Đơn hàng') + ' đã bị huỷ (giao thất bại)',
        body: `${ref.no} – ${order.customerName} · ${reason}`, url: `/index.html${ref.link}`, actorId: viewer(c).id, data: { orderId: order.id } });
    }
    return json({ ok: true, replayed });
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
      await cashLock(tx);
      const [locked] = await tx.select({ status: salesOrders.status }).from(salesOrders).where(eq(salesOrders.id, order.id)).for('update');
      if (locked?.status !== 'cancelled') throw new AppError(409, 'Đơn không còn ở trạng thái đã huỷ.');
      await assertNoReturnActivity(tx, order.id);
      await assertNoLiquidationHistory(tx,order.id);
      const [cashHistory]=await tx.select({id:cashCollections.id}).from(cashCollections).where(eq(cashCollections.orderId,order.id)).limit(1);
      if(cashHistory)throw new AppError(409,'Đơn có lịch sử tiền mặt nhân viên giữ; giữ chứng từ để đối soát, không xoá.','ORDER_HAS_HISTORY');
      const [ledger] = await tx.select({ id: stockMoves.id }).from(stockMoves).where(sql`
        (${stockMoves.refType} in ('pos_order','sales_order') and (${stockMoves.refId}=${order.id} or ${stockMoves.refId} like ${order.id + '#%'})) or
        (${stockMoves.refType}='packing_slip' and exists(select 1 from ${packingSlips} p where p.id=${stockMoves.refId} and p.order_id=${order.id})) or
        (${stockMoves.refType}='pos_delivery' and exists(select 1 from ${deliveries} d where d.id=${stockMoves.refId} and d.order_id=${order.id}))`).limit(1);
      if (ledger) throw new AppError(409, 'Đơn đã có lịch sử kho. Giữ chứng từ để nhận hoàn và đối chiếu sổ kho, không xoá.', 'ORDER_HAS_HISTORY');
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
      await invoiceTasksChanged(c.env, { orderId: order.id }, viewer(c).id);
      return json({ ok: true, updated: true });
    }
    await c.env.db.update(salesOrders).set({ invoiceStatus: 'requested', invoiceRequestedAt: nowIso(), invoiceRequestedBy: viewer(c).id, ...fields,
      updatedAt: nowIso(), revision: sql`${salesOrders.revision} + 1` }).where(and(eq(salesOrders.id, order.id), eq(salesOrders.invoiceStatus, 'none')));
    await invoiceTasksChanged(c.env, { orderId: order.id }, viewer(c).id);
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
    await invoiceTasksChanged(c.env, { orderId: order.id }, viewer(c).id);
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
      .orderBy(...rankFirst(searchRank([quotations.quoteNo], quotations.customer, c.url.searchParams.get('q'))), desc(quotations.createdAt), desc(quotations.id)).limit(30);
    return json({ quotes: rows });
  }, 'business');

  // ================= HĐKT =================
  router.get('/contracts', async c => {
    const { limit, offset } = paging(c.url, 200, 500);
    const sp = c.url.searchParams, invoice = sp.get('invoice') || '', status = sp.get('status') || '', owner = sp.get('owner') || '', entity = sp.get('entity') || '';
    const from = sp.get('from') || '', to = sp.get('to') || '', dateBy = sp.get('dateBy') === 'signed' ? 'signed' : 'created';
    if ((from && !isDate(from)) || (to && !isDate(to)) || (from && to && from > to)) throw new AppError(400, 'Khoảng ngày không hợp lệ.');
    if (status && status !== 'unsubmitted' && !(ORDER_STATUSES as readonly string[]).includes(status)) throw new AppError(400, 'Trạng thái không hợp lệ.');
    if (entity && !(LEGAL_ENTITIES as readonly string[]).includes(entity)) throw new AppError(400, 'Pháp nhân không hợp lệ.');
    const scope = orderScope(c);
    // Cùng bộ lọc với trang Đơn hàng: trạng thái theo đơn đi kèm HĐKT (nháp / chờ duyệt / đã duyệt / đang giao / hoàn thành / huỷ).
    const where = and(scope, matchAllWords(foldSql(salesContracts.contractNo, salesOrders.quoteNo, salesOrders.customerName), sp.get('q')),
      invoice === 'requested' || invoice === 'issued' || invoice === 'none' ? eq(salesOrders.invoiceStatus, invoice) : undefined,
      status === 'unsubmitted' ? and(eq(salesOrders.status, 'draft'), isNull(salesOrders.submittedAt)) : status ? eq(salesOrders.status, status as OrderStatus) : undefined,
      owner ? eq(salesOrders.ownerId, owner) : undefined,
      entity ? eq(salesContracts.legalEntity, entity as typeof LEGAL_ENTITIES[number]) : undefined,
      dateBy === 'signed' ? and(from ? gte(salesContracts.signedDate, from) : undefined, to ? lte(salesContracts.signedDate, to) : undefined)
        : and(from ? gte(salesContracts.createdAt, new Date(from + 'T00:00:00+07:00').toISOString()) : undefined, to ? lte(salesContracts.createdAt, new Date(to + 'T23:59:59.999+07:00').toISOString()) : undefined));
    // Dòng tổng theo đúng bộ lọc (mọi trang, không chỉ trang đang xem); tiền không tính HĐKT đã huỷ.
    const live = and(where, ne(salesOrders.status, 'cancelled'));
    const [[{ n: total = 0 } = {}], rows, [{ n: invoicePending = 0 } = {}], [sum], [paidRow], ownerOptions] = await Promise.all([
      c.env.db.select({ n: count() }).from(salesContracts).innerJoin(salesOrders, eq(salesOrders.id, salesContracts.orderId)).where(where),
      c.env.db.select({ contract: salesContracts, orderNo: salesOrders.orderNo, customerName: salesOrders.customerName, quoteNo: salesOrders.quoteNo, orderStatus: salesOrders.status,
      invoiceStatus: salesOrders.invoiceStatus, invoiceNo: salesOrders.invoiceNo, submittedAt: salesOrders.submittedAt, ownerName: employees.name })
      .from(salesContracts).innerJoin(salesOrders, eq(salesOrders.id, salesContracts.orderId)).leftJoin(employees, eq(employees.id, salesOrders.ownerId))
      .where(where).orderBy(...rankFirst(searchRank([salesContracts.contractNo, salesOrders.quoteNo], salesOrders.customerName, c.url.searchParams.get('q'))), desc(salesContracts.createdAt), desc(salesContracts.id)).limit(limit).offset(offset),
      c.env.db.select({ n: count() }).from(salesContracts).innerJoin(salesOrders, eq(salesOrders.id, salesContracts.orderId))
        .where(and(scope, ne(salesOrders.status, 'cancelled'), eq(salesOrders.invoiceStatus, 'requested'))),
      c.env.db.select({ n: count(), value: sql<number>`coalesce(sum(${salesContracts.value}), 0)::float8`, deposit: sql<number>`coalesce(sum(${salesContracts.depositAmount}), 0)::float8` }).from(salesContracts).innerJoin(salesOrders, eq(salesOrders.id, salesContracts.orderId)).where(live),
      c.env.db.select({ paid: sql<number>`coalesce(sum(${customerPayments.amount}), 0)::float8` }).from(customerPayments)
        .innerJoin(salesContracts, eq(salesContracts.orderId, customerPayments.orderId)).innerJoin(salesOrders, eq(salesOrders.id, salesContracts.orderId))
        .where(and(live, isNull(customerPayments.voidedAt))),
      c.env.db.selectDistinct({ id: employees.id, name: employees.name }).from(salesContracts).innerJoin(salesOrders, eq(salesOrders.id, salesContracts.orderId))
        .innerJoin(employees, eq(employees.id, salesOrders.ownerId)).where(scope).orderBy(asc(employees.name)),
    ]);
    const revenue = Number(sum?.value ?? 0), paid = Number(paidRow?.paid ?? 0);
    const summary = { count: Number(sum?.n ?? 0), cancelled: Number(total) - Number(sum?.n ?? 0), revenue, deposit: Number(sum?.deposit ?? 0), paid, remaining: Math.max(0, revenue - paid) };
    const debts = await receivableOf(c.env.db, [...new Set(rows.map(r => r.contract.orderId))]);
    return json({ contracts: rows.map(r => ({ ...r.contract, data: undefined, orderNo: r.orderNo, customerName: r.customerName, quoteNo: r.quoteNo, orderStatus: r.orderStatus,
      invoiceStatus: r.invoiceStatus, invoiceNo: r.invoiceNo, ownerName: r.ownerName ?? '',
      receivable: debts.get(r.contract.orderId), debtCounts: debtCounts(r.orderStatus, r.contract.status), submittedAt: r.submittedAt })), total: Number(total), limit, offset, invoicePending: Number(invoicePending),
      summary, filterOptions: { owners: ownerOptions } });
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
    // Điều khoản theo báo giá để điền sẵn hộp lập HĐKT (cọc, số ngày thanh toán phần còn lại).
    const source = contractTermsFromQuote(JSON.parse(quote.data));
    const terms = { depositRate: source.depositRate ?? null, paymentDays: await balancePaymentDays(c.env.db, quoteTermsSource(quote)) };
    if (!customerCode) return json({ contractNo: '', terms, error: 'Báo giá chưa có mã khách hàng hoặc MST để cấp số HĐKT.' });
    const { year, month } = vietnamDate();
    const [row] = await c.env.db.select({ seq: contractCounters.lastSequence }).from(contractCounters).where(eq(contractCounters.id, `HDKT:${year}:${month}:${entity}`)).limit(1);
    return json({ contractNo: contractNumber(entity, customerCode, (row?.seq ?? 0) + 1), terms });
  }, 'business');

  router.post('/contracts', async c => {
    const body = await readJson(c.req, 64_000), me = viewer(c), quoteId = text(body.quoteId, 80);
    if (!quoteId) throw new AppError(400, 'Chọn báo giá đã duyệt để lập HĐKT.');
    const [quote] = await c.env.db.select().from(quotations).where(and(eq(quotations.id, quoteId), quotationPredicate(me))).limit(1);
    if (!quote) throw new AppError(404, 'Không tìm thấy báo giá.');
    if (quote.approvalStatus !== 'approved') throw new AppError(409, 'Báo giá chưa được duyệt. Chỉ báo giá đã duyệt mới lập được HĐKT.', 'QUOTE_NOT_APPROVED');
    const entity = legalCode(body.legalEntity);
    if (!entity) throw new AppError(400, 'Chọn pháp nhân bên bán: Bách Ngân (BN), Vigifts (VG) hoặc QTV.');
    const sourceTerms = contractTermsFromQuote(JSON.parse(quote.data));
    // Không gửi = theo báo giá (đơn không HĐKT cũng tính cùng quy tắc: báo giá → điều khoản khách → 0).
    const depositRate = Number(body.depositRate ?? sourceTerms.depositRate ?? 0);
    const paymentDays = Number(body.paymentDays ?? await balancePaymentDays(c.env.db, quoteTermsSource(quote)));
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
    const warehouseId = await pickSaleWarehouse(c.env.db, quote.assigneeId ?? quote.creatorId, me, body.warehouseId);
    const viaClaw = wantsSapoPush(c, body) && sapoPushViaClaw(c);
    const push = wantsSapoPush(c, body) && !viaClaw ? await prepareSapoPush(c, sapoLocationOf(body)) : null;
    let contractNo = '', sapo: SapoPushOutcome = null;
    let orderId = '';
    try {
      orderId = await createOrderFromQuote(c.env.db, quote, { createdBy: me.id, status: 'draft', debtWarningAccepted: body.debtWarningAccepted === true, submitted: me.role === 'manager', warehouseId, note: typeof body.note === 'string' ? text([orderNotesFromQuote(data),body.note].filter(Boolean).join('\n\n'),20000) : undefined, inTx: async (tx, oid) => {
        await saveQuoteStockPlan(tx,oid,me.id,body.stockPlan);
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
          paymentMethod: text(body.paymentMethod, 1000), deliveryAddress: text(body.deliveryAddress, 2000) || sourceTerms.deliveryAddress || order!.address,
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
    let quoteRevision: number | null = null, changedOrderId = "";
    await c.env.db.transaction(async tx => {
      const [found] = await tx.select({ order: salesOrders }).from(salesOrders).innerJoin(salesContracts, eq(salesOrders.id, salesContracts.orderId))
        .where(and(eq(salesContracts.id, c.params.id!), orderScope(c))).limit(1).for('update', { of: salesOrders });
      if (!found) throw new AppError(404, 'Không tìm thấy HĐKT.');
      changedOrderId = found.order.id;
      if (found.order.status !== 'draft' && me.role !== 'manager') throw new AppError(403, 'HĐKT đã duyệt. Chỉ Manager được chỉnh sửa hoặc huỷ.', 'CONTRACT_APPROVED');
      await assertCanEditOrder(c, found.order, 'HĐKT', tx);
      const [contract] = await tx.select().from(salesContracts).where(eq(salesContracts.id, c.params.id!)).limit(1).for('update');
      if (!contract) throw new AppError(404, 'Không tìm thấy HĐKT.');
      if (contract.status !== 'draft' && me.role !== 'manager') throw new AppError(403, 'HĐKT đã ký / hoàn tất. Chỉ Manager được chỉnh sửa hoặc huỷ.', 'CONTRACT_APPROVED');
      if (body.revision !== undefined && (!Number.isSafeInteger(body.revision) || body.revision !== contract.revision))
        throw new AppError(409, 'HĐKT đã thay đổi. Vui lòng mở lại trước khi lưu.', 'CONTRACT_CHANGED');
      if (contract.status === 'cancelled' && body.status !== undefined && body.status !== 'cancelled') throw new AppError(409,'HĐKT đã huỷ, không mở lại riêng trạng thái hợp đồng.');
      // Nhận tiền trước duyệt vẫn là thực thu: không huỷ HĐKT để bỏ qua khoản đã nhận.
      if (body.status === 'cancelled') {
        const [paid] = await tx.select({ id: customerPayments.id }).from(customerPayments)
          .where(and(eq(customerPayments.orderId, found.order.id), isNull(customerPayments.voidedAt))).limit(1);
        if (paid) throw new AppError(409, 'HĐKT đã thu tiền, không huỷ được. Cần xử lý khoản đã thu trước.', 'ORDER_HAS_PAYMENTS');
      }
      const financial = body.depositRate !== undefined || body.paymentDays !== undefined;
      if (financial && me.role !== 'manager') throw new AppError(403, 'Chỉ Manager được sửa tỷ lệ cọc và thời hạn thanh toán.');
      const set: Partial<typeof salesContracts.$inferInsert> = { updatedAt: nowIso() };
      if (body.status !== undefined) { if (!CONTRACT_STATUSES.includes(body.status as never)) throw new AppError(400, 'Trạng thái HĐKT không hợp lệ.'); set.status = body.status as never; }
      if ((body.status === 'signed' || body.status === 'completed') && found.order.status === 'draft') throw new AppError(409, 'HĐKT chưa được Manager duyệt (đơn đang chờ duyệt), chưa đánh dấu ký được.', 'ORDER_NOT_APPROVED');
      if(body.status==='completed')await assertCrmOrderCompletion(tx,found.order.id);
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
      if (body.syncQuoteTerms === true) {
        if (contract.status === 'cancelled') throw new AppError(409, 'HĐKT đã huỷ, không cập nhật báo giá nguồn.');
        const deliveryTime = body.deliveryTime === undefined ? undefined : text(body.deliveryTime, 2000);
        if (deliveryTime !== undefined) {
          const doc = JSON.parse(set.data ?? contract.data);
          doc.details = { ...(doc.details || {}), deliveryTime };
          set.data = JSON.stringify(doc);
        }
        quoteRevision = await syncContractQuoteTerms(tx, contract.quoteId ?? found.order.quoteId, contract.id, body.quoteRevision, {
          ...(set.depositRate !== undefined || set.paymentDays !== undefined ? { depositRate: set.depositRate ?? contract.depositRate } : {}),
          ...(set.paymentDays !== undefined ? { paymentDays: set.paymentDays } : {}),
          ...(set.deliveryAddress !== undefined ? { deliveryAddress: set.deliveryAddress } : {}),
          ...(deliveryTime !== undefined ? { deliveryTime } : {}),
        }, me);
      }
      if (body.status === 'cancelled') {
        await assertCanCancelDocument(tx,found.order.id);
        await tx.update(salesOrders).set({status:'cancelled',updatedAt:nowIso(),revision:sql`${salesOrders.revision}+1`}).where(eq(salesOrders.id,found.order.id));
        await syncOrderStock(tx,me.id,found.order.id,`Huỷ HĐKT ${contract.contractNo}`);
        await cancelDocumentChildren(tx,found.order,me.id);
        await removeMovements(tx,`sale:${found.order.id}:`);
      }
      const [saved] = await tx.update(salesContracts).set({ ...set, revision: contract.revision + 1 }).where(eq(salesContracts.id, contract.id)).returning();
      if (financial || body.signedDate !== undefined) await syncPaymentSchedules(tx, found.order, saved);
    });
    return json({ ok: true, quoteRevision, ...(body.returnDetail === true ? { detail: await confirmedDetail(c,changedOrderId) } : {}) });
  }, 'business');

  // ================= LỊCH GIAO HÀNG =================
  router.get('/deliveries', async c => {
    const focusId = c.url.searchParams.get('id');
    const from = focusId ? null : c.url.searchParams.get('from'), to = focusId ? null : c.url.searchParams.get('to'), status = focusId ? '' : c.url.searchParams.get('status') || '';
    // Bộ lọc chi tiết: nhân viên phụ trách đơn, loại chứng từ (đơn / HĐKT), đơn vị giao, hoá đơn của đơn.
    const sp = c.url.searchParams, owner = focusId ? '' : sp.get('owner') || '', kind = focusId ? '' : sp.get('kind') || '';
    const carrier = focusId ? '' : sp.get('carrier') || '', invoice = focusId ? '' : sp.get('invoice') || '';
    const scope = and(sql`${salesOrders.channel} <> 'pos'`, deliveryScope(c));
    const [rows, ownerOptions, carrierOptions] = await Promise.all([c.env.db.select({ d: deliveries, orderNo: salesOrders.orderNo, contractNo: salesContracts.contractNo, customerName: salesOrders.customerName,
      contact: salesOrders.contact, phone: salesOrders.phone, orderAddress: salesOrders.address, ownerId:salesOrders.ownerId,orderCreatedBy:salesOrders.createdBy,ownerName: employees.name, invoiceStatus: salesOrders.invoiceStatus, invoiceNo: salesOrders.invoiceNo })
      .from(deliveries).innerJoin(salesOrders, eq(salesOrders.id, deliveries.orderId)).leftJoin(salesContracts, eq(salesContracts.orderId, deliveries.orderId))
      .leftJoin(employees, eq(employees.id, salesOrders.ownerId))
      .where(and(scope, focusId ? eq(deliveries.id, focusId) : undefined, isDate(from) ? gte(deliveries.plannedDate, from!) : undefined, isDate(to) ? lte(deliveries.plannedDate, to!) : undefined,
        status ? eq(deliveries.status, status as never) : undefined,
        owner ? eq(salesOrders.ownerId, owner) : undefined,
        kind === 'contract' ? isNotNull(salesContracts.orderId) : kind === 'order' ? isNull(salesContracts.orderId) : undefined,
        carrier ? eq(deliveries.carrier, carrier) : undefined,
        invoice === 'requested' || invoice === 'issued' || invoice === 'none' ? eq(salesOrders.invoiceStatus, invoice) : undefined))
      .orderBy(desc(deliveries.plannedDate), desc(deliveries.createdAt), desc(deliveries.id)).limit(500),
      c.env.db.selectDistinct({ id: employees.id, name: employees.name }).from(deliveries).innerJoin(salesOrders, eq(salesOrders.id, deliveries.orderId))
        .innerJoin(employees, eq(employees.id, salesOrders.ownerId)).where(scope).orderBy(asc(employees.name)),
      c.env.db.selectDistinct({ carrier: deliveries.carrier }).from(deliveries).innerJoin(salesOrders, eq(salesOrders.id, deliveries.orderId))
        .where(and(scope, ne(deliveries.carrier, ''))).orderBy(asc(deliveries.carrier)),
    ]);
    // `contractNo` có → chuyến giao của HĐKT (hiện số HĐKT, mở #/contracts/…), không phải của đơn hàng.
    // Liên hệ / địa chỉ của khách trên đơn: kho (không xem được danh bạ khách) vẫn có đủ thông tin để liên hệ giao hàng.
    const photos = await photoUrls(c.env.db, c.env.files, 'delivery', rows.filter(r => r.d.status === 'delivered').map(r => r.d.id));
    const confirmations=await deliveryConfirmations(c.env.db,rows.map(r=>r.d));
    return json({ canCancel: !isWarehouseMember(viewer(c)), deliveries: rows.map(r => ({ ...r.d, shippingFee: isWarehouseMember(viewer(c)) ? null : r.d.shippingFee, orderNo: r.orderNo, contractNo: r.contractNo ?? null, customerName: r.customerName,
      customerContact: r.contact, customerPhone: r.phone, customerAddress: r.orderAddress, ownerName: r.ownerName ?? '', invoiceStatus: r.invoiceStatus, invoiceNo: r.invoiceNo,
      ...confirmations.get(r.d.id),canConfirm:canConfirmDelivery(viewer(c),{ownerId:r.ownerId,createdBy:r.orderCreatedBy}),canCancel:!isWarehouseMember(viewer(c))&&canConfirmDelivery(viewer(c),{ownerId:r.ownerId,createdBy:r.orderCreatedBy}),photos: photos.get(r.d.id) ?? [] })),
      filterOptions: { owners: ownerOptions, carriers: carrierOptions.map(x => x.carrier).filter(Boolean) } });
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
    // Mã chống gửi lặp (giao diện gửi một mã mỗi lần mở form): gửi lại cùng nội dung → trả chuyến cũ, khác nội dung → 409.
    const clientKey = body.clientKey === undefined ? null : text(body.clientKey, 100);
    if (clientKey !== null && !/^[a-zA-Z0-9_-]{8,100}$/.test(clientKey)) throw new AppError(400, 'Mã chống gửi lặp không hợp lệ – tải lại trang rồi thử lại.');
    const requestHash = clientKey ? deliveryRequestHash(body) : null;
    const made = await c.env.db.transaction(async tx => {
      if (clientKey) {
        await tx.select({ id: salesOrders.id }).from(salesOrders).where(eq(salesOrders.id, order.id)).for('update');
        const [prior] = await tx.select({ id: deliveries.id, plannedDate: deliveries.plannedDate, hash: deliveries.requestHash }).from(deliveries)
          .where(and(eq(deliveries.orderId, order.id), eq(deliveries.clientKey, clientKey))).limit(1);
        if (prior) {
          if (prior.hash !== requestHash) throw new AppError(409, 'Mã chống gửi lặp đã dùng cho lịch giao khác nội dung. Mở lại form để lập lịch mới.', 'IDEMPOTENCY_CONFLICT');
          return { id: prior.id, plannedDate: prior.plannedDate, replayed: true };
        }
      }
      return { ...await createScheduledDelivery(tx, order.id, body, me.id, clientKey ? { clientKey, requestHash: requestHash! } : undefined), replayed: false };
    });
    if (made.replayed) return json({ id: made.id, replayed: true });
    // Ngày lên lịch giao trở thành ngày giao dự kiến của đơn (đơn của khách cũng cập nhật theo).
    await setExpectedDeliveryDate(c, order, made.plannedDate);
    return json({ id: made.id }, 201);
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
    const [row] = await c.env.db.select({ d: deliveries, status: salesOrders.status,ownerId:salesOrders.ownerId,orderCreatedBy:salesOrders.createdBy }).from(deliveries).innerJoin(salesOrders, eq(salesOrders.id, deliveries.orderId))
      .where(and(eq(deliveries.id, c.params.id!), deliveryScope(c))).limit(1);
    if (!row) throw new AppError(404, 'Không tìm thấy lịch giao.');
    if(!canConfirmDelivery(me,{ownerId:row.ownerId,createdBy:row.orderCreatedBy}))throw new AppError(403,'Chỉ nhân viên phụ trách, Sale Admin, Kho hoặc Manager được xác nhận chuyến giao.');
    if (row.d.status === 'delivered') throw new AppError(409, 'Chuyến này đã giao xong, không đổi trạng thái được.');
    if (row.d.status === 'cancelled') throw new AppError(409, 'Chuyến đã huỷ. Lên lịch chuyến mới nếu cần giao lại.');
    if (row.status === 'cancelled' && status !== 'cancelled') throw new AppError(409, 'Đơn hàng / HĐKT đã huỷ, không giao được.');
    // Chỉ đi tới: Chờ giao ⇄ Đang giao → Đã giao / Thất bại; Thất bại → Chờ giao (giao lại); huỷ khi chưa giao. "Đã giao" chỉ từ Chờ / Đang giao.
    const from: Record<string, readonly string[]> = { planned: ['in_transit', 'failed'], in_transit: ['planned', 'failed'], failed: ['planned', 'in_transit'], delivered: ['planned', 'in_transit'], cancelled: ['planned', 'in_transit', 'failed'] };
    if (!from[status]!.includes(row.d.status)) throw new AppError(409, 'Không đổi được trạng thái chuyến giao theo thứ tự này.', 'DELIVERY_STATUS_FLOW');
    const deliveredOn = status === 'delivered' ? (isDate(body.deliveredOn) ? String(body.deliveredOn) : vietnamDate().iso) : null;
    await c.env.db.transaction(async tx => {
      const [flowOrder] = await tx.select().from(salesOrders).where(eq(salesOrders.id,row.d.orderId));
      if(flowOrder?.channel==='pos')await cashLock(tx);
      if(saleFlowOf(flowOrder?.posSnapshot)){if(['in_transit','delivered'].includes(status))await assertPosFlowFulfillable(tx,row.d.orderId);if(status==='cancelled'&&(await tx.select({id:stockMoves.id}).from(stockMoves).where(and(eq(stockMoves.refType,'pos_delivery'),eq(stockMoves.refId,row.d.id))).limit(1)).length)throw new AppError(409,'Chuyến đã xuất hàng: dùng yêu cầu trả/thu hồi, không huỷ lịch thẳng.');}
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('stock_holds'))`);
      if (['in_transit','delivered'].includes(status) && flowOrder?.channel==='pos') await assertNoStockRecovery(tx,row.d.orderId);
      if (['in_transit','delivered'].includes(status) && flowOrder?.channel==='crm') {
        await tx.select({id:salesOrders.id}).from(salesOrders).where(eq(salesOrders.id,row.d.orderId)).for('update');
        await assertPlannedDispatch(tx,row.d.orderId,row.d.id);
      }
      const [freshDeliveryOrder]=await tx.select({status:salesOrders.status,ownerId:salesOrders.ownerId,createdBy:salesOrders.createdBy,posSnapshot:salesOrders.posSnapshot}).from(salesOrders).where(eq(salesOrders.id,row.d.orderId)).for('update');
      if (!freshDeliveryOrder || (freshDeliveryOrder.status==='cancelled' && status!=='cancelled')) throw new AppError(409,'Đơn đã huỷ, không giao được.');
      assertNoPendingGhnEdit(freshDeliveryOrder.posSnapshot);
      if(!canConfirmDelivery(me,freshDeliveryOrder))throw new AppError(403,'Quyền phụ trách chuyến giao vừa thay đổi.');
      const [carrierDelivery] = await tx.select().from(deliveries).where(eq(deliveries.id,row.d.id)).for('update');
      if (flowOrder?.channel === 'pos' && carrierDelivery && isGhnTracked(carrierDelivery) && status !== 'cancelled')
        throw new AppError(409,'Vận đơn GHN tự cập nhật theo hãng vận chuyển. Bấm Đồng bộ GHN để lấy trạng thái mới nhất; không đánh dấu giao hàng thủ công.','GHN_STATUS_MANAGED');
      if(status==='cancelled') await assertNotDispatched(tx,row.d.orderId,row.d.id);
      // Đổi có điều kiện trạng thái cũ (trong giao dịch): hai lần bấm "Đã giao" cùng lúc chỉ một lần cộng số đã giao.
      const confirmedAt=nowIso();
      const done = await tx.update(deliveries).set({ status, deliveredAt: deliveredOn, updatedAt: confirmedAt,confirmedBy:me.id,confirmedAt,confirmedStatus:status })
        .where(and(eq(deliveries.id, row.d.id), inArray(deliveries.status, [...from[status]!] as typeof DELIVERY_STATUSES[number][]))).returning({ id: deliveries.id });
      if (!done.length) throw new AppError(409, 'Chuyến giao vừa được người khác cập nhật. Tải lại trang.', 'DELIVERY_CHANGED');
      await tx.insert(auditLogs).values({id:crypto.randomUUID(),actorId:me.id,module:'sales',action:'delivery-status-confirm',entityType:'deliveries',entityId:row.d.id,data:JSON.stringify({orderId:row.d.orderId,from:carrierDelivery?.status,to:status,actorName:me.name,positionId:me.positionId}),createdAt:confirmedAt});
      if(['in_transit','delivered'].includes(status))await recordDispatch(tx,row.d.orderId,row.d.id,me.id,status);
      if(status==='in_transit'&&saleFlowOf(flowOrder?.posSnapshot)==='prepaid')await issuePosDelivery(tx,row.d.orderId,row.d.id,me.id,true);
      if (status !== 'delivered') return;
      await savePhotos(tx, c.env.files, me.id, 'delivery', row.d.id, photos);
      for (const l of await tx.select().from(deliveryLines).where(eq(deliveryLines.deliveryId, row.d.id)))
        await tx.update(salesOrderLines).set({ deliveredQty: sql`LEAST(${salesOrderLines.qty}, ${salesOrderLines.deliveredQty} + ${l.qty})` }).where(eq(salesOrderLines.id, l.orderLineId));
      if (status === 'delivered') await issuePosDelivery(tx, row.d.orderId, row.d.id, me.id);
      await refreshOrderStatus(tx, row.d.orderId, deliveredOn);
      // Lịch sử sản phẩm ghi CÙNG giao dịch với "Đã giao": không có chuyến đã giao mà thiếu dòng lịch sử.
      await recordDeliveryMovements(tx, row.d);
    });
    if (status === 'delivered') await invoiceTasksChanged(c.env, { orderId: row.d.orderId }, me.id);
    // Giao xong / giao thất bại: báo nhân viên phụ trách đơn (giao lại, đòi tiền, xuất hoá đơn).
    if (status === 'delivered' || status === 'failed') {
      const [o] = await c.env.db.select({ orderNo: salesOrders.orderNo, ownerId: salesOrders.ownerId, customerName: salesOrders.customerName }).from(salesOrders).where(eq(salesOrders.id, row.d.orderId)).limit(1);
      const ref = docRef(row.d.orderId, o?.orderNo ?? '', (await contractNosOf(c.env.db, [row.d.orderId])).get(row.d.orderId));
      if (o) await notifyMany(c.env, [o.ownerId], { eventType: status === 'delivered' ? 'delivery_done' : 'delivery_failed', title: status === 'delivered' ? 'Đã giao hàng' : 'Giao hàng không thành công',
        body: `${row.d.deliveryNo} · ${ref.no} – ${o.customerName}`, url: `/index.html${ref.link}`, actorId: me.id, data: { orderId: row.d.orderId, deliveryId: row.d.id } }).catch(() => 0);
    }
    // Huỷ chuyến Ship COD quầy Lock đã có vận đơn: huỷ luôn trên GHN (lỗi thì trả lý do, chuyến CRM vẫn đã huỷ).
    const ghnCancel = status === 'cancelled' && row.d.trackingCode ? await cancelGhnShipments(c.env, [row.d.id]) : null;
    return json({ ok: true, ...(ghnCancel ? { ghnCancel } : {}) });
  }, 'business');

  // ================= CÔNG NỢ =================
  /** Công nợ theo đơn: chỉ đơn đã xác nhận hoặc có HĐKT đã ký (đơn nháp / huỷ không tính). `?status=open|overdue|paid` lọc theo tình trạng. */
  router.get('/receivables', async c => {
    const want = c.url.searchParams.get('status') || '', sp = c.url.searchParams;
    // Bộ lọc chi tiết (cùng nghĩa trang Đơn hàng): nguồn đơn, loại chứng từ, nhân viên, chi nhánh, hoá đơn, giao hàng, ngày tạo đơn.
    const kind = sp.get('kind') || '', owner = sp.get('owner') || '', branch = sp.get('branch') || '', source = sp.get('source') || '';
    const invoice = sp.get('invoice') || '', delivery = sp.get('delivery') || '', from = sp.get('from') || '', to = sp.get('to') || '';
    if ((from && !isDate(from)) || (to && !isDate(to)) || (from && to && from > to)) throw new AppError(400, 'Khoảng ngày không hợp lệ.');
    if (delivery && delivery !== 'none' && !DELIVERY_STATUSES.includes(delivery as typeof DELIVERY_STATUSES[number])) throw new AppError(400, 'Trạng thái giao hàng không hợp lệ.');
    const isGhn = or(eq(salesOrders.fulfillmentMode, 'cod'), sql`EXISTS (SELECT 1 FROM ${deliveries} WHERE ${deliveries.orderId}=${salesOrders.id} AND lower(${deliveries.carrier}) LIKE '%ghn%')`);
    const hasContract = sql`EXISTS (SELECT 1 FROM ${salesContracts} WHERE ${salesContracts.orderId} = ${salesOrders.id})`;
    const lastDelivery = sql`(select ${deliveries.status} from ${deliveries} where ${deliveries.orderId}=${salesOrders.id} and ${deliveries.status}<>'cancelled' order by ${deliveries.updatedAt} desc limit 1)`;
    const filters = and(
      kind === 'contract' ? hasContract : kind === 'order' ? sql`NOT ${hasContract}` : undefined,
      owner ? eq(salesOrders.ownerId, owner) : undefined,
      branch === 'crm' ? ne(salesOrders.channel, 'pos') : branch ? sql`EXISTS (SELECT 1 FROM ${posShifts} WHERE ${posShifts.id}=${salesOrders.shiftId} AND ${posShifts.registerId}=${branch})` : undefined,
      source === 'crm' ? ne(salesOrders.channel, 'pos') : source === 'pos' ? and(eq(salesOrders.channel, 'pos'), sql`NOT (${isGhn})`) : source === 'ghn' ? isGhn : undefined,
      invoice === 'requested' || invoice === 'issued' || invoice === 'none' ? eq(salesOrders.invoiceStatus, invoice) : undefined,
      delivery === 'none' ? sql`${lastDelivery} IS NULL` : delivery ? sql`${lastDelivery} = ${delivery}` : undefined,
      from ? gte(salesOrders.createdAt, new Date(from + 'T00:00:00+07:00').toISOString()) : undefined,
      to ? lte(salesOrders.createdAt, new Date(to + 'T23:59:59.999+07:00').toISOString()) : undefined,
    );
    // Lọc trong SQL trước khi giới hạn số dòng: chỉ đơn có công nợ (đã duyệt hoặc HĐKT đã ký) và – trừ khi xem "Đã thu đủ" – còn phải thu,
    // để đơn cũ còn nợ không bị đơn mới đã thu đủ đẩy ra khỏi danh sách.
    const due = sql`((SELECT coalesce(sum(${paymentSchedules.amount}), 0) FROM ${paymentSchedules} WHERE ${paymentSchedules.orderId} = ${salesOrders.id}) - (select coalesce(sum(${posReturns.total}),0) from ${posReturns} where ${posReturns.orderId}=${salesOrders.id} and ${posReturns.creditEffectiveAt} is not null))`;
    const paid = sql`((SELECT coalesce(sum(${customerPayments.amount}), 0) FROM ${customerPayments} WHERE ${customerPayments.orderId} = ${salesOrders.id} AND ${customerPayments.voidedAt} IS NULL) - (select coalesce(sum(${posRefunds.amount}),0) from ${posRefunds} inner join ${posReturns} on ${posReturns.id}=${posRefunds.returnId} where ${posReturns.orderId}=${salesOrders.id}) - (select coalesce(sum(${posExchangeAllocations.amount}),0) from ${posExchangeAllocations} inner join ${posReturns} on ${posReturns.id}=${posExchangeAllocations.returnId} where ${posReturns.orderId}=${salesOrders.id} and ${posExchangeAllocations.status}='applied'))`;
    const rows = await c.env.db.select().from(salesOrders).where(and(orderScope(c), ne(salesOrders.status, 'cancelled'), filters,
      or(ne(salesOrders.status, 'draft'), sql`EXISTS (SELECT 1 FROM ${salesContracts} WHERE ${salesContracts.orderId} = ${salesOrders.id} AND ${salesContracts.status} IN ('signed', 'completed'))`),
      want === 'paid' ? sql`${due} > 0 AND ${paid} >= ${due}` : sql`${due} > ${paid}`,
      matchAllWords(foldSql(salesOrders.orderNo, salesOrders.customerName, salesOrders.phone, salesOrders.taxCode,
        sql`(SELECT ${salesContracts.contractNo} FROM ${salesContracts} WHERE ${salesContracts.orderId} = ${salesOrders.id})`), c.url.searchParams.get('q'))))
      .orderBy(...rankFirst(searchRank([salesOrders.orderNo, salesOrders.phone, salesOrders.taxCode], salesOrders.customerName, c.url.searchParams.get('q'))), desc(salesOrders.createdAt), desc(salesOrders.id)).limit(2000);
    const contracts = rows.length ? await c.env.db.select({ orderId: salesContracts.orderId, status: salesContracts.status, no: salesContracts.contractNo }).from(salesContracts).where(inArray(salesContracts.orderId, rows.map(r => r.id))) : [];
    const counted = rows.filter(r => debtCounts(r.status, contracts.find(x => x.orderId === r.id)?.status)), ids = counted.map(r => r.id);
    const [sch, pay] = ids.length ? await Promise.all([
      c.env.db.select().from(paymentSchedules).where(inArray(paymentSchedules.orderId, ids)),
      c.env.db.select().from(customerPayments).where(and(inArray(customerPayments.orderId, ids), isNull(customerPayments.voidedAt))),
    ]) : [[], []];
    const today = vietnamDate().iso, owners = new Map((ids.length ? await c.env.db.select({ id: employees.id, name: employees.name }).from(employees)
      .where(inArray(employees.id, [...new Set(counted.map(r => r.ownerId))])) : []).map(e => [e.id, e.name]));
    const live = and(orderScope(c), ne(salesOrders.status, 'cancelled'));
    const [adjustments, deliveryRows, ownerOptions, branchOptions] = await Promise.all([returnAdjustments(c.env.db, ids),
      ids.length ? c.env.db.select({ orderId: deliveries.orderId, status: deliveries.status, carrier: deliveries.carrier }).from(deliveries)
        .where(and(inArray(deliveries.orderId, ids), ne(deliveries.status, 'cancelled'))).orderBy(desc(deliveries.updatedAt)) : [],
      c.env.db.selectDistinct({ id: employees.id, name: employees.name }).from(salesOrders).innerJoin(employees, eq(employees.id, salesOrders.ownerId)).where(live).orderBy(asc(employees.name)),
      c.env.db.selectDistinct({ id: posRegisters.id, name: posRegisters.name }).from(salesOrders).innerJoin(posShifts, eq(posShifts.id, salesOrders.shiftId)).innerJoin(posRegisters, eq(posRegisters.id, posShifts.registerId)).where(live).orderBy(asc(posRegisters.name)),
    ]);
    const deliveryOf = new Map<string, { status: string; carrier: string | null }>();
    for (const d of deliveryRows) if (!deliveryOf.has(d.orderId)) deliveryOf.set(d.orderId, d);
    const list = counted.map(r => {
      const net=netReturnInputs(sch.filter(x=>x.orderId===r.id),pay.filter(x=>x.orderId===r.id),adjustments.get(r.id)),s=net.schedules,p=net.payments;
      return { orderId: r.id, orderNo: r.orderNo, contractNo: contracts.find(x => x.orderId === r.id)?.no ?? null, customerId: r.customerId, customerName: r.customerName, phone: r.phone,
        orderDate: r.orderDate, orderStatus: r.status, invoiceNo: r.invoiceNo, invoiceStatus: r.invoiceStatus, ownerName: owners.get(r.ownerId) ?? '',
        deliveryStatus: deliveryOf.get(r.id)?.status ?? '', deliveryCarrier: deliveryOf.get(r.id)?.carrier ?? '', ...receivable(s, p, today), aging: debtAging(s, p, today) };
    })
      .filter(r => r.status !== 'none' && (!want || r.status === want || (want === 'open' && r.status === 'overdue')));
    const sum = (k: 'due' | 'paid' | 'balance' | 'overdue') => list.reduce((s, r) => s + r[k], 0);
    const aged = (k: 'd30' | 'd60' | 'over60' | 'd90' | 'over90') => list.reduce((s, r) => s + r.aging.buckets[k], 0);
    return json({ receivables: list, totals: { due: sum('due'), paid: sum('paid'), balance: sum('balance'), overdue: sum('overdue'), aging: { d30: aged('d30'), d60: aged('d60'), over60: aged('over60'), d90: aged('d90'), over90: aged('over90') } },
      filterOptions: { owners: ownerOptions, branches: [{ id: 'crm', name: 'VIGIFTS / CRM' }, ...branchOptions] } });
  }, 'business');

  /** Ghi nhận phiếu thu. Không thu vượt số còn phải thu của đơn. */
  router.post('/payments', async c => {
    const body = await readJson(c.req, 8_192), me = viewer(c);
    const order = await loadOrder(c, text(body.orderId, 80));
    if(saleFlowOf(order.posSnapshot))throw new AppError(409,'Đơn cọc/trả trước: dùng Thu tiền trong POS để kiểm tra ca và giữ hàng.');
    if (order.status === 'cancelled') throw new AppError(409, 'Đơn hàng / HĐKT đã huỷ, không ghi thu được.');
    if (order.status === 'draft' && order.channel !== 'crm') throw new AppError(409, 'Đơn POS chưa được duyệt, chưa ghi thu được.', 'ORDER_NOT_APPROVED');
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
    // Mã chống lặp: POS bắt buộc; đơn CRM có gửi thì dùng luôn (mạng chập chờn bấm lại không ghi thu hai lần).
    const sentKey = text(body.key,100), requestKey = posReceipt || /^[a-zA-Z0-9_-]{16,100}$/.test(sentKey) ? sentKey : null;
    if(posReceipt && (!requestKey || !/^[a-zA-Z0-9_-]{16,100}$/.test(requestKey) || !Number.isSafeInteger(amount) || !['cash','transfer'].includes(method) || body.confirmed!==true)) throw new AppError(400,'Xác nhận đã thực nhận tiền, chọn tiền mặt/chuyển khoản và cung cấp mã chống lặp hợp lệ.');
    const scheduleId = body.scheduleId ? text(body.scheduleId, 80) : null;
    if (scheduleId && !(await c.env.db.select({ id: paymentSchedules.id }).from(paymentSchedules).where(and(eq(paymentSchedules.id, scheduleId), eq(paymentSchedules.orderId, order.id))).limit(1)).length)
      throw new AppError(400, 'Kỳ thanh toán không thuộc đơn này.');
    const needsCashConfirmation = order.channel==='crm' && method==='cash' && me.role==='employee' && canCollectCrmCashWithoutDrawer(me);
    if(needsCashConfirmation&&!requestKey)throw new AppError(400,'Thiếu mã chống gửi lặp cho ghi nhận tiền mặt.');
    const id = crypto.randomUUID();
    let receiptId:string=id,replayed=false;
    const receiptState:{status:'confirmed'|'held'}={status:'confirmed'};
    // Khoá dòng đơn rồi mới tính số còn phải thu: hai lần bấm / hai người ghi cùng lúc không thu vượt.
    await c.env.db.transaction(async tx => {
      await cashLock(tx);
      if(requestKey&&order.channel==='crm'){
        const [held]=await tx.select().from(cashCollections).where(eq(cashCollections.requestKey,requestKey));
        if(held){
          if(held.orderId!==order.id||held.amount!==amount||method!=='cash'||held.collectedBy!==me.id||held.paidAt!==paidAt||held.reference!==text(body.reference,200)||held.note!==text(body.note,2000)||held.scheduleId!==scheduleId||held.status==='cancelled')throw new AppError(409,'Mã ghi nhận tiền mặt đã dùng cho nội dung khác hoặc đã huỷ.');
          if(held.status==='confirmed'){const [p]=await tx.select({voidedAt:customerPayments.voidedAt}).from(customerPayments).where(eq(customerPayments.id,held.paymentId!));if(!p||p.voidedAt)throw new AppError(409,'Phiếu thu đã huỷ; không gửi lại ghi nhận này.');}
          receiptId=held.id;receiptState.status=held.status;replayed=true;return;
        }
      }
      if(requestKey){const [prior]=await tx.select().from(customerPayments).where(eq(customerPayments.requestKey,requestKey));if(prior){if(prior.orderId!==order.id||prior.amount!==amount||prior.method!==method||prior.createdBy!==me.id||prior.voidedAt)throw new AppError(409,'Mã ghi thu đã dùng cho giao dịch khác.');receiptId=prior.id;replayed=true;return;}}
      let cashShiftId:string|null=null;
      const [cashShift] = await tx.select().from(posShifts).where(and(eq(posShifts.memberId, me.id), isNull(posShifts.closedAt)));
      const outsideDrawer = order.channel === 'crm' && method === 'cash' && canCollectCrmCashWithoutDrawer(me);
      if (posReceipt || (!outsideDrawer && method === 'cash' && (cashShift || (await drawerOf(tx)).openingSetAt))) {
        if (!cashShift) throw new AppError(409, 'Cần ca đang mở để ghi tiền mặt vào két.');
        if (posReceipt && order.shiftId) {
          const [originalShift] = await tx.select().from(posShifts).where(eq(posShifts.id, order.shiftId));
          if (!originalShift || originalShift.cashDrawerId !== cashShift.cashDrawerId) throw new AppError(409, 'Cần mở ca tại đúng két của đơn POS để ghi thu.');
        }
        if (paidAt !== vietnamDate().iso) throw new AppError(400, 'Tiền vào két ghi nhận ngày thực thu hôm nay.');
        cashShiftId = cashShift.id;
      }
      const [fresh] = await tx.select({ status: salesOrders.status, channel: salesOrders.channel, posSnapshot: salesOrders.posSnapshot }).from(salesOrders).where(eq(salesOrders.id, order.id)).for('update');
      if (!fresh || fresh.status === 'cancelled') throw new AppError(409, 'Đơn hàng / HĐKT đã huỷ, không ghi thu được.');
      assertNoPendingGhnEdit(fresh.posSnapshot);
      if (fresh.status === 'draft' && fresh.channel !== 'crm') throw new AppError(409, 'Đơn POS chưa được duyệt, chưa ghi thu được.', 'ORDER_NOT_APPROVED');
      const debt = (await receivableOf(tx, [order.id])).get(order.id)!;
      const held=order.channel==='crm'?await heldCashForOrder(tx,order.id):0;
      if (amount > debt.balance-held) throw new AppError(400, held?`Nhân viên đang giữ ${held.toLocaleString('vi-VN')} đ; đơn chỉ còn có thể thu thêm ${Math.max(0,debt.balance-held).toLocaleString('vi-VN')} đ.`:`Đơn chỉ còn phải thu ${debt.balance.toLocaleString('vi-VN')} đ.`);
      if(needsCashConfirmation){
        await tx.insert(cashCollections).values({id,orderId:order.id,scheduleId,requestKey:requestKey!,amount,paidAt,reference:text(body.reference,200),note:text(body.note,2000),status:'held',collectedBy:me.id,createdAt:nowIso()});
        await cashAudit(tx,me.id,'cash-collection-held','customer_cash_collections',id,{orderId:order.id,amount,paidAt});
        receiptState.status='held';return;
      }
      await tx.insert(customerPayments).values({ id, orderId: order.id, scheduleId, customerId: order.customerId, shiftId:cashShiftId, requestKey, paymentSource:posReceipt?'pos':'manual', amount, paidAt, method, reference: text(body.reference, 200), note: text(body.note, 2000), createdBy: me.id, createdAt: nowIso() });
      if(cashShiftId || outsideDrawer)await cashAudit(tx,me.id,'receipt','payments',id,{orderId:order.id,shiftId:cashShiftId,amount,method,...(outsideDrawer?{cashHandling:'outside_drawer'}:{})});
    });
    if(receiptState.status==='held'&&!replayed){
      const managers=await c.env.db.select({id:employees.id}).from(employees).where(and(eq(employees.role,'manager'),eq(employees.active,true),isNull(employees.deletedAt)));
      await notifyMany(c.env,managers.map(m=>m.id),{eventType:'cash_collection_held',title:'Tiền mặt nhân viên đang giữ',body:`${me.name}: ${amount.toLocaleString('vi-VN')} đ · ${order.orderNo}`,url:'/index.html#/orders/'+encodeURIComponent(order.id),actorId:me.id}).catch(()=>console.warn('Cash collection notification skipped'));
    }
    return json({ id:receiptId,status:receiptState.status }, 201);
  }, 'business');

  /** Huỷ phiếu thu ghi nhầm (bắt buộc lý do). Phiếu giữ lại trong lịch sử, không tính vào đã thu; muốn sửa thì huỷ rồi ghi phiếu mới. */
  router.post('/payments/:id/void', async c => {
    const me = viewer(c), body = await readJson(c.req, 2_000), reason = text(body.reason, 500);
    if (!canVoidPayment(me)) throw new AppError(403, 'Chỉ Manager hoặc người có quyền "Huỷ phiếu thu" huỷ được phiếu thu.');
    if (reason.length < 3) throw new AppError(400, 'Ghi lý do huỷ phiếu thu.');
    const [p] = await c.env.db.select({ id: customerPayments.id, orderId: customerPayments.orderId, voidedAt: customerPayments.voidedAt, voidedBy: customerPayments.voidedBy, voidReason: customerPayments.voidReason, shiftId: customerPayments.shiftId, paymentSource: customerPayments.paymentSource, amount: customerPayments.amount }).from(customerPayments)
      .innerJoin(salesOrders, eq(salesOrders.id, customerPayments.orderId)).where(and(eq(customerPayments.id, c.params.id!), orderScope(c))).limit(1);
    if (!p) throw new AppError(404, 'Không tìm thấy phiếu thu.');
    // Gửi lại sau khi mạng rớt (lần trước đã huỷ xong): cùng người, cùng lý do → báo thành công thay vì báo lỗi.
    if (p.voidedAt && p.voidedBy === me.id && p.voidReason === reason) return json({ ok: true, orderId: p.orderId, alreadyApplied: true, ...(body.returnDetail === true ? { detail: await confirmedDetail(c,p.orderId) } : {}) });
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
      // GHN thu hộ đúng số tiền lúc tạo vận đơn: đã có vận đơn / đã đi giao mà cộng lại cọc vào COD → khi GHN giao xong CRM ghi thu thừa số cọc.
      const [ship] = deliveryId ? await tx.select({ status: deliveries.status, trackingCode: deliveries.trackingCode }).from(deliveries).where(eq(deliveries.id, deliveryId)) : [];
      if (ship && (ship.trackingCode || ship.status !== 'planned'))
        throw new AppError(409, 'Chuyến COD đã có vận đơn / đã đi giao: GHN đang thu hộ số tiền cũ. Huỷ chuyến giao (huỷ vận đơn) rồi mới huỷ phiếu cọc.', 'COD_SHIPMENT_EXISTS');
      if (deliveryId) await tx.update(deliveries).set({ codAmount: sql`${deliveries.codAmount} + ${p.amount}`, updatedAt: nowIso() })
        .where(and(eq(deliveries.id, deliveryId), eq(deliveries.orderId, p.orderId)));
    }
    const [flowOrder] = await tx.select().from(salesOrders).where(eq(salesOrders.id,p.orderId));
    if(saleFlowOf(flowOrder?.posSnapshot) && ((await flowIssued(tx,p.orderId)).some(r=>r.qty>0)||flowOrder?.status==='delivered'))throw new AppError(409,'Đã xuất hàng: xử lý trả/hoàn thay vì huỷ phiếu thu.');
    if (saleFlowOf(flowOrder?.posSnapshot) && flowOrder?.status!=='delivered') await tx.update(posOrderReservations).set({expiresAt:sql`least(${posOrderReservations.expiresAt},${flowHoldUntil(nowIso())})`,updatedAt:nowIso()}).where(and(eq(posOrderReservations.orderId,p.orderId),eq(posOrderReservations.status,'active')));
    if(p.shiftId) await voidClosedCashEffect(tx,p.shiftId,me.id,`Huỷ phiếu thu ${p.id}: ${reason}`);
    await cashAudit(tx,me.id,'void','payments',p.id,{reason,shiftId:p.shiftId});
    });
    return json({ ok: true, orderId: p.orderId, ...(body.returnDetail === true ? { detail: await confirmedDetail(c,p.orderId) } : {}) });
  }, 'business');
}
