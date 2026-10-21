import { AppError } from '../../../core/errors.ts';
import { posMoney } from './pos-money.ts';
export const CASH_KINDS = {
  other_income: 'Thu khác',
  cash_in: 'Rút két',
  petty_expense: 'Chi vặt',
  advance: 'Tạm ứng',
  cash_out: 'Nộp két',
  adjustment: 'Điều chỉnh két',
} as const;
export const CASH_REASONS = {
  counting: 'Đếm sai',
  wrong_change: 'Đưa nhầm tiền',
  small_change: 'Thiếu tiền lẻ',
  other: 'Khác',
} as const;
export function cashEntryInput(b: Record<string, unknown>) {
  const kind = String(b.kind) as keyof typeof CASH_KINDS;
  if (!Object.hasOwn(CASH_KINDS, kind)) throw new AppError(400, 'Chọn loại phiếu hợp lệ.');
  const amount = posMoney(b.amount);
  if (!amount) throw new AppError(400, 'Số tiền phải lớn hơn 0.');
  let reason = String(b.reason ?? '')
    .trim()
    .slice(0, 2000);
  if (!reason) throw new AppError(400, 'Nội dung hoặc lý do là bắt buộc.');
  if (b.entryName !== undefined) {
    if (typeof b.entryName !== 'string' || !b.entryName.trim() || b.entryName.trim().length > 120 || /[\r\n\u0000-\u001f]/.test(b.entryName))
      throw new AppError(400, 'Tên phiếu cần từ 1 đến 120 ký tự trên một dòng.');
    if (kind === 'adjustment') throw new AppError(400, 'Phiếu điều chỉnh giữ nguyên loại điều chỉnh két.');
    reason = `Tên phiếu: ${b.entryName.trim()}\n\n${reason}`;
  }
  const direction = kind === 'adjustment' ? b.direction : ['other_income', 'cash_in'].includes(kind) ? 'in' : 'out';
  if (direction !== 'in' && direction !== 'out') throw new AppError(400, 'Chọn chiều điều chỉnh.');
  return { kind, amount, reason, direction };
}
export function cashCloseReason(difference: number, code: unknown, note: unknown) {
  if (!difference) return { reasonCode: '', reasonNote: '', differenceReason: '' };
  if (typeof code !== 'string' || !Object.hasOwn(CASH_REASONS, code)) throw new AppError(400, 'Chọn lý do chênh lệch.');
  const reasonNote = String(note ?? '')
    .trim()
    .slice(0, 2000);
  if (code === 'other' && !reasonNote) throw new AppError(400, 'Chọn Khác cần ghi chú.');
  return {
    reasonCode: code,
    reasonNote,
    differenceReason: CASH_REASONS[code as keyof typeof CASH_REASONS] + (reasonNote ? ': ' + reasonNote : ''),
  };
}

/** A human-readable title line in the existing description, preserving the constrained accounting kind. */
export function cashEntryName(e: { reason: string; kind: string }) {
  const match = /^Tên phiếu: ([^\r\n]{1,120})\n\n/.exec(e.reason);
  return match?.[1] || CASH_KINDS[e.kind as keyof typeof CASH_KINDS] || e.kind;
}
