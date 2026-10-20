import { saleFlowOf } from '../domain/pos-order-flow.ts';
import { assertNoReturnActivity } from './pos-return-credit.ts';
import { posOrderNote } from '../domain/pos-order-note.ts';
import { snapshotPosFees } from '../domain/pos-fees.ts';
import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import type { PosDb, PosMember } from './pos-store.ts';
import { posText, reservedBySku } from './pos-store.ts';
import { posLine, posMoney } from '../domain/pos-money.ts';
import { cashAudit } from './cash-store.ts';
import { customers } from '../../customers/schema.ts';
import { stockBalances } from '../../inventory/schema.ts';
import { salesOrders, salesOrderLines, salesContracts, customerPayments, paymentSchedules, deliveries, deliveryLines, packingSlips } from '../schema.ts';

/** Manager amendments never rewrite a posted receipt or reverse an inventory issue. */
export async function editPosOrder(db: PosDb, order: typeof salesOrders.$inferSelect, actor: PosMember, b: Record<string, unknown>) {
  if (actor.role !== 'manager') throw new AppError(403, 'Đơn POS đã duyệt: chỉ Manager được sửa.');
  if (order.channel !== 'pos' || order.status === 'cancelled') throw new AppError(409, 'Chỉ sửa đơn POS còn hiệu lực.');
  if (b.revision !== order.revision) throw new AppError(409, 'Đơn vừa được cập nhật. Tải lại trước khi sửa.');
  const reason = posText(b.reason, 2000);
  if (!reason) throw new AppError(400, 'Nhập lý do sửa đơn.');
  const [oldLines, ships, receipts, schedules, packs, contracts] = await Promise.all([
    db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, order.id)).orderBy(asc(salesOrderLines.lineNo)),
    db.select().from(deliveries).where(eq(deliveries.orderId, order.id)),
    db.select().from(customerPayments).where(and(eq(customerPayments.orderId, order.id), isNull(customerPayments.voidedAt))),
    db.select().from(paymentSchedules).where(eq(paymentSchedules.orderId, order.id)),
    db.select().from(packingSlips).where(and(eq(packingSlips.orderId, order.id), ne(packingSlips.status, 'cancelled'))),
    db.select().from(salesContracts).where(and(eq(salesContracts.orderId, order.id), ne(salesContracts.status, 'cancelled'))),
  ]);
  const snapshot = JSON.parse(order.posSnapshot || '{}');
  const customerId = b.customerId === undefined ? order.customerId : posText(b.customerId) || null;
  if (customerId !== order.customerId) await assertNoReturnActivity(db, order.id);
  if (customerId !== order.customerId && receipts.length) throw new AppError(409, 'Đơn đã thu tiền: cần xử lý phiếu thu trước khi đổi khách liên kết.');
  if (customerId) {
    const [customer] = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.id, customerId), eq(customers.approvalStatus, 'approved')));
    if (!customer) throw new AppError(400, 'Khách hàng chưa dùng được.');
  }
  const fields = {
    note: b.note === undefined ? order.note : posOrderNote(b.note),
    customerId, customerName: b.customerName === undefined ? order.customerName : posText(b.customerName, 500),
    contact: b.contact === undefined ? order.contact : posText(b.contact, 500),
    phone: b.phone === undefined ? order.phone : posText(b.phone, 100),
    email: b.email === undefined ? order.email : posText(b.email, 254),
    taxCode: b.taxCode === undefined ? order.taxCode : posText(b.taxCode, 100),
    address: b.address === undefined ? order.address : posText(b.address, 2000),
  };
  if (!fields.customerName) throw new AppError(400, 'Nhập tên khách hàng.');
  let totals = { subtotal: order.subtotal, tax: order.tax, total: order.total };
  let computed: ReturnType<typeof posLine>[] | null = null;
  if (b.lines !== undefined) {
    if (!Array.isArray(b.lines) || b.lines.length !== oldLines.length) throw new AppError(400, 'Giữ đủ các dòng hàng của đơn.');
    const input = b.lines as Record<string, unknown>[];
    if (input.some(l => !l || typeof l !== 'object') || new Set(input.map(l => l.id)).size !== oldLines.length || input.some(l => !oldLines.some(old => old.id === l.id)))
      throw new AppError(400, 'Dòng hàng không thuộc đơn hoặc bị trùng.');
    const byId = new Map(input.map(l => [l.id, l]));
    const changed = oldLines.some(l => {
      const row = byId.get(l.id)!;
      return Number(row.qty) !== l.qty || Number(row.price) !== (l.listUnitPrice ?? l.unitPrice) || row.discountType !== l.discountType || Number(row.discountValue) !== l.discountValue;
    });
    if (changed) {
      if (saleFlowOf(order.posSnapshot)) throw new AppError(409,'Đơn cọc/trả trước giữ nguyên giá, chiết khấu và số lượng.');
      await assertNoReturnActivity(db,order.id);
      const active = ships.filter(s => s.status !== 'cancelled');
      if (order.fulfillmentMode !== 'cod' || receipts.length || oldLines.some(l => l.deliveredQty > 0) || packs.length || contracts.length || active.some(s => s.status !== 'planned') || active.length > 1)
        throw new AppError(409, 'Chỉ đổi số lượng/giá khi COD chưa xuất hàng, chưa thu và có tối đa một chuyến chờ giao. Phiếu đã đóng gói cần xử lý trước.');
      if (active.length) {
        const plannedLines = await db.select().from(deliveryLines).where(eq(deliveryLines.deliveryId, active[0]!.id));
        if (plannedLines.length !== oldLines.length || oldLines.some(l => !plannedLines.some(dl => dl.orderLineId === l.id && dl.qty === l.qty)))
          throw new AppError(409, 'Chuyến giao đã chia một phần: cần xử lý lịch giao trước khi đổi số lượng/giá.');
      }
      computed = oldLines.map(l => {
        const row = byId.get(l.id)!;
        if (row.qty === '' || row.price === '') throw new AppError(400, 'Không để trống số lượng hoặc đơn giá.');
        return posLine({ price: posMoney(row.price, 'Đơn giá'), qty: row.qty, discountType: row.discountType, discountValue: row.discountValue,
          taxRate: l.taxRate, priceIncludesVat: l.taxRate > 0, vatEnabled: l.taxRate > 0 });
      });
      const skus = [...new Set(oldLines.map(l => l.sku))].sort();
      const warehouseId = snapshot.register?.warehouseId;
      if (typeof warehouseId !== 'string' || !warehouseId) throw new AppError(409, 'Thiếu kho gốc của đơn POS.');
      const balances = await db.select().from(stockBalances).where(and(eq(stockBalances.warehouseId, warehouseId), inArray(stockBalances.sku, skus))).for('update');
      const reserved = await reservedBySku(db, skus, warehouseId);
      for (const sku of skus) {
        const own = oldLines.filter(l => l.sku === sku).reduce((n, l) => n + (order.holdsStock ? l.qty : 0), 0);
        const wanted = oldLines.reduce((n, l, i) => n + (l.sku === sku ? computed![i]!.qty : 0), 0);
        const available = (balances.find(r => r.sku === sku)?.qty ?? 0) - (reserved.get(sku) ?? 0) + own;
        if (wanted > available + 1e-9) throw new AppError(409, `${sku}: chỉ còn khả dụng ${Math.max(0, available)}.`, 'POS_STOCK_SHORT');
      }
      const fees = snapshotPosFees(snapshot);
      totals = { subtotal: posMoney(computed.reduce((n, l) => n + l.subtotal, 0) + fees.subtotal), tax: posMoney(computed.reduce((n, l) => n + l.tax, 0) + fees.tax), total: posMoney(computed.reduce((n, l) => n + l.total, 0) + fees.total) };
      if (schedules.length !== 1) throw new AppError(409, 'Đơn có lịch thanh toán riêng, cần xử lý lịch thu trước khi đổi giá trị.');
    }
  }
  const now = new Date().toISOString();
  if (computed) {
    for (const [i, old] of oldLines.entries()) {
      const line = computed[i]!;
      await db.update(salesOrderLines).set({ qty: line.qty, unitPrice: line.unitPrice, listUnitPrice: line.listUnitPrice, discountType: line.discountType, discountValue: line.discountValue, discountAmount: line.discountAmount, amount: line.subtotal }).where(eq(salesOrderLines.id, old.id));
      for (const ship of ships.filter(s => s.status === 'planned'))
        await db.update(deliveryLines).set({ qty: line.qty }).where(and(eq(deliveryLines.deliveryId, ship.id), eq(deliveryLines.orderLineId, old.id)));
    }
    await db.update(paymentSchedules).set({ amount: totals.total }).where(eq(paymentSchedules.id, schedules[0]!.id));
    for (const ship of ships.filter(s => s.status === 'planned')) await db.update(deliveries).set({ codAmount: totals.total, updatedAt: now }).where(eq(deliveries.id, ship.id));
    snapshot.lines = oldLines.map((l, i) => ({ ...l, ...computed![i]!, id: undefined }));
    snapshot.discount = computed.reduce((n, l) => n + l.discountAmount, 0);
    Object.assign(snapshot, totals, { tendered: totals.total });
  }
  const paymentNote = b.paymentNote === undefined ? undefined : posText(b.paymentNote, 2000);
  if (paymentNote !== undefined) await db.update(paymentSchedules).set({ note: paymentNote }).where(eq(paymentSchedules.orderId, order.id));
  if (b.delivery !== undefined) {
    if (!b.delivery || typeof b.delivery !== 'object' || Array.isArray(b.delivery)) throw new AppError(400, 'Thông tin giao không hợp lệ.');
    const d = b.delivery as Record<string, unknown>;
    const address = posText(d.address, 2000), receiverName = posText(d.receiverName, 500), receiverPhone = posText(d.receiverPhone, 100);
    if (order.fulfillmentMode === 'cod' && !address) throw new AppError(400, 'Nhập địa chỉ giao hàng.');
    const editable = ships.filter(s => ['planned', 'in_transit'].includes(s.status));
    if (!editable.length && ships.some(s => s.status === 'delivered' && (s.address !== address || s.receiverName !== receiverName || s.receiverPhone !== receiverPhone)))
      throw new AppError(409, 'Chuyến đã giao: không sửa thông tin giao hàng lịch sử.');
    await db.update(deliveries).set({ address, receiverName, receiverPhone, updatedAt: now }).where(and(eq(deliveries.orderId, order.id), inArray(deliveries.status, ['planned', 'in_transit'])));
  }
  snapshot.customer = fields.customerName;
  snapshot.note = fields.note;
  await db.update(salesOrders).set({ ...fields, ...totals, posSnapshot: JSON.stringify(snapshot), revision: order.revision + 1, updatedAt: now }).where(eq(salesOrders.id, order.id));
  await cashAudit(db, actor.id, 'amend-pos-order', 'orders', order.id, { reason, before: { ...order, lines: oldLines }, after: { ...fields, ...totals, lines: computed, delivery: b.delivery, paymentNote }, revision: order.revision + 1 });
  return { id: order.id, revision: order.revision + 1, ...totals };
}
