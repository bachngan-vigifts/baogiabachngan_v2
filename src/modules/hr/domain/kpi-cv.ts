/**
 * KPI CÔNG VIỆC – nhân viên Sale (sheet "KPI CV"). KPI CV quyết định mức thưởng KPI DS ở bảng lương Sale.
 *
 *   KH mới     = (KH mới + 4 × (ngày làm hàng + ngày công tác)) / chỉ tiêu × 10%   (vượt chỉ tiêu → 20%)
 *   Giao dịch  = (GD + 10 × (ngày làm hàng + ngày công tác)) / chỉ tiêu × 30%      (tối đa 30%)
 *   Số HĐ      = MIN(1, số HĐ / chỉ tiêu) × 10%
 *   DS cá nhân = DS / chỉ tiêu DS cá nhân × 50%                                    (không giới hạn)
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
export interface KpiCvResult {
  points: { newCustomers: number; transactions: number; contracts: number; revenue: number };
  total: number; used: number; tier: 'high' | 'low' | 'none';
}
export const KPI_TIER_LABEL = { high: 'Mức cao', low: 'Mức thấp', none: 'Không thưởng' } as const;

export function computeKpiCv(k: KpiCvInput, p: PayrollParams, revenueTarget: number, monthRevenue: number): KpiCvResult {
  const extra = (k.kpiMerchDays || 0) + (k.kpiTripDays || 0);
  const nc = (k.kpiNewCustomers ?? 0) + p.kpiCustomersPerExtraDay * extra;
  const tx = (k.kpiTransactions ?? 0) + p.kpiTransactionsPerExtraDay * extra;
  const newCustomers = k.kpiNewCustomers === null ? 0 : nc > p.kpiNewCustomers ? p.kpiNewCustomersOver : nc / p.kpiNewCustomers * p.kpiNewCustomersWeight;
  const transactions = k.kpiTransactions === null ? 0 : tx > p.kpiTransactions ? p.kpiTransactionsWeight : tx / p.kpiTransactions * p.kpiTransactionsWeight;
  const contracts = k.kpiContracts === null ? 0 : Math.min(1, k.kpiContracts / p.kpiContracts) * p.kpiContractsWeight;
  const revenue = revenueTarget > 0 ? (k.kpiRevenue ?? monthRevenue) / revenueTarget * p.kpiRevenueWeight : 0;
  const total = newCustomers + transactions + contracts + revenue, used = k.kpiOverride ?? total;
  return { points: { newCustomers, transactions, contracts, revenue }, total, used, tier: used >= p.kpiHigh ? 'high' : used >= p.kpiLow ? 'low' : 'none' };
}
