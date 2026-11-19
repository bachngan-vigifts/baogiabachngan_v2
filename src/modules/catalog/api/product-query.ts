import { and, asc, or, sql, type SQL } from 'drizzle-orm';
import { foldSql } from '../../../core/text/fold.ts';
import { products } from '../schema.ts';
import { compactText, needsCompact, parseQuery } from '../domain/product-rank.ts';

/*
 * Tìm sản phẩm trên máy chủ – cùng quy tắc với trình duyệt (catalog/domain/product-rank.ts): khớp mọi từ (không dấu; từ có số / ký hiệu
 * khớp cả khi bỏ khoảng trắng, dấu câu: "0.5l" ↔ "0.5 L") và xếp theo mức liên quan thay vì bảng chữ cái.
 */
const likeEsc = (v: string) => v.replace(/[\\%_]/g, m => '\\' + m);
/** Chuỗi tìm kiếm đã bỏ dấu, lưu sẵn trong cột sinh tự động `products.search_fold` (= foldSql(sku, name, brand, pattern),
 * migration 20261119090000_search_fold_columns.sql). Tìm không phải chạy translate() trên mọi dòng; có chỉ mục trigram. */
const productHay = () => sql`${products}.search_fold`;
const compactSql = (folded: SQL) => sql`regexp_replace(${folded}, '[^a-z0-9]', '', 'g')`;
/** Tên đã bỏ dấu, gộp khoảng trắng (như `fold()` ở JS). */
const foldedName = () => sql`btrim(regexp_replace(${foldSql(products.name)}, '\\s+', ' ', 'g'))`;

export function matchProductWords(q: string | null) {
  const { words } = parseQuery(q);
  if (!words.length) return undefined;
  const hay = productHay(), compact = compactSql(productHay());
  return and(...words.map(w => {
    const plain = sql`${hay} LIKE ${'%' + likeEsc(w) + '%'}`, c = compactText(w);
    return needsCompact(w) && c ? or(plain, sql`${compact} LIKE ${'%' + likeEsc(c) + '%'}`) : plain;
  }));
}

/** Mới tạo lên trước: giờ tạo, sản phẩm cũ (chưa có giờ tạo) theo mã sản phẩm Sapo giảm dần, rồi theo tên. */
export const newestProducts = (): SQL[] => [
  sql`${products.createdAt} DESC NULLS LAST`,
  sql`(case when ${products.sapoProductId} ~ '^[0-9]{1,18}$' then ${products.sapoProductId}::bigint end) DESC NULLS LAST`,
  asc(foldSql(products.name)), asc(products.sku),
];

/** Thứ tự kết quả: hạng liên quan (0 mã đúng … 6 còn lại – xem product-rank.ts), cùng hạng thì mới tạo lên trước. Không gõ tìm: mới tạo lên đầu. */
export function productOrder(q: string | null): SQL[] {
  const { words, phrase, compact } = parseQuery(q);
  const byName = newestProducts();
  if (!words.length) return byName;
  const name = foldedName(), sku = compactSql(foldSql(products.sku)), padded = sql`' ' || ${name}`;
  const nameHasAll = and(...words.map(w => {
    const plain = sql`${name} LIKE ${'%' + likeEsc(w) + '%'}`, c = compactText(w);
    return needsCompact(w) && c ? or(plain, sql`${compactSql(name)} LIKE ${'%' + likeEsc(c) + '%'}`) : plain;
  }))!;
  const wordStarts = and(...words.map(w => sql`${padded} LIKE ${'% ' + likeEsc(w) + '%'}`))!;
  const rank = sql`CASE
    WHEN ${compact} <> '' AND ${sku} = ${compact} THEN 0
    WHEN ${compact} <> '' AND ${sku} LIKE ${likeEsc(compact) + '%'} THEN 1
    WHEN ${name} LIKE ${likeEsc(phrase) + '%'} THEN 2
    WHEN ${name} LIKE ${'%' + likeEsc(phrase) + '%'} THEN 3
    WHEN ${wordStarts} THEN 4
    WHEN ${nameHasAll} THEN 5
    ELSE 6 END`;
  return [asc(rank), ...byName];
}
