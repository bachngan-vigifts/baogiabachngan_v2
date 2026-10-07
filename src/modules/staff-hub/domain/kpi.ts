/**
 * Chỉ số KPI của nhân viên kinh doanh (hàm thuần – một chỗ để sửa định nghĩa).
 *  - Doanh số tháng = tổng giá trị (gồm VAT) các đơn nhân viên PHỤ TRÁCH, ngày đặt trong tháng, đã tính công nợ
 *    (đơn không huỷ và không còn nháp; đơn nháp có HĐKT đã ký vẫn tính – cùng quy tắc `debtCounts` của Bán hàng).
 *  - Đã thu tháng = phiếu thu (ngày thu trong tháng) của các đơn nhân viên phụ trách.
 *  - Tỷ lệ chốt = số báo giá trong tháng đã lên đơn / số báo giá trong tháng.
 */
export const STAFF_HUB_LIMITS = { orders: 1000, quotes: 200, payments: 300, trendMonths: 6 } as const;

export interface KpiOrder { id: string; orderDate: string; total: number; counted: boolean }
export const monthOf = (date: string | null | undefined) => (date ?? '').slice(0, 7);

/** Doanh số + số đơn đã tính công nợ trong tháng. */
export function revenueIn(orders: readonly KpiOrder[], month: string) {
  const list = orders.filter(o => o.counted && monthOf(o.orderDate) === month);
  return { revenue: list.reduce((s, o) => s + o.total, 0), orders: list.length };
}

/** Diễn biến các tháng gần đây (cũ → mới): doanh số, số đơn, đã thu. */
export function trend(orders: readonly KpiOrder[], payments: readonly { amount: number; paidAt: string }[], months: readonly string[]) {
  return months.map(m => ({ month: m, ...revenueIn(orders, m), collected: payments.filter(p => monthOf(p.paidAt) === m).reduce((s, p) => s + p.amount, 0) }));
}

export const percent = (part: number, whole: number) => whole > 0 ? Math.round(part / whole * 1000) / 10 : null;
