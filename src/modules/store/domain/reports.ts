/**
 * BÁO CÁO CỬA HÀNG TRƯỞNG (CHT) – hàm thuần (không DB), theo Bản mô tả công việc CHT + Quy định chính sách lương CHT.
 *
 *  Báo cáo         Kỳ (period)                    Hạn nộp (giờ Việt Nam)            Tiền Trách nhiệm (ngạch 250.000)
 *  Ngày (daily)    YYYY-MM-DD (ngày có mở ca POS)  trước 22h00 cùng ngày             0 lần chưa đạt 250k · 1–2: 150k · 3–4: 50k · ≥5: 0
 *  Tuần (weekly)   YYYY-MM-DD = thứ Hai của tuần    trước 10h00 thứ Hai tuần sau      0: 250k · 1: 150k · 2: 50k · ≥3: 0
 *  Tháng (monthly) YYYY-MM                         trước ngày 02 tháng sau           đúng hạn 250k · trễ ≤ 2 ngày 100k · còn lại 0
 *  Kiểm tồn kho    YYYY-MM                         trước ngày 02 tháng sau           đúng hạn 250k · trễ ≤ 2 ngày 150k · còn lại / không báo chênh lệch 0
 *
 *  "Chưa đạt" = nộp trễ, không nộp, hoặc bị Quản lý đánh dấu (sai số liệu sổ quỹ tính 2 lần; đề xuất đặt hàng sai tính 1 lần).
 *  Có lý do khách quan được Quản lý xác nhận ("miễn") → không tính chưa đạt. Mỗi ngạch xét độc lập, thấp nhất 0.
 */
export const STORE_REPORT_KINDS = ['daily', 'weekly', 'monthly', 'stocktake'] as const;
export type StoreReportKind = typeof STORE_REPORT_KINDS[number];
export const STORE_REPORT_LABEL: Record<StoreReportKind, string> = { daily: 'Báo cáo ngày', weekly: 'Báo cáo tuần', monthly: 'Báo cáo tháng', stocktake: 'Báo cáo kiểm tồn kho' };
/** Kết quả duyệt: pending = chưa duyệt (tính theo giờ nộp), ok = đạt, cash_error = sai số liệu sổ quỹ (×2), order_error = đề xuất đặt hàng sai,
 *  gap_unreported = có chênh lệch kho nhưng không báo trong biên bản, excused = lý do khách quan (không tính chưa đạt). */
export const STORE_REVIEW_STATUSES = ['pending', 'ok', 'cash_error', 'order_error', 'gap_unreported', 'excused'] as const;
export type StoreReviewStatus = typeof STORE_REVIEW_STATUSES[number];
export const STORE_REVIEW_LABEL: Record<StoreReviewStatus, string> = {
  pending: 'Chờ duyệt', ok: 'Đạt', cash_error: 'Sai số liệu sổ quỹ (tính 2 lần)', order_error: 'Đề xuất đặt hàng sai', gap_unreported: 'Có chênh lệch kho nhưng không báo', excused: 'Miễn (lý do khách quan)',
};
/** Kết quả duyệt hợp lệ theo loại báo cáo. */
export const REVIEW_FOR: Record<StoreReportKind, readonly StoreReviewStatus[]> = {
  daily: ['ok', 'cash_error', 'excused'], weekly: ['ok', 'order_error', 'excused'], monthly: ['ok', 'excused'], stocktake: ['ok', 'gap_unreported', 'excused'],
};
export const RESPONSIBILITY_SLOT = 250_000;
export const STORE_LIMITS = { text: 2000, money: 100_000_000_000 } as const;

const VN = 7 * 3600_000;
const pad = (n: number) => String(n).padStart(2, '0');
const isoDay = (t: number) => { const d = new Date(t); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
/** Mốc giờ Việt Nam → ISO UTC. */
const vnAt = (day: string, hour: number) => new Date(Date.parse(day + 'T00:00:00Z') - VN + hour * 3600_000).toISOString();
const addDays = (day: string, n: number) => isoDay(Date.parse(day + 'T00:00:00Z') + n * 86400_000);
export const nextMonth = (m: string) => { const y = +m.slice(0, 4), mo = +m.slice(5, 7); return mo === 12 ? `${y + 1}-01` : `${y}-${pad(mo + 1)}`; };
export const prevMonth = (m: string) => { const y = +m.slice(0, 4), mo = +m.slice(5, 7); return mo === 1 ? `${y - 1}-12` : `${y}-${pad(mo - 1)}`; };
/** Ngày / giờ Việt Nam của một thời điểm. */
export function vnClock(nowIso: string) { const t = Date.parse(nowIso) + VN, d = new Date(t); return { day: isoDay(t), hour: d.getUTCHours() + d.getUTCMinutes() / 60, weekday: d.getUTCDay() }; }
/** Thứ Hai của tuần chứa ngày `day` (YYYY-MM-DD). */
export const mondayOf = (day: string) => { const w = new Date(day + 'T00:00:00Z').getUTCDay(); return addDays(day, -((w + 6) % 7)); };
export const isPeriod = (kind: StoreReportKind, p: unknown): p is string =>
  typeof p === 'string' && (kind === 'monthly' || kind === 'stocktake' ? /^\d{4}-(0[1-9]|1[0-2])$/.test(p)
    : /^\d{4}-\d{2}-\d{2}$/.test(p) && isoDay(Date.parse(p + 'T00:00:00Z')) === p && (kind === 'daily' || mondayOf(p) === p));

/** Hạn nộp (ISO UTC) của một kỳ báo cáo. */
export function deadlineOf(kind: StoreReportKind, period: string) {
  if (kind === 'daily') return vnAt(period, 22);
  if (kind === 'weekly') return vnAt(addDays(period, 7), 10);
  return vnAt(nextMonth(period) + '-02', 0);
}
/** Kỳ được phép nộp lúc `now`: không nộp trước khi kỳ bắt đầu (ngày / tuần / tháng chưa tới). */
export function periodStarted(kind: StoreReportKind, period: string, nowIso: string) {
  const day = vnClock(nowIso).day;
  if (kind === 'daily' || kind === 'weekly') return period <= day;
  return period <= day.slice(0, 7);
}

export type SlotState = 'on_time' | 'late' | 'missing' | 'not_due';
/** Trạng thái nộp của một kỳ: so giờ nộp lần đầu với hạn. */
export function slotState(kind: StoreReportKind, period: string, submittedAt: string | null, nowIso: string): { state: SlotState; lateDays: number } {
  const due = deadlineOf(kind, period);
  if (!submittedAt) return { state: nowIso > due ? 'missing' : 'not_due', lateDays: 0 };
  if (submittedAt <= due) return { state: 'on_time', lateDays: 0 };
  return { state: 'late', lateDays: Math.ceil((Date.parse(submittedAt) - Date.parse(due)) / 86400_000) };
}

export interface ReportRow { kind: StoreReportKind; period: string; submittedAt: string | null; review: StoreReviewStatus }
export interface ResponsibilityPart { slot: StoreReportKind; amount: number; fails: number; detail: { period: string; state: SlotState; review: StoreReviewStatus; fails: number }[] }

const tierDaily = (n: number) => n === 0 ? 250_000 : n <= 2 ? 150_000 : n <= 4 ? 50_000 : 0;
const tierWeekly = (n: number) => n === 0 ? 250_000 : n === 1 ? 150_000 : n === 2 ? 50_000 : 0;

/**
 * Tiền Trách nhiệm tháng `month` của một cửa hàng.
 * `dailyDays`: các ngày trong tháng cửa hàng có mở ca POS (ngày cần báo cáo). `weeks`: thứ Hai các tuần cần báo cáo
 * (tuần có mở ca, hạn nộp rơi vào tháng). `reports`: các báo cáo đã nộp (mọi kỳ liên quan).
 */
export function responsibilityOf(a: { month: string; dailyDays: readonly string[]; weeks: readonly string[]; reports: readonly ReportRow[]; now: string }) {
  const find = (kind: StoreReportKind, period: string) => a.reports.find(r => r.kind === kind && r.period === period);
  const dayDetail = a.dailyDays.map(period => { const r = find('daily', period), s = slotState('daily', period, r?.submittedAt ?? null, a.now).state, review = r?.review ?? 'pending';
    return { period, state: s, review, fails: dailyFails(s, review) }; });
  const weekDetail = a.weeks.map(period => { const r = find('weekly', period), s = slotState('weekly', period, r?.submittedAt ?? null, a.now).state, review = r?.review ?? 'pending';
    return { period, state: s, review, fails: weeklyFails(s, review) }; });
  const once = (kind: 'monthly' | 'stocktake') => {
    const r = find(kind, a.month), st = slotState(kind, a.month, r?.submittedAt ?? null, a.now), review = r?.review ?? 'pending';
    let amount: number;
    if (review === 'excused' || st.state === 'not_due') amount = RESPONSIBILITY_SLOT;
    else if (kind === 'stocktake' && review === 'gap_unreported') amount = 0;
    else if (st.state === 'on_time') amount = RESPONSIBILITY_SLOT;
    else if (st.state === 'late' && st.lateDays <= 2) amount = kind === 'monthly' ? 100_000 : 150_000;
    else amount = 0;
    return { slot: kind, amount, fails: amount === RESPONSIBILITY_SLOT ? 0 : 1, detail: [{ period: a.month, state: st.state, review, fails: amount === RESPONSIBILITY_SLOT ? 0 : 1 }] } satisfies ResponsibilityPart;
  };
  const dFails = dayDetail.reduce((s, d) => s + d.fails, 0), wFails = weekDetail.reduce((s, d) => s + d.fails, 0);
  const parts: ResponsibilityPart[] = [
    { slot: 'daily', amount: tierDaily(dFails), fails: dFails, detail: dayDetail },
    { slot: 'weekly', amount: tierWeekly(wFails), fails: wFails, detail: weekDetail },
    once('monthly'), once('stocktake'),
  ];
  return { month: a.month, parts, total: parts.reduce((s, p) => s + p.amount, 0) };
}
/** Ngày: trễ / thiếu = 1 lần; sai số liệu sổ quỹ = 2 lần (thay cho 1 lần trễ nếu có cả hai). */
export function dailyFails(s: SlotState, review: StoreReviewStatus) {
  if (review === 'excused' || s === 'not_due') return 0;
  if (review === 'cash_error') return 2;
  return s === 'on_time' ? 0 : 1;
}
/** Tuần: trễ / thiếu / đề xuất đặt hàng sai = 1 lần. */
export function weeklyFails(s: SlotState, review: StoreReviewStatus) {
  if (review === 'excused' || s === 'not_due') return 0;
  return s === 'on_time' && review !== 'order_error' ? 0 : 1;
}

/** Tuần cần báo cáo trong tháng: thứ Hai của tuần có mở ca, với hạn nộp (thứ Hai tuần sau) rơi vào tháng. */
export function weeksDueIn(month: string, shiftDays: readonly string[]) {
  const set = new Set(shiftDays.map(mondayOf));
  return [...set].filter(mon => addDays(mon, 7).slice(0, 7) === month).sort();
}

export interface Reminder { kind: StoreReportKind; period: string; label: string; due: string; overdue: boolean }
/**
 * Việc CHT cần làm lúc `now` (nhắc bằng hộp nhắc 30 phút / lần):
 *  – Báo cáo ngày: hôm nay có mở ca → nhắc từ 19h00; các ngày có mở ca trong 7 ngày qua chưa nộp → quá hạn.
 *  – Báo cáo tuần: tuần trước có mở ca, chưa nộp → nhắc từ 08h00 thứ Hai.
 *  – Báo cáo tháng + kiểm tồn kho (tháng cửa hàng có mở ca): nhắc từ 08h00 ngày cuối tháng; tháng trước chưa nộp → nhắc trong 10 ngày đầu tháng.
 */
export function remindersAt(nowIso: string, shiftDays: readonly string[], submitted: ReadonlySet<string>) {
  const { day, hour } = vnClock(nowIso), out: Reminder[] = [], has = (k: StoreReportKind, p: string) => submitted.has(`${k}:${p}`);
  const push = (kind: StoreReportKind, period: string, label: string) => { const due = deadlineOf(kind, period); out.push({ kind, period, label, due, overdue: nowIso > due }); };
  const days = new Set(shiftDays);
  for (let i = 7; i >= 1; i--) { const d = addDays(day, -i); if (days.has(d) && !has('daily', d)) push('daily', d, `Báo cáo ngày ${d.slice(8)}/${d.slice(5, 7)}`); }
  if (days.has(day) && hour >= 19 && !has('daily', day)) push('daily', day, 'Báo cáo ngày hôm nay');
  const lastWeek = addDays(mondayOf(day), -7), thisMonday = mondayOf(day);
  if ((day > thisMonday || hour >= 8) && shiftDays.some(d => d >= lastWeek && d < thisMonday) && !has('weekly', lastWeek)) push('weekly', lastWeek, `Báo cáo tuần ${lastWeek.slice(8)}/${lastWeek.slice(5, 7)}`);
  const month = day.slice(0, 7), prev = prevMonth(month), lastDay = addDays(nextMonth(month) + '-01', -1);
  const opened = (m: string) => shiftDays.some(d => d.startsWith(m)); // chỉ nhắc tháng cửa hàng có mở ca
  for (const kind of ['monthly', 'stocktake'] as const) {
    if (+day.slice(8) <= 10 && opened(prev) && !has(kind, prev)) push(kind, prev, `${STORE_REPORT_LABEL[kind]} ${prev.slice(5)}/${prev.slice(0, 4)}`);
    if (day === lastDay && hour >= 8 && opened(month) && !has(kind, month)) push(kind, month, `${STORE_REPORT_LABEL[kind]} ${month.slice(5)}/${month.slice(0, 4)}`);
  }
  return out;
}

// ---------------- Nộp chính thức / nháp
/**
 * Thời điểm kỳ kết thúc = sớm nhất được NỘP CHÍNH THỨC (nháp lưu được bất cứ lúc nào sau khi kỳ bắt đầu):
 *  ngày → từ 00h00 chính ngày đó (báo cáo trong ngày, hạn 22h; ca còn mở thì số liệu là tạm tính);
 *  tuần → 00h00 thứ Hai tuần sau; tháng / kiểm tồn → 00h00 ngày 01 tháng sau.
 */
export function periodEndsAt(kind: StoreReportKind, period: string) {
  if (kind === 'daily') return vnAt(period, 0);
  if (kind === 'weekly') return vnAt(addDays(period, 7), 0);
  return vnAt(nextMonth(period) + '-01', 0);
}
export const canSubmitOfficial = (kind: StoreReportKind, period: string, nowIso: string) => nowIso >= periodEndsAt(kind, period);

// ---------------- Báo cáo ngày: tiền phải nộp (nguồn sổ quỹ)
export const DEPOSIT_SCHEDULES = ['daily', 'periodic'] as const;
export type DepositSchedule = typeof DEPOSIT_SCHEDULES[number];
export const DEPOSIT_SCHEDULE_LABEL: Record<DepositSchedule, string> = { daily: 'Nộp hằng ngày', periodic: 'Nộp theo đợt (không bắt buộc mỗi ngày)' };
export const CASH_MISSING_LABEL = {
  opening: 'Chưa có tiền đầu ngày (chưa mở ca)',
  retained: 'Chưa cấu hình quỹ được giữ lại tại cửa hàng',
  schedule: 'Chưa cấu hình lịch nộp tiền',
} as const;
export type CashMissing = keyof typeof CASH_MISSING_LABEL;
export interface CashDayInput {
  /** Tiền đầu ngày = tiền thực đếm lúc mở ca ĐẦU TIÊN của ngày (tiền bàn giao giữa các ca không cộng lại). */
  opening: number | null;
  /** Thu tiền mặt: bán hàng + COD thực nhận + Thu khác / Rút két (phiếu đã ghi). */
  cashIn: number;
  /** Chi hợp lệ: chi vặt, tạm ứng, hoàn tiền khách (phiếu đã ghi). Không gồm nộp két. */
  spent: number;
  /** Đã nộp theo sổ quỹ (phiếu "Nộp két" đã ghi) – không trừ lần nữa khi tính tiền phải nộp. */
  depositedBook: number;
  /** Quỹ được giữ lại tại cửa hàng (cấu hình); null = chưa cấu hình. */
  retained: number | null;
  schedule: DepositSchedule | null;
  /** Số CHT khai đã nộp ngân hàng; null = chưa khai. */
  declared: number | null;
}
/**
 * Tiền phải nộp = tiền đầu ngày + thu tiền mặt − chi hợp lệ − quỹ được giữ lại (không âm).
 * Thiếu căn cứ (đầu ngày / quỹ giữ lại / lịch nộp) → không tính, nêu rõ thiếu gì; KHÔNG tự coi là 0.
 * Chênh lệch chỉ để giải trình – không tự đánh dấu sai sổ quỹ hay trừ Tiền Trách nhiệm (người duyệt quyết định).
 */
export function cashDue(x: CashDayInput) {
  const missing: CashMissing[] = [];
  if (x.opening === null) missing.push('opening');
  if (x.retained === null) missing.push('retained');
  if (x.schedule === null) missing.push('schedule');
  const available = (x.opening ?? 0) + x.cashIn - x.spent;
  const due = missing.length ? null : Math.max(0, available - x.retained!);
  const requiredToday = x.schedule === 'daily';
  const declaredDiff = due !== null && x.declared !== null ? x.declared - due : null;
  const bookDiff = x.declared !== null ? x.declared - x.depositedBook : null;
  const needsExplanation = (declaredDiff !== null && declaredDiff !== 0 && (requiredToday || x.declared! > 0)) || (bookDiff !== null && bookDiff !== 0);
  return { available, due, requiredToday, missing, missingLabels: missing.map(k => CASH_MISSING_LABEL[k]), declared: x.declared, depositedBook: x.depositedBook, declaredDiff, bookDiff, needsExplanation };
}
