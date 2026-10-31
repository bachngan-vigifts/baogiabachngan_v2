import { sql } from 'drizzle-orm';
import { pgTable, text, doublePrecision, boolean, index, primaryKey, check } from 'drizzle-orm/pg-core';
import { enumCheck } from '../../core/db/enum-check.ts';
import { employees } from '../staff/schema.ts';
import { ADJUSTMENT_KINDS, ATTENDANCE_STATUSES, PAYROLL_GROUPS, PAYSLIP_STATUSES, RESPONSIBILITY_MODES } from './domain/payroll.ts';

/*
 * Nhân sự – bảng lương theo file "Bảng lương mẫu" (3 bảng: Sale & VP, Bách Ngân, Lock).
 *
 *   hr_payroll_settings  (áp dụng từ tháng)  tham số công ty: công chuẩn, LCB vùng, phụ cấp, tỷ lệ thưởng… (domain/params.ts)
 *   hr_payroll_months    (tháng)             số liệu chung của nhóm: DS cửa hàng Bách Ngân, DS TB 6 tháng, DS team Lock, chi thưởng quý
 *   staff_members 1 ── * hr_salary_profiles  hồ sơ lương từng người (áp dụng từ tháng): nhóm, vị trí, LCB, hệ số năng lực, phụ cấp, BHXH, ngân hàng…
 *                 1 ── * hr_attendance       chấm công từng ngày (đủ / nửa công / nghỉ…)
 *                 1 ── * hr_payroll_inputs   số liệu tháng: ngày công (nếu nhập tay), giờ tăng ca, DS, sản lượng, KPI CV, BHYT, TNCN, thưởng quý
 *                 1 ── * hr_adjustments      khoản nhiều dòng có lý do: thưởng khác, công tác, vi phạm, tạm ứng, tạm ứng điện thoại
 *                 1 ── * hr_payslips         phiếu lương ĐÃ CHỐT: tổng + toàn bộ chi tiết (JSON) chụp lúc chốt
 *
 * Tháng đã chốt lương thì khoá: không sửa ngày công / số liệu tháng / thưởng phạt của tháng đó (mở lại phiếu trước).
 * Công thức ở domain/payroll.ts (+ kpi-cv.ts, params.ts).
 */
export const hrSalaryProfiles = pgTable('hr_salary_profiles', {
  memberId: text('member_id').notNull().references(() => employees.id),
  /** Áp dụng từ tháng (YYYY-MM). */
  effectiveMonth: text('effective_month').notNull(),
  /** Bảng lương: sale (Sale & VP) / bn (Bách Ngân) / lock. */
  payrollGroup: text('payroll_group', { enum: PAYROLL_GROUPS }).notNull().default('sale'),
  /** Vị trí ghi trên bảng lương: SALE, KẾ TOÁN, KHO, TK, IT-WEB, NVBH, CHT, TV… */
  positionLabel: text('position_label').notNull().default(''),
  /** LCB / lương thoả thuận; 0 = LCB vùng (tham số). */
  baseSalary: doublePrecision('base_salary').notNull().default(0),
  capacityCoef: doublePrecision('capacity_coef').notNull().default(0),
  responsibilityMode: text('responsibility_mode', { enum: RESPONSIBILITY_MODES }).notNull().default('fixed'),
  responsibility: doublePrecision('responsibility').notNull().default(0),
  /** Hưởng phụ cấp cơm + xăng (thử việc: không). */
  mealAllowance: boolean('meal_allowance').notNull().default(true),
  phoneAllowance: doublePrecision('phone_allowance').notNull().default(0),
  /** Chuyên cần (Bách Ngân, Lock). */
  attendanceBonus: doublePrecision('attendance_bonus').notNull().default(0),
  /** Sale: tính KPI CV + thưởng KPI DS. */
  kpiEnabled: boolean('kpi_enabled').notNull().default(false),
  fixedKpi: doublePrecision('fixed_kpi'),
  contractBonusEnabled: boolean('contract_bonus_enabled').notNull().default(false),
  /** Bách Ngân / Lock: hưởng thưởng DS của nhóm. */
  teamBonus: boolean('team_bonus').notNull().default(false),
  /** Đơn giá / tỷ lệ thưởng sản lượng (kho 15.000/đơn, TK 30.000/lượt, IT 0,005 × DS web). */
  outputRate: doublePrecision('output_rate').notNull().default(0),
  /** Chỉ tiêu DS cá nhân / tháng (KPI CV, thưởng quý); 0 = mặc định ở tham số. */
  revenueTarget: doublePrecision('revenue_target').notNull().default(0),
  /** BHXH người lao động đóng (trừ vào lương). */
  insurance: doublePrecision('insurance').notNull().default(0),
  /** Tài khoản nhận lương (mã ngân hàng theo VietQR: vcb, acb, vietinbank…). */
  bankCode: text('bank_code').notNull().default(''),
  bankAccount: text('bank_account').notNull().default(''),
  bankHolder: text('bank_holder').notNull().default(''),
  note: text('note').notNull().default(''),
  updatedBy: text('updated_by').references(() => employees.id),
  updatedAt: text('updated_at').notNull(),
}, t => [
  primaryKey({ columns: [t.memberId, t.effectiveMonth] }),
  check('chk_hr_salary_month', sql`${t.effectiveMonth} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
  check('chk_hr_salary_money', sql`${t.baseSalary} >= 0 AND ${t.revenueTarget} >= 0 AND ${t.insurance} >= 0`),
  check('chk_hr_salary_extra', sql`${t.capacityCoef} >= 0 AND ${t.responsibility} >= 0 AND ${t.phoneAllowance} >= 0 AND ${t.attendanceBonus} >= 0 AND ${t.outputRate} >= 0`),
  check('chk_hr_fixed_kpi',sql`${t.fixedKpi} is null or (${t.fixedKpi}>=0 and ${t.fixedKpi}<=10)`),
  enumCheck('chk_hr_salary_group', t.payrollGroup, PAYROLL_GROUPS),
  enumCheck('chk_hr_salary_resp_mode', t.responsibilityMode, RESPONSIBILITY_MODES),
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
  payrollGroup: text('payroll_group', { enum: PAYROLL_GROUPS }).notNull().default('sale'),
  workDays: doublePrecision('work_days').notNull().default(0),
  gross: doublePrecision('gross').notNull(),
  deductionTotal: doublePrecision('deduction_total').notNull().default(0),
  net: doublePrecision('net').notNull(),
  /** Toàn bộ phiếu lương lúc chốt (các khoản, ghi chú cách tính, KPI CV, tham số) – JSON. */
  data: text('data').notNull().default('{}'),
  note: text('note').notNull().default(''),
  confirmedBy: text('confirmed_by').references(() => employees.id),
  confirmedAt: text('confirmed_at').notNull(),
  paidAt: text('paid_at'),
}, t => [
  primaryKey({ columns: [t.memberId, t.month] }),
  index('idx_hr_payslips_month').on(t.month, t.status),
  enumCheck('chk_hr_payslips_status', t.status, PAYSLIP_STATUSES),
  enumCheck('chk_hr_payslips_group', t.payrollGroup, PAYROLL_GROUPS),
]).enableRLS();

/** Tham số lương công ty, áp dụng từ tháng (JSON các khoá ở domain/params.ts; thiếu khoá → mặc định). */
export const hrPayrollSettings = pgTable('hr_payroll_settings', {
  effectiveMonth: text('effective_month').primaryKey(),
  params: text('params').notNull().default('{}'),
  updatedBy: text('updated_by').references(() => employees.id),
  updatedAt: text('updated_at').notNull(),
}, t => [check('chk_hr_settings_month', sql`${t.effectiveMonth} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`)]).enableRLS();

/** Số liệu chung của các nhóm trong tháng. */
export const hrPayrollMonths = pgTable('hr_payroll_months', {
  month: text('month').primaryKey(),
  /** DS thực hiện cửa hàng Bách Ngân và DS trung bình 6 tháng (xét thưởng DS Bách Ngân). */
  bnRevenue: doublePrecision('bn_revenue').notNull().default(0),
  bnAvgRevenue: doublePrecision('bn_avg_revenue').notNull().default(0),
  /** DS team Lock (xét thưởng DS Lock). */
  lockRevenue: doublePrecision('lock_revenue').notNull().default(0),
  /** Chi trả thưởng quý team Sale trong kỳ lương này (tháng cuối quý). */
  payQuarterBonus: boolean('pay_quarter_bonus').notNull().default(false),
  note: text('note').notNull().default(''),
  updatedBy: text('updated_by').references(() => employees.id),
  updatedAt: text('updated_at').notNull(),
}, t => [
  check('chk_hr_months_month', sql`${t.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
  check('chk_hr_months_money', sql`${t.bnRevenue} >= 0 AND ${t.bnAvgRevenue} >= 0 AND ${t.lockRevenue} >= 0`),
]).enableRLS();

/** Số liệu lương nhập theo tháng của từng người (cột nền vàng trên bảng lương). null = lấy tự động. */
export const hrPayrollInputs = pgTable('hr_payroll_inputs', {
  memberId: text('member_id').notNull().references(() => employees.id),
  month: text('month').notNull(),
  /** Ngày làm việc nhập tay; null = theo chấm công. */
  workDays: doublePrecision('work_days'),
  overtimeHours: doublePrecision('overtime_hours').notNull().default(0),
  /** DS tháng (Sale – thưởng KPI DS); null = DS đơn hàng trên hệ thống. */
  revenue: doublePrecision('revenue'),
  outputQty: doublePrecision('output_qty').notNull().default(0),
  kpiNewCustomers: doublePrecision('kpi_new_customers'),
  kpiTransactions: doublePrecision('kpi_transactions'),
  kpiContracts: doublePrecision('kpi_contracts'),
  kpiRevenue: doublePrecision('kpi_revenue'),
  kpiMerchDays: doublePrecision('kpi_merch_days').notNull().default(0),
  kpiTripDays: doublePrecision('kpi_trip_days').notNull().default(0),
  /** KPI chốt (1 = 100%) – thay kết quả tính. */
  kpiOverride: doublePrecision('kpi_override'),
  healthInsurance: doublePrecision('health_insurance').notNull().default(0),
  incomeTax: doublePrecision('income_tax').notNull().default(0),
  /** Thưởng quý nhập tay; null = tự tính. */
  quarterBonus: doublePrecision('quarter_bonus'),
  note: text('note').notNull().default(''),
  updatedBy: text('updated_by').references(() => employees.id),
  updatedAt: text('updated_at').notNull(),
}, t => [
  primaryKey({ columns: [t.memberId, t.month] }),
  index('idx_hr_inputs_month').on(t.month),
  check('chk_hr_inputs_month', sql`${t.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
  check('chk_hr_inputs_values', sql`coalesce(${t.workDays}, 0) >= 0 AND ${t.overtimeHours} >= 0 AND coalesce(${t.revenue}, 0) >= 0 AND ${t.outputQty} >= 0 AND ${t.healthInsurance} >= 0 AND ${t.incomeTax} >= 0 AND coalesce(${t.quarterBonus}, 0) >= 0`),
]).enableRLS();
