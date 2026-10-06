/**
 * Bộ lọc "Tìm nhanh sản phẩm" như web cũ (`public/app.js`: matchesSearchGroup, isMinhLongCatalogProduct).
 * Biểu thức chạy trên tên đã bỏ dấu (fold) bằng regex PostgreSQL (`\m`/`\M` = đầu/cuối từ, tương đương `\b`).
 */
export const PRODUCT_GROUPS = {
  dinner: { label: 'Bộ đồ ăn', all: ['bo (do an|ban an|chen dia)'] },
  tea: { label: 'Bộ trà', all: ['bo (tra|am tra|tach tra)'] },
  thermalCup: { label: 'Ly / cốc giữ nhiệt', all: ['giu nhiet', '\\m(ly|coc|ca)\\M'] },
  thermalBottle: { label: 'Bình giữ nhiệt', all: ['giu nhiet', '\\mbinh\\M'] },
  tableware: { label: 'Chén, tô, đĩa', all: ['\\m(chen|to|dia|tach)\\M'] },
  vase: { label: 'Bình hoa', all: ['binh hoa|lo hoa'] },
  cookware: { label: 'Nồi, chảo', all: ['\\m(noi|chao|quanh)\\M'] },
} as const;
export type ProductGroup = keyof typeof PRODUCT_GROUPS;
export const isProductGroup = (v: unknown): v is ProductGroup => typeof v === 'string' && Object.hasOwn(PRODUCT_GROUPS, v);

/** Sản phẩm Minh Long (báo giá HRC/B2B): thương hiệu hoặc tên có các cụm này. VIGIFTS dùng phần còn lại. */
export const MINH_LONG_WORDS = ['minh long', 'healthy cook', 'su duong sinh'] as const;
export type ProductScope = 'minhlong' | 'other';
export const scopeForQuoteType = (type: string): ProductScope => type === 'VIGIFTS' ? 'other' : 'minhlong';

/** Khoảng giá: số không âm, từ ≤ đến; trả null nếu không hợp lệ. */
export function priceRange(min: unknown, max: unknown): { min: number | null; max: number | null } | null {
  const n = (v: unknown) => v === null || v === undefined || v === '' ? null : Number(v);
  const lo = n(min), hi = n(max);
  if ((lo !== null && !(Number.isFinite(lo) && lo >= 0)) || (hi !== null && !(Number.isFinite(hi) && hi >= 0)) || (lo !== null && hi !== null && lo > hi)) return null;
  return { min: lo, max: hi };
}
