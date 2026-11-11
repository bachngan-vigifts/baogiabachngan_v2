import { documentDate, documentNumberPatterns, nextDocumentNumber } from '../../../core/document-number.ts';
/** Quote prefixes stay HRC_BG / B2B_BG / VG_BG; displayed numbers use PREFIX_NNN_DDMMYYYY. */
export const QUOTE_NO_PREFIX = { HRC: 'HRC', B2B: 'B2B', VIGIFTS: 'VG', SALE: 'SALE' } as const;
const OLD_RE = /^((?:HRC|B2B|VG|SALE)_BG)(\d{4})(\d{2})(\d{2})_(\d{3,})$/;
const NEW_RE = /^((?:HRC|B2B|VG|SALE)_BG)_(\d{3,})_(\d{2})(\d{2})(\d{4})$/;
/** Internal series key, retained for compatibility; it is not the displayed prefix. */
export const quoteHeadFor = (type: string, date: string) => {
  documentDate(date);
  return `${QUOTE_NO_PREFIX[type as keyof typeof QUOTE_NO_PREFIX] ?? 'B2B'}_BG${date.replaceAll('-', '')}_`;
};
export function autoQuoteHead(no: string): string | null {
  const old = OLD_RE.exec(no.trim()), next = NEW_RE.exec(no.trim());
  if (!old && !next) return null;
  const prefix = (old || next)![1]!, date = old ? `${old[2]}-${old[3]}-${old[4]}` : `${next![5]}-${next![4]}-${next![3]}`;
  try { documentDate(date); } catch { return null; }
  return prefix + date.replaceAll('-', '') + '_';
}
function series(head: string) {
  const m = /^((?:HRC|B2B|VG|SALE)_BG)(\d{4})(\d{2})(\d{2})_$/.exec(head);
  if (!m) throw new Error('Loại số báo giá không hợp lệ.');
  return { prefix: m[1]!, date: `${m[2]}-${m[3]}-${m[4]}` };
}
export function nextQuoteNoAfter(head: string, used: readonly string[]) {
  const { prefix, date } = series(head);
  return nextDocumentNumber(prefix, date, used, head);
}
export function quoteNumberPatterns(head: string): [string, string] {
  const { prefix, date } = series(head);
  return documentNumberPatterns(prefix, date, head);
}
