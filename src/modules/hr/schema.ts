import { sql } from 'drizzle-orm';
import { pgTable, text, doublePrecision, index, primaryKey, check } from 'drizzle-orm/pg-core';
import { enumCheck } from '../../core/db/enum-check.ts';
import { employees } from '../staff/schema.ts';
import { ADJUSTMENT_KINDS, ATTENDANCE_STATUSES, PAYSLIP_STATUSES, PAY_SCHEMES } from './domain/payroll.ts';

/*
 * Nhân sự: lương, ngày công, thưởng / phạt, phiếu lương.
 *
 *   staff_members 1 ── * hr_salary_profiles  (mức lương theo tháng áp dụng; tháng X dùng bản mới nhất có effective_month ≤ X)
 *                 1 ── * hr_attendance       (mỗi ngày một dòng: đủ công / nửa công / nghỉ…)
 *                 1 ── * hr_adjustments      (thưởng, phụ cấp thêm, khấu trừ, tạm ứng – gắn tháng)
 *                 1 ── * hr_month_inputs     (số liệu nhập theo tháng cho bảng lương Sale / Bách Ngân / Lock: KPI, DS TB 6 tháng, tăng ca…)
 *                 1 ── * hr_payslips         (phiếu lương ĐÃ CHỐT của tháng: chụp lại số liệu + từng dòng, sửa dữ liệu sau không làm đổi)
 *
 * Tháng đã chốt lương thì khoá: không sửa ngày công / thưởng phạt của tháng đó (mở lại phiếu trước).
 * Công thức tính ở domain/payroll.ts.
 */
export const hrSalaryProfiles = pgTable('hr_salary_profiles', {
  memberId: text('member_id').notNull().references(() => employees.id),
  /** Áp dụng từ tháng (YYYY-MM). */
  effectiveMonth: text('effective_month').notNull(),
  baseSalary: doublePrecision('base_salary').notNull().default(0),
  /** Phụ cấp cố định hằng tháng (ăn trưa, xăng xe, điện thoại…). */
  allowance: doublePrecision('allowance').notNull().default(0),
  standardDays: doublePrecision('standard_days').notNull().default(26),
  /** Chỉ tiêu doanh số tháng (KPI). */
  revenueTarget: doublePrecision('revenue_target').notNull().default(0),
  /** % hoa hồng trên doanh số tháng. */
  commissionRate: doublePrecision('commission_rate').notNull().default(0),
  /** Bảo hiểm phần nhân viên đóng (trừ vào lương). */
  insurance: doublePrecision('insurance').notNull().default(0),
  /** Cách tính lương (xem PAY_SCHEMES); `basic` = lương cơ bản + hoa hồng như trước. */
  scheme: text('scheme', { enum: PAY_SCHEMES }).notNull().default('basic'),
  /** Tham số riêng của bảng lương (JSON, xem SchemeParams): hệ số năng lực, trách nhiệm, cơm xăng, đơn giá sản lượng. */
  params: text('params').notNull().default('{}'),
  note: text('note').notNull().default(''),
  updatedBy: text('updated_by').references(() => employees.id),
  updatedAt: text('updated_at').notNull(),
}, t => [
  primaryKey({ columns: [t.memberId, t.effectiveMonth] }),
  enumCheck('chk_hr_salary_scheme', t.scheme, PAY_SCHEMES),
  check('chk_hr_salary_month', sql`${t.effectiveMonth} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
  check('chk_hr_salary_money', sql`${t.baseSalary} >= 0 AND ${t.allowance} >= 0 AND ${t.revenueTarget} >= 0 AND ${t.insurance} >= 0`),
  check('chk_hr_salary_rates', sql`${t.standardDays} > 0 AND ${t.standardDays} <= 31 AND ${t.commissionRate} >= 0 AND ${t.commissionRate} <= 100`),
]).enableRLS();

export const hrAttendance = pgTable('hr_attendance', {
  memberId: text('member_id').notNull().references(() => employees.id),
  workDate: text('work_date').notNull(),
  status: text('status', { enum: ATTENDANCE_STATUSES }).notNull(),
  note: text('note').notNull().default(''),
  recordedBy: text('recorded_by').references(() => employees.id),
  updatedAt: text('updated_at').notNull(),
}, t => [
  primaryKey({ columns: [t.memberId, t.workDate] }),
  enumCheck('chk_hr_attendance_status', t.status, ATTENDANCE_STATUSES),
]).enableRLS();

/** Số liệu nhập theo tháng (JSON, xem MonthInputs). Tháng đã chốt lương thì khoá như ngày công. */
export const hrMonthInputs = pgTable('hr_month_inputs', {
  memberId: text('member_id').notNull().references(() => employees.id),
  month: text('month').notNull(),
  data: text('data').notNull().default('{}'),
  updatedBy: text('updated_by').references(() => employees.id),
  updatedAt: text('updated_at').notNull(),
}, t => [
  primaryKey({ columns: [t.memberId, t.month] }),
  check('chk_hr_month_inputs_month', sql`${t.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
]).enableRLS();

export const hrAdjustments = pgTable('hr_adjustments', {
  id: text('id').primaryKey(),
  memberId: text('member_id').notNull().references(() => employees.id),
  month: text('month').notNull(),
  kind: text('kind', { enum: ADJUSTMENT_KINDS }).notNull(),
  amount: doublePrecision('amount').notNull(),
  reason: text('reason').notNull().default(''),
  createdBy: text('created_by').references(() => employees.id),
  createdAt: text('created_at').notNull(),
}, t => [
  index('idx_hr_adjustments_member').on(t.memberId, t.month),
  enumCheck('chk_hr_adjustments_kind', t.kind, ADJUSTMENT_KINDS),
  check('chk_hr_adjustments_amount', sql`${t.amount} > 0`),
]).enableRLS();

export const hrPayslips = pgTable('hr_payslips', {
  memberId: text('member_id').notNull().references(() => employees.id),
  month: text('month').notNull(),
  status: text('status', { enum: PAYSLIP_STATUSES }).notNull().default('confirmed'),
  standardDays: doublePrecision('standard_days').notNull(),
  workedDays: doublePrecision('worked_days').notNull(),
  baseSalary: doublePrecision('base_salary').notNull(),
  salaryByDays: doublePrecision('salary_by_days').notNull(),
  allowance: doublePrecision('allowance').notNull(),
  revenue: doublePrecision('revenue').notNull(),
  commissionRate: doublePrecision('commission_rate').notNull(),
  commission: doublePrecision('commission').notNull(),
  bonus: doublePrecision('bonus').notNull(),
  extraAllowance: doublePrecision('extra_allowance').notNull(),
  deduction: doublePrecision('deduction').notNull(),
  advance: doublePrecision('advance').notNull(),
  insurance: doublePrecision('insurance').notNull(),
  gross: doublePrecision('gross').notNull(),
  net: doublePrecision('net').notNull(),
  /** Cách tính và từng dòng của phiếu lúc chốt (JSON, mảng PayLine) – để in phiếu đúng như lúc chốt. */
  scheme: text('scheme', { enum: PAY_SCHEMES }).notNull().default('basic'),
  lines: text('lines').notNull().default('[]'),
  note: text('note').notNull().default(''),
  confirmedBy: text('confirmed_by').references(() => employees.id),
  confirmedAt: text('confirmed_at').notNull(),
  paidAt: text('paid_at'),
}, t => [
  primaryKey({ columns: [t.memberId, t.month] }),
  index('idx_hr_payslips_month').on(t.month, t.status),
  enumCheck('chk_hr_payslips_status', t.status, PAYSLIP_STATUSES),
  enumCheck('chk_hr_payslips_scheme', t.scheme, PAY_SCHEMES),
]).enableRLS();
