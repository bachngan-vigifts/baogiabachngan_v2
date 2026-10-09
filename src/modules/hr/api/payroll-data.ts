import { and, asc, desc, eq, gte, inArray, isNull, lte, notInArray } from 'drizzle-orm';
import type { AnyDb } from '../../../core/db/client.ts';
import { employees } from '../../staff/schema.ts';
import { hrAdjustments, hrAttendance, hrPayrollInputs, hrPayrollMonths, hrPayrollSettings, hrPayslips, hrSalaryProfiles } from '../schema.ts';
import { mergeParams, type PayrollParams } from '../domain/params.ts';
import {
  EMPTY_GROUP_MONTH, EMPTY_INPUT, computePayslip, defaultProfileFor, computeQuarterBonus, monthRange, quarterMonths, summarizeAttendance,
  type GroupMonth, type PayrollInput, type PayslipCalc, type SalaryProfile,
} from '../domain/payroll.ts';

/**
 * Doanh số đơn hàng trên hệ thống theo người phụ trách và tháng: Map<memberId, { 'YYYY-MM': số tiền }>.
 * Bơm vào từ app/router.ts (module staff-hub) để `hr` không phụ thuộc module bán hàng.
 */
export type RevenueOf = (db: AnyDb, months: readonly string[]) => Promise<Map<string, Record<string, number>>>;

type ProfileRow = typeof hrSalaryProfiles.$inferSelect;
/** Chưa có hồ sơ lương → mặc định theo chức vụ (`effectiveMonth: null`). */
const toProfile = (p: ProfileRow | undefined, positionId?: string | null): SalaryProfile & { effectiveMonth: string | null; note: string } => p ? {
  payrollGroup: p.payrollGroup, positionLabel: p.positionLabel, baseSalary: p.baseSalary, capacityCoef: p.capacityCoef,
  responsibilityMode: p.responsibilityMode, responsibility: p.responsibility, mealAllowance: p.mealAllowance, phoneAllowance: p.phoneAllowance,
  attendanceBonus: p.attendanceBonus, kpiEnabled: p.kpiEnabled, teamBonus: p.teamBonus, outputRate: p.outputRate, revenueTarget: p.revenueTarget,
  insurance: p.insurance, bankCode: p.bankCode, bankAccount: p.bankAccount, bankHolder: p.bankHolder, effectiveMonth: p.effectiveMonth, note: p.note,
} : { ...defaultProfileFor(positionId), effectiveMonth: null, note: '' };
const toInput = (r: typeof hrPayrollInputs.$inferSelect | undefined): PayrollInput & { note: string } => r ? {
  workDays: r.workDays, overtimeHours: r.overtimeHours, revenue: r.revenue, outputQty: r.outputQty, healthInsurance: r.healthInsurance, incomeTax: r.incomeTax,
  quarterBonus: r.quarterBonus, kpiNewCustomers: r.kpiNewCustomers, kpiTransactions: r.kpiTransactions, kpiContracts: r.kpiContracts, kpiRevenue: r.kpiRevenue,
  kpiMerchDays: r.kpiMerchDays, kpiTripDays: r.kpiTripDays, kpiOverride: r.kpiOverride, note: r.note,
} : { ...EMPTY_INPUT, note: '' };

/** Tham số áp dụng cho tháng (bản mới nhất có effective_month ≤ tháng; chưa có → mặc định). */
export async function paramsFor(db: AnyDb, month: string): Promise<{ params: PayrollParams; effectiveMonth: string | null }> {
  const [s] = await db.select().from(hrPayrollSettings).where(lte(hrPayrollSettings.effectiveMonth, month)).orderBy(desc(hrPayrollSettings.effectiveMonth)).limit(1);
  let saved: unknown = {}; try { saved = s ? JSON.parse(s.params) : {}; } catch { /* hỏng → mặc định */ }
  return { params: mergeParams(saved), effectiveMonth: s?.effectiveMonth ?? null };
}
export async function groupMonthOf(db: AnyDb, month: string): Promise<GroupMonth & { note: string }> {
  const [g] = await db.select().from(hrPayrollMonths).where(eq(hrPayrollMonths.month, month)).limit(1);
  return g ? { bnRevenue: g.bnRevenue, bnAvgRevenue: g.bnAvgRevenue, lockRevenue: g.lockRevenue, payQuarterBonus: g.payQuarterBonus, note: g.note } : { ...EMPTY_GROUP_MONTH, note: '' };
}
/** Hồ sơ lương áp dụng cho tháng của nhiều người (mỗi người: bản effective_month mới nhất ≤ tháng). */
async function profilesFor(db: AnyDb, month: string, memberIds?: readonly string[]) {
  const rows = await db.select().from(hrSalaryProfiles)
    .where(and(lte(hrSalaryProfiles.effectiveMonth, month), memberIds ? inArray(hrSalaryProfiles.memberId, [...memberIds]) : undefined))
    .orderBy(desc(hrSalaryProfiles.effectiveMonth));
  const map = new Map<string, ProfileRow>();
  for (const r of rows) if (!map.has(r.memberId)) map.set(r.memberId, r);
  return map;
}

/**
 * Thưởng quý tự tính cho team Sale (tháng cuối quý, khi bật "chi trả thưởng quý"): Map<memberId, tiền>.
 * Team = người thuộc bảng Sale có tính KPI; chỉ tiêu quý = chỉ tiêu DS tháng × 3; DS = DS nhập tay hoặc DS hệ thống từng tháng.
 */
async function quarterBonuses(db: AnyDb, month: string, params: PayrollParams, gm: GroupMonth, revenueOf: RevenueOf) {
  const q = quarterMonths(month);
  if (!q.isQuarterEnd || !gm.payQuarterBonus) return { map: new Map<string, number>(), detail: null };
  const profiles = await profilesFor(db, month), team = [...profiles.values()].filter(p => p.payrollGroup === 'sale' && p.kpiEnabled);
  if (!team.length) return { map: new Map<string, number>(), detail: null };
  const ids = team.map(p => p.memberId);
  const [inputs, revenues] = await Promise.all([
    db.select({ memberId: hrPayrollInputs.memberId, month: hrPayrollInputs.month, revenue: hrPayrollInputs.revenue }).from(hrPayrollInputs)
      .where(and(inArray(hrPayrollInputs.memberId, ids), inArray(hrPayrollInputs.month, q.months))),
    revenueOf(db, q.months),
  ]);
  const detail = computeQuarterBonus(team.map(p => ({
    memberId: p.memberId, target: (p.revenueTarget || params.kpiRevenue) * 3,
    revenues: q.months.map(m => inputs.find(i => i.memberId === p.memberId && i.month === m)?.revenue ?? revenues.get(p.memberId)?.[m] ?? 0),
  })), params);
  return { map: new Map(detail.rows.map(r => [r.memberId, r.bonus])), detail: { ...detail, quarter: q.quarter, months: q.months } };
}

export interface PayrollRow {
  member: { id: string; name: string; active: boolean; positionId: string | null };
  profile: ReturnType<typeof toProfile>; input: ReturnType<typeof toInput>;
  attendanceDays: number; systemRevenue: number; adjustments: { id: string; kind: string; amount: number; reason: string; createdAt: string; createdByName: string }[];
  calc: PayslipCalc; slip: (typeof hrPayslips.$inferSelect) | null;
}

/**
 * Bảng lương một tháng cho nhiều người (mặc định: mọi nhân viên đang làm / có hồ sơ lương). Một chỗ tính duy nhất cho
 * trang chi tiết nhân viên, bảng lương công ty và lúc chốt lương.
 */
export async function buildPayroll(db: AnyDb, month: string, revenueOf: RevenueOf, onlyIds?: readonly string[]) {
  const r = monthRange(month);
  const [{ params, effectiveMonth }, gm, profiles] = await Promise.all([paramsFor(db, month), groupMonthOf(db, month), profilesFor(db, month, onlyIds)]);
  const members = await db.select({ id: employees.id, name: employees.name, active: employees.active, positionId: employees.positionId }).from(employees)
    .where(and(isNull(employees.deletedAt), notInArray(employees.role, ['customer', 'supplier']), onlyIds ? inArray(employees.id, [...onlyIds]) : undefined))
    .orderBy(asc(employees.name));
  const list = onlyIds ? members : members.filter(m => m.active || profiles.has(m.id));
  const ids = list.map(m => m.id);
  if (!ids.length) return { month, params, paramsMonth: effectiveMonth, groupMonth: gm, rows: [] as PayrollRow[], quarter: null };
  const [inputs, adjustments, attendance, slips, revenues, quarter] = await Promise.all([
    db.select().from(hrPayrollInputs).where(and(eq(hrPayrollInputs.month, month), inArray(hrPayrollInputs.memberId, ids))),
    db.select({ id: hrAdjustments.id, memberId: hrAdjustments.memberId, kind: hrAdjustments.kind, amount: hrAdjustments.amount, reason: hrAdjustments.reason, createdAt: hrAdjustments.createdAt, createdByName: employees.name })
      .from(hrAdjustments).leftJoin(employees, eq(employees.id, hrAdjustments.createdBy))
      .where(and(eq(hrAdjustments.month, month), inArray(hrAdjustments.memberId, ids))).orderBy(asc(hrAdjustments.createdAt)),
    db.select({ memberId: hrAttendance.memberId, status: hrAttendance.status }).from(hrAttendance)
      .where(and(inArray(hrAttendance.memberId, ids), gte(hrAttendance.workDate, r.from), lte(hrAttendance.workDate, r.to))),
    db.select().from(hrPayslips).where(and(eq(hrPayslips.month, month), inArray(hrPayslips.memberId, ids))),
    revenueOf(db, [month]),
    quarterBonuses(db, month, params, gm, revenueOf),
  ]);
  const rows: PayrollRow[] = list.map(m => {
    const profile = toProfile(profiles.get(m.id), m.positionId), input = toInput(inputs.find(i => i.memberId === m.id));
    const adj = adjustments.filter(a => a.memberId === m.id).map(({ memberId: _m, ...a }) => ({ ...a, createdByName: a.createdByName ?? '' }));
    const attendanceDays = summarizeAttendance(attendance.filter(a => a.memberId === m.id)).worked, systemRevenue = revenues.get(m.id)?.[month] ?? 0;
    const calc = computePayslip({ profile, params, input, adjustments: adj, attendanceDays, systemRevenue, groupMonth: gm, quarterBonusAuto: quarter.map.get(m.id) ?? 0 });
    return { member: m, profile, input, attendanceDays, systemRevenue, adjustments: adj, calc, slip: slips.find(s => s.memberId === m.id) ?? null };
  });
  return { month, params, paramsMonth: effectiveMonth, groupMonth: gm, rows, quarter: quarter.detail };
}

/** Phiếu lương để hiển thị: đã chốt → bản chụp lúc chốt; chưa chốt → tạm tính. */
export function payslipView(row: PayrollRow) {
  if (row.slip) {
    let calc: PayslipCalc = row.calc; try { calc = { ...row.calc, ...JSON.parse(row.slip.data) }; } catch { /* dữ liệu hỏng → hiện bản tạm tính */ }
    return { ...calc, gross: row.slip.gross, deductionTotal: row.slip.deductionTotal, net: row.slip.net, status: row.slip.status, confirmedAt: row.slip.confirmedAt, paidAt: row.slip.paidAt, note: row.slip.note };
  }
  return { ...row.calc, status: 'estimate' as const, confirmedAt: null, paidAt: null, note: '' };
}

/** Dữ liệu lương / ngày công một người một tháng (trang chi tiết nhân viên). */
export async function payrollOf(db: AnyDb, memberId: string, month: string, revenueOf: RevenueOf) {
  const r = monthRange(month);
  const [board, history, attendance] = await Promise.all([
    buildPayroll(db, month, revenueOf, [memberId]),
    db.select().from(hrSalaryProfiles).where(eq(hrSalaryProfiles.memberId, memberId)).orderBy(desc(hrSalaryProfiles.effectiveMonth)).limit(36),
    db.select({ date: hrAttendance.workDate, status: hrAttendance.status, note: hrAttendance.note }).from(hrAttendance)
      .where(and(eq(hrAttendance.memberId, memberId), gte(hrAttendance.workDate, r.from), lte(hrAttendance.workDate, r.to))).orderBy(asc(hrAttendance.workDate)),
  ]);
  const row = board.rows[0];
  const profile = row?.profile ?? toProfile(undefined), input = row?.input ?? toInput(undefined);
  return {
    profile, input, history: history.map(h => ({ ...toProfile(h), updatedAt: h.updatedAt })),
    attendance, attendanceSummary: { ...summarizeAttendance(attendance), standardDays: board.params.standardDays, daysInMonth: r.days },
    adjustments: row?.adjustments ?? [], systemRevenue: row?.systemRevenue ?? 0, groupMonth: board.groupMonth,
    params: board.params, payslip: row ? payslipView(row) : null, locked: !!row?.slip,
  };
}
