import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { products, productStock, warehouses } from '../../catalog/schema.ts';
import { incomingShipmentLines, incomingShipments, supplierReceiptLines, supplierReceipts } from '../schema.ts';
import type { Db } from './purchase-store.ts';

/**
 * Tồn "Hàng chờ về" = số còn thiếu (đặt − đã nhận đạt) của các đơn mua NCC đã duyệt, chưa huỷ – theo từng mã.
 * Ghi vào product_stock của kho loại `incoming` (tạo kho "Hàng chờ về" nếu chưa có) để mọi chỗ đang đọc tồn
 * (trang Sản phẩm, Kiểm tồn báo giá, Khách hỏi tồn…) thấy ngay. Chỉ ghi phần thay đổi; mã không còn chờ thì xoá dòng.
 * File danh mục / file tồn / đồng bộ Sapo không ghi đè kho này.
 */
export async function syncIncomingStock(db: Db): Promise<{ changed: number }> {
  let [wh] = await db.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.kind, 'incoming')).orderBy(asc(warehouses.sortOrder), asc(warehouses.id)).limit(1);
  if (!wh) {
    await db.insert(warehouses).values({ id: 'hang-cho-ve', name: 'Hàng chờ về', kind: 'incoming', sortOrder: 99, active: true }).onConflictDoNothing();
    [wh] = await db.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.kind, 'incoming')).limit(1);
    if (!wh) return { changed: 0 };
  }
  const ordered = await db.select({ sku: incomingShipmentLines.sku, lineId: incomingShipmentLines.id, qty: incomingShipmentLines.quantity })
    .from(incomingShipmentLines).innerJoin(incomingShipments, eq(incomingShipments.id, incomingShipmentLines.shipmentId))
    .innerJoin(products, eq(products.sku, incomingShipmentLines.sku))
    .where(and(eq(incomingShipments.source, 'supplier-order'), eq(incomingShipments.approvalStatus, 'approved'), isNull(incomingShipments.cancelledAt)));
  const lineIds = ordered.map(o => o.lineId);
  const got = lineIds.length ? await db.select({ lineId: supplierReceiptLines.lineId, good: sql<number>`sum(${supplierReceiptLines.goodQty})`.mapWith(Number) })
    .from(supplierReceiptLines).innerJoin(supplierReceipts, eq(supplierReceipts.id, supplierReceiptLines.receiptId))
    .where(and(isNull(supplierReceipts.cancelledAt), inArray(supplierReceiptLines.lineId, lineIds))).groupBy(supplierReceiptLines.lineId) : [];
  const received = new Map(got.map(g => [g.lineId, g.good]));
  const want = new Map<string, number>();
  for (const o of ordered) { const left = Math.max(0, o.qty - (received.get(o.lineId) ?? 0)); if (left > 0) want.set(o.sku, (want.get(o.sku) ?? 0) + left); }
  const have = new Map((await db.select({ sku: productStock.sku, qty: productStock.quantity }).from(productStock).where(eq(productStock.warehouseId, wh.id))).map(r => [r.sku, r.qty]));
  const now = new Date().toISOString(), upserts = [...want].filter(([sku, q]) => have.get(sku) !== q), drop = [...have.keys()].filter(sku => !want.has(sku));
  for (let i = 0; i < upserts.length; i += 500)
    await db.insert(productStock).values(upserts.slice(i, i + 500).map(([sku, quantity]) => ({ sku, warehouseId: wh!.id, quantity, updatedAt: now })))
      .onConflictDoUpdate({ target: [productStock.sku, productStock.warehouseId], set: { quantity: sql`excluded.quantity`, updatedAt: sql`excluded.updated_at` } });
  for (let i = 0; i < drop.length; i += 500)
    await db.delete(productStock).where(and(eq(productStock.warehouseId, wh.id), inArray(productStock.sku, drop.slice(i, i + 500))));
  return { changed: upserts.length + drop.length };
}
