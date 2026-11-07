/**
 * Ghi giá vốn dòng đơn lúc bán (snapshot) – gọi trong CÙNG giao dịch với luồng tạo / sửa / duyệt đơn và POS.
 * Quy tắc vòng đời:
 *  - Dòng chưa có snapshot → ghi (báo giá → giá nhập gần nhất trước ngày bán → sau ngày bán); không có nguồn → không ghi (thiếu giá vốn).
 *  - Đơn NHÁP: snapshot tự cập nhật theo báo giá / giá nhập mới mỗi lần sửa (trừ bản Manager đã điều chỉnh).
 *  - Đơn đã duyệt / POS: snapshot KHOÁ; chỉ ghi lại khi dòng đổi mã (dòng cũ thực chất là hàng khác). Manager điều chỉnh qua `adjustLineCost`.
 *  - Gửi lặp (retry cùng mã chống lặp) không tạo đơn mới nên không tạo snapshot mới; gọi lại hàm này cũng không đổi gì (idempotent).
 *  - Mọi thay đổi ghi `sales_line_cost_history`.
 */
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { AnyDb } from '../../../core/db/client.ts';
import { AppError } from '../../../core/errors.ts';
import { salesOrderLines, salesOrders } from '../schema.ts';
import { salesLineCostHistory, salesLineCosts } from '../line-cost-schema.ts';
import { quotations } from '../../quotes/schema.ts';
import type { QuoteRow } from '../../quotes/domain/quote-math.ts';
import { productMovements } from '../../catalog/schema.ts';
import { matchQuoteRow, pickLineCost, type LineCostReason } from '../domain/line-cost.ts';

/** Lịch sử giá nhập theo mã (sổ sản phẩm, dòng "Nhập hàng"). */
export async function purchaseHistory(db: AnyDb, skus: readonly string[]) {
  const list = [...new Set(skus.filter(Boolean))], out = new Map<string, { at: string; price: number }[]>();
  if (!list.length) return out;
  const rows = await db.select({ sku: productMovements.sku, at: productMovements.occurredAt, price: productMovements.unitPrice }).from(productMovements)
    .where(and(inArray(productMovements.sku, list), eq(productMovements.kind, 'purchase'), isNotNull(productMovements.unitPrice)));
  for (const r of rows) (out.get(r.sku) ?? out.set(r.sku, []).get(r.sku)!).push({ at: r.at, price: Number(r.price) });
  return out;
}
const parseRows = (s: string | null | undefined): QuoteRow[] => {
  try { const d = JSON.parse(s || 'null'); return Array.isArray(d?.rows) ? d.rows.filter((r: QuoteRow) => String(r.name || '').trim() && Number(r.qty) > 0) : []; } catch { return []; }
};

export async function ensureLineCosts(db: AnyDb, orderId: string, reason: LineCostReason, actorId: string | null) {
  const [order] = await db.select({ id: salesOrders.id, status: salesOrders.status, orderDate: salesOrders.orderDate, quoteId: salesOrders.quoteId }).from(salesOrders).where(eq(salesOrders.id, orderId)).limit(1);
  if (!order) return { written: 0 };
  const [lines, existing, quote] = await Promise.all([
    db.select({ id: salesOrderLines.id, lineNo: salesOrderLines.lineNo, sku: salesOrderLines.sku, name: salesOrderLines.name }).from(salesOrderLines)
      .where(eq(salesOrderLines.orderId, orderId)).orderBy(asc(salesOrderLines.lineNo)),
    db.select().from(salesLineCosts).where(eq(salesLineCosts.orderId, orderId)),
    order.quoteId ? db.select({ data: quotations.data, updatedAt: quotations.updatedAt }).from(quotations).where(eq(quotations.id, order.quoteId)).limit(1) : Promise.resolve([]),
  ]);
  const draft = order.status === 'draft', rows = parseRows(quote[0]?.data), now = new Date().toISOString();
  const byLine = new Map(existing.map(e => [e.orderLineId, e]));
  // Dòng cần (tính) lại: chưa có · đổi mã · đơn nháp (trừ bản Manager điều chỉnh).
  const todo = lines.filter(l => { const e = byLine.get(l.id); return !e || e.sku !== l.sku || (draft && e.source !== 'manual'); });
  if (!todo.length) return { written: 0 };
  const history = await purchaseHistory(db, todo.map(l => l.sku));
  let written = 0;
  for (const l of todo) {
    const e = byLine.get(l.id), c = pickLineCost(matchQuoteRow(rows, l), quote[0]?.updatedAt ?? null, history.get(l.sku), order.orderDate, l.sku);
    if (e && c && e.sku === l.sku && e.unitCost === c.unitCost && e.source === c.source && e.confidence === c.confidence) continue;
    if (!c) {
      if (!e) continue;
      // Đổi mã sang hàng không có nguồn giá: gỡ giá cũ (thuộc hàng khác), ghi lịch sử.
      await db.delete(salesLineCosts).where(eq(salesLineCosts.orderLineId, l.id));
      await db.insert(salesLineCostHistory).values({ id: crypto.randomUUID(), orderLineId: l.id, orderId, sku: l.sku, unitCost: null, previousUnitCost: e.unitCost,
        source: 'missing', confidence: 'backfill', reason, note: `Đổi mã ${e.sku} → ${l.sku}: chưa có giá vốn`, actorId, at: now });
      written++; continue;
    }
    const values = { sku: l.sku, unitCost: c.unitCost, source: c.source, confidence: c.confidence, costAt: c.costAt, capturedAt: now, capturedBy: actorId, note: '' };
    if (e) await db.update(salesLineCosts).set({ ...values, revision: e.revision + 1 }).where(eq(salesLineCosts.orderLineId, l.id));
    else await db.insert(salesLineCosts).values({ orderLineId: l.id, orderId, ...values }).onConflictDoNothing();
    await db.insert(salesLineCostHistory).values({ id: crypto.randomUUID(), orderLineId: l.id, orderId, sku: l.sku, unitCost: c.unitCost, previousUnitCost: e?.unitCost ?? null,
      source: c.source, confidence: c.confidence, reason, note: e && e.sku !== l.sku ? `Đổi mã ${e.sku} → ${l.sku}` : '', actorId, at: now });
    written++;
  }
  return { written };
}

/** Manager điều chỉnh giá vốn một dòng (bắt buộc lý do; kiểm tra phiên bản để không ghi đè người khác). */
export async function adjustLineCost(db: AnyDb, lineId: string, input: { unitCost: number; reason: string; revision: number | null }, actorId: string) {
  if (!Number.isFinite(input.unitCost) || input.unitCost < 0 || input.unitCost > 1e12) throw new AppError(400, 'Giá vốn không hợp lệ.');
  const reason = input.reason.trim().slice(0, 500);
  if (reason.length < 3) throw new AppError(400, 'Nhập lý do điều chỉnh giá vốn.');
  return db.transaction(async tx => {
    const [line] = await tx.select({ id: salesOrderLines.id, orderId: salesOrderLines.orderId, sku: salesOrderLines.sku }).from(salesOrderLines).where(eq(salesOrderLines.id, lineId)).limit(1);
    if (!line) throw new AppError(404, 'Không tìm thấy dòng đơn.');
    const [order] = await tx.select({ status: salesOrders.status }).from(salesOrders).where(eq(salesOrders.id, line.orderId)).limit(1);
    if (!order || order.status === 'cancelled') throw new AppError(409, 'Đơn đã huỷ – không điều chỉnh giá vốn.');
    const [e] = await tx.select().from(salesLineCosts).where(eq(salesLineCosts.orderLineId, lineId)).limit(1).for('update');
    if ((e?.revision ?? 0) !== (input.revision ?? 0)) throw new AppError(409, 'Giá vốn dòng này vừa thay đổi. Tải lại rồi điều chỉnh.', 'COST_CHANGED');
    const now = new Date().toISOString(), unitCost = Math.round(input.unitCost * 100) / 100;
    const values = { sku: line.sku, unitCost, source: 'manual' as const, confidence: 'confirmed' as const, costAt: now, capturedAt: now, capturedBy: actorId, note: reason };
    if (e) await tx.update(salesLineCosts).set({ ...values, revision: e.revision + 1 }).where(eq(salesLineCosts.orderLineId, lineId));
    else await tx.insert(salesLineCosts).values({ orderLineId: lineId, orderId: line.orderId, ...values, revision: 1 });
    await tx.insert(salesLineCostHistory).values({ id: crypto.randomUUID(), orderLineId: lineId, orderId: line.orderId, sku: line.sku, unitCost, previousUnitCost: e?.unitCost ?? null,
      source: 'manual', confidence: 'confirmed', reason: 'adjust', note: reason, actorId, at: now });
    return { revision: (e?.revision ?? 0) + 1, unitCost };
  });
}
