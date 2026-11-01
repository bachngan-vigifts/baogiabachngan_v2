import { and, asc, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import { readCatalogStock } from '../../catalog/api/stock-source.ts';
import { productStock, warehouses } from '../../catalog/schema.ts';
import { orderStockHolds, salesOrderLines, salesOrders } from '../schema.ts';
import { crmStockFulfilment } from './crm-stock-lifecycle.ts';
import { reservedBySku, type PosDb } from './pos-store.ts';

/**
 * GIỮ HÀNG THEO ĐƠN HÀNG / HĐKT CRM (quyết định Anh Thái 28/10/2026, docs/SO-KHO.md › Giữ hàng theo đơn).
 *  - Mỗi lần giữ tối đa = CÓ THỂ BÁN tại kho bán = tồn sổ kho − hàng đang giữ cho đơn / báo giá khác (reservedBySku, như POS).
 *  - Tự động lúc duyệt khi đơn có ngày giao dự kiến: hạn = hết ngày giao + 3 ngày. Không có ngày giao → không tự giữ.
 *  - Thủ công "Giữ hàng / Giữ thêm" (khi hàng về): hạn 5 ngày. Manager gia hạn thêm 5 ngày.
 *  - Chấm dứt: xuất kho (tiêu hao đúng lượng xuất), giao xong, hết hạn, bấm huỷ giữ, huỷ đơn.
 * Lượng giữ hiệu lực = min(tổng dòng giữ còn hạn, phần chưa giao / chưa xuất của đơn). Gọi trong giao dịch, sau khoá `stock_holds`.
 */
export const AUTO_HOLD_GRACE_DAYS = 3;
export const MANUAL_HOLD_DAYS = 5;
const DAY = 864e5;
const round = (n: number) => Math.round(n * 1000) / 1000;

/** Hết ngày (giờ Việt Nam) của ngày giao + 3 ngày. */
export function autoHoldExpiry(deliveryDate: string) {
  return new Date(Date.parse(deliveryDate + 'T23:59:59+07:00') + AUTO_HOLD_GRACE_DAYS * DAY).toISOString();
}
export const manualHoldExpiry = (now = Date.now()) => new Date(now + MANUAL_HOLD_DAYS * DAY).toISOString();

export const lockHolds = (db: PosDb) => db.execute(sql`select pg_advisory_xact_lock(hashtext('stock_holds'))`);
const live = (now: string) => and(eq(orderStockHolds.status, 'active'), gt(orderStockHolds.expiresAt, now));

type Order = typeof salesOrders.$inferSelect;
export interface HoldLine { lineId: string; sku: string; name: string; remaining: number; held: number; want: number; qty: number }

/** Phần chưa giao / chưa xuất của từng dòng có mã + lượng đang giữ còn hạn. */
export async function orderHoldLines(db: PosDb, order: Pick<Order, 'id'>, now = new Date().toISOString()) {
  const [lines, state, holds] = await Promise.all([
    db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, order.id)).orderBy(asc(salesOrderLines.lineNo)),
    crmStockFulfilment(db, [order.id]),
    db.select({ lineId: orderStockHolds.orderLineId, qty: sql<number>`sum(${orderStockHolds.qty})`.mapWith(Number) }).from(orderStockHolds)
      .where(and(eq(orderStockHolds.orderId, order.id), live(now))).groupBy(orderStockHolds.orderLineId),
  ]);
  const issued = state.get(order.id)?.lines ?? [];
  return lines.filter(l => l.sku.trim() && l.qty > 0).map(l => {
    const remaining = round(Math.max(0, l.qty - Math.max(l.deliveredQty, issued.find(x => x.lineId === l.id)?.issued ?? 0)));
    const held = round(Math.min(remaining, holds.find(h => h.lineId === l.id)?.qty ?? 0));
    return { lineId: l.id, sku: l.sku, name: l.name, remaining, held };
  });
}

/**
 * Giữ phần còn thiếu của đơn, mỗi mã tối đa có thể bán tại kho bán. Trả lượng giữ được / còn thiếu từng dòng.
 * `clientKey`: bấm lặp / mạng gửi lại cùng mã không giữ thêm (trả lại kết quả cũ).
 */
export async function holdOrderStock(db: PosDb, order: Order, actorId: string, opts: { source: 'auto' | 'manual' | 'conversion'; expiresAt: string; clientKey?: string; now?: string; limit?: Map<string, number> }) {
  const now = opts.now ?? new Date().toISOString();
  if (order.channel !== 'crm' || order.holdMode !== 'capped') throw new AppError(409, 'Đơn này giữ hàng theo cách cũ – chờ Manager áp dụng kế hoạch chuyển đổi.', 'HOLD_LEGACY_ORDER');
  if (!['confirmed', 'delivering'].includes(order.status)) throw new AppError(409, 'Chỉ giữ hàng cho đơn đã duyệt, chưa giao xong.', 'HOLD_ORDER_STATUS');
  if (!order.warehouseId) throw new AppError(409, 'Chọn kho bán cho đơn trước khi giữ hàng.', 'HOLD_NO_WAREHOUSE');
  await lockHolds(db);
  if (opts.clientKey) {
    const prior = await db.select({ lineId: orderStockHolds.orderLineId, qty: orderStockHolds.qty }).from(orderStockHolds)
      .where(and(eq(orderStockHolds.orderId, order.id), eq(orderStockHolds.clientKey, opts.clientKey)));
    if (prior.length) return { replayed: true, lines: (await orderHoldLines(db, order, now)).map(l => ({ ...l, want: 0, qty: prior.filter(p => p.lineId === l.lineId).reduce((n, p) => n + p.qty, 0) })) };
  }
  const lines = await orderHoldLines(db, order, now);
  const skus = [...new Set(lines.map(l => l.sku))].sort();
  // Tồn kho bán theo đúng nguồn chuẩn: kho đã chốt đầu kỳ = sổ kho, chưa chốt = tồn Sapo (như POS / báo giá giữ hàng).
  const [stock, reserved] = skus.length ? await Promise.all([readCatalogStock(db, skus), reservedBySku(db, skus, order.warehouseId, order.id)]) : [[], new Map<string, number>()];
  const balances = stock.filter(r => r.warehouseId === order.warehouseId).map(r => ({ sku: r.sku, qty: r.quantity }));
  // Có thể bán cho đơn này = tồn − giữ của đơn / báo giá khác − phần đơn này đang giữ (đã nằm trong tồn).
  const free = new Map(skus.map(sku => [sku, Math.max(0, (balances.find(b => b.sku === sku)?.qty ?? 0) - (reserved.get(sku) ?? 0)
    - lines.filter(l => l.sku === sku).reduce((n, l) => n + l.held, 0))]));
  const out: HoldLine[] = [], rows: (typeof orderStockHolds.$inferInsert)[] = [];
  const cap = opts.limit ? new Map(opts.limit) : null;
  for (const l of lines) {
    const want = round(Math.max(0, l.remaining - l.held)), qty = round(Math.min(want, free.get(l.sku) ?? 0, cap ? cap.get(l.sku) ?? 0 : Infinity));
    free.set(l.sku, (free.get(l.sku) ?? 0) - qty);
    if (cap) cap.set(l.sku, (cap.get(l.sku) ?? 0) - qty);
    out.push({ ...l, want, qty });
    if (qty > 0) rows.push({ id: crypto.randomUUID(), orderId: order.id, orderLineId: l.lineId, sku: l.sku, warehouseId: order.warehouseId, qty, source: opts.source,
      status: 'active', expiresAt: opts.expiresAt, clientKey: opts.clientKey ?? null, createdBy: actorId, createdAt: now });
  }
  if (rows.length) await db.insert(orderStockHolds).values(rows);
  return { replayed: false, lines: out };
}

/** Xuất kho theo phiếu: tiêu hao phần giữ đúng dòng đơn của phiếu, đúng lượng đã xuất (dòng giữ cũ trước). */
export async function consumeOrderHolds(db: PosDb, orderId: string, issued: readonly { orderLineId: string | null; qty: number }[], now = new Date().toISOString()) {
  for (const { orderLineId, qty } of issued) {
    let left = qty;
    if (!orderLineId || !(left > 0)) continue;
    const rows = await db.select().from(orderStockHolds).where(and(eq(orderStockHolds.orderId, orderId), eq(orderStockHolds.orderLineId, orderLineId), eq(orderStockHolds.status, 'active')))
      .orderBy(asc(orderStockHolds.createdAt), asc(orderStockHolds.id)).for('update');
    for (const r of rows) {
      if (left <= 0.0005) break;
      const take = Math.min(left, r.qty), rest = round(r.qty - take);
      left = round(left - take);
      await db.update(orderStockHolds).set(rest > 0.0005 ? { qty: rest } : { qty: 0, status: 'consumed', closedAt: now }).where(eq(orderStockHolds.id, r.id));
    }
  }
}

/** Huỷ giữ thủ công / huỷ đơn: đóng mọi dòng giữ còn hiệu lực của đơn. */
export async function releaseOrderHolds(db: PosDb, orderId: string, by: string | null, now = new Date().toISOString()) {
  return (await db.update(orderStockHolds).set({ status: 'released', closedAt: now, closedBy: by })
    .where(and(eq(orderStockHolds.orderId, orderId), eq(orderStockHolds.status, 'active'))).returning({ id: orderStockHolds.id })).length;
}

/** Đổi ngày giao: phần giữ tự động theo hạn mới (ngày giao + 3 ngày). */
export async function retimeAutoHolds(db: PosDb, orderId: string, deliveryDate: string) {
  await db.update(orderStockHolds).set({ expiresAt: autoHoldExpiry(deliveryDate) })
    .where(and(eq(orderStockHolds.orderId, orderId), eq(orderStockHolds.status, 'active'), eq(orderStockHolds.source, 'auto')));
}

/** Đánh dấu hết hạn (lượng hiệu lực đã tự loại theo hạn); trả các đơn vừa hết hạn để báo người phụ trách một lần. */
export async function expireOrderHolds(db: PosDb, now = new Date().toISOString()) {
  const done = await db.update(orderStockHolds).set({ status: 'expired', closedAt: now, notifiedAt: now })
    .where(and(eq(orderStockHolds.status, 'active'), lte(orderStockHolds.expiresAt, now))).returning({ orderId: orderStockHolds.orderId, sku: orderStockHolds.sku });
  return [...new Set(done.map(d => d.orderId))];
}

/** Lượng giữ hiệu lực của các đơn CRM giữ theo bảng (dùng trong orderHolds). */
export async function cappedOrderHolds(db: PosDb, skus: readonly string[] | undefined, warehouseId: string | undefined, now = new Date().toISOString(), complete = false) {
  if (skus && !skus.length) return [];
  const rows = await db.select({ orderId: orderStockHolds.orderId, lineId: orderStockHolds.orderLineId, sku: orderStockHolds.sku, warehouseId: orderStockHolds.warehouseId,
    qty: sql<number>`sum(${orderStockHolds.qty})`.mapWith(Number) }).from(orderStockHolds)
    .innerJoin(salesOrders, eq(salesOrders.id, orderStockHolds.orderId))
    .where(and(live(now), eq(salesOrders.channel, 'crm'), eq(salesOrders.holdMode, 'capped'), inArray(salesOrders.status, ['confirmed', 'delivering']), eq(salesOrders.holdsStock, true),
      // Đã đẩy Sapo và tồn Sapo của mã cập nhật sau lúc đẩy: tồn nguồn đã trừ đơn – thôi giữ (như đơn kiểu cũ, hold-routes.ts › orderHolds).
      sql`NOT (${salesOrders.sapoOrderId} IS NOT NULL AND (${salesOrders.sapoPushedAt} IS NULL OR EXISTS (SELECT 1 FROM ${productStock} ps JOIN ${warehouses} w ON w.id = ps.warehouse_id
        WHERE ps.sku = ${orderStockHolds.sku} AND w.kind = 'stock' AND ps.updated_at > ${salesOrders.sapoPushedAt})))`,
      skus ? inArray(orderStockHolds.sku, [...skus]) : undefined, warehouseId ? eq(orderStockHolds.warehouseId, warehouseId) : undefined))
    .groupBy(orderStockHolds.orderId, orderStockHolds.orderLineId, orderStockHolds.sku, orderStockHolds.warehouseId).limit(complete ? 2147483647 : 20000);
  if (!rows.length) return [];
  const ids = [...new Set(rows.map(r => r.orderId))];
  const [orders, lines, state] = await Promise.all([
    db.select({ id: salesOrders.id, orderNo: salesOrders.orderNo, quoteId: salesOrders.quoteId, customer: salesOrders.customerName }).from(salesOrders).where(inArray(salesOrders.id, ids)),
    db.select({ id: salesOrderLines.id, qty: salesOrderLines.qty, delivered: salesOrderLines.deliveredQty }).from(salesOrderLines).where(inArray(salesOrderLines.orderId, ids)),
    crmStockFulfilment(db, ids),
  ]);
  const bySku = new Map<string, { sku: string; orderId: string; qty: number }>();
  for (const r of rows) {
    const line = lines.find(l => l.id === r.lineId), issued = state.get(r.orderId)?.lines.find(l => l.lineId === r.lineId)?.issued ?? 0;
    const remaining = line ? Math.max(0, line.qty - Math.max(line.delivered, issued)) : 0, qty = Math.min(r.qty, remaining);
    if (qty <= 0.0005) continue;
    const k = r.orderId + '\u0000' + r.sku, cur = bySku.get(k);
    bySku.set(k, { sku: r.sku, orderId: r.orderId, qty: round((cur?.qty ?? 0) + qty) });
  }
  return [...bySku.values()].map(v => { const o = orders.find(x => x.id === v.orderId)!;
    return { sku: v.sku, qty: v.qty, orderId: v.orderId, orderNo: o.orderNo, quoteId: o.quoteId, customer: o.customer, contractNo: null as string | null, unassigned: false }; });
}
