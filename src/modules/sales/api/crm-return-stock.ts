import { and, asc, eq, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import { inventoryAdjustments, stockMoves } from '../../inventory/schema.ts';
import { deliveries, deliveryLines } from '../schema.ts';
import { posReturns, posReturnLines } from '../return-schema.ts';
import { crmStockFulfilment } from './crm-stock-lifecycle.ts';
import type { CashDb } from './cash-store.ts';

/**
 * TRẢ HÀNG CRM → NHẬP LẠI KHO CHỈ TRONG PHẠM VI ĐÃ THỰC XUẤT (docs/SO-KHO.md › Trả hàng).
 * Mỗi dòng đơn: tổng nhập lại (các phiếu đã nhận + phiếu này) ≤ lượng xuất ròng có bút toán (phiếu xuất / trừ kiểu cũ).
 * Phần vượt (đơn cũ giao khi chưa có bút toán xuất) chỉ nhập khi Manager chọn căn cứ kiểm được:
 *  - `pre_opening`: hàng đã giao TRƯỚC ngày chốt tồn đầu kỳ của kho nhận (tồn chốt chưa từng tính lượng này);
 *  - `adjustment`: phiếu điều chỉnh đã duyệt đã trừ bù đúng mã (mỗi phiếu chỉ dùng tối đa lượng đã trừ, cộng dồn mọi phiếu trả).
 * Không có căn cứ → không nhập kho (tránh cộng lại hàng chưa từng trừ, làm tồn đội lên).
 */
export type StockBasis =
  | { kind: 'pre_opening'; note: string; covered: Record<string, number>; by: string; at: string }
  | { kind: 'adjustment'; adjustmentId: string; refNo: string; note: string; covered: Record<string, number>; by: string; at: string };
export interface UnprovenLine { lineId: string; sku: string; qty: number; issued: number; restocked: number }

const round = (n: number) => Math.round(n * 1000) / 1000;
/** Ngày (giờ Việt Nam) của một mốc ISO; ngày giao lưu dạng YYYY-MM-DD giữ nguyên. */
const vnDate = (iso: string) => /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : new Date(Date.parse(iso) + 7 * 3600_000).toISOString().slice(0, 10);

export async function unprovenRestock(db: CashDb, orderId: string, returnId: string): Promise<UnprovenLine[]> {
  const lines = (await db.select().from(posReturnLines).where(eq(posReturnLines.returnId, returnId))).filter(l => l.disposition === 'restock' && l.requestedQty > 0);
  if (!lines.length) return [];
  const state = (await crmStockFulfilment(db, [orderId], {gross:true})).get(orderId);
  const priorRows = await db.select({ lineId: posReturnLines.orderLineId, qty: posReturnLines.restockQty, snapshot: posReturns.sourceSnapshot })
    .from(posReturnLines).innerJoin(posReturns, eq(posReturns.id, posReturnLines.returnId))
    .where(and(eq(posReturns.orderId, orderId), isNotNull(posReturns.receivedAt), ne(posReturns.id, returnId)));
  const prior = new Map<string,number>();
  for(const row of priorRows){const covered=Number(JSON.parse(row.snapshot)?.stockBasis?.covered?.[row.lineId]??0);prior.set(row.lineId,(prior.get(row.lineId)??0)+Math.max(0,row.qty-(Number.isFinite(covered)?covered:0)));}
  const want = new Map<string, { sku: string; qty: number }>();
  for (const l of lines) want.set(l.orderLineId, { sku: l.sku, qty: (want.get(l.orderLineId)?.qty ?? 0) + l.requestedQty });
  return [...want].flatMap(([lineId, w]) => {
    const issued = state?.lines.find(x => x.lineId === lineId)?.issued ?? 0, restocked = prior.get(lineId) ?? 0;
    const qty = round(Math.min(w.qty, Math.max(0, restocked + w.qty - issued)));
    return qty > 0.0005 ? [{ lineId, sku: w.sku, qty, issued, restocked }] : [];
  });
}

export const describeUnproven = (lines: readonly UnprovenLine[]) =>
  lines.map(l => `${l.sku}: nhập lại ${round(l.qty + Math.max(0, l.issued - l.restocked))}, đã xuất có chứng từ ${round(Math.max(0, l.issued - l.restocked))}`).join('; ');

/** Kiểm căn cứ Manager chọn cho phần vượt; trả căn cứ chuẩn hoá để lưu vào phiếu. Gọi trong giao dịch đã khoá đơn + phiếu. */
export async function verifyStockBasis(db: CashDb, order: { id: string; orderDate: string | null }, ret: { id: string; warehouseId: string },
  unproven: readonly UnprovenLine[], raw: unknown, by: string): Promise<StockBasis> {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const note = String(input.note ?? '').trim().slice(0, 1000), at = new Date().toISOString();
  const covered = Object.fromEntries(unproven.map(l => [l.lineId, l.qty]));
  if (note.length < 5) throw new AppError(400, 'Ghi rõ căn cứ nhập lại kho (ít nhất 5 ký tự).', 'STOCK_BASIS_NOTE');
  if (input.kind === 'pre_opening') {
    const [opening] = await db.select({ at: sql<string | null>`min(${stockMoves.createdAt})` }).from(stockMoves)
      .where(and(eq(stockMoves.warehouseId, ret.warehouseId), eq(stockMoves.refType, 'opening')));
    if (!opening?.at) throw new AppError(409, 'Kho nhận chưa chốt tồn đầu kỳ.', 'WAREHOUSE_NOT_OPENED');
    const openedOn = vnDate(opening.at);
    const shipped = await db.select({ lineId: deliveryLines.orderLineId, qty: deliveryLines.qty, at: deliveries.deliveredAt }).from(deliveryLines)
      .innerJoin(deliveries, eq(deliveries.id, deliveryLines.deliveryId))
      .where(and(eq(deliveries.orderId, order.id), eq(deliveries.status, 'delivered'), inArray(deliveryLines.orderLineId, unproven.map(l => l.lineId))));
    for (const l of unproven) {
      const trips = shipped.filter(s => s.lineId === l.lineId);
      // Đơn nhập từ hệ thống cũ không có chuyến giao: chỉ chấp nhận khi cả đơn lập trước ngày chốt.
      const before = trips.length ? trips.filter(s => s.at && vnDate(s.at) < openedOn).reduce((n, s) => n + s.qty, 0)
        : order.orderDate && order.orderDate < openedOn ? Infinity : 0;
      if (l.qty + Math.max(0, l.restocked - l.issued) > before + 0.0005)
        throw new AppError(409, `${l.sku}: không có chuyến giao trước ngày chốt tồn ${openedOn.split('-').reverse().join('/')} của kho nhận đủ cho phần nhập lại. Chọn phiếu điều chỉnh đã trừ bù, hoặc không nhập kho.`, 'STOCK_BASIS_INVALID');
    }
    return { kind: 'pre_opening', note, covered, by, at };
  }
  if (input.kind === 'adjustment') {
    // Giao diện nhập số phiếu (ĐC-…); API nhận cả id.
    const ref = String(input.adjustmentId ?? input.adjustmentRefNo ?? '').trim().slice(0, 100);
    const [adj] = ref ? await db.select().from(inventoryAdjustments).where(or(eq(inventoryAdjustments.id, ref), eq(inventoryAdjustments.refNo, ref))).for('update') : [];
    const id = adj?.id ?? '';
    if (!adj || adj.status !== 'approved') throw new AppError(409, 'Chọn phiếu điều chỉnh đã duyệt.', 'STOCK_BASIS_INVALID');
    const adjLines = JSON.parse(adj.lines) as { sku: string; qty: number }[];
    // Lượng của phiếu điều chỉnh đã làm căn cứ cho phiếu trả khác (chưa huỷ / từ chối).
    const others = await db.select({ snapshot: posReturns.sourceSnapshot }).from(posReturns)
      .where(and(ne(posReturns.id, ret.id), sql`${posReturns.status} not in ('cancelled','rejected')`, sql`${posReturns.sourceSnapshot} like ${'%' + id + '%'}`)).orderBy(asc(posReturns.id));
    const usedBySku = new Map<string, number>();
    for (const o of others) {
      const basis = (JSON.parse(o.snapshot) as { stockBasis?: StockBasis; stockBasisSkus?: Record<string, number> });
      if (basis.stockBasis?.kind === 'adjustment' && basis.stockBasis.adjustmentId === id)
        for (const [sku, qty] of Object.entries(basis.stockBasisSkus ?? {})) usedBySku.set(sku, (usedBySku.get(sku) ?? 0) + qty);
    }
    const need = new Map<string, number>();
    for (const l of unproven) need.set(l.sku, (need.get(l.sku) ?? 0) + l.qty);
    for (const [sku, qty] of need) {
      const debited = adjLines.filter(a => a.sku === sku && a.qty < 0).reduce((n, a) => n - a.qty, 0), left = debited - (usedBySku.get(sku) ?? 0);
      if (qty > left + 0.0005) throw new AppError(409, `${sku}: phiếu ${adj.refNo} chỉ còn ${round(Math.max(0, left))} chưa dùng làm căn cứ (cần ${qty}).`, 'STOCK_BASIS_INVALID');
    }
    return { kind: 'adjustment', adjustmentId: id, refNo: adj.refNo, note, covered, by, at };
  }
  throw new AppError(400, 'Chọn căn cứ nhập lại kho: giao trước ngày chốt tồn, hoặc phiếu điều chỉnh đã trừ bù.', 'STOCK_BASIS_REQUIRED');
}

/** Căn cứ đã lưu còn che đủ phần vượt hiện tại (đơn / phiếu xuất có thể đổi sau khi duyệt). */
export function basisCovers(basis: StockBasis | undefined, unproven: readonly UnprovenLine[]) {
  return unproven.every(l => (basis?.covered[l.lineId] ?? 0) + 0.0005 >= l.qty);
}
export const basisSkus = (unproven: readonly UnprovenLine[]) => {
  const out: Record<string, number> = {};
  for (const l of unproven) out[l.sku] = round((out[l.sku] ?? 0) + l.qty);
  return out;
};
