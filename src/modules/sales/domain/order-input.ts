import { AppError } from '../../../core/errors.ts';

/** Optional creation overrides. Missing note inherits quote notes; explicit empty clears it. */
export function cleanOrderInput(raw: Record<string, unknown>) {
  const str = (key: string, max: number) => {
    if (raw[key] === undefined) return undefined;
    if (typeof raw[key] !== 'string' || (raw[key] as string).length > max) throw new AppError(400, `Thông tin đơn hàng không hợp lệ: ${key}.`);
    return (raw[key] as string).trim();
  };
  const date = (key: string) => {
    const s = str(key, 10); if (s === undefined) return undefined;
    if (s === '' && key === 'deliveryDate') return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s + 'T00:00:00Z')) || new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) !== s) throw new AppError(400, 'Ngày đặt / ngày hẹn giao không hợp lệ.');
    return s;
  };
  return { receiverName: str('receiverName', 500), receiverPhone: str('receiverPhone', 100), note: str('note', 20000), deliveryAddress: str('deliveryAddress', 2000), orderDate: date('orderDate') ?? undefined, deliveryDate: date('deliveryDate') };
}
