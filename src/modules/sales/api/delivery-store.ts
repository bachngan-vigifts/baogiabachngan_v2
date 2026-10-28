import { documentNumberPatterns } from '../../../core/document-number.ts';
import { orderRecipient } from '../domain/order-notes.ts';
import { saleFlowOf } from '../domain/pos-order-flow.ts';
import { and, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import type { StaffEnv } from '../../staff/api/auth-routes.ts';
import { deliveries, deliveryLines, packingSlips, salesOrderLines, salesOrders } from '../schema.ts';
import { nextDocNo, vietnamDate } from '../domain/sales.ts';

type Tx = Parameters<Parameters<StaffEnv['db']['transaction']>[0]>[0];
const text = (value: unknown, max: number) => {
  if (value !== undefined && value !== null && typeof value !== 'string') throw new AppError(400, 'Thông tin giao hàng không hợp lệ.');
  return String(value ?? '').trim().slice(0, max);
};

export function ghnCodeOf(value: unknown) {
  const raw = String(value ?? '').toUpperCase();
  return raw.match(/(?:^|[^A-Z0-9])GHN[-:#\s]*([A-Z0-9]{6,24})(?:$|[^A-Z0-9])/)?.[1] ?? '';
}

/** Caller checks order access. Shared by standalone and combined scheduling; always inside the caller's transaction. */
export async function createScheduledDelivery(tx: Tx, orderId: string, body: Record<string, unknown>, actorId: string, request?: { clientKey: string; requestHash: string }) {
  const [order] = await tx.select().from(salesOrders).where(eq(salesOrders.id, orderId)).limit(1).for('update');
  if (!order) throw new AppError(404, 'Không tìm thấy đơn hàng / HĐKT.');
  if (saleFlowOf(order.posSnapshot)==='deposit') throw new AppError(409,'Đơn cọc nhận tại quầy, dùng Thu nốt và xuất hàng.');
  if (order.status === 'draft') throw new AppError(409, 'Đơn chưa được Manager duyệt, chưa lên lịch giao được.', 'ORDER_NOT_APPROVED');
  if (order.status === 'cancelled' || order.status === 'delivered') throw new AppError(409, 'Đơn đã huỷ hoặc đã giao xong.');
  const date = text(body.plannedDate, 100);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + 'T00:00:00Z')) || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date)
    throw new AppError(400, 'Chọn ngày giao hợp lệ.');
  const shippingFee = Number(body.shippingFee ?? 0);
  if (!Number.isFinite(shippingFee) || shippingFee < 0 || shippingFee > 1e13) throw new AppError(400, 'Phí giao hàng không hợp lệ.');
  if (body.lines !== undefined && (!Array.isArray(body.lines) || body.lines.length > 500)) throw new AppError(400, 'Danh sách hàng giao không hợp lệ.');
  const lines = await tx.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, orderId));
  const pending = await tx.select({ lineId: deliveryLines.orderLineId, qty: deliveryLines.qty }).from(deliveryLines)
    .innerJoin(deliveries, eq(deliveries.id, deliveryLines.deliveryId)).where(and(eq(deliveries.orderId, orderId), inArray(deliveries.status, ['planned', 'in_transit'])));
  const remaining = (l: typeof lines[number]) => l.qty - l.deliveredQty - pending.filter(p => p.lineId === l.id).reduce((sum, p) => sum + p.qty, 0);
  const quantities = new Map<string, number>();
  const wanted = (body.lines ?? []) as Record<string, unknown>[];
  if (wanted.length) for (const item of wanted) {
    if (!item || typeof item !== 'object') throw new AppError(400, 'Dòng hàng giao không hợp lệ.');
    const line = lines.find(l => l.id === item.orderLineId), qty = Number(item.qty);
    if (!line) throw new AppError(400, 'Dòng hàng không thuộc đơn.');
    if (!Number.isFinite(qty) || qty < 0 || qty > 1e9) throw new AppError(400, 'Số lượng giao không hợp lệ.');
    if (qty > 0) quantities.set(line.id, (quantities.get(line.id) ?? 0) + qty);
  } else for (const line of lines) { const qty = remaining(line); if (qty > 0) quantities.set(line.id, qty); }
  if (!quantities.size) throw new AppError(400, 'Không còn hàng nào cần giao cho đơn này.');
  for (const [id, qty] of quantities) {
    const line = lines.find(l => l.id === id)!;
    if (qty > remaining(line) + 1e-9) throw new AppError(400, `"${line.name}" chỉ còn ${remaining(line)} ${line.unit} chưa lên lịch giao.`);
  }
  // Different orders created concurrently must not choose the same daily document number.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'delivery-number:' + date}))`);
  const used = await tx.select({ no: deliveries.deliveryNo }).from(deliveries).where(or(...documentNumberPatterns('GH', date).map(pattern => sql`${deliveries.deliveryNo} LIKE ${pattern}`)));
  const id = crypto.randomUUID(), now = new Date().toISOString();
  const trackingCode = text(body.ghnOrderCode, 100).toUpperCase().replace(/^GHN[-:#\s]*/i, '') || ghnCodeOf(body.note) || ghnCodeOf(order.note);
  await tx.insert(deliveries).values({ id, deliveryNo: nextDocNo('GH', date, used.map(r => r.no)), orderId, plannedDate: date,
    timeSlot: text(body.timeSlot, 100), address: text(body.address, 2000) || order.address,
    ...orderRecipient(order, { receiverName: text(body.receiverName, 500), receiverPhone: text(body.receiverPhone, 100) }),
    carrier: trackingCode ? 'GHN' : text(body.carrier, 200), trackingCode, shippingFee: Math.round(shippingFee), status: 'planned',
    assigneeId: body.assigneeId ? text(body.assigneeId, 80) : null, note: text(body.note, 2000), clientKey: request?.clientKey ?? null, requestHash: request?.requestHash ?? null,
    createdBy: actorId, createdAt: now, updatedAt: now });
  await tx.insert(deliveryLines).values([...quantities].map(([orderLineId, qty]) => ({ deliveryId: id, orderLineId, qty })));
  return { id, plannedDate: date };
}

/** Packing plans imply one initial customer trip. Caller holds the order lock; no stock is issued here. */
export async function ensurePackingSchedule(tx: Tx, orderId: string, actorId: string) {
  const [order] = await tx.select().from(salesOrders).where(eq(salesOrders.id,orderId)).for('update');
  if (!order || order.channel !== 'crm' || ['draft','cancelled','delivered'].includes(order.status)) return;
  const [packing] = await tx.select({id:packingSlips.id}).from(packingSlips).where(and(eq(packingSlips.orderId,orderId),ne(packingSlips.status,'cancelled'))).limit(1);
  if (!packing) return;
  const [existing] = await tx.select({id:deliveries.id}).from(deliveries).where(eq(deliveries.orderId,orderId)).limit(1);
  if (existing) return; // Do not undo an explicit cancellation.
  const made = await createScheduledDelivery(tx,orderId,{plannedDate:order.expectedDeliveryDate||vietnamDate().iso},actorId);
  if (!order.expectedDeliveryDate) await tx.update(salesOrders).set({expectedDeliveryDate:made.plannedDate}).where(eq(salesOrders.id,orderId));
  return made;
}
