import type { StaffCostOf } from '../core/contracts/staff-cost.ts';
import { buildPayroll, payslipView } from '../modules/hr/api/payroll-data.ts';
import { memberRevenues } from '../modules/staff-hub/api/routes.ts';
import { crmFactsOf } from './sales-payroll-facts.ts';
import { teamPayrollRevenues } from './team-payroll-revenues.ts';
import { weeklyPointsFor } from '../modules/staff-reports/api/routes.ts';

/** Dòng thu nhập là THƯỞNG (phần còn lại của tổng thu nhập là lương + phụ cấp). */
const BONUS_KEYS = new Set(['kpiBonus', 'outputBonus', 'quarterBonus', 'salesBonus', 'otherBonus', 'contractBonus', 'contractBonusAdjustment']);

/** Chi phí nhân sự tháng từ đúng một chỗ tính bảng lương (buildPayroll / payslipView) – khớp số trên phiếu lương. */
export const staffCostOf: StaffCostOf = async (db, month) => {
  const board = await buildPayroll(db, month, memberRevenues, undefined, crmFactsOf, false, teamPayrollRevenues, weeklyPointsFor);
  return board.rows.map(row => {
    const v = payslipView(row), income = v.income ?? [];
    const gross = Math.round(income.reduce((n, l) => n + (Number(l.amount) || 0), 0));
    const bonus = Math.round(income.filter(l => BONUS_KEYS.has(l.key)).reduce((n, l) => n + (Number(l.amount) || 0), 0));
    return { memberId: row.member.id, name: row.member.name, positionId: row.member.positionId, payrollGroup: row.profile.payrollGroup,
      status: (v.status === 'paid' || v.status === 'confirmed' ? v.status : 'estimate') as 'estimate' | 'confirmed' | 'paid', gross, bonus, salary: gross - bonus };
  }).filter(c => c.gross !== 0);
};
