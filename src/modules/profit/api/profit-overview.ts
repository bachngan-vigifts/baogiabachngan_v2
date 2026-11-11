import type { ReportCacheMeta } from "../../../core/cache/report-cache.ts";
import type { ProfitRow } from "../domain/profit.ts";

interface OverviewSource {
  from: string;
  to: string;
  summary: ProfitRow;
  direct: { printing: number; commission: number; shipping: number };
  compare: {
    from: string;
    to: string;
    revenue: number;
    gross: number;
    coveredRevenue: number;
    margin: number | null;
    orders: number;
  } | null;
  cardFees: { available: boolean; note: string };
  branchCosts: {
    rows: {
      id: string;
      name: string;
      net: number;
      petty: number;
      staff: number;
    }[];
    officeExpenses: { available: boolean; note: string };
    company: {
      net: number;
      reconcile: { ok: boolean; payrollOk: boolean };
    } | null;
  };
  staff: {
    available: boolean;
    partial: boolean;
    months: string[];
    unallocatedTotal: number;
    reconcile: { ok: boolean };
  };
  cache: ReportCacheMeta;
}
/** Projection only: same cached calculation as /profit, without orders, wages or customer detail. */
export function compactProfitOverview(d: OverviewSource) {
  return {
    from: d.from,
    to: d.to,
    summary: d.summary,
    direct: d.direct,
    compare: d.compare,
    cache: d.cache,
    cardFees: d.cardFees,
    officeExpenses: d.branchCosts.officeExpenses,
    branches: d.branchCosts.rows.map(({ id, name, net, petty, staff }) => ({
      id,
      name,
      net,
      petty,
      staff,
    })),
    company: d.branchCosts.company
      ? {
          net: d.branchCosts.company.net,
          reconciled:
            d.branchCosts.company.reconcile.ok &&
            d.branchCosts.company.reconcile.payrollOk,
        }
      : null,
    staff: {
      available: d.staff.available,
      partial: d.staff.partial,
      months: d.staff.months,
      unallocatedTotal: d.staff.unallocatedTotal,
      reconciled: d.staff.reconcile.ok,
    },
  };
}
