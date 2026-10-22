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
  /** Phần voucher của đơn chia vào dòng này (VNĐ, trừ sau chiết khấu dòng, trước thuế) – xem allocatePosVoucher. */
  voucherAmount?: number;
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
  const lineDiscount = mode === 'percent' ? Math.round((listAmount * value) / 100) : value;
  const voucherAmount = input.voucherAmount ?? 0;
  if (!Number.isSafeInteger(voucherAmount) || voucherAmount < 0 || voucherAmount > listAmount - lineDiscount)
    throw new AppError(400, 'Voucher vượt giá trị dòng hàng.');
  // discountAmount = chiết khấu dòng + phần voucher: listAmount − discountAmount = tiền hàng của dòng (trước thuế nếu giá đã gồm VAT).
  const discountAmount = lineDiscount + voucherAmount;
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
    voucherAmount,
    subtotal,
    tax,
    total: subtotal + tax,
    unitPrice: subtotal / qty,
    taxRate: input.vatEnabled ? input.taxRate : 0,
  };
}
export const posCashDifference = (opening: number, cashReceived: number, counted: number) =>
  posMoney(counted) - posMoney(opening) - cashReceived;

/**
 * VOUCHER nhập tay trên đơn Bán hàng nhanh: thu ngân ghi mã / ghi chú voucher + số tiền (VNĐ) hoặc % giảm cho cả đơn.
 * Không kiểm mã với danh sách phát hành; bắt buộc ghi mã để đối soát. Giảm vào giá TRƯỚC THUẾ: chia vào các dòng hàng theo
 * tỷ lệ tiền hàng sau chiết khấu dòng (VAT tính trên giá sau giảm). Không áp vào phí dịch vụ / phí ship.
 */
export interface PosVoucher { code: string; type: 'percent' | 'amount'; value: number }
export function parsePosVoucher(input: unknown): PosVoucher | null {
  if (input === undefined || input === null || input === '') return null;
  if (typeof input !== 'object' || Array.isArray(input)) throw new AppError(400, 'Voucher không hợp lệ.');
  const o = input as Record<string, unknown>;
  const code = String(o.code ?? '').trim().replace(/\s+/g, ' ').slice(0, 60), value = Number(o.value ?? 0);
  if (!code && !value) return null;
  const type = o.type === 'percent' ? 'percent' : o.type === 'amount' ? 'amount' : null;
  if (!type) throw new AppError(400, 'Chọn voucher giảm theo VNĐ hoặc %.');
  if (!code) throw new AppError(400, 'Nhập mã / ghi chú voucher.');
  if (type === 'percent' ? !(Number.isFinite(value) && value > 0 && value <= 100) : !(Number.isSafeInteger(value) && value > 0))
    throw new AppError(400, type === 'percent' ? 'Voucher % phải từ 0 đến 100.' : 'Số tiền voucher không hợp lệ.');
  return { code, type, value };
}
/** Số tiền voucher và phần chia cho từng dòng (theo tiền hàng sau chiết khấu dòng; phần lẻ cho dòng có phần dư lớn nhất). */
export function allocatePosVoucher(bases: readonly number[], voucher: PosVoucher | null): { amount: number; shares: number[] } {
  if (!voucher) return { amount: 0, shares: bases.map(() => 0) };
  const total = bases.reduce((n, b) => n + b, 0);
  const amount = voucher.type === 'percent' ? Math.round((total * voucher.value) / 100) : voucher.value;
  if (amount > total) throw new AppError(400, 'Voucher vượt tiền hàng của đơn.');
  const raw = bases.map(b => (total ? (amount * b) / total : 0)), shares = raw.map(Math.floor);
  let rest = amount - shares.reduce((n, x) => n + x, 0);
  const byRemainder = raw.map((r, i) => [r - shares[i]!, i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; rest > 0; k++, rest--) shares[byRemainder[k % byRemainder.length]![1]]! += 1;
  return { amount, shares };
}
