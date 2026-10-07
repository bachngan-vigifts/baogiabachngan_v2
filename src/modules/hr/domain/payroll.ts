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
export interface SalaryProfile { baseSalary: number; allowance: number; standardDays: number; revenueTarget: number; commissionRate: number; insurance: number }
export const EMPTY_PROFILE: SalaryProfile = { baseSalary: 0, allowance: 0, standardDays: DEFAULT_STANDARD_DAYS, revenueTarget: 0, commissionRate: 0, insurance: 0 };

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
