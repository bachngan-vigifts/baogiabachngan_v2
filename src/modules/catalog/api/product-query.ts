import { and, asc, or, sql, type SQL } from 'drizzle-orm';
import { foldSql } from '../../../core/text/fold.ts';
import { products } from '../schema.ts';
import { compactText, needsCompact, parseQuery } from '../domain/product-rank.ts';

/*
 * Tìm sản phẩm trên máy chủ – cùng quy tắc với trình duyệt (catalog/domain/product-rank.ts): khớp mọi từ (không dấu; từ có số / ký hiệu
 * khớp cả khi bỏ khoảng trắng, dấu câu: "0.5l" ↔ "0.5 L") và xếp theo mức liên quan thay vì bảng chữ cái.
 */
const likeEsc = (v: string) => v.replace(/[\\%_]/g, m => '\\' + m);
const productHay = () => foldSql(products.sku, products.name, products.brand, products.pattern);
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

/** Thứ tự kết quả: hạng liên quan (0 mã đúng … 6 còn lại – xem product-rank.ts), cùng hạng tên ngắn trước, rồi theo tên. */
export function productOrder(q: string | null): SQL[] {
  const { words, phrase, compact } = parseQuery(q);
  const byName = [asc(foldSql(products.name)), asc(products.name), asc(products.sku)];
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
  return [asc(rank), asc(sql`length(${products.name})`), ...byName];
}
