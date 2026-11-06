import type { SalePayrollPreviewOf } from '../core/contracts/weekly-report.ts';
import { buildPayroll } from '../modules/hr/api/payroll-data.ts';
import { kpiBonusRate, netKpiBonusRate } from '../modules/hr/domain/payroll.ts';
import { memberRevenues } from '../modules/staff-hub/api/routes.ts';
import { crmFactsOf } from './sales-payroll-facts.ts';
import { teamPayrollRevenues } from './team-payroll-revenues.ts';
import { weeklyPointsFor } from '../modules/staff-reports/api/routes.ts';

/**
 * Thưởng KPI DS dự kiến cho báo cáo tháng Sale: chạy đúng một chỗ tính bảng lương (buildPayroll) cho riêng người đó,
 * đọc dòng "Thưởng KPI DS" và KPI CV – không tự tính lại công thức thưởng.
 */
export const salePayrollPreviewOf: SalePayrollPreviewOf = async (db, memberId, month) => {
  const board = await buildPayroll(db, month, memberRevenues, [memberId], crmFactsOf, false, teamPayrollRevenues, weeklyPointsFor);
  const row = board.rows.find(r => r.member.id === memberId);
  if (!row || row.profile.payrollGroup !== 'sale') return null;
  const c = row.calc, p = board.params, k = c.kpi ?? c.salesCrm?.previewKpi ?? null, net = !!c.kpiNetBasis;
  const line = c.income.find(l => l.key === 'kpiBonus');
  const applied = !!c.kpi, amount = applied ? line?.amount ?? 0 : c.salesCrm?.kpiBonusPreview ?? 0;
  const used = k?.used ?? null, rate = net ? netKpiBonusRate(p, used) : kpiBonusRate(p, used);
  const b = k?.basis, t = k?.targets;
  return {
    kpi: k ? { used, rows: [
      { key: 'newCustomers', actual: b?.newCustomers ?? null, target: t?.newCustomers ?? p.kpiNewCustomers },
      { key: 'transactions', actual: b?.transactions ?? null, target: t?.transactions ?? p.kpiTransactions },
      { key: 'contracts', actual: b?.contracts ?? null, target: t?.contracts ?? p.kpiContracts },
      { key: 'revenue', actual: b?.revenue ?? null, target: t?.revenue ?? p.kpiRevenue },
    ] } : null,
    bonus: { rate, amount: Math.round(amount), basis: net ? c.kpiNetBasis!.netRevenue : c.revenue, basisLabel: net ? 'DS net' : 'DS', applied,
      tiers: net ? [{ from: 0.6, rate: p.saleKpiNetLowRate }, { from: 0.9, rate: p.saleKpiNetHighRate }, { from: 1.2, rate: p.saleKpiNetOverRate }]
        : [{ from: p.kpiLow, rate: p.kpiLowRate }, { from: p.kpiHigh, rate: p.kpiHighRate }] },
  };
};
