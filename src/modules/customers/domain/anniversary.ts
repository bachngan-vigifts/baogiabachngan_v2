/** Shared by server and browser. Use calendar dates, never elapsed milliseconds as company age. */
export const ANNIVERSARY_INTERVAL = 5;
export const ANNIVERSARY_LEAD_DAYS = 60;
export const vietnamToday = (now = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).format(now);
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export function anniversarySuggestion(establishedDate: string | null | undefined, today = vietnamToday()) {
  if (!isCalendarDate(establishedDate) || !isCalendarDate(today) || establishedDate > today) return null;
  const startYear = Number(establishedDate.slice(0, 4)), currentYear = Number(today.slice(0, 4));
  let years = Math.max(ANNIVERSARY_INTERVAL, Math.ceil((currentYear - startYear) / ANNIVERSARY_INTERVAL) * ANNIVERSARY_INTERVAL);
  const anniversaryDate = (year: number) => {
    if (year > 9999) return null;
    const date = String(year).padStart(4, '0') + establishedDate.slice(4);
    // Companies founded on leap day celebrate on 28 February in non-leap years.
    return isCalendarDate(date) ? date : String(year).padStart(4, '0') + '-02-28';
  };
  let date = anniversaryDate(startYear + years);
  if (date && date < today) { years += ANNIVERSARY_INTERVAL; date = anniversaryDate(startYear + years); }
  if (!date) return null;
  const daysUntil = Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000);
  return { years, date, daysUntil, upcoming: daysUntil <= ANNIVERSARY_LEAD_DAYS,
    suggestion: `Kỷ niệm ${years} năm thành lập: chủ động liên hệ, tìm hiểu kế hoạch sự kiện và tư vấn quà tặng / ấn phẩm kỷ niệm.` };
}
