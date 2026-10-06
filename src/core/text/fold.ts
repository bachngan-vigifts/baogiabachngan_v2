import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';

/**
 * Tìm kiếm tiếng Việt không phân biệt dấu/hoa thường, chạy được trên PostgreSQL thật lẫn PGlite
 * (không cần extension `unaccent`): cùng một bảng chuyển chữ ở JS và trong SQL `translate()`.
 */
const FROM = 'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ';
const TO = 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd';

/** Chuẩn hoá chuỗi để so khớp: chữ thường, bỏ dấu, gộp khoảng trắng. */
export function fold(value: unknown): string {
  const lower = String(value ?? '').toLowerCase().normalize('NFC');
  let out = '';
  for (const ch of lower) { const i = FROM.indexOf(ch); out += i >= 0 ? TO[i] : ch; }
  return out.trim().replace(/\s+/g, ' ');
}

/** Biểu thức SQL tương đương `fold()` cho một hoặc nhiều cột (nối bằng khoảng trắng). */
export function foldSql(...columns: SQLWrapper[]): SQL {
  const joined = sql.join(columns.map(c => sql`coalesce(${c}, '')`), sql` || ' ' || `);
  return sql`translate(lower(${joined}), ${FROM}, ${TO})`;
}

/** Điều kiện "chứa mọi từ khoá" (mỗi từ khoá ≤ 10, đã thoát ký tự LIKE). */
export function matchAllWords(haystack: SQL, query: unknown): SQL | undefined {
  const words = fold(query).split(' ').filter(Boolean).slice(0, 10);
  if (!words.length) return undefined;
  return sql.join(words.map(w => sql`${haystack} LIKE ${'%' + w.replace(/[\\%_]/g, m => '\\' + m) + '%'}`), sql` AND `);
}

/** Đọc tham số phân trang an toàn. */
export function paging(url: URL, defLimit = 50, maxLimit = 200) {
  const n = (k: string, d: number) => { const v = Number(url.searchParams.get(k)); return Number.isInteger(v) && v >= 0 ? v : d; };
  return { limit: Math.min(n('limit', defLimit) || defLimit, maxLimit), offset: Math.min(n('offset', 0), 1_000_000) };
}
