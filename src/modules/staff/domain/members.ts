import { AppError } from '../../../core/errors.ts';
import { roleFromPosition, type Role } from './roles.ts';

/**
 * Quy tắc quản lý nhân viên (Manager). Port từ các route `/admin/member*` của bản cũ; giữ nguyên mã lỗi và thông báo.
 * Vai trò LUÔN suy từ chức vụ (`roleFromPosition`), bất kể client gửi `role` gì – nên không thể tạo ra tài khoản
 * lệch giữa vai trò và chức vụ từ trang quản lý.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; // giống bản cũ (khác biểu thức email của đơn NCC)
export const ACTIVATION_TTL_SECONDS = 900;

/** Chức vụ mặc định (dữ liệu tham chiếu, được nạp bằng migration). id 'manager' và 'supplier' có ý nghĩa đặc biệt. */
export const DEFAULT_POSITIONS: readonly { id: string; name: string }[] = [
  { id: 'manager', name: 'Manager' }, { id: 'sale', name: 'Sale' }, { id: 'sale-admin', name: 'Sale Admin' },
  { id: 'sales-ml', name: 'NVBH ML' }, { id: 'sales-lock', name: 'NVBH LOCK' }, { id: 'warehouse', name: 'Kho' },
  { id: 'accounting', name: 'Kế toán' }, { id: 'supplier', name: 'NCC' },
];

const bad = (status: number, message: string) => new AppError(status, message);
const PHONE_MSG = 'Vui lòng nhập số điện thoại nhân viên (tối đa 40 ký tự).';
const NAME_EMAIL_MSG = 'Nhập họ tên và địa chỉ email hợp lệ.';

function cleanNameEmail(b: Record<string, unknown>) {
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '', name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name || name.length > 200 || email.length > 254 || !EMAIL.test(email)) throw bad(400, NAME_EMAIL_MSG);
  return { name, email };
}
function cleanPhoneRequired(b: Record<string, unknown>): string {
  if (typeof b.phone !== 'string' || !b.phone.trim() || b.phone.trim().length > 40) throw bad(400, PHONE_MSG);
  return b.phone.trim();
}

export interface NewMemberInput { name: string; email: string; phone: string; positionId: string }
/** Bước 1 khi tạo nhân viên: kiểm dữ liệu gửi lên (chưa kiểm chức vụ/email có tồn tại không – việc của repo). Thứ tự kiểm giống bản cũ. */
export function cleanNewMember(b: Record<string, unknown>): NewMemberInput {
  const phone = cleanPhoneRequired(b);
  const { name, email } = cleanNameEmail(b);
  return { name, email, phone, positionId: typeof b.positionId === 'string' ? b.positionId : '' };
}

export interface MemberUpdateInput { id: string; name: string; email: string; phone: string; positionId: string; active: boolean }
export function cleanMemberUpdate(b: Record<string, unknown>): MemberUpdateInput {
  if (!['manager', 'employee', 'supplier'].includes(b.role as string) || typeof b.active !== 'boolean') throw bad(400, 'Quyền không hợp lệ.');
  const { name, email } = cleanNameEmail(b);
  const phone = typeof b.phone === 'string' ? b.phone.trim() : '';
  if (!phone || phone.length > 40) throw bad(400, PHONE_MSG);
  return { id: String(b.id ?? ''), name, email, phone, positionId: typeof b.positionId === 'string' ? b.positionId : '', active: b.active };
}

export function cleanPhone(b: Record<string, unknown>): { id: string; phone: string } {
  if (typeof b.phone !== 'string' || b.phone.trim().length > 40) throw bad(400, 'Số điện thoại không hợp lệ.');
  return { id: String(b.id ?? ''), phone: b.phone.trim() };
}

/** Manager không tự thao tác trên chính mình (đổi quyền/khoá/xoá/đặt lại mật khẩu). */
export const SELF_MESSAGES = {
  reset: 'Dùng chức năng đổi mật khẩu cho tài khoản của mình.',
  remove: 'Không thể xoá tài khoản đang đăng nhập.',
  update: 'Không tự thay đổi quyền hoặc khóa tài khoản của mình.',
} as const;
export function assertNotSelf(actorId: string, targetId: unknown, message: string): void {
  if (targetId === actorId) throw bad(400, message);
}

export const newMemberId = (): string => 'NV-' + crypto.randomUUID();
export const memberRole = (positionId: string): Role => roleFromPosition(positionId);

/** Liên kết kích hoạt gửi cho nhân viên (hiệu lực 15 phút). Token ở phần #fragment nên không đi qua máy chủ/log. */
export const activationLink = (origin: string, email: string, token: string): string =>
  `${origin}/login.html#email=${encodeURIComponent(email)}&token=${token}`;
