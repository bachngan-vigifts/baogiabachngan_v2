/**
 * Nhân sự – lương, thưởng, ngày công: cấu hình + công thức (một chỗ duy nhất để sửa, hàm thuần, test không cần DB).
 *
 *   Lương theo ngày công = Lương cơ bản × Ngày công thực tế / Ngày công chuẩn
 *   Hoa hồng            = Doanh số tháng (đơn đã xác nhận, gồm VAT) × % hoa hồng
 *   Tổng thu nhập       = Lương theo ngày công + Phụ cấp cố định + Phụ cấp thêm + Thưởng + Hoa hồng
 *   Thực lĩnh           = Tổng thu nhập − Khấu trừ − Bảo hiểm (phần NV đóng) − Tạm ứng
 */
export const ATTENDANCE_STATUSES = ['present', 'half', 'paid_leave', 'unpaid_leave', 'absent'] as const;
export type AttendanceStatus = typeof ATTENDANCE_STATUSES[number];
/** Số công của mỗi trạng thái. */
export const ATTENDANCE_CREDIT: Record<AttendanceStatus, number> = { present: 1, half: 0.5, paid_leave: 1, unpaid_leave: 0, absent: 0 };
export const ATTENDANCE_LABEL: Record<AttendanceStatus, string> = { present: 'Đủ công', half: 'Nửa công', paid_leave: 'Nghỉ có lương', unpaid_leave: 'Nghỉ không lương', absent: 'Vắng' };

/** Khoản cộng / trừ trong tháng ngoài lương cơ bản. */
export const ADJUSTMENT_KINDS = ['bonus', 'allowance', 'deduction', 'advance'] as const;
export type AdjustmentKind = typeof ADJUSTMENT_KINDS[number];
export const ADJUSTMENT_LABEL: Record<AdjustmentKind, string> = { bonus: 'Thưởng', allowance: 'Phụ cấp thêm', deduction: 'Khấu trừ / phạt', advance: 'Tạm ứng' };

/** Phiếu lương đã chốt (`confirmed`) → đã trả (`paid`). Chưa chốt = tạm tính, không lưu. */
export const PAYSLIP_STATUSES = ['confirmed', 'paid'] as const;
export type PayslipStatus = typeof PAYSLIP_STATUSES[number];

export const DEFAULT_STANDARD_DAYS = 26;
export const HR_LIMITS = { maxSalary: 10_000_000_000, maxAmount: 10_000_000_000, reason: 500, note: 500 } as const;

// ---------------- Tháng
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const isMonth = (v: unknown): v is string => typeof v === 'string' && MONTH_RE.test(v);
export function daysInMonth(month: string) { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y!, m!, 0)).getUTCDate(); }
/** Ngày đầu / cuối tháng (YYYY-MM-DD) và tháng sau (để so sánh `<`). */
export function monthRange(month: string) {
  const days = daysInMonth(month);
  return { from: `${month}-01`, to: `${month}-${String(days).padStart(2, '0')}`, next: shiftMonth(month, 1) + '-01', days };
}
export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split('-').map(Number), d = new Date(Date.UTC(y!, m! - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
export const inMonth = (date: string | null | undefined, month: string) => !!date && date.slice(0, 7) === month;

// ---------------- Ngày công
export interface AttendanceSummary { worked: number; present: number; half: number; paidLeave: number; unpaidLeave: number; absent: number; recorded: number }
export function summarizeAttendance(rows: readonly { status: string }[]): AttendanceSummary {
  const s: AttendanceSummary = { worked: 0, present: 0, half: 0, paidLeave: 0, unpaidLeave: 0, absent: 0, recorded: 0 };
  for (const r of rows) {
    const st = r.status as AttendanceStatus;
    if (!(st in ATTENDANCE_CREDIT)) continue;
    s.worked += ATTENDANCE_CREDIT[st]; s.recorded++;
    if (st === 'present') s.present++; else if (st === 'half') s.half++; else if (st === 'paid_leave') s.paidLeave++; else if (st === 'unpaid_leave') s.unpaidLeave++; else s.absent++;
  }
  return s;
}

// ---------------- Lương
/**
 * Cách tính lương của từng người:
 *  - `basic`    : lương cơ bản + phụ cấp + hoa hồng (cách cũ, mặc định);
 *  - `sale`     : bảng LƯƠNG SALE (kèm kế toán, admin, kho, thiết kế, IT, thử việc);
 *  - `bachngan` : bảng LƯƠNG BÁCH NGÂN;
 *  - `lock`     : bảng LƯƠNG LOCK.
 */
export const PAY_SCHEMES = ['basic', 'sale', 'bachngan', 'lock'] as const;
export type PayScheme = typeof PAY_SCHEMES[number];
export const PAY_SCHEME_LABEL: Record<PayScheme, string> = { basic: 'Lương cơ bản + hoa hồng', sale: 'Bảng lương Sale', bachngan: 'Bảng lương Bách Ngân', lock: 'Bảng lương Lock' };
export const RESPONSIBILITY_MODES = ['fixed', 'per_day', 'prorated'] as const;
export type ResponsibilityMode = typeof RESPONSIBILITY_MODES[number];

/** Tham số riêng từng người (cố định theo mức lương áp dụng). */
export interface SchemeParams {
  /** Hệ số năng lực × PAY.capabilityRate = phụ cấp năng lực. */
  capabilityCoef: number;
  /** Trách nhiệm: số tiền cố định / đơn giá mỗi ngày công / số tiền theo tỷ lệ ngày công (theo `responsibilityMode`). */
  responsibility: number;
  responsibilityMode: ResponsibilityMode;
  /** Hưởng phụ cấp cơm + xăng (thử việc thường không). */
  meal: boolean;
  /** Thưởng sản lượng = sản lượng tháng × đơn giá (kho 15.000/đơn, TK 30.000/lượt) hoặc × tỷ lệ (IT-Web 0,005). */
  outputRate: number;
}
export const EMPTY_PARAMS: SchemeParams = { capabilityCoef: 0, responsibility: 0, responsibilityMode: 'fixed', meal: false, outputRate: 0 };

export interface SalaryProfile {
  baseSalary: number; allowance: number; standardDays: number; revenueTarget: number; commissionRate: number; insurance: number;
  scheme: PayScheme; params: SchemeParams;
}
export const EMPTY_PROFILE: SalaryProfile = { baseSalary: 0, allowance: 0, standardDays: DEFAULT_STANDARD_DAYS, revenueTarget: 0, commissionRate: 0, insurance: 0, scheme: 'basic', params: EMPTY_PARAMS };

/** Đọc `params` lưu dạng JSON, bỏ giá trị lạ. */
export function parseParams(raw: unknown): SchemeParams {
  let o: Record<string, unknown> = {};
  if (typeof raw === 'string') { try { o = JSON.parse(raw) ?? {}; } catch { o = {}; } } else if (raw && typeof raw === 'object') o = raw as Record<string, unknown>;
  const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= HR_LIMITS.maxSalary ? n : 0; };
  return {
    capabilityCoef: num(o.capabilityCoef), responsibility: num(o.responsibility),
    responsibilityMode: (RESPONSIBILITY_MODES as readonly unknown[]).includes(o.responsibilityMode) ? o.responsibilityMode as ResponsibilityMode : 'fixed',
    meal: o.meal === true, outputRate: num(o.outputRate),
  };
}

export interface PayslipFigures {
  standardDays: number; workedDays: number; baseSalary: number; salaryByDays: number; allowance: number;
  revenue: number; commissionRate: number; commission: number;
  bonus: number; extraAllowance: number; deduction: number; advance: number; insurance: number; gross: number; net: number;
}
const round = (n: number) => Math.round(n);
export function computePayslip(input: { profile: SalaryProfile; workedDays: number; revenue: number; adjustments: readonly { kind: string; amount: number }[] }): PayslipFigures {
  const p = input.profile, std = p.standardDays > 0 ? p.standardDays : DEFAULT_STANDARD_DAYS;
  const sum = (k: AdjustmentKind) => input.adjustments.filter(a => a.kind === k).reduce((s, a) => s + a.amount, 0);
  const salaryByDays = round(p.baseSalary * input.workedDays / std), commission = round(input.revenue * p.commissionRate / 100);
  const bonus = sum('bonus'), extraAllowance = sum('allowance'), deduction = sum('deduction'), advance = sum('advance');
  const gross = salaryByDays + p.allowance + extraAllowance + bonus + commission;
  return {
    standardDays: std, workedDays: input.workedDays, baseSalary: p.baseSalary, salaryByDays, allowance: p.allowance,
    revenue: input.revenue, commissionRate: p.commissionRate, commission, bonus, extraAllowance, deduction, advance, insurance: p.insurance,
    gross, net: gross - deduction - p.insurance - advance,
  };
}

/** % hoàn thành chỉ tiêu doanh số (null = chưa đặt chỉ tiêu). */
export const targetPercent = (revenue: number, target: number) => target > 0 ? Math.round(revenue / target * 1000) / 10 : null;


// =====================================================================================================================
// Bảng lương theo từng nhóm (chuyển từ file Excel LƯƠNG SALE / BÁCH NGÂN / LOCK). Một chỗ duy nhất để đổi mức & tỷ lệ.
// =====================================================================================================================
export const PAY = {
  /** Phụ cấp năng lực: 1 hệ số = 1.600.000 ÷ 8. */
  capabilityRate: 200_000,
  mealPerDay: 25_000, fuelPerDay: 25_000,
  /** Số ngày chuẩn và số giờ/ngày để tính đơn giá giờ tăng ca; tăng ca tính x2. */
  overtimeDays: 24, hoursPerDay: 8, overtimeFactor: 2,
  /** Ngày trừ cơm mặc định theo bảng lương (có thể ghi đè theo tháng). */
  mealDeductDays: { sale: 0, bachngan: 1, lock: 0 } as Record<'sale' | 'bachngan' | 'lock', number>,
  /** Sale: thưởng KPI DS = DS tháng × tỷ lệ theo KPI CV. */
  saleKpi: { high: 0.9, highRate: 0.012, low: 0.6, lowRate: 0.005 },
  /** Bách Ngân: chỉ xét thưởng khi DS tháng > `minRevenue`; so với DS trung bình 6 tháng; chia cho `split` người. */
  bachngan: { minRevenue: 300_000_000, level1: 1, rate1: 0.01, level2: 0.85, rate2: 0.005, split: 2 },
  /** Lock: thưởng theo DS team, chia cho `split` người. */
  lock: { target: 300_000_000, floor: 0.85, highRevenue: 310_000_000, highRate: 0.015, rate: 0.01, split: 2 },
  /** KPI công việc của Sale (mỗi ngày làm hàng / công tác được cộng thêm KH mới và giao dịch). */
  kpi: {
    newCustomers: { target: 96, weight: 0.1, overScore: 0.2 }, transactions: { target: 260, weight: 0.3 },
    contracts: { target: 8, weight: 0.1 }, revenue: { target: 415_000_000, weight: 0.5 },
    perHangDay: { newCustomers: 4, transactions: 10 },
  },
} as const;

/** Số liệu nhập mỗi tháng cho từng người (ngoài ngày công, thưởng/phạt đã có). Tiền: đồng; tỷ lệ: 0–1. */
export interface MonthInputs {
  /** KPI CV chốt thẳng (0–1.5…); không có thì tính từ các số thực hiện bên dưới. */
  kpiOverride?: number;
  kpiNewCustomers?: number; kpiTransactions?: number; kpiContracts?: number; kpiHangDays?: number;
  /** DS tháng ghi đè (không có thì lấy doanh số hệ thống). Lock: DS cả team. */
  revenue?: number;
  /** Bách Ngân: DS trung bình 6 tháng. */
  avgRevenue6?: number;
  outputQty?: number; otherBonus?: number; quarterBonus?: number;
  overtimeHours?: number; attendanceBonus?: number; businessTrip?: number; phone?: number;
  violation?: number; phoneAdvance?: number; bhyt?: number; tncn?: number;
  mealDeductDays?: number;
}
export const MONTH_INPUT_KEYS = ['kpiOverride', 'kpiNewCustomers', 'kpiTransactions', 'kpiContracts', 'kpiHangDays', 'revenue', 'avgRevenue6', 'outputQty', 'otherBonus', 'quarterBonus',
  'overtimeHours', 'attendanceBonus', 'businessTrip', 'phone', 'violation', 'phoneAdvance', 'bhyt', 'tncn', 'mealDeductDays'] as const satisfies readonly (keyof MonthInputs)[];

/** Đọc dữ liệu tháng lưu dạng JSON: chỉ giữ khoá hợp lệ và số không âm. */
export function parseMonthInputs(raw: unknown): MonthInputs {
  let o: Record<string, unknown> = {};
  if (typeof raw === 'string') { try { o = JSON.parse(raw) ?? {}; } catch { o = {}; } } else if (raw && typeof raw === 'object') o = raw as Record<string, unknown>;
  const out: MonthInputs = {};
  for (const k of MONTH_INPUT_KEYS) {
    const v = o[k]; if (v === '' || v === null || v === undefined) continue;
    const n = Number(v); if (Number.isFinite(n) && n >= 0 && n <= 1e13) out[k] = n;
  }
  return out;
}

/** Một dòng trên phiếu lương. `income` cộng vào tổng thu nhập, `deduction` trừ vào thực lĩnh. */
export interface PayLine { key: string; label: string; amount: number; type: 'income' | 'deduction'; note?: string }
export type PayrollResult = PayslipFigures & { scheme: PayScheme; lines: PayLine[]; kpiCv: number | null };

/** KPI công việc của Sale (sheet KPI CV): KH mới (vượt chỉ tiêu được 20%), giao dịch (tối đa 30%), số HĐ (tối đa 100%), DS cá nhân (không giới hạn). */
export function computeKpiCv(i: { newCustomers: number; transactions: number; contracts: number; revenue: number; hangDays: number }): number {
  const k = PAY.kpi, nc = i.newCustomers + k.perHangDay.newCustomers * i.hangDays, tx = i.transactions + k.perHangDay.transactions * i.hangDays;
  const scoreNc = nc > k.newCustomers.target ? k.newCustomers.overScore : nc / k.newCustomers.target * k.newCustomers.weight;
  const scoreTx = tx > k.transactions.target ? k.transactions.weight : tx / k.transactions.target * k.transactions.weight;
  const scoreCt = (i.contracts >= k.contracts.target ? 1 : i.contracts / k.contracts.target) * k.contracts.weight;
  const scoreRv = i.revenue / k.revenue.target * k.revenue.weight;
  return scoreNc + scoreTx + scoreCt + scoreRv;
}

const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
const vnd = (v: number) => Math.round(v).toLocaleString('vi-VN');

/** Tính phiếu lương theo `profile.scheme`. `basic` giữ nguyên cách cũ (kèm danh sách dòng để in). */
export function computePayroll(input: {
  profile: SalaryProfile; workedDays: number; revenue: number; adjustments: readonly { kind: string; amount: number }[]; inputs?: MonthInputs;
}): PayrollResult {
  const p = input.profile;
  if (p.scheme === 'basic') {
    const f = computePayslip(input), L: PayLine[] = [];
    const add = (key: string, label: string, amount: number, type: PayLine['type'], note?: string) => { if (amount) L.push({ key, label, amount, type, ...(note ? { note } : {}) }); };
    add('salary', 'Lương theo ngày công', f.salaryByDays, 'income', `${vnd(f.baseSalary)} × ${f.workedDays} / ${f.standardDays} công`);
    add('allowance', 'Phụ cấp cố định', f.allowance, 'income'); add('extra', 'Phụ cấp thêm', f.extraAllowance, 'income');
    add('bonus', 'Thưởng', f.bonus, 'income'); add('commission', 'Hoa hồng', f.commission, 'income', `${vnd(f.revenue)} × ${f.commissionRate}%`);
    add('deduction', 'Khấu trừ / phạt', f.deduction, 'deduction'); add('insurance', 'Bảo hiểm (NV đóng)', f.insurance, 'deduction'); add('advance', 'Tạm ứng', f.advance, 'deduction');
    return { ...f, scheme: 'basic', lines: L, kpiCv: null };
  }

  const m = input.inputs ?? {}, a = p.params, adj = (k: AdjustmentKind) => input.adjustments.filter(x => x.kind === k).reduce((s, x) => s + x.amount, 0);
  const std = p.standardDays > 0 ? p.standardDays : DEFAULT_STANDARD_DAYS, worked = input.workedDays, scheme = p.scheme;
  const revenue = m.revenue ?? input.revenue;
  const salaryByDays = round(p.baseSalary * worked / std);
  const income: PayLine[] = [], deduct: PayLine[] = [];
  const inc = (key: string, label: string, amount: number, note?: string) => { amount = round(amount); if (amount) income.push({ key, label, amount, type: 'income', ...(note ? { note } : {}) }); return amount; };
  const ded = (key: string, label: string, amount: number, note?: string) => { amount = round(amount); if (amount) deduct.push({ key, label, amount, type: 'deduction', ...(note ? { note } : {}) }); return amount; };

  inc('salary', 'Lương theo ngày công', salaryByDays, `${vnd(p.baseSalary)} × ${worked} / ${std} công`);
  const capability = inc('capability', 'Phụ cấp năng lực', a.capabilityCoef * PAY.capabilityRate, `hệ số ${a.capabilityCoef} × ${vnd(PAY.capabilityRate)}`);
  const resp = a.responsibilityMode === 'per_day' ? a.responsibility * worked : a.responsibilityMode === 'prorated' ? a.responsibility * worked / std : a.responsibility;
  const responsibility = inc('responsibility', 'Trách nhiệm', resp, a.responsibilityMode === 'per_day' ? `${vnd(a.responsibility)} × ${worked} ngày` : a.responsibilityMode === 'prorated' ? `${vnd(a.responsibility)} × ${worked} / ${std}` : undefined);

  let kpiCv: number | null = null, rewardLabel = 'Thưởng doanh số', reward = 0, rewardNote: string | undefined;
  if (scheme === 'sale') {
    kpiCv = m.kpiOverride ?? (m.kpiNewCustomers !== undefined || m.kpiTransactions !== undefined || m.kpiContracts !== undefined
      ? computeKpiCv({ newCustomers: m.kpiNewCustomers ?? 0, transactions: m.kpiTransactions ?? 0, contracts: m.kpiContracts ?? 0, revenue, hangDays: m.kpiHangDays ?? 0 }) : null);
    const k = PAY.saleKpi;
    if (kpiCv !== null && revenue > 0) {
      const rate = kpiCv >= k.high ? k.highRate : kpiCv >= k.low ? k.lowRate : 0;
      reward = revenue * rate; rewardLabel = 'Thưởng KPI doanh số'; rewardNote = `KPI CV ${pct(kpiCv)} · ${vnd(revenue)} × ${pct(rate)}`;
    }
  } else if (scheme === 'bachngan') {
    const b = PAY.bachngan, avg = m.avgRevenue6 ?? 0;
    if (revenue > b.minRevenue && avg > 0) {
      const ratio = revenue / avg, rate = ratio >= b.level1 ? b.rate1 : ratio >= b.level2 ? b.rate2 : 0;
      reward = revenue * rate / b.split; rewardNote = `DS ${vnd(revenue)} = ${pct(ratio)} DS TB 6 tháng · ${pct(rate)} ÷ ${b.split}`;
    }
  } else {
    const l = PAY.lock;
    if (revenue >= l.floor * l.target) {
      const rate = revenue >= l.highRevenue ? l.highRate : l.rate;
      reward = revenue * rate / l.split; rewardNote = `DS team ${vnd(revenue)} × ${pct(rate)} ÷ ${l.split}`;
    }
  }
  const rewardAmt = inc('reward', rewardLabel, reward, rewardNote);
  const output = inc('output', 'Thưởng sản lượng', (m.outputQty ?? 0) * a.outputRate, `${m.outputQty ?? 0} × ${a.outputRate < 1 ? pct(a.outputRate) : vnd(a.outputRate)}`);
  const quarter = inc('quarter', 'Thưởng quý', m.quarterBonus ?? 0);
  const other = inc('other', 'Thưởng khác', (m.otherBonus ?? 0) + adj('bonus'));

  const mealDays = Math.max(0, worked - (m.mealDeductDays ?? PAY.mealDeductDays[scheme]));
  const meal = a.meal ? inc('meal', 'Cơm + xăng', (PAY.mealPerDay + PAY.fuelPerDay) * mealDays, `${vnd(PAY.mealPerDay + PAY.fuelPerDay)} × ${mealDays} ngày`) : 0;
  const phone = inc('phone', 'Điện thoại', m.phone ?? 0);
  const attendance = inc('attendance', 'Chuyên cần', m.attendanceBonus ?? 0);
  const trip = inc('trip', 'Công tác', m.businessTrip ?? 0);
  const otBase = scheme === 'lock' ? salaryByDays : p.baseSalary, hours = m.overtimeHours ?? 0;
  const overtime = inc('overtime', 'Tăng ca', otBase / PAY.overtimeDays / PAY.hoursPerDay * hours * PAY.overtimeFactor, `${hours} giờ × ${PAY.overtimeFactor}`);
  const extra = inc('extra', 'Phụ cấp thêm', adj('allowance')), fixed = inc('fixed', 'Phụ cấp cố định', p.allowance);

  const gross = income.reduce((s, l) => s + l.amount, 0);
  // Sale: tạm ứng điện thoại cấn trừ với phụ cấp điện thoại – trừ phần lớn hơn (đúng như file Excel).
  const phoneOffset = scheme === 'sale' ? Math.max(m.phoneAdvance ?? 0, m.phone ?? 0) : 0;
  const violation = ded('violation', 'Vi phạm', m.violation ?? 0);
  const deduction = violation + ded('deduction', 'Khấu trừ / phạt', adj('deduction')) + ded('phone-offset', 'Cấn trừ điện thoại', phoneOffset, 'tạm ứng ĐT hoặc phụ cấp ĐT (lấy số lớn hơn)');
  const insurance = ded('bhxh', 'BHXH', p.insurance) + ded('bhyt', 'BHYT', m.bhyt ?? 0) + ded('tncn', 'TNCN', m.tncn ?? 0);
  const advance = ded('advance', 'Tạm ứng', adj('advance'));

  return {
    scheme, kpiCv, lines: [...income, ...deduct],
    standardDays: std, workedDays: worked, baseSalary: p.baseSalary, salaryByDays, allowance: capability + responsibility + fixed,
    revenue, commissionRate: 0, commission: rewardAmt,
    bonus: output + quarter + other, extraAllowance: meal + phone + attendance + trip + overtime + extra,
    deduction, advance, insurance, gross, net: gross - deduction - insurance - advance,
  };
}
