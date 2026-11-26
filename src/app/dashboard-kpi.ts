import { appsheetKpiApplies } from '../modules/hr/domain/params.ts';
import type { DashboardKpiMember, DashboardKpiOf, DashboardKpiPart } from '../core/contracts/dashboard-kpi.ts';
import {teamPayrollRevenues} from './team-payroll-revenues.ts';
import { buildPayroll, payslipView } from '../modules/hr/api/payroll-data.ts';
import { kpiBonusRate, netKpiBonusRate, type PayrollInput } from '../modules/hr/domain/payroll.ts';
import { computeKpiCv, kpiTargetsOf, type KpiTargetProfile } from '../modules/hr/domain/kpi-cv.ts';
import type { PayrollParams } from '../modules/hr/domain/params.ts';
import { memberRevenues } from '../modules/staff-hub/api/routes.ts';
import { crmFactsOf } from './sales-payroll-facts.ts';

/**
 * Điểm KPI Sale cho Tổng quan doanh số – lấy đúng kết quả của bảng lương (cùng tham số, KPI chốt / cố định, ngày làm hàng /
 * công tác, nguồn CRM). Phiếu đã chốt dùng bản chụp lúc chốt. Chỉ trả điểm, chỉ tiêu và số thực tế; không trả tiền lương.
 */
export const dashboardKpiOf: DashboardKpiOf = async (db, month, memberIds) => {
  if (!memberIds.length) return [];
  const board = await buildPayroll(db, month, memberRevenues, memberIds, crmFactsOf,false,teamPayrollRevenues);
  // Sale Admin tracking is read-only, independent of payroll switches and closed payslips.
  // Keep salaryKpiEligible and every salary/bonus calculation unchanged.
  const trackingIds=board.rows.filter(r=>r.member.active&&r.member.positionId==='sale-admin').map(r=>r.member.id);
  const trackingFacts=trackingIds.length?await crmFactsOf(db,month,[],false,{approvedOnly:appsheetKpiApplies(board.params,month)}):null;
  const netFrom=String(board.params.saleKpiNetFrom||0).replace(/^(\d{4})(\d{2})$/,'$1-$2');
  const trackingNet=appsheetKpiApplies(board.params,month)||netFrom!=='0'&&month>=netFrom;
  const out: DashboardKpiMember[] = [];
  for (const row of board.rows) {
    if(!row.member.active||!['sale','sale-admin','manager'].includes(row.member.positionId??''))continue;
    const trackingOnly=row.member.positionId==='sale-admin',fact=trackingFacts?.members.get(row.member.id);
    const trackingInput={...row.input,kpiNewCustomers:fact?.newCustomers??0,kpiTransactions:fact?.transactions??0,kpiContracts:fact?.contracts??0,kpiRevenue:trackingNet?fact?.netRevenue??0:row.input.revenue??row.systemRevenue,kpiOverride:null};
    const view = (trackingOnly?{...row.calc,status:'estimate' as const,kpi:computeKpiCv(trackingInput,board.params,kpiTargetsOf(board.params,row.profile),row.systemRevenue,appsheetKpiApplies(board.params,month)?'appsheet':'legacy'),salesCrm:undefined}:payslipView(row)) as ReturnType<typeof payslipView> & {
      calculationContext?: { params?: PayrollParams; profile?: KpiTargetProfile & { fixedKpi?: number | null }; input?: PayrollInput; systemRevenue?: number };
    };
    const kpi = view.kpi;
    if (!kpi) continue;
    const ctx = view.calculationContext, p = ctx?.params ?? board.params, input = ctx?.input ?? row.input;
    const profile = ctx?.profile ?? row.profile, systemRevenue = ctx?.systemRevenue ?? row.systemRevenue;
    const crm = view.salesCrm, auto = crm?.kpiApply ? crm.facts : null;
    const pick = (manual: number | null, fact: number | undefined) => manual ?? (auto ? fact ?? 0 : null);
    const basis=kpi.basis;
    const merchDays = basis?.merchDays ?? input.kpiMerchDays ?? 0, tripDays = basis?.tripDays ?? input.kpiTripDays ?? 0, days = basis?.extraDays ?? merchDays + tripDays;
    const revenueActual = basis?.revenue ?? input.kpiRevenue ?? input.revenue ?? systemRevenue;
    // Chỉ tiêu đã dùng khi tính (lưu trong kết quả KPI); phiếu chốt trước khi có chỉ tiêu riêng → tính lại từ bản chụp.
    const t = kpi.targets ?? kpiTargetsOf(p, profile);
    const parts: DashboardKpiPart[] = [
      { key: 'newCustomers', label: 'KH mới', actual: basis ? basis.newCustomers : pick(input.kpiNewCustomers, auto?.newCustomers), extra: p.kpiCustomersPerExtraDay * days, target: t.newCustomers, own: t.own.newCustomers, points: kpi.points.newCustomers, max: kpi.policy==='appsheet'?p.kpiNewCustomersWeight:Math.max(p.kpiNewCustomersWeight, p.kpiNewCustomersOver) },
      { key: 'transactions', label: 'Giao dịch', actual: basis ? basis.transactions : pick(input.kpiTransactions, auto?.transactions), extra: p.kpiTransactionsPerExtraDay * days, target: t.transactions, own: t.own.transactions, points: kpi.points.transactions, max: p.kpiTransactionsWeight },
      { key: 'contracts', label: 'Đơn hàng / HĐKT', actual: basis ? basis.contracts : pick(input.kpiContracts, auto?.contracts), extra: 0, target: t.contracts, own: t.own.contracts, points: kpi.points.contracts, max: p.kpiContractsWeight },
      { key: 'revenue', label: kpi.policy==='appsheet'?'Doanh số ghi nhận':'Doanh số cá nhân', actual: revenueActual, extra: 0, target: t.revenue, own: t.own.revenue, points: kpi.points.revenue, max: null },
    ];
    const netFrom = String(p.saleKpiNetFrom || 0).replace(/^(\d{4})(\d{2})$/, '$1-$2'), net = kpi.policy==='appsheet' || netFrom !== '0' && month >= netFrom;
    const adjustedBy = kpi.used === kpi.total ? null : profile.fixedKpi != null ? 'fixed' : 'override';
    out.push({
      id: row.member.id, name: row.member.name, status: view.status, source: trackingOnly || auto ? 'crm' : 'manual',
      total: kpi.total, used: kpi.used, adjustedBy, trackingOnly, bonusRate: trackingOnly ? 0 : net ? netKpiBonusRate(p, kpi.used) : kpiBonusRate(p, kpi.used),
      revenueIssues:trackingOnly&&trackingNet?fact?.netRevenueIssues??0:undefined,
      revenueBasis:(trackingOnly?trackingNet:kpi.policy==='appsheet')?'net-revenue':'invoice-total',approvedOnly:kpi.policy==='appsheet',
      crmPreview: crm && !crm.kpiApply && crm.previewKpi ? crm.previewKpi.used : null, parts, merchDays, tripDays,
    });
  }
  return out;
};
