import { AppError } from '../../../core/errors.ts';

export type SepayPayment = {
  providerId: string; amount: number; accountNumber: string; transactionAt: string;
  transferType: 'in'; content: string; payload: string;
};

const str = (v: unknown, max: number) => typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, max) : '';
export const normalizeSepayReference = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'D').toUpperCase().replace(/[^A-Z0-9]/g, '');

export function parseSepayPayment(body: Record<string, unknown>): SepayPayment {
  const transferType = str(body.transferType ?? body.transfer_type, 20).toLowerCase();
  const amount = Number(body.transferAmount ?? body.transfer_amount ?? body.amount);
  const providerId = str(body.id ?? body.transactionId ?? body.transaction_id ?? body.referenceCode, 200);
  const accountNumber = str(body.accountNumber ?? body.account_number, 100).replace(/\s+/g, '');
  const content = str(body.content ?? body.description, 2000);
  const rawAt = str(body.transactionDate ?? body.transaction_date ?? body.transactionTime ?? body.transaction_time, 100);
  const parsedAt = rawAt ? new Date(rawAt.includes('T') ? rawAt : rawAt.replace(' ', 'T') + '+07:00') : new Date();
  if (transferType !== 'in' || !providerId || !accountNumber || !Number.isFinite(amount) || amount <= 0 || !content || Number.isNaN(parsedAt.valueOf()) || parsedAt.valueOf() > Date.now() + 5 * 60_000)
    throw new AppError(400, 'Giao dịch SePay không hợp lệ.');
  const payload = JSON.stringify(body);
  if (payload.length > 32_000) throw new AppError(413, 'Gói SePay quá lớn.');
  return { providerId, amount: Math.round(amount), accountNumber, transactionAt: parsedAt.toISOString(), transferType: 'in', content, payload };
}

export function decideSepayMatch(matches: { id: string; outstanding: number }[], amount: number) {
  if (!matches.length) return { status: 'unmatched' as const, reason: 'Không tìm thấy mã đơn, báo giá hoặc hợp đồng trong nội dung chuyển khoản.' };
  if (matches.length > 1) return { status: 'review' as const, reason: 'Nội dung chuyển khoản khớp nhiều đơn; cần kế toán đối soát.' };
  const order = matches[0]!;
  if (order.outstanding <= 0) return { status: 'review' as const, reason: 'Đơn đã thu đủ; không tự động ghi nhận thêm.', orderId: order.id };
  if (amount > Math.round(order.outstanding)) return { status: 'review' as const, reason: 'Số tiền chuyển vượt công nợ còn lại.', orderId: order.id };
  return { status: 'matched' as const, reason: '', orderId: order.id };
}
