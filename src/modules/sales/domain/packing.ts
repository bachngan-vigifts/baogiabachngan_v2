/** Phiếu đóng gói: gợi ý quy cách (thùng) và cân nặng từ thông tin thùng của sản phẩm trong danh mục. */
import type { PACKING_SOURCES } from './statuses.ts';

export type PackingSource = typeof PACKING_SOURCES[number];
export const PACKING_SOURCE_LABEL: Record<PackingSource, string> = {
  warehouse: 'Kho', store: 'Điều chuyển từ cửa hàng', supplier: 'Nhập từ NCC', agent: 'Lấy từ đại lý', other: 'Nguồn khác',
};

export interface CartonInfo { perCarton: number | null; cartonWeight: number | null; cartonLength: number | null; cartonWidth: number | null; cartonHeight: number | null }
const pos = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const num = (v: number) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(v);

/**
 * Gợi ý đóng gói cho một dòng: số thùng chẵn + số lẻ, kích thước thùng, cân nặng ước tính (kg, làm tròn 0,1).
 * Cân nặng = cân 1 thùng × (số lượng / số cái mỗi thùng) – phần lẻ tính theo tỷ lệ.
 */
export function packingSuggestion(qty: number, unit: string, c: Partial<CartonInfo> | null | undefined) {
  const per = pos(c?.perCarton), w = pos(c?.cartonWeight), l = pos(c?.cartonLength), wd = pos(c?.cartonWidth), h = pos(c?.cartonHeight);
  const cartonSize = l && wd && h ? `${num(l)}×${num(wd)}×${num(h)} cm` : '';
  const cartons = per ? Math.floor(qty / per + 1e-9) : 0, loose = per ? Math.round((qty - cartons * per) * 1000) / 1000 : qty;
  const weight = per && w ? Math.round(w * qty / per * 10) / 10 : null;
  const u = unit || 'sp';
  const text = per ? [cartons ? `${num(cartons)} thùng × ${num(per)} ${u}` : '', loose ? `${num(loose)} ${u} lẻ` : ''].filter(Boolean).join(' + ') : '';
  return { perCarton: per, cartonWeight: w, cartonSize, cartons, loose, weight, text };
}
