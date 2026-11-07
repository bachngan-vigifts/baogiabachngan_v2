/**
 * GIÁ VỐN DÒNG ĐƠN (snapshot lúc bán) – hàm thuần.
 *  Nguồn: báo giá (dòng cùng vị trí, cùng mã + tên) → giá nhập gần nhất TRƯỚC / TRONG ngày bán (sổ sản phẩm)
 *         → giá nhập sau ngày bán (chỉ khi chưa có giá trước đó) → không có = thiếu giá vốn (không tính 0).
 *  Mức tin cậy: confirmed = Manager nhập tay (báo giá chế độ "nhập giá" hoặc điều chỉnh) · estimate = suy ra (CK mua vào, giá nhập gần nhất)
 *               · backfill = đơn cũ chưa có snapshot hoặc giá nhập sau ngày bán – không coi là chính xác.
 */
import type { QuoteRow } from '../../quotes/domain/quote-math.ts';
import { quoteStockSku } from '../../quotes/domain/quote-math.ts';

export const LINE_COST_SOURCES = ['quote', 'purchase', 'purchase_later', 'manual'] as const;
export type LineCostSource = typeof LINE_COST_SOURCES[number];
export const LINE_COST_CONFIDENCES = ['confirmed', 'estimate', 'backfill'] as const;
export type LineCostConfidence = typeof LINE_COST_CONFIDENCES[number];
export const LINE_COST_REASONS = ['create', 'amend', 'confirm', 'pos', 'pos_edit', 'adjust'] as const;
export type LineCostReason = typeof LINE_COST_REASONS[number];
export const LINE_COST_SOURCE_LABEL: Record<LineCostSource | 'missing', string> = {
  quote: 'Giá vốn trên báo giá', purchase: 'Giá nhập gần nhất trước ngày bán', purchase_later: 'Giá nhập sau ngày bán (chưa có giá trước đó)',
  manual: 'Manager điều chỉnh', missing: 'Thiếu giá vốn',
};
export const LINE_COST_CONFIDENCE_LABEL: Record<LineCostConfidence, string> = { confirmed: 'Chính xác', estimate: 'Ước tính', backfill: 'Backfill' };

export interface LineCost { unitCost: number; source: LineCostSource; confidence: LineCostConfidence; costAt: string | null }

/** Giá nhập theo mã: gần nhất trước / trong ngày bán; không có thì sớm nhất sau ngày bán. */
export function purchaseCostAt(history: readonly { at: string; price: number }[] | undefined, day: string): LineCost | null {
  if (!history?.length) return null;
  const end = day + '￿';
  let before: { at: string; price: number } | null = null, after: { at: string; price: number } | null = null;
  for (const h of history) {
    if (!Number.isFinite(h.price) || h.price < 0) continue;
    if (h.at <= end) { if (!before || h.at > before.at) before = h; }
    else if (!after || h.at < after.at) after = h;
  }
  return before ? { unitCost: before.price, source: 'purchase', confidence: 'estimate', costAt: before.at }
    : after ? { unitCost: after.price, source: 'purchase_later', confidence: 'backfill', costAt: after.at } : null;
}

/** Dòng báo giá khớp dòng đơn (cùng vị trí, mã, tên) – như doanh số net KPI; lệch thì không dùng số liệu báo giá. */
export function matchQuoteRow(rows: readonly QuoteRow[], line: { lineNo: number; sku: string; name: string }): QuoteRow | null {
  const r = rows[line.lineNo - 1];
  return r && quoteStockSku(r) === line.sku && String(r.name || '').trim() === line.name.trim() ? r : null;
}
/** Giá vốn từ dòng báo giá: nhập tay = chính xác; theo % CK mua vào / mặc định thương hiệu = ước tính. */
export function quoteLineCost(row: QuoteRow | null, quoteUpdatedAt: string | null): LineCost | null {
  if (!row || row.costPrice === undefined || row.costPrice === null) return null;
  const v = Number(row.costPrice);
  if (!Number.isFinite(v) || v < 0) return null;
  return { unitCost: v, source: 'quote', confidence: (row as { costMode?: string }).costMode === 'manual' ? 'confirmed' : 'estimate', costAt: quoteUpdatedAt };
}
/** Báo giá trước, rồi giá nhập. */
export function pickLineCost(row: QuoteRow | null, quoteUpdatedAt: string | null, history: readonly { at: string; price: number }[] | undefined, day: string, sku: string): LineCost | null {
  return quoteLineCost(row, quoteUpdatedAt) ?? (sku ? purchaseCostAt(history, day) : null);
}
