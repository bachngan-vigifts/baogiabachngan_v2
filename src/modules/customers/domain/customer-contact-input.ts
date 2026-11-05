import { AppError } from '../../../core/errors.ts';
import { CUSTOMER_LIMITS } from './customer-config.ts';

export function customerContactInput(body: Record<string, unknown>) {
  const text = (key: string, max: number) => {
    const value = body[key] ?? '';
    if (typeof value !== 'string' || value.length > max) throw new AppError(400, 'Thông tin người liên hệ không hợp lệ.');
    return value.trim();
  };
  const name = text('name', CUSTOMER_LIMITS.contactName), email = text('email', 200);
  if (!name) throw new AppError(400, 'Nhập tên người liên hệ.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError(400, 'Email người liên hệ không hợp lệ.');
  return { name, title: text('title', CUSTOMER_LIMITS.contactTitle), phone: text('phone', 40), email,
    note: text('note', CUSTOMER_LIMITS.contactNote), isPrimary: body.isPrimary === true };
}

/** Validate the complete initial profile before creating any canonical row. */
export function initialCustomerProfile(body: Record<string, unknown>) {
  const raw = body.contacts ?? [];
  if (!Array.isArray(raw) || raw.length > CUSTOMER_LIMITS.contacts || raw.some(r => !r || typeof r !== 'object' || Array.isArray(r)))
    throw new AppError(400, `Mỗi khách tối đa ${CUSTOMER_LIMITS.contacts} người liên hệ.`);
  const contacts = raw.map(row => customerContactInput(row));
  if (contacts.filter(row => row.isPrimary).length > 1) throw new AppError(400, 'Chỉ chọn một người liên hệ chính.');
  // Người đại diện là một dòng trong danh bạ vừa nhập (chưa có id): đánh dấu bằng `isRepresentative`, server gán id khi lưu.
  const flagged = raw.map((row, index) => (row as Record<string, unknown>).isRepresentative === true ? index : -1).filter(index => index >= 0);
  if (flagged.length > 1) throw new AppError(400, 'Chỉ chọn một người đại diện.');
  const notes = body.notes ?? '';
  if (typeof notes !== 'string' || notes.length > 5000) throw new AppError(400, 'Ghi chú khách hàng tối đa 5.000 ký tự.');
  const debtNote = body.legacyDebtNote ?? '';
  if (typeof debtNote !== 'string' || debtNote.length > 2000) throw new AppError(400, 'Ghi chú công nợ cũ tối đa 2.000 ký tự.');
  const shared = body.sharedIds ?? [];
  if (!Array.isArray(shared) || shared.length > CUSTOMER_LIMITS.shared || shared.some(id => typeof id !== 'string' || !id.trim() || id.length > 200))
    throw new AppError(400, 'Danh sách chia sẻ không hợp lệ.');
  return { contacts, notes: notes.trim(), debtNote: debtNote.trim(), representativeIndex: flagged[0] ?? -1, sharedIds: [...new Set(shared as string[])] };
}
