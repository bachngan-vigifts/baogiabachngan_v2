import type { DashboardKpiMember, DashboardKpiOf, DashboardKpiPart } from '../core/contracts/dashboard-kpi.ts';
import { buildPayroll, payslipView } from '../modules/hr/api/payroll-data.ts';
import { kpiBonusRate, netKpiBonusRate, type PayrollInput } from '../modules/hr/domain/payroll.ts';
import type { PayrollParams } from '../modules/hr/domain/params.ts';
import { memberRevenues } from '../modules/staff-hub/api/routes.ts';
import { crmFactsOf } from './sales-payroll-facts.ts';

/**
 * Điểm KPI Sale cho Tổng quan doanh số – lấy đúng kết quả của bảng lương (cùng tham số, KPI chốt / cố định, ngày làm hàng /
 * công tác, nguồn CRM). Phiếu đã chốt dùng bản chụp lúc chốt. Chỉ trả điểm, chỉ tiêu và số thực tế; không trả tiền lương.
 */
export const dashboardKpiOf: DashboardKpiOf = async (db, month, memberIds) => {
  if (!memberIds.length) return [];
  const board = await buildPayroll(db, month, memberRevenues, memberIds, crmFactsOf);
  const out: DashboardKpiMember[] = [];
  for (const row of board.rows) {
    const view = payslipView(row) as ReturnType<typeof payslipView> & {
      calculationContext?: { params?: PayrollParams; profile?: { revenueTarget?: number; fixedKpi?: number | null }; input?: PayrollInput; systemRevenue?: number };
    };
    const kpi = view.kpi;
    if (!kpi) continue;
    const ctx = view.calculationContext, p = ctx?.params ?? board.params, input = ctx?.input ?? row.input;
    const profile = ctx?.profile ?? row.profile, systemRevenue = ctx?.systemRevenue ?? row.systemRevenue;
    const crm = view.salesCrm, auto = crm?.kpiApply ? crm.facts : null;
    const pick = (manual: number | null, fact: number | undefined) => manual ?? (auto ? fact ?? 0 : null);
    const merchDays = input.kpiMerchDays || 0, tripDays = input.kpiTripDays || 0, days = merchDays + tripDays;
    const revenueActual = input.kpiRevenue ?? input.revenue ?? systemRevenue;
    const parts: DashboardKpiPart[] = [
      { key: 'newCustomers', label: 'KH mới', actual: pick(input.kpiNewCustomers, auto?.newCustomers), extra: p.kpiCustomersPerExtraDay * days, target: p.kpiNewCustomers, points: kpi.points.newCustomers, max: Math.max(p.kpiNewCustomersWeight, p.kpiNewCustomersOver) },
      { key: 'transactions', label: 'Giao dịch', actual: pick(input.kpiTransactions, auto?.transactions), extra: p.kpiTransactionsPerExtraDay * days, target: p.kpiTransactions, points: kpi.points.transactions, max: p.kpiTransactionsWeight },
      { key: 'contracts', label: 'Số HĐKT', actual: pick(input.kpiContracts, auto?.contracts), extra: 0, target: p.kpiContracts, points: kpi.points.contracts, max: p.kpiContractsWeight },
      { key: 'revenue', label: 'Doanh số cá nhân', actual: revenueActual, extra: 0, target: profile.revenueTarget || p.kpiRevenue, points: kpi.points.revenue, max: null },
    ];
    const netFrom = String(p.saleKpiNetFrom || 0).replace(/^(\d{4})(\d{2})$/, '$1-$2'), net = netFrom !== '0' && month >= netFrom;
    const adjustedBy = kpi.used === kpi.total ? null : profile.fixedKpi != null ? 'fixed' : 'override';
    out.push({
      id: row.member.id, name: row.member.name, status: view.status, source: auto ? 'crm' : 'manual',
      total: kpi.total, used: kpi.used, adjustedBy, bonusRate: net ? netKpiBonusRate(p, kpi.used) : kpiBonusRate(p, kpi.used),
      crmPreview: crm && !crm.kpiApply && crm.previewKpi ? crm.previewKpi.used : null, parts, merchDays, tripDays,
    });
  }
  return out;
};
