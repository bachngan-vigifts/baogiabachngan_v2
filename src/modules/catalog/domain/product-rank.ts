/**
 * TÌM SẢN PHẨM – quy tắc khớp + xếp hạng dùng chung cho:
 *  - máy chủ `GET /products` (trang Sản phẩm, ô tìm hàng ở Đơn mua NCC…): catalog/api/routes.ts dựng SQL theo đúng các bước dưới;
 *  - trình duyệt (gợi ý sản phẩm khi lập báo giá): product-search.ts → trial-ui/product-search.js.
 *
 * Khớp: bỏ dấu, mọi từ khoá phải có trong (mã, tên, thương hiệu, mẫu). Từ có số / ký hiệu còn khớp khi bỏ khoảng trắng,
 * dấu câu ở cả hai phía: "0.5l" ↔ "0.5 L", "lhc4282" ↔ "LHC-4282", "500ml" ↔ "500 ml".
 * Xếp hạng (nhỏ = lên trước), cùng hạng thì tên ngắn trước rồi theo tên:
 *   0 mã đúng · 1 mã bắt đầu bằng chuỗi gõ · 2 tên bắt đầu bằng cụm gõ · 3 tên chứa nguyên cụm
 *   4 mọi từ đứng đầu một chữ trong tên · 5 mọi từ nằm trong tên · 6 còn lại (khớp nhờ mã / thương hiệu / mẫu)
 */
import { fold } from '../../../core/text/fold.ts';

export interface SearchQuery {
  /** Từ khoá đã bỏ dấu (tối đa 10). */ words: string[];
  /** Cụm gõ đã bỏ dấu, một khoảng trắng giữa các từ. */ phrase: string;
  /** Chuỗi gõ chỉ còn chữ + số (so với mã). */ compact: string;
}

/** Bỏ mọi ký tự không phải chữ / số (sau khi đã bỏ dấu). */
export const compactText = (folded: string) => folded.replace(/[^a-z0-9]/g, '');
/** Từ có số hoặc ký hiệu mới khớp kiểu bỏ khoảng trắng (tránh "ly" khớp nhầm "bol yen"). */
export const needsCompact = (word: string) => /[0-9]/.test(word) || /[^a-z0-9]/.test(word);

export function parseQuery(q: unknown): SearchQuery {
  const phrase = fold(q);
  const words = phrase.split(' ').filter(Boolean).slice(0, 10);
  return { words, phrase: words.join(' '), compact: compactText(phrase) };
}

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
