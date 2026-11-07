import { ensureLineCosts } from './line-costs.ts';
import { pendingGhnEdit, type GhnEditPreviewLine } from '../domain/pos-ghn-edit.ts';
import { assertNotDispatched } from './cancellation-guards.ts';
import { saleFlowOf } from '../domain/pos-order-flow.ts';
import { assertNoReturnActivity } from './pos-return-credit.ts';
import { posOrderNote } from '../domain/pos-order-note.ts';
import { snapshotPosFees } from '../domain/pos-fees.ts';
import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import type { PosDb, PosMember } from './pos-store.ts';
import { posText, reservedBySku } from './pos-store.ts';
import { allocatePosVoucher, parsePosVoucher, posLine, posMoney } from '../domain/pos-money.ts';
import { cashAudit } from './cash-store.ts';
import { products, productPrices } from '../../catalog/schema.ts';
import { customers } from '../../customers/schema.ts';
import { stockBalances } from '../../inventory/schema.ts';
import { salesOrders, salesOrderLines, salesContracts, customerPayments, paymentSchedules, deliveries, deliveryLines, packingSlips, packingSlipLines } from '../schema.ts';

/** Manager amendments never rewrite a posted receipt or reverse an inventory issue. */
export async function editPosOrder(db: PosDb, order: typeof salesOrders.$inferSelect, actor: PosMember, b: Record<string, unknown>, options: { allowGhn?: boolean; allowPending?: boolean; preview?: boolean } = {}) {
  if (pendingGhnEdit(order.posSnapshot) && !options.allowPending) throw new AppError(409, 'Đơn đang chờ hoàn tất sửa GHN. Tiếp tục lần sửa trước.', 'GHN_EDIT_PENDING');
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
  const plan: { id: string; sku: string; name: string; unit: string; taxRate: number; row: Record<string, unknown>; existing: boolean }[] = [];
  if (b.lines !== undefined) {
    if (!Array.isArray(b.lines) || !b.lines.length || b.lines.length > 150) throw new AppError(400, 'Đơn cần từ 1 đến 150 dòng hàng.');
    const input = b.lines as Record<string, unknown>[];
    if (input.some(l => !l || typeof l !== 'object' || Array.isArray(l))) throw new AppError(400, 'Dòng hàng không hợp lệ.');
    const ids = input.filter(l => l.id !== undefined).map(l => l.id);
    if (new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !oldLines.some(old => old.id === id)))
      throw new AppError(400, 'Dòng hàng không thuộc đơn hoặc bị trùng.');
    for (const row of input) {
      const old = oldLines.find(l => l.id === row.id);
      if (old && row.sku !== undefined && row.sku !== old.sku) throw new AppError(400, 'Không đổi mã trên ID dòng cũ. Xoá dòng rồi thêm sản phẩm cần thay.');
      const sku = old?.sku ?? posText(row.sku, 100);
      if (!sku) throw new AppError(400, 'Chọn mã sản phẩm cho dòng mới.');
      plan.push({ id: old?.id ?? crypto.randomUUID(), sku, name: old?.name ?? '', unit: old?.unit ?? '', taxRate: old?.taxRate ?? 0, row, existing: !!old });
    }
    if (new Set(plan.map(l => l.sku)).size !== plan.length) throw new AppError(400, 'Gộp số lượng các dòng trùng mã sản phẩm.');
    const changed = plan.length !== oldLines.length || plan.some((l, i) => {
      const old = oldLines.find(old => old.id === l.id), row = l.row;
      return !old || oldLines[i]?.id !== l.id || Number(row.qty) !== old.qty || Number(row.price) !== (old.listUnitPrice ?? old.unitPrice) || row.discountType !== old.discountType || Number(row.discountValue) !== old.discountValue;
    });
    if (changed) {
      if (saleFlowOf(order.posSnapshot)) throw new AppError(409,'Đơn cọc/trả trước giữ nguyên giá, chiết khấu và số lượng.');
      await assertNoReturnActivity(db,order.id);
      await assertNotDispatched(db, order.id);
      const active = ships.filter(s => s.status !== 'cancelled');
      // Carrier edits enter through the durable GHN workflow; ordinary edits cannot bypass its readback and reservation checks.
      if (!options.allowGhn && active.some(s => s.trackingCode)) throw new AppError(409, 'Đơn có vận đơn GHN: mở form Sửa đơn POS để cập nhật đồng thời hàng và COD, không sửa riêng dữ liệu CRM.', 'GHN_SHIPMENT_EXISTS');
      if (order.fulfillmentMode !== 'cod' || receipts.length || oldLines.some(l => l.deliveredQty > 0) || packs.length || contracts.length || active.some(s => s.status !== 'planned') || active.length > 1)
        throw new AppError(409, 'Chỉ đổi số lượng/giá khi COD chưa xuất hàng, chưa thu và có tối đa một chuyến chờ giao. Phiếu đã đóng gói cần xử lý trước.');
      if (active.length) {
        const plannedLines = await db.select().from(deliveryLines).where(eq(deliveryLines.deliveryId, active[0]!.id));
        if (plannedLines.length !== oldLines.length || oldLines.some(l => !plannedLines.some(dl => dl.orderLineId === l.id && dl.qty === l.qty)))
          throw new AppError(409, 'Chuyến giao đã chia một phần: cần xử lý lịch giao trước khi đổi số lượng/giá.');
      }
      const added = plan.filter(l => !l.existing);
      if (added.length) {
        const policyId = snapshot.pricePolicyId;
        if (typeof policyId !== 'string' || !policyId) throw new AppError(409, 'Thiếu chính sách giá gốc của đơn POS.');
        const found = await db.select({ product: products, price: productPrices.price }).from(products)
          .innerJoin(productPrices, and(eq(productPrices.sku, products.sku), eq(productPrices.policyId, policyId)))
          .where(and(inArray(products.sku, added.map(l => l.sku)), eq(products.active, true), eq(products.approvalStatus, 'approved')));
        const withVat = typeof snapshot.vatEnabled === 'boolean' ? snapshot.vatEnabled : policyId === snapshot.register?.pricePolicyId;
        const taxRate = withVat ? Number(snapshot.register?.taxRate) : 0;
        if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) throw new AppError(409, 'Thiếu cấu hình VAT gốc của đơn POS.');
        for (const line of added) {
          const match = found.find(p => p.product.sku === line.sku);
          if (!match || match.price === null) throw new AppError(400, 'Sản phẩm chưa được duyệt, ngừng bán hoặc thiếu giá theo chính sách gốc: ' + line.sku);
          line.name = match.product.name; line.unit = match.product.unit; line.taxRate = taxRate;
          if (line.row.price === undefined) line.row = { ...line.row, price: match.price };
        }
      }
      const removed = oldLines.filter(l => !plan.some(next => next.id === l.id));
      if (removed.length) {
        const removedIds = removed.map(l => l.id);
        const [history, packHistory] = await Promise.all([
          db.select({ id: deliveryLines.orderLineId }).from(deliveryLines).innerJoin(deliveries, eq(deliveries.id, deliveryLines.deliveryId))
            .where(and(inArray(deliveryLines.orderLineId, removedIds), ne(deliveries.status, 'planned'))).limit(1),
          db.select({ id: packingSlipLines.id }).from(packingSlipLines).where(inArray(packingSlipLines.orderLineId, removedIds)).limit(1),
        ]);
        if (history.length || packHistory.length) throw new AppError(409, 'Mã cần xoá đã có lịch sử giao/đóng gói. Giữ dòng để bảo toàn chứng từ cũ, hoặc xử lý qua luồng huỷ/đổi trả.');
      }
      const lineOf = (voucherShares: readonly number[]) => plan.map((l, i) => {
        const row = l.row;
        if (row.qty === '' || row.price === '') throw new AppError(400, 'Không để trống số lượng hoặc đơn giá.');
        return posLine({ price: posMoney(row.price, 'Đơn giá'), qty: row.qty, discountType: row.discountType, discountValue: row.discountValue,
          taxRate: l.taxRate, priceIncludesVat: l.taxRate > 0, vatEnabled: l.taxRate > 0, voucherAmount: voucherShares[i] ?? 0 });
      });
      // Voucher của đơn (nếu có) chia lại theo số lượng / giá mới: % giữ tỷ lệ, VNĐ giữ số tiền (không được vượt tiền hàng mới).
      const voucher = parsePosVoucher(snapshot.voucher ? { code: snapshot.voucher.code, type: snapshot.voucher.type, value: snapshot.voucher.value } : null);
      const base = lineOf([]), split = allocatePosVoucher(base.map(l => l.listAmount - l.discountAmount), voucher);
      computed = split.amount ? lineOf(split.shares) : base;
      if (voucher) snapshot.voucher = { ...voucher, amount: split.amount };
      const skus = [...new Set([...oldLines, ...plan].map(l => l.sku))].sort();
      const warehouseId = snapshot.register?.warehouseId;
      if (typeof warehouseId !== 'string' || !warehouseId) throw new AppError(409, 'Thiếu kho gốc của đơn POS.');
      const balances = await db.select().from(stockBalances).where(and(eq(stockBalances.warehouseId, warehouseId), inArray(stockBalances.sku, skus))).for('update');
      const reserved = await reservedBySku(db, skus, warehouseId, order.id);
      for (const sku of skus) {
        const wanted = plan.reduce((n, l, i) => n + (l.sku === sku ? computed![i]!.qty : 0), 0);
        const available = (balances.find(r => r.sku === sku)?.qty ?? 0) - (reserved.get(sku) ?? 0);
        if (wanted > 0 && wanted > available + 1e-9) throw new AppError(409, `${sku}: chỉ còn khả dụng ${Math.max(0, available)}.`, 'POS_STOCK_SHORT');
      }
      const fees = snapshotPosFees(snapshot);
      totals = { subtotal: posMoney(computed.reduce((n, l) => n + l.subtotal, 0) + fees.subtotal), tax: posMoney(computed.reduce((n, l) => n + l.tax, 0) + fees.tax), total: posMoney(computed.reduce((n, l) => n + l.total, 0) + fees.total) };
      if (schedules.length !== 1) throw new AppError(409, 'Đơn có lịch thanh toán riêng, cần xử lý lịch thu trước khi đổi giá trị.');
    }
  }
  const paymentNote = b.paymentNote === undefined ? undefined : posText(b.paymentNote, 2000);
  let deliveryPatch: { address: string; receiverName: string; receiverPhone: string } | undefined;
  if (b.delivery !== undefined) {
    if (!b.delivery || typeof b.delivery !== 'object' || Array.isArray(b.delivery)) throw new AppError(400, 'Thông tin giao không hợp lệ.');
    const d = b.delivery as Record<string, unknown>;
    const address = posText(d.address, 2000), receiverName = posText(d.receiverName, 500), receiverPhone = posText(d.receiverPhone, 100);
    if (order.fulfillmentMode === 'cod' && !address) throw new AppError(400, 'Nhập địa chỉ giao hàng.');
    const editable = ships.filter(s => ['planned', 'in_transit'].includes(s.status));
    if (!editable.length && ships.some(s => s.status === 'delivered' && (s.address !== address || s.receiverName !== receiverName || s.receiverPhone !== receiverPhone)))
      throw new AppError(409, 'Chuyến đã giao: không sửa thông tin giao hàng lịch sử.');
    // Đã có vận đơn GHN: đổi người nhận / địa chỉ ở CRM không đổi trên GHN → shipper giao theo thông tin cũ. Sửa trên GHN trước.
    if (editable.some(s => s.trackingCode && (s.address !== address || s.receiverName !== receiverName || s.receiverPhone !== receiverPhone)))
      throw new AppError(409, 'Đơn đã có vận đơn GHN: sửa người nhận / địa chỉ trên trang GHN (CRM không tự đổi vận đơn), hoặc huỷ chuyến giao rồi tạo lại.', 'GHN_SHIPMENT_EXISTS');
    deliveryPatch = { address, receiverName, receiverPhone };
  }
  if (options.preview) {
    const prepared: GhnEditPreviewLine[] = computed ? plan.map((meta, i) => ({ ...(meta.existing ? { id: meta.id } : {}), sku: meta.sku, name: meta.name, unit: meta.unit,
      qty: computed![i]!.qty, price: computed![i]!.listUnitPrice, taxRate: meta.taxRate, discountType: computed![i]!.discountType, discountValue: computed![i]!.discountValue, gross: computed![i]!.total }))
      : oldLines.map(l => ({ id: l.id, sku: l.sku, name: l.name, unit: l.unit, qty: l.qty, price: l.listUnitPrice ?? l.unitPrice, taxRate: l.taxRate, discountType: l.discountType, discountValue: l.discountValue, gross: Math.round(l.amount * (1 + l.taxRate / 100)) }));
    return { id: order.id, revision: order.revision, ...totals, preview: { changed: !!computed, lines: prepared } };
  }
  const now = new Date().toISOString();
  if (computed) {
    const removedIds = oldLines.filter(old => !plan.some(l => l.id === old.id)).map(l => l.id);
    if (removedIds.length) {
      await db.delete(deliveryLines).where(inArray(deliveryLines.orderLineId, removedIds)); // only untouched planned links passed the guard above
      await db.delete(salesOrderLines).where(inArray(salesOrderLines.id, removedIds));
    }
    // Preserve retained line IDs and avoid the unique (order_id,line_no) index while renumbering.
    for (const l of plan.filter(l => l.existing)) await db.update(salesOrderLines).set({ lineNo: -oldLines.find(old => old.id === l.id)!.lineNo }).where(eq(salesOrderLines.id, l.id));
    for (const [i, meta] of plan.entries()) {
      const line = computed[i]!;
      const values = { lineNo: i + 1, sku: meta.sku, name: meta.name, unit: meta.unit, taxRate: meta.taxRate,
        qty: line.qty, unitPrice: line.unitPrice, listUnitPrice: line.listUnitPrice, discountType: line.discountType, discountValue: line.discountValue, discountAmount: line.discountAmount, amount: line.subtotal };
      if (meta.existing) await db.update(salesOrderLines).set(values).where(eq(salesOrderLines.id, meta.id));
      else await db.insert(salesOrderLines).values({ ...values, id: meta.id, orderId: order.id, deliveredQty: 0 });
    }
    await ensureLineCosts(db, order.id, 'pos_edit', actor.id); // dòng mới / đổi mã: ghi giá vốn; dòng cũ giữ nguyên
    for (const ship of ships.filter(s => s.status === 'planned')) {
      await db.delete(deliveryLines).where(eq(deliveryLines.deliveryId, ship.id));
      await db.insert(deliveryLines).values(plan.map((l, i) => ({ deliveryId: ship.id, orderLineId: l.id, qty: computed![i]!.qty })));
    }
    await db.update(paymentSchedules).set({ amount: totals.total }).where(eq(paymentSchedules.id, schedules[0]!.id));
    for (const ship of ships.filter(s => s.status === 'planned')) await db.update(deliveries).set({ codAmount: totals.total, updatedAt: now }).where(eq(deliveries.id, ship.id));
    snapshot.lines = plan.map((l, i) => ({ sku: l.sku, name: l.name, unit: l.unit, ...computed![i]! }));
    snapshot.discount = computed.reduce((n, l) => n + l.discountAmount, 0);
    Object.assign(snapshot, totals, { tendered: totals.total });
  }
  if (paymentNote !== undefined) await db.update(paymentSchedules).set({ note: paymentNote }).where(eq(paymentSchedules.orderId, order.id));
  if (deliveryPatch) await db.update(deliveries).set({ ...deliveryPatch, updatedAt: now }).where(and(eq(deliveries.orderId, order.id), inArray(deliveries.status, ['planned', 'in_transit'])));
  snapshot.customer = fields.customerName;
  snapshot.note = fields.note;
  await db.update(salesOrders).set({ ...fields, ...totals, posSnapshot: JSON.stringify(snapshot), revision: order.revision + 1, updatedAt: now }).where(eq(salesOrders.id, order.id));
  await cashAudit(db, actor.id, 'amend-pos-order', 'orders', order.id, { reason, before: { ...order, lines: oldLines }, after: { ...fields, ...totals, lines: computed ? plan.map((l, i) => ({ id: l.id, sku: l.sku, name: l.name, ...computed![i]! })) : null, delivery: b.delivery, paymentNote }, revision: order.revision + 1 });
  return { id: order.id, revision: order.revision + 1, ...totals, preview: undefined };
}
