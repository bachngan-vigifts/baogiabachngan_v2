import { AppError } from '../../../core/errors.ts';
import { orderTotals } from './sales.ts';
/** Allocate original document rounding once, deterministically. Partial returns then use returnPortion's
 * cumulative rounding, so returning every line in any sequence gives exactly the original VNĐ totals. */
export function crmReturnAmounts(order: { subtotal: number; tax: number; total: number }, lines: { id: string; amount: number; taxRate: number }[]) {
  const totals = orderTotals(lines);
  if (!lines.length || lines.some(l => !Number.isFinite(l.amount) || l.amount < 0 || !Number.isFinite(l.taxRate) || l.taxRate < 0 || l.taxRate > 100)
    || totals.subtotal !== order.subtotal || totals.tax !== order.tax || totals.total !== order.total)
    throw new AppError(409, 'Tổng đơn và dòng hàng không khớp; cần đối soát trước khi lập phiếu trả.');
  const allocate = (raw: number[], budget: number) => {
    const values = raw.map(Math.floor), remaining = budget - values.reduce((a, b) => a + b, 0);
    if (!Number.isSafeInteger(budget) || budget < 0 || remaining < 0 || remaining > raw.length) throw new AppError(409, 'Giá trị gốc không hợp lệ.');
    const ranked = raw.map((n, i) => ({ i, fraction: n - values[i]! })).sort((a, b) => b.fraction - a.fraction || a.i - b.i);
    for (let n = 0; n < remaining; n++) values[ranked[n]!.i]!++;
    return values;
  };
  const sub = allocate(lines.map(l => l.amount), order.subtotal), tax = allocate(lines.map(l => l.amount * l.taxRate / 100), order.tax);
  return new Map(lines.map((l, i) => [l.id, { subtotal: sub[i]!, tax: tax[i]! }]));
}
