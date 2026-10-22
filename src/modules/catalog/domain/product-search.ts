/**
 * "Tìm nhanh sản phẩm" lọc NGAY TRÊN TRÌNH DUYỆT như web cũ (bản cũ tải cả danh mục rồi lọc tại chỗ nên gõ là ra).
 * Cùng quy tắc với `searchFilter` của `GET /products` (catalog/api/routes.ts): nhiều từ khoá không dấu, nhóm sản phẩm,
 * phạm vi theo loại báo giá (gõ đúng một mã SKU thì vẫn ra dù khác phạm vi), khoảng giá theo chính sách đang chọn.
 * Được đóng gói thành `trial-ui/product-search.js` bằng `npm run ui:build`.
 */
import { fold } from '../../../core/text/fold.ts';
import { MINH_LONG_WORDS, PRODUCT_GROUPS, isProductGroup, priceRange, type ProductScope } from './product-filters.ts';
import { compactText, parseQuery, productRank, wordMatches } from './product-rank.ts';

export interface SnapshotPolicy { id: string; name: string }
export interface SnapshotWarehouse { id: string; name: string; kind: string }
export interface CatalogSnapshot {
  version: string; observedAt: string | null; columns: readonly string[];
  policies: SnapshotPolicy[]; warehouses: SnapshotWarehouse[]; products: unknown[][];
}
export interface CatalogProduct {
  sku: string; name: string; brand: string; pattern: string; unit: string; imageUrl: string; taxBasis: string;
  taxIn: number | null; taxOut: number | null; taxable: boolean;
  perCarton: number | null; cartonWeight: number | null; cartonLength: number | null; cartonWidth: number | null; cartonHeight: number | null;
  stockUpdatedAt: string | null;
  prices: Record<string, number | null>; stock: Record<string, number>;
  /** Chuỗi đã bỏ dấu để lọc nhanh (+ bản bỏ khoảng trắng / dấu câu cho từ có số, ký hiệu). */
  _hay: string; _compact: string; _name: string; _minhLong: boolean;
}
export interface SearchOptions { q?: string; group?: string; scope?: ProductScope | ''; policy?: string; min?: unknown; max?: unknown }

/** Biểu thức nhóm viết cho PostgreSQL (`\m` `\M` = ranh giới từ) → RegExp JS. */
const GROUP_RE = Object.fromEntries(Object.entries(PRODUCT_GROUPS).map(([k, g]) => [k, g.all.map(re => new RegExp(re.replace(/\\[mM]/g, '\\b')))]));

/** Dựng danh sách sản phẩm từ bản chụp gọn của `GET /catalog-snapshot`. */
export function hydrateSnapshot(snap: CatalogSnapshot): CatalogProduct[] {
  const cols = snap.columns, n = cols.length;
  return snap.products.map(row => {
    const p = Object.fromEntries(cols.map((c, i) => [c, row[i]])) as unknown as CatalogProduct;
    const prices = row[n] as (number | null)[], stock = row[n + 1] as (number | null)[];
    p.prices = Object.fromEntries(snap.policies.map((x, i) => [x.id, prices[i] ?? null]));
    p.stock = {};
    snap.warehouses.forEach((w, i) => { if (stock[i] !== null && stock[i] !== undefined) p.stock[w.id] = stock[i]!; });
    p._hay = fold([p.sku, p.name, p.brand, p.pattern].map(v => v ?? '').join(' '));
    p._compact = compactText(p._hay);
    p._name = fold(p.name);
    const label = fold(`${p.brand ?? ''} ${p.name ?? ''}`);
    p._minhLong = MINH_LONG_WORDS.some(w => label.includes(w));
    return p;
  });
}

/** Lọc + xếp hạng như máy chủ (product-rank.ts): mã đúng → mã bắt đầu → tên bắt đầu / chứa cụm gõ → …; cùng hạng tên ngắn trước. Trả null nếu khoảng giá sai. */
export function searchProducts(items: readonly CatalogProduct[], o: SearchOptions): CatalogProduct[] | null {
  const range = priceRange(o.min, o.max);
  if (!range) return null;
  const raw = (o.q || '').trim().split(/\s+/).filter(Boolean);
  const query = parseQuery(o.q), words = query.words;
  const exact = raw.length === 1 ? raw[0]!.toLowerCase() : null;
  const groupRe = o.group && isProductGroup(o.group) ? GROUP_RE[o.group]! : null;
  const priceOn = !!o.policy && (range.min !== null || range.max !== null);
  const out = items.filter(p => {
    if (words.length && !words.every(w => wordMatches(p._hay, p._compact, w))) return false;
    if (groupRe && !groupRe.every(re => re.test(p._name))) return false;
    if (priceOn) {
      const v = p.prices[o.policy!];
      if (v === null || v === undefined || (range.min !== null && v < range.min) || (range.max !== null && v > range.max)) return false;
    }
    if (o.scope === 'minhlong' || o.scope === 'other') {
      const inScope = o.scope === 'minhlong' ? p._minhLong : !p._minhLong;
      if (!inScope && !(exact && p.sku.toLowerCase() === exact)) return false;
    }
    return true;
  });
  const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  const rank = new Map(out.map(p => [p, productRank(p, query)]));
  return out.sort((a, b) => rank.get(a)! - rank.get(b)! || (words.length ? a._name.length - b._name.length : 0)
    || cmp(a._name, b._name) || cmp(a.name, b.name) || cmp(a.sku, b.sku));
}
