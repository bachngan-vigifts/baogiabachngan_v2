import { AppError } from '../../../core/errors.ts';
import { posLine, posMoney } from './pos-money.ts';

/** Customer-facing charges. Service follows the selected price policy; shipping is VAT-exempt. */
export function posFeeInput(b: Record<string, unknown>) {
  const feeName = String(b.feeName ?? '').trim();
  if (feeName.length > 200) throw new AppError(400, 'Tên khoản phí tối đa 200 ký tự.');
  const feeAmount = posMoney(b.feeAmount ?? 0, 'Phí dịch vụ');
  const feeQuantity = b.feeQuantity === undefined || b.feeQuantity === '' ? 1 : posMoney(b.feeQuantity, 'Số lượng phí dịch vụ');
  const shippingFee = posMoney(b.shippingFee ?? 0, 'Phí ship');
  if (feeAmount > 0 && !feeName) throw new AppError(400, 'Nhập tên khoản phí, ví dụ phí in hoặc phí gói quà.');
  if (feeQuantity < 1) throw new AppError(400, 'Số lượng phí dịch vụ phải từ 1 trở lên.');
  return feeName || feeAmount || shippingFee ? { feeName, feeAmount, feeQuantity, shippingFee } : {};
}
export function calculatePosFees(b: Record<string, unknown>, taxRate: number) {
  const input = posFeeInput(b), unitPrice = input.feeAmount ?? 0, quantity = input.feeQuantity ?? 1, shippingFee = input.shippingFee ?? 0;
  const calculated = posLine({ price: unitPrice, qty: quantity, taxRate, priceIncludesVat: taxRate > 0, vatEnabled: taxRate > 0 });
  const service = { name: input.feeName ?? '', ...calculated, unitPrice, quantity, amount: calculated.total };
  return { service, shippingFee, subtotal: posMoney(service.subtotal + shippingFee), tax: service.tax, total: posMoney(service.total + shippingFee) };
}
export function snapshotPosFees(snapshot: { fees?: ReturnType<typeof calculatePosFees> }) {
  const f = snapshot.fees;
  if (!f) return calculatePosFees({}, 0);
  const structured = Object.prototype.hasOwnProperty.call(f.service, 'quantity');
  return calculatePosFees({ feeName: f.service.name, feeAmount: structured ? f.service.unitPrice : f.service.amount, feeQuantity: structured ? f.service.quantity : 1, shippingFee: f.shippingFee }, f.service.taxRate);
}
