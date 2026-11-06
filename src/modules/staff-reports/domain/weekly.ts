/**
 * BÁO CÁO TUẦN của Sale / Sale Admin – hàm thuần (không DB). Căn cứ Tiền trách nhiệm từ tháng 12/2026:
 *   Tiền trách nhiệm = Mức trách nhiệm (hồ sơ lương) × (ngày công ÷ công chuẩn) × (điểm báo cáo tuần ÷ 4).
 *  Kỳ báo cáo = tuần thứ Hai → Chủ nhật; hạn 10h00 thứ Hai tuần sau (giờ VN); nộp chính thức từ 00h00 thứ Hai tuần sau.
 *  Điểm một tuần: Miễn (nghỉ phép / công tác, Manager duyệt) 1 · Chưa đạt (Manager duyệt) 0 · đúng hạn 1 · trễ < 1 ngày 0,5 ·
 *  trễ từ 1 ngày / không nộp 0. Tuần thuộc tháng của ngày hạn nộp; tháng có 5 tuần lấy 4 tuần điểm cao nhất (tối đa 4 điểm).
 */
export const WEEKLY_REPORT_FROM = '2026-12';
export const WEEKLY_REQUIRED = 4;
/** Chức vụ phải nộp báo cáo tuần (và được tính Tiền trách nhiệm theo báo cáo). */
export const WEEKLY_POSITIONS = ['sale', 'sale-admin'] as const;
export const WEEKLY_REVIEWS = ['pending', 'ok', 'rejected', 'excused'] as const;
export type WeeklyReview = typeof WEEKLY_REVIEWS[number];
export const WEEKLY_REVIEW_LABEL: Record<WeeklyReview, string> = { pending: 'Chờ duyệt', ok: 'Đạt', rejected: 'Chưa đạt', excused: 'Miễn (nghỉ phép / công tác)' };
export const WEEKLY_LIMITS = { text: 2000 } as const;

const VN = 7 * 3600_000, DAY = 86400_000;
const pad = (n: number) => String(n).padStart(2, '0');
const isoDay = (t: number) => { const d = new Date(t); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
export const addDays = (day: string, n: number) => isoDay(Date.parse(day + 'T00:00:00Z') + n * DAY);
const vnAt = (day: string, hour: number) => new Date(Date.parse(day + 'T00:00:00Z') - VN + hour * 3600_000).toISOString();
export const vnDay = (iso: string) => isoDay(Date.parse(iso) + VN);
export const mondayOf = (day: string) => { const w = new Date(day + 'T00:00:00Z').getUTCDay(); return addDays(day, -((w + 6) % 7)); };
export const isWeek = (p: unknown): p is string => typeof p === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p) && isoDay(Date.parse(p + 'T00:00:00Z')) === p && mondayOf(p) === p;
export const weeklyDeadline = (monday: string) => vnAt(addDays(monday, 7), 10);
export const weeklyOpensAt = (monday: string) => vnAt(addDays(monday, 7), 0);
export const weekStarted = (monday: string, nowIso: string) => vnDay(nowIso) >= monday;
export const canSubmitWeek = (monday: string, nowIso: string) => nowIso >= weeklyOpensAt(monday);
/** Các tuần (thứ Hai) có hạn nộp rơi vào tháng `month`. */
export function weeksOfMonth(month: string) {
  const first = month + '-01', out: string[] = [];
  for (let m = mondayOf(addDays(first, -7)); ; m = addDays(m, 7)) {
    const due = addDays(m, 7);
    if (due.slice(0, 7) > month) break;
    if (due.slice(0, 7) === month) out.push(m);
  }
  return out;
}
export const appliesTo = (month: string) => month >= WEEKLY_REPORT_FROM;

export type WeekState = 'on_time' | 'late' | 'missing' | 'not_due';
export function weekState(monday: string, submittedAt: string | null, nowIso: string): { state: WeekState; lateMs: number } {
  const due = weeklyDeadline(monday);
  if (!submittedAt) return { state: nowIso > due ? 'missing' : 'not_due', lateMs: 0 };
  return submittedAt <= due ? { state: 'on_time', lateMs: 0 } : { state: 'late', lateMs: Date.parse(submittedAt) - Date.parse(due) };
}
/** Điểm một tuần; `null` = chưa tới hạn (chưa tính). */
export function weekScore(monday: string, r: { submittedAt: string; review: WeeklyReview } | null, nowIso: string): number | null {
  if (r?.review === 'excused') return 1;
  if (r?.review === 'rejected') return 0;
  const s = weekState(monday, r?.submittedAt ?? null, nowIso);
  if (s.state === 'not_due') return null;
  if (s.state === 'on_time') return 1;
  if (s.state === 'late') return s.lateMs < DAY ? 0.5 : 0;
  return 0;
}
/** Điểm tháng: 4 tuần điểm cao nhất (tuần chưa tới hạn tính 0 khi tạm tính), tối đa 4. */
export function monthPoints(month: string, reports: ReadonlyMap<string, { submittedAt: string; review: WeeklyReview }>, nowIso: string) {
  const weeks = weeksOfMonth(month).map(period => { const r = reports.get(period) ?? null, st = weekState(period, r?.submittedAt ?? null, nowIso);
    return { period, deadline: weeklyDeadline(period), state: st.state, review: r?.review ?? null, score: weekScore(period, r, nowIso) }; });
  const counted = [...weeks].map(w => w.score ?? 0).sort((a, b) => b - a).slice(0, WEEKLY_REQUIRED);
  return { month, weeks, points: counted.reduce((n, x) => n + x, 0), required: WEEKLY_REQUIRED, pending: weeks.filter(w => w.score === null).length };
}
/** Tiền trách nhiệm theo báo cáo tuần. */
export const weeklyResponsibility = (amount: number, days: number, standardDays: number, points: number) =>
  standardDays > 0 ? amount * days / standardDays * Math.min(WEEKLY_REQUIRED, Math.max(0, points)) / WEEKLY_REQUIRED : 0;

/** Nhóm ngành của khách cho mục "Chăm sóc trong tuần": ưu tiên "Nhóm / loại khách", không khớp thì đoán theo tên khách. */
export const INDUSTRIES = ['bank', 'agri', 'aqua', 'other'] as const;
export type Industry = typeof INDUSTRIES[number];
export const INDUSTRY_LABEL: Record<Industry, string> = { bank: 'Ngân hàng / tín dụng', agri: 'Nông nghiệp', aqua: 'Thuỷ sản', other: 'Khác' };
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
const INDUSTRY_RULES: [Industry, RegExp][] = [
  ['bank', /ngan hang|\w*bank\b|quy tin dung|\bqtdnd\b|\b(bidv|vib|msb|ncb|shb|ocb|scb|vrb)\b/],
  ['aqua', /thuy san|hai san/],
  ['agri', /nong nghiep|nong san|nong duoc|phan bon|vat tu nong|bao ve thuc vat|\bbvtv\b|giong cay|thuc an chan nuoi/],
];
export function industryOf(customerType: string | null | undefined, name: string | null | undefined): Industry {
  for (const src of [customerType, name]) {
    const t = fold(src ?? '');
    for (const [k, re] of INDUSTRY_RULES) if (re.test(t)) return k;
  }
  return 'other';
}

/** Phần nhân viên tự nhập: kế hoạch tuần tới (bắt buộc), tình trạng từng báo giá trong tuần chưa chốt (bắt buộc), kết quả nổi bật / khó khăn (tuỳ chọn). */
export interface WeeklyInputs { highlights: string; nextWeekPlan: string; support: string; quoteNotes: Record<string, string> }
export function weeklyProblems(v: WeeklyInputs, openQuotes: readonly { id: string; quoteNo: string }[]) {
  const out: string[] = [];
  if (v.nextWeekPlan.length < 3) out.push('Nhập kế hoạch tuần tới.');
  const missing = openQuotes.filter(q => (v.quoteNotes[q.id] ?? '').length < 3).map(q => q.quoteNo);
  if (missing.length) out.push(`Ghi tình trạng / bước tiếp cho báo giá: ${missing.join(', ')}.`);
  return out;
}
