import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';

/**
 * Tìm kiếm tiếng Việt không phân biệt dấu/hoa thường, chạy được trên PostgreSQL thật lẫn PGlite
 * (không cần extension `unaccent`): cùng một bảng chuyển chữ ở JS và trong SQL `translate()`.
 */
/** Dấu rời (Unicode tổ hợp – NFD, hay gặp khi tên gõ trên Mac / nhập từ Sapo): không có ký tự tương ứng trong TO nên `translate()` xoá đi. */
const MARKS = '\u0300\u0301\u0302\u0303\u0306\u0309\u031b\u0323';
const FROM = 'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ' + MARKS;
const TO = 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd';

/** Chuẩn hoá chuỗi để so khớp: chữ thường, bỏ dấu, gộp khoảng trắng. */
export function fold(value: unknown): string {
  const lower = String(value ?? '').toLowerCase().normalize('NFC');
  let out = '';
  for (const ch of lower) { const i = FROM.indexOf(ch); out += i >= 0 ? TO[i] ?? '' : ch; }
  return out.trim().replace(/\s+/g, ' ');
}

/** Biểu thức SQL tương đương `fold()` cho một hoặc nhiều cột (nối bằng khoảng trắng). */
export function foldSql(...columns: SQLWrapper[]): SQL {
  const joined = sql.join(columns.map(c => sql`coalesce(${c}, '')`), sql` || ' ' || `);
  return sql`translate(lower(${joined}), ${FROM}, ${TO})`;
}

/**
 * TÌM KIẾM DÙNG CHUNG (cùng quy tắc với tìm sản phẩm – catalog/domain/product-rank.ts):
 * bỏ dấu, nhiều từ khoá không cần đúng thứ tự (tối đa 10). Từ có số / ký hiệu còn khớp khi bỏ khoảng trắng, dấu câu ở cả hai phía:
 * "dh001" ↔ "DH_001", "0901 234 567" ↔ "0901234567", "0.5l" ↔ "0.5 L".
 */
export interface SearchQuery { words: string[]; phrase: string; compact: string }
/** Bỏ mọi ký tự không phải chữ / số (sau khi đã bỏ dấu). */
export const compactText = (folded: string) => folded.replace(/[^a-z0-9]/g, '');
/**
 * Từ có số, hoặc có ký hiệu nằm GIỮA chữ / số ("lhc-4282", "a.b"), mới khớp thêm kiểu bỏ khoảng trắng / dấu câu
 * (tránh "ly" khớp nhầm "bol yen", và "count-" khớp mọi chữ "count").
 */
export const needsCompact = (word: string) => /[0-9]/.test(word) || /[a-z0-9][^a-z0-9]+[a-z0-9]/.test(word);
export function parseQuery(q: unknown): SearchQuery {
  const phrase = fold(q);
  const words = phrase.split(' ').filter(Boolean).slice(0, 10);
  return { words, phrase: words.join(' '), compact: compactText(phrase) };
}
const likeEsc = (v: string) => v.replace(/[\\%_]/g, m => '\\' + m);
const compactSql = (folded: SQL) => sql`regexp_replace(${folded}, '[^a-z0-9]', '', 'g')`;

/** Điều kiện "chứa mọi từ khoá" trên chuỗi đã bỏ dấu (`foldSql(...)`). */
export function matchAllWords(haystack: SQL, query: unknown): SQL | undefined {
  const { words } = parseQuery(query);
  if (!words.length) return undefined;
  return sql.join(words.map(w => {
    const plain = sql`${haystack} LIKE ${'%' + likeEsc(w) + '%'}`, c = compactText(w);
    return needsCompact(w) && c ? sql`(${plain} OR ${compactSql(haystack)} LIKE ${'%' + likeEsc(c) + '%'})` : plain;
  }), sql` AND `);
}

/**
 * Hạng liên quan (nhỏ = lên trước) khi có từ khoá: 0 mã đúng · 1 mã bắt đầu bằng chuỗi gõ · 2 tên bắt đầu bằng cụm gõ ·
 * 3 tên chứa nguyên cụm · 4 còn lại. `codes`: các cột mã (số chứng từ, SKU, SĐT, MST…); `name`: cột tên chính.
 * Không có từ khoá → undefined (giữ thứ tự mặc định, mới tạo lên trên).
 */
export function searchRank(codes: readonly SQLWrapper[], name: SQLWrapper, query: unknown): SQL | undefined {
  const { words, phrase, compact } = parseQuery(query);
  if (!words.length) return undefined;
  const any = (op: (c: SQL) => SQL) => codes.length ? sql.join(codes.map(c => op(compactSql(foldSql(c)))), sql` OR `) : sql`false`;
  const n = sql`btrim(regexp_replace(${foldSql(name)}, '\\s+', ' ', 'g'))`;
  return sql`CASE
    WHEN ${compact !== ''} AND (${any(c => sql`${c} = ${compact}`)}) THEN 0
    WHEN ${compact !== ''} AND (${any(c => sql`${c} LIKE ${likeEsc(compact) + '%'}`)}) THEN 1
    WHEN ${n} LIKE ${likeEsc(phrase) + '%'} THEN 2
    WHEN ${n} LIKE ${'%' + likeEsc(phrase) + '%'} THEN 3
    ELSE 4 END`;
}

/** `orderBy(...rankFirst(searchRank(...)), …)`: hạng liên quan đứng trước thứ tự mặc định khi có từ khoá. */
export const rankFirst = (rank: SQL | undefined): SQL[] => rank ? [sql`${rank} ASC`] : [];

/** Đọc tham số phân trang an toàn. */
export function paging(url: URL, defLimit = 50, maxLimit = 200) {
  const n = (k: string, d: number) => { const v = Number(url.searchParams.get(k)); return Number.isInteger(v) && v >= 0 ? v : d; };
  return { limit: Math.min(n('limit', defLimit) || defLimit, maxLimit), offset: Math.min(n('offset', 0), 1_000_000) };
}
