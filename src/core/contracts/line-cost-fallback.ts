import type { AnyDb } from '../db/client.ts';

/**
 * Nguồn giá vốn bổ sung cho dòng đơn (ngoài báo giá và giá nhập kho): giá mua trên đơn NCC đã duyệt và công thức mua NCC theo
 * thương hiệu – cùng nguyên tắc với script khôi phục đơn cũ (scripts/maintenance/recover-legacy-profit-costs.ts).
 * Module sales / profit không đọc dữ liệu NCC trực tiếp; tầng app nối hàm này (src/app/line-cost-fallback.ts).
 */
export interface CostPoint { at: string; cost: number; ref: string; unit?: string }
export interface SkuFallbackCosts {
  /** Giá mua sau CK, trước VAT trên các dòng đơn NCC đã duyệt, chưa huỷ. */
  orders: CostPoint[];
  /** Giá tham chiếu theo công thức thương hiệu (giá bán lẻ trước VAT × (1 − CK mặc định)); null = không áp được. */
  catalog: (CostPoint & { note: string }) | null;
}
export type LineCostFallbackOf = (db: AnyDb, skus: readonly string[]) => Promise<Map<string, SkuFallbackCosts>>;
