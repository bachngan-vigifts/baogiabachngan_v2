import { AppError } from '../../../core/errors.ts';
import { posMoney } from './pos-money.ts';
export type PosSaleFlow = 'deposit' | 'prepaid';
export function saleFlowOf(value: unknown): PosSaleFlow | null {
  let data: any = value;
  try {
    if (typeof value === 'string') data = JSON.parse(value);
  } catch {
    return null;
  }
  return data?.saleFlow === 'deposit' || data?.saleFlow === 'prepaid'
    ? data.saleFlow
    : null;
}
export function flowInitialAmount(
  flow: PosSaleFlow,
  total: number,
  value: unknown,
): number {
  if (total <= 0)
    throw new AppError(400, 'Đơn cọc/trả trước phải có giá trị lớn hơn 0.');
  const amount = posMoney(
    value === undefined
      ? flow === 'prepaid'
        ? total
        : Math.max(1, Math.round(total * 0.3))
      : value,
    'Số thu trước',
  );
  if (amount <= 0 || amount > total || (flow === 'prepaid' && amount !== total))
    throw new AppError(
      400,
      flow === 'prepaid'
        ? 'Ship trả trước phải yêu cầu đủ 100% tổng đơn.'
        : 'Số cọc phải lớn hơn 0 và không vượt tổng đơn.',
    );
  return amount;
}
export const flowHoldUntil = (at: string, paidShipping = false) =>
  paidShipping
    ? '9999-12-31T23:59:59.999Z'
    : new Date(Date.parse(at) + 5 * 86400000).toISOString();
export const flowRemaining = (total: number, paid: number) =>
  Math.max(0, total - paid);
