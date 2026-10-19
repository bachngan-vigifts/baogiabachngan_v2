import { AppError } from '../../../core/errors.ts';
import { posLine, posMoney } from './pos-money.ts';

/** Customer-facing charges. Service follows the selected price policy; shipping is VAT-exempt. */
export function posFeeInput(b: Record<string, unknown>) {
  const feeName = String(b.feeName ?? '').trim();
  if (feeName.length > 200) throw new AppError(400, 'Tên khoản phí tối đa 200 ký tự.');
  const feeAmount = posMoney(b.feeAmount ?? 0, 'Phí dịch vụ');
  const shippingFee = posMoney(b.shippingFee ?? 0, 'Phí ship');
  if (feeAmount > 0 && !feeName) throw new AppError(400, 'Nhập tên khoản phí, ví dụ phí in hoặc phí gói quà.');
  return feeName || feeAmount || shippingFee ? { feeName, feeAmount, shippingFee } : {};
}
export function calculatePosFees(b: Record<string, unknown>, taxRate: number) {
  const input = posFeeInput(b), amount = input.feeAmount ?? 0, shippingFee = input.shippingFee ?? 0;
  const service = { name: input.feeName ?? '', amount, ...posLine({ price: amount, qty: 1, taxRate, priceIncludesVat: taxRate > 0, vatEnabled: taxRate > 0 }) };
  return { service, shippingFee, subtotal: posMoney(service.subtotal + shippingFee), tax: service.tax, total: posMoney(service.total + shippingFee) };
}
export function snapshotPosFees(snapshot: { fees?: ReturnType<typeof calculatePosFees> }) {
  const f = snapshot.fees;
  return f ? calculatePosFees({ feeName: f.service.name, feeAmount: f.service.amount, shippingFee: f.shippingFee }, f.service.taxRate) : calculatePosFees({}, 0);
}
