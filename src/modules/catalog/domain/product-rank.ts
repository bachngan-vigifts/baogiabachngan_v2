/**
 * TÌM SẢN PHẨM – quy tắc khớp + xếp hạng dùng chung cho:
 *  - máy chủ `GET /products` (trang Sản phẩm, ô tìm hàng ở Đơn mua NCC…): catalog/api/routes.ts dựng SQL theo đúng các bước dưới;
 *  - trình duyệt (gợi ý sản phẩm khi lập báo giá): product-search.ts → trial-ui/product-search.js.
 *
 * Khớp: bỏ dấu, mọi từ khoá phải có trong (mã, tên, thương hiệu, mẫu). Từ có số / ký hiệu còn khớp khi bỏ khoảng trắng,
 * dấu câu ở cả hai phía: "0.5l" ↔ "0.5 L", "lhc4282" ↔ "LHC-4282", "500ml" ↔ "500 ml".
 * Xếp hạng (nhỏ = lên trước), cùng hạng thì mới tạo lên trước:
 *   0 mã đúng · 1 mã bắt đầu bằng chuỗi gõ · 2 tên bắt đầu bằng cụm gõ · 3 tên chứa nguyên cụm
 *   4 mọi từ đứng đầu một chữ trong tên · 5 mọi từ nằm trong tên · 6 còn lại (khớp nhờ mã / thương hiệu / mẫu)
 */
import { fold, compactText, needsCompact, parseQuery, type SearchQuery } from '../../../core/text/fold.ts';

// Quy tắc tách từ khoá / bỏ khoảng trắng dùng chung cho mọi ô tìm (core/text/fold.ts).
export { compactText, needsCompact, parseQuery, type SearchQuery };

/** Một từ khoá có trong chuỗi tìm (đã bỏ dấu) không. */
export function wordMatches(hay: string, compactHay: string, word: string): boolean {
  if (hay.includes(word)) return true;
  const c = compactText(word);
  return needsCompact(word) && c.length > 0 && compactHay.includes(c);
}

/** Hạng liên quan của một sản phẩm đã khớp (xem bảng ở đầu file). */
export function productRank(p: { sku: string; name: string }, q: SearchQuery): number {
  if (!q.words.length) return 6;
  const sku = compactText(fold(p.sku)), name = fold(p.name);
  if (q.compact && sku === q.compact) return 0;
  if (q.compact && sku.startsWith(q.compact)) return 1;
  if (name.startsWith(q.phrase)) return 2;
  if (name.includes(q.phrase)) return 3;
  const padded = ' ' + name;
  if (q.words.every(w => padded.includes(' ' + w))) return 4;
  if (q.words.every(w => wordMatches(name, compactText(name), w))) return 5;
  return 6;
}
