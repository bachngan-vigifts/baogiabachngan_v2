/**
 * KPI CÔNG VIỆC – nhân viên Sale (sheet "KPI CV"). KPI CV quyết định mức thưởng KPI DS ở bảng lương Sale.
 *
 *   KH mới     = (KH mới + 4 × (ngày làm hàng + ngày công tác)) / chỉ tiêu × 10%   (vượt chỉ tiêu → 20%)
 *   Giao dịch  = (GD + 10 × (ngày làm hàng + ngày công tác)) / chỉ tiêu × 30%      (tối đa 30%)
 *   Số HĐ      = MIN(1, số HĐ / chỉ tiêu) × 10%
 *   DS cá nhân = DS / chỉ tiêu DS cá nhân × 50%                                    (không giới hạn)
 *   Chuẩn AppSheet theo kỳ: trần KH/GD/HĐ = 10/30/10%, chỉ ngày làm hàng cộng bù; DS ghi nhận không trần 50%.
 *   KPI CV     = tổng 4 điểm; "KPI chốt" nhập tay (nếu có) được dùng thay.
 */
import type { PayrollParams } from './params.ts';

export interface KpiCvInput {
  kpiNewCustomers: number | null; kpiTransactions: number | null; kpiContracts: number | null;
  /** DS cá nhân tính KPI; null = DS tháng. */
  kpiRevenue: number | null;
  kpiMerchDays: number; kpiTripDays: number;
  /** KPI chốt (tỷ lệ, 1 = 100%) – nhập tay thay kết quả tính. */
  kpiOverride: number | null;
}
/** Chỉ tiêu dùng để chấm KPI của một người một tháng; `own` = chỉ tiêu riêng trong hồ sơ lương (không phải mức chung). */
export interface KpiTargets {
  newCustomers: number; transactions: number; contracts: number; revenue: number;
  own: { newCustomers: boolean; transactions: boolean; contracts: boolean; revenue: boolean };
}
/** Chỉ tiêu riêng trong hồ sơ lương (null = theo mức chung của tháng; doanh số giữ quy ước cũ 0 = mức chung). */
export interface KpiTargetProfile { revenueTarget?: number; kpiNewCustomersTarget?: number | null; kpiTransactionsTarget?: number | null; kpiContractsTarget?: number | null }
export function kpiTargetsOf(p: PayrollParams, f: KpiTargetProfile): KpiTargets {
  const own = (v: number | null | undefined) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  return {
    newCustomers: own(f.kpiNewCustomersTarget) ? f.kpiNewCustomersTarget! : p.kpiNewCustomers,
    transactions: own(f.kpiTransactionsTarget) ? f.kpiTransactionsTarget! : p.kpiTransactions,
    contracts: own(f.kpiContractsTarget) ? f.kpiContractsTarget! : p.kpiContracts,
    revenue: own(f.revenueTarget) ? f.revenueTarget! : p.kpiRevenue,
    own: { newCustomers: own(f.kpiNewCustomersTarget), transactions: own(f.kpiTransactionsTarget), contracts: own(f.kpiContractsTarget), revenue: own(f.revenueTarget) },
  };
}
export interface KpiCvResult {
  points: { newCustomers: number; transactions: number; contracts: number; revenue: number };
  total: number; used: number; tier: 'high' | 'low' | 'none';
  /** Chỉ tiêu đã dùng – lưu trong bản chụp lúc chốt (phiếu cũ không có thì đọc tham số trong bản chụp). */
  targets?: KpiTargets;
  policy?: 'legacy' | 'appsheet';
  basis?: { newCustomers: number | null; transactions: number | null; contracts: number | null; revenue: number; merchDays: number; tripDays: number; extraDays: number };

}
export const KPI_TIER_LABEL = { high: 'Mức cao', low: 'Mức thấp', none: 'Không thưởng' } as const;

/** `target`: chỉ tiêu theo người (kpiTargetsOf) – hoặc chỉ số DS (cách gọi cũ: các chỉ tiêu khác theo mức chung). */
export function computeKpiCv(k: KpiCvInput, p: PayrollParams, target: number | KpiTargets, monthRevenue: number, policy: 'legacy' | 'appsheet' = 'legacy'): KpiCvResult {
  const t: KpiTargets = typeof target === 'number'
    ? { ...kpiTargetsOf(p, {}), revenue: target, own: { newCustomers: false, transactions: false, contracts: false, revenue: false } } : target;
  const revenueTarget = t.revenue;
  const extra = (k.kpiMerchDays || 0) + (policy === 'legacy' ? k.kpiTripDays || 0 : 0);
  const nc = (k.kpiNewCustomers ?? 0) + p.kpiCustomersPerExtraDay * extra;
  const tx = (k.kpiTransactions ?? 0) + p.kpiTransactionsPerExtraDay * extra;
  const newCustomers = policy === 'appsheet' ? Math.min(1, nc / t.newCustomers) * p.kpiNewCustomersWeight : k.kpiNewCustomers === null ? 0 : nc > t.newCustomers ? p.kpiNewCustomersOver : nc / t.newCustomers * p.kpiNewCustomersWeight;
  const transactions = policy === 'appsheet' ? Math.min(1, tx / t.transactions) * p.kpiTransactionsWeight : k.kpiTransactions === null ? 0 : tx > t.transactions ? p.kpiTransactionsWeight : tx / t.transactions * p.kpiTransactionsWeight;
  const contracts = k.kpiContracts === null ? 0 : Math.min(1, k.kpiContracts / t.contracts) * p.kpiContractsWeight;
  const revenue = revenueTarget > 0 ? (k.kpiRevenue ?? monthRevenue) / revenueTarget * p.kpiRevenueWeight : 0;
  const total = newCustomers + transactions + contracts + revenue, used = k.kpiOverride ?? total;
  return { points: { newCustomers, transactions, contracts, revenue }, total, used, targets: t, policy, basis: {newCustomers:k.kpiNewCustomers,transactions:k.kpiTransactions,contracts:k.kpiContracts,revenue:k.kpiRevenue??monthRevenue,merchDays:k.kpiMerchDays||0,tripDays:k.kpiTripDays||0,extraDays:extra}, tier: used >= p.kpiHigh ? 'high' : used >= p.kpiLow ? 'low' : 'none' };
}
