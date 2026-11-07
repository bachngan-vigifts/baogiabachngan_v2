/**
 * GIÁ VỐN DÒNG ĐƠN (snapshot lúc bán) – hàm thuần.
 *  Nguồn: báo giá (dòng cùng vị trí, cùng mã + tên) → giá nhập gần nhất TRƯỚC / TRONG ngày bán (sổ sản phẩm)
 *         → giá nhập sau ngày bán (chỉ khi chưa có giá trước đó) → không có = thiếu giá vốn (không tính 0).
 *  Mức tin cậy: confirmed = Manager nhập tay (báo giá chế độ "nhập giá" hoặc điều chỉnh) · estimate = suy ra (CK mua vào, giá nhập gần nhất)
 *               · backfill = đơn cũ chưa có snapshot hoặc giá nhập sau ngày bán – không coi là chính xác.
 */
import type { QuoteRow } from '../../quotes/domain/quote-math.ts';
import type { CostPoint, SkuFallbackCosts } from '../../../core/contracts/line-cost-fallback.ts';
import { costModeOf, quoteStockSku } from '../../quotes/domain/quote-math.ts';

export const LINE_COST_SOURCES = ['quote', 'purchase', 'purchase_later', 'manual', 'purchase_order', 'catalog_rule'] as const;
export type LineCostSource = typeof LINE_COST_SOURCES[number];
export const LINE_COST_CONFIDENCES = ['confirmed', 'estimate', 'backfill'] as const;
export type LineCostConfidence = typeof LINE_COST_CONFIDENCES[number];
export const LINE_COST_REASONS = ['create', 'amend', 'confirm', 'pos', 'pos_edit', 'adjust', 'recover'] as const;
export type LineCostReason = typeof LINE_COST_REASONS[number];
export const LINE_COST_SOURCE_LABEL: Record<LineCostSource | 'missing', string> = {
  quote: 'Giá vốn trên báo giá', purchase: 'Giá nhập gần nhất trước ngày bán', purchase_later: 'Giá nhập sau ngày bán (chưa có giá trước đó)',
  manual: 'Manager điều chỉnh', missing: 'Thiếu giá vốn',
  purchase_order: 'Giá mua trên đơn NCC đã duyệt (sau CK, trước VAT)',
  catalog_rule: 'Công thức mua NCC theo thương hiệu (giá tham chiếu)',
};
export const LINE_COST_CONFIDENCE_LABEL: Record<LineCostConfidence, string> = { confirmed: 'Chính xác', estimate: 'Ước tính', backfill: 'Backfill' };

export interface LineCost { unitCost: number; source: LineCostSource; confidence: LineCostConfidence; costAt: string | null }

/** Giá nhập theo mã: gần nhất trước / trong ngày bán; không có thì sớm nhất sau ngày bán. */
export function purchaseCostAt(history: readonly { at: string; price: number }[] | undefined, day: string): LineCost | null {
  if (!history?.length) return null;
  const end = Date.parse(day + 'T23:59:59.999+07:00');
  if (!Number.isFinite(end)) return null;
  let before: { at: string; price: number } | null = null, after: { at: string; price: number } | null = null;
  for (const h of history) {
    const at = Date.parse(h.at);
    if (!Number.isFinite(h.price) || h.price < 0 || !Number.isFinite(at)) continue;
    if (at <= end) { if (!before || at > Date.parse(before.at)) before = h; }
    else if (!after || at < Date.parse(after.at)) after = h;
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
  // A discounted quote with no list price often persisted 0. It is not evidence of free stock.
  if (v === 0 && costModeOf(row) !== 'manual' && row.purchaseDiscount !== 100) return null;
  return { unitCost: v, source: 'quote', confidence: (row as { costMode?: string }).costMode === 'manual' ? 'confirmed' : 'estimate', costAt: quoteUpdatedAt };
}
/** Báo giá trước, rồi giá nhập. */
const sameUnit = (a?: string, b?: string) => !a?.trim() || !b?.trim() || a.trim().toLowerCase() === b.trim().toLowerCase();
/** Điểm giá gần nhất trước / trong ngày bán; không có thì sớm nhất sau ngày bán. Cùng thời điểm lấy theo mã tham chiếu (ổn định). */
function nearestPoint(points: readonly CostPoint[] | undefined, day: string, unit?: string) {
  const end = Date.parse(day + 'T23:59:59.999+07:00');
  if (!points?.length || !Number.isFinite(end)) return null;
  const ok = points.filter(p => Number.isFinite(p.cost) && p.cost >= 0 && Number.isFinite(Date.parse(p.at)) && sameUnit(p.unit, unit));
  const before = ok.filter(p => Date.parse(p.at) <= end).sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.ref.localeCompare(b.ref))[0];
  if (before) return { point: before, later: false };
  const after = ok.filter(p => Date.parse(p.at) > end).sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.ref.localeCompare(b.ref))[0];
  return after ? { point: after, later: true } : null;
}
/**
 * Giá vốn một dòng theo nguyên tắc chung (lúc bán và khi tính lại đơn cũ):
 * báo giá → giá nhập kho trước ngày bán → đơn NCC đã duyệt trước ngày bán → giá nhập kho sau ngày bán → đơn NCC sau ngày bán (backfill)
 * → công thức thương hiệu (giá tham chiếu). Không có nguồn nào → null (thiếu giá vốn, không coi là 0).
 */
export function pickLineCost(row: QuoteRow | null, quoteUpdatedAt: string | null, history: readonly { at: string; price: number }[] | undefined, day: string, sku: string,
  fallback?: SkuFallbackCosts | null, unit?: string): LineCost | null {
  const quote = quoteLineCost(row, quoteUpdatedAt);
  if (quote || !sku) return quote;
  const receipt = purchaseCostAt(history, day);
  if (receipt?.source === 'purchase') return receipt;
  const order = nearestPoint(fallback?.orders, day, unit);
  if (order && !order.later) return { unitCost: order.point.cost, source: 'purchase_order', confidence: 'estimate', costAt: order.point.at };
  if (receipt) return receipt;
  if (order) return { unitCost: order.point.cost, source: 'purchase_order', confidence: 'backfill', costAt: order.point.at };
  const rule = fallback?.catalog;
  if (rule && Number.isFinite(rule.cost) && rule.cost >= 0 && sameUnit(rule.unit, unit)) return { unitCost: rule.cost, source: 'catalog_rule', confidence: 'estimate', costAt: rule.at };
  return null;
}
