/**
 * BÁO CÁO TUẦN của Sale / Sale Admin – hàm thuần (không DB). Căn cứ Tiền trách nhiệm từ tháng 11/2026:
 *   Tiền trách nhiệm = Mức trách nhiệm (hồ sơ lương) × (ngày công ÷ công chuẩn) × (điểm báo cáo tuần ÷ 4).
 *  Kỳ báo cáo = tuần thứ Hai → Chủ nhật; hạn 10h00 thứ Hai tuần sau (giờ VN); nộp chính thức từ 00h00 thứ Hai tuần sau.
 *  Điểm một tuần: Miễn (nghỉ phép / công tác, Manager duyệt) 1 · Chưa đạt (Manager duyệt) 0 · đúng hạn 1 · trễ < 1 ngày 0,5 ·
 *  trễ từ 1 ngày / không nộp 0. Tuần thuộc tháng của ngày hạn nộp; tháng có 5 tuần lấy 4 tuần điểm cao nhất (tối đa 4 điểm).
 */
export const WEEKLY_REPORT_FROM = '2026-11';
/** Ngày triển khai: tuần có hạn nộp trước 00h00 ngày này tính "Miễn – trước ngày triển khai" (1 điểm, không nhắc). */
export const WEEKLY_LAUNCH_DAY = '2026-11-06';
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

export type WeekState = 'on_time' | 'late' | 'missing' | 'not_due' | 'exempt';
/** Hạn nộp trước ngày triển khai (`launchDay` để test truyền '' = không miễn). */
export const beforeLaunch = (monday: string, launchDay = WEEKLY_LAUNCH_DAY) => !!launchDay && weeklyDeadline(monday) < vnAt(launchDay, 0);
export function weekState(monday: string, submittedAt: string | null, nowIso: string, launchDay = WEEKLY_LAUNCH_DAY): { state: WeekState; lateMs: number } {
  if (beforeLaunch(monday, launchDay)) return { state: 'exempt', lateMs: 0 };
  return stateBy(weeklyDeadline(monday), submittedAt, nowIso);
}
/** Điểm một tuần; `null` = chưa tới hạn (chưa tính). */
export function weekScore(monday: string, r: { submittedAt: string; review: WeeklyReview } | null, nowIso: string, launchDay = WEEKLY_LAUNCH_DAY): number | null {
  if (r?.review === 'excused') return 1;
  if (r?.review === 'rejected') return 0;
  const s = weekState(monday, r?.submittedAt ?? null, nowIso, launchDay);
  if (s.state === 'exempt') return 1;
  if (s.state === 'not_due') return null;
  if (s.state === 'on_time') return 1;
  if (s.state === 'late') return s.lateMs < DAY ? 0.5 : 0;
  return 0;
}
/** BÁO CÁO THÁNG (từ 11/2026): kỳ = 'YYYY-MM'; nộp chính thức từ 00h00 ngày 01 tháng sau, hạn 10h00 ngày 02 tháng sau. */
export const MONTHLY_REPORT_FROM = '2026-11';
export const isMonthPeriod = (p: unknown): p is string => typeof p === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(p);
export const nextMonth = (month: string) => { const [y, m] = month.split('-').map(Number) as [number, number]; return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`; };
export const shiftMonths = (month: string, n: number) => { const [y, m] = month.split('-').map(Number) as [number, number]; const t = y * 12 + m - 1 + n; return `${Math.floor(t / 12)}-${pad(t % 12 + 1)}`; };
export const monthlyDeadline = (month: string) => vnAt(nextMonth(month) + '-02', 10);
export const monthlyOpensAt = (month: string) => vnAt(nextMonth(month) + '-01', 0);
export const monthStarted = (month: string, nowIso: string) => vnDay(nowIso).slice(0, 7) >= month;
export const canSubmitMonth = (month: string, nowIso: string) => nowIso >= monthlyOpensAt(month);
export const monthlyRequired = (month: string) => month >= MONTHLY_REPORT_FROM;
function stateBy(due: string, submittedAt: string | null, nowIso: string): { state: WeekState; lateMs: number } {
  if (!submittedAt) return { state: nowIso > due ? 'missing' : 'not_due', lateMs: 0 };
  return submittedAt <= due ? { state: 'on_time', lateMs: 0 } : { state: 'late', lateMs: Date.parse(submittedAt) - Date.parse(due) };
}
export const monthlyState = (month: string, submittedAt: string | null, nowIso: string) => stateBy(monthlyDeadline(month), submittedAt, nowIso);
/** Điểm báo cáo tháng – cùng thang báo cáo tuần; `null` = chưa tới hạn. */
export function monthlyScore(month: string, r: { submittedAt: string; review: WeeklyReview } | null, nowIso: string): number | null {
  if (r?.review === 'excused') return 1;
  if (r?.review === 'rejected') return 0;
  const s = monthlyState(month, r?.submittedAt ?? null, nowIso);
  if (s.state === 'not_due') return null;
  if (s.state === 'on_time') return 1;
  if (s.state === 'late') return s.lateMs < DAY ? 0.5 : 0;
  return 0;
}

/**
 * Điểm tháng (căn cứ Tiền trách nhiệm): 4 tuần điểm cao nhất + báo cáo tháng (từ 11/2026) → tối đa 5.
 * `reports`: theo kỳ – tuần (thứ Hai) và tháng ('YYYY-MM'). Kỳ chưa tới hạn tính 0 khi tạm tính.
 */
export function monthPoints(month: string, reports: ReadonlyMap<string, { submittedAt: string; review: WeeklyReview }>, nowIso: string) {
  const weeks = weeksOfMonth(month).map(period => { const r = reports.get(period) ?? null, st = weekState(period, r?.submittedAt ?? null, nowIso);
    return { period, deadline: weeklyDeadline(period), state: st.state, review: r?.review ?? null, score: weekScore(period, r, nowIso) }; });
  const counted = [...weeks].map(w => w.score ?? 0).sort((a, b) => b - a).slice(0, WEEKLY_REQUIRED);
  const mr = reports.get(month) ?? null;
  const monthly = monthlyRequired(month) ? { period: month, deadline: monthlyDeadline(month), state: monthlyState(month, mr?.submittedAt ?? null, nowIso).state, review: mr?.review ?? null, score: monthlyScore(month, mr, nowIso) } : null;
  const points = counted.reduce((n, x) => n + x, 0) + (monthly?.score ?? 0);
  return { month, weeks, monthly, points, required: WEEKLY_REQUIRED + (monthly ? 1 : 0),
    pending: weeks.filter(w => w.score === null).length + (monthly && monthly.score === null ? 1 : 0) };
}
/** Tiền trách nhiệm theo điểm báo cáo (`required` = 4 hoặc 5). */
export const weeklyResponsibility = (amount: number, days: number, standardDays: number, points: number, required = WEEKLY_REQUIRED) =>
  standardDays > 0 ? amount * days / standardDays * Math.min(required, Math.max(0, points)) / required : 0;

/** Phần tự nhập báo cáo tháng: đánh giá, chỉ tiêu tháng sau (ghi chú), khách trọng điểm, kế hoạch (bắt buộc); đề xuất (tuỳ chọn). */
export interface MonthlyInputs { evaluation: string; nextTarget: number | null; keyCustomers: string; plan: string; support: string }
export function monthlyProblems(v: MonthlyInputs) {
  const out: string[] = [];
  if (v.evaluation.length < 3) out.push('Nhập đánh giá tháng (vì sao đạt / chưa đạt).');
  if (!v.nextTarget || v.nextTarget <= 0) out.push('Nhập chỉ tiêu đăng ký tháng sau.');
  if (v.keyCustomers.length < 3) out.push('Nhập khách trọng điểm tháng sau.');
  if (v.plan.length < 3) out.push('Nhập kế hoạch / chương trình tháng sau.');
  return out;
}

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
