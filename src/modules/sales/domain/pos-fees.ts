import { AppError } from '../../../core/errors.ts';
import { posLine, posMoney } from './pos-money.ts';

type ServiceInput = { name: string; unitPrice: number; quantity: number };
type FeeInput = { feeName?: string; feeAmount?: number; feeQuantity?: number; serviceFees?: ServiceInput[]; shippingFee?: number };
function serviceInput(name: unknown, price: unknown, qty: unknown): ServiceInput {
  const text = String(name ?? '').trim();
  if (text.length > 200) throw new AppError(400, 'Tên khoản phí tối đa 200 ký tự.');
  const unitPrice = posMoney(price ?? 0, 'Phí dịch vụ');
  const quantity = qty === undefined || qty === '' ? 1 : posMoney(qty, 'Số lượng phí dịch vụ');
  if (unitPrice > 0 && !text) throw new AppError(400, 'Nhập tên khoản phí, ví dụ phí in hoặc phí gói quà.');
  if (quantity < 1) throw new AppError(400, 'Số lượng phí dịch vụ phải từ 1 trở lên.');
  return { name: text, unitPrice, quantity };
}
/** Customer-facing charges. Keep flat inputs unchanged for old QR/replay hashes. */
export function posFeeInput(b: Record<string, unknown>): FeeInput {
  const shippingFee = posMoney(b.shippingFee ?? 0, 'Phí ship');
  if (b.serviceFees !== undefined) {
    if (!Array.isArray(b.serviceFees) || b.serviceFees.length > 50) throw new AppError(400, 'Tối đa 50 dòng phí dịch vụ.');
    if (b.feeName || Number(b.feeAmount)) throw new AppError(400, 'Chỉ gửi một định dạng phí dịch vụ.');
    const serviceFees = b.serviceFees.map((row: unknown) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new AppError(400, 'Dòng phí dịch vụ không hợp lệ.');
      const r = row as Record<string, unknown>; return serviceInput(r.name, r.unitPrice, r.quantity);
    }).filter(r => r.name || r.unitPrice);
    return serviceFees.length || shippingFee ? { serviceFees, shippingFee } : {};
  }
  const fee = serviceInput(b.feeName, b.feeAmount, b.feeQuantity);
  return fee.name || fee.unitPrice || shippingFee ? { feeName: fee.name, feeAmount: fee.unitPrice, feeQuantity: fee.quantity, shippingFee } : {};
}
export function calculatePosFees(b: Record<string, unknown>, taxRate: number) {
  const input = posFeeInput(b), shippingFee = input.shippingFee ?? 0;
  const calculate = (row: ServiceInput) => {
    const calculated = posLine({ price: row.unitPrice, qty: row.quantity, taxRate, priceIncludesVat: taxRate > 0, vatEnabled: taxRate > 0 });
    return { name: row.name, ...calculated, unitPrice: row.unitPrice, quantity: row.quantity, amount: calculated.total };
  };
  const services = (input.serviceFees ?? (input.feeName || input.feeAmount ? [{ name: input.feeName ?? '', unitPrice: input.feeAmount ?? 0, quantity: input.feeQuantity ?? 1 }] : [])).map(calculate);
  const zero = calculate({ name: '', unitPrice: 0, quantity: 1 });
  const sum = (key: 'amount' | 'subtotal' | 'tax') => posMoney(services.reduce((n, s) => n + s[key], 0));
  // Aggregate remains available to returns, old clients and integrations. VAT rounds per fee line.
  const service = services.length === 1 ? services[0]! : { ...zero, name: services.length ? `Phí dịch vụ (${services.length} khoản)` : '', unitPrice: sum('amount'), listUnitPrice: sum('amount'), listAmount: sum('amount'), subtotal: sum('subtotal'), tax: sum('tax'), total: sum('amount'), amount: sum('amount') };
  return { service, services, shippingFee, subtotal: posMoney(service.subtotal + shippingFee), tax: service.tax, total: posMoney(service.total + shippingFee) };
}
export function snapshotPosFees(snapshot: { fees?: ReturnType<typeof calculatePosFees> }) {
  const f = snapshot.fees;
  if (!f) return calculatePosFees({}, 0);
  if (Array.isArray(f.services)) return calculatePosFees({ serviceFees: f.services.map(s => ({ name: s.name, unitPrice: s.unitPrice, quantity: s.quantity })), shippingFee: f.shippingFee }, f.service.taxRate);
  const structured = Object.prototype.hasOwnProperty.call(f.service, 'quantity');
  return calculatePosFees({ feeName: f.service.name, feeAmount: structured ? f.service.unitPrice : f.service.amount, feeQuantity: structured ? f.service.quantity : 1, shippingFee: f.shippingFee }, f.service.taxRate);
}
