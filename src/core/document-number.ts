/** Auto-generated document numbers: PREFIX_NNN_DDMMYYYY. Existing YYYYMMDD_NNN numbers remain readable. */
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const escapeLike = (s: string) => s.replace(/[\\%_]/g, '\\$&');
export function documentDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date) throw new Error('Ngày chứng từ không hợp lệ.');
  return date.slice(8, 10) + date.slice(5, 7) + date.slice(0, 4);
}
export function documentSequence(no: string, prefix: string, date: string, legacyHead = `${prefix}_${date.replaceAll('-', '')}_`): number | null {
  const current = new RegExp(`^${escapeRegex(prefix)}_(\\d{3,})_${documentDate(date)}$`).exec(no);
  const legacy = no.startsWith(legacyHead) ? no.slice(legacyHead.length) : '';
  const raw = current?.[1] ?? (/^\d{3,}$/.test(legacy) ? legacy : '');
  const value = raw ? Number(raw) : NaN;
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
export function nextDocumentNumber(prefix: string, date: string, used: readonly string[], legacyHead?: string): string {
  let max = 0;
  for (const no of used) max = Math.max(max, documentSequence(no, prefix, date, legacyHead) ?? 0);
  if (!Number.isSafeInteger(max + 1)) throw new Error('Số thứ tự chứng từ vượt giới hạn.');
  return `${prefix}_${String(max + 1).padStart(3, '0')}_${documentDate(date)}`;
}
/** SQL LIKE patterns for both numbering formats. Parameters, including literal underscores, must stay escaped. */
export function documentNumberPatterns(prefix: string, date: string, legacyHead = `${prefix}_${date.replaceAll('-', '')}_`): [string, string] {
  return [escapeLike(prefix) + '\\_%\\_' + documentDate(date), escapeLike(legacyHead) + '%'];
}
