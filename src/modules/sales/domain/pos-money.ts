import { AppError } from '../../../core/errors.ts';
export function posMoney(value: unknown, label = 'Số tiền'): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0 || n > 1e12) throw new AppError(400, label + ' không hợp lệ.');
  return n;
}
export function posLine(input: {
  price: number;
  qty: unknown;
  discountType?: unknown;
  discountValue?: unknown;
  taxRate: number;
  priceIncludesVat: boolean;
  vatEnabled: boolean;
}) {
  const price = posMoney(input.price, 'Giá bán'),
    qty = Number(input.qty),
    mode = input.discountType ?? 'percent',
    value = Number(input.discountValue ?? 0);
  if (!Number.isFinite(qty) || qty <= 0 || qty > 1e6 || Math.abs(qty * 1000 - Math.round(qty * 1000)) > 1e-6)
    throw new AppError(400, 'Số lượng không hợp lệ.');
  if (!['percent', 'amount'].includes(String(mode)) || !Number.isFinite(value) || value < 0)
    throw new AppError(400, 'Chiết khấu không hợp lệ.');
  const listAmount = posMoney(Math.round(price * qty));
  if (
    (mode === 'percent' && value > 100) ||
    (mode === 'amount' && (!Number.isSafeInteger(value) || value > listAmount))
  )
    throw new AppError(400, 'Chiết khấu vượt giá trị dòng hàng.');
  const discountAmount = mode === 'percent' ? Math.round((listAmount * value) / 100) : value;
  const after = listAmount - discountAmount,
    rate = input.taxRate / 100;
  const subtotal = input.priceIncludesVat ? Math.round(after / (1 + rate)) : after;
  const tax = input.vatEnabled ? (input.priceIncludesVat ? after - subtotal : Math.round(subtotal * rate)) : 0;
  return {
    qty,
    listUnitPrice: price,
    listAmount,
    discountType: mode as 'percent' | 'amount',
    discountValue: value,
    discountAmount,
    subtotal,
    tax,
    total: subtotal + tax,
    unitPrice: subtotal / qty,
    taxRate: input.vatEnabled ? input.taxRate : 0,
  };
}
export const posCashDifference = (opening: number, cashReceived: number, counted: number) =>
  posMoney(counted) - posMoney(opening) - cashReceived;
