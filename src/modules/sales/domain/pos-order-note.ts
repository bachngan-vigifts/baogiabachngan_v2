import { AppError } from '../../../core/errors.ts';
export function posOrderNote(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > 2000) throw new AppError(400, 'Ghi chú đơn hàng tối đa 2.000 ký tự.');
  return value.trim();
}
