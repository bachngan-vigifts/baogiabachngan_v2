import { AppError, forbidden } from '../../../core/errors.ts';
import { isSupplier, type Role } from '../../staff/domain/roles.ts';

/*
 * Danh mục NCC: quy tắc nhập liệu và gắn tài khoản. Mọi thứ NCC (tên, email nhận đơn, ai đăng nhập thay mặt NCC nào)
 * là DỮ LIỆU sửa được trên trang quản lý NCC, không viết cứng trong code như bản cũ.
 */
const EMAIL = /^\S+@\S+\.\S+$/; // giống bản cũ (approveSupplierOrder)
export const MAX_CC_EMAILS = 20; // giống bản cũ

/** Khoá so sánh tên NCC: bỏ dấu, hạ chữ, gộp khoảng trắng; coi "đ" như "d" để "Đông Á" và "Dong A" là một. */
export const supplierNameKey = (name: string): string =>
  name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/đ/g, 'd').trim().replace(/\s+/g, ' ');

export interface SupplierInput { name: string; taxCode?: string; address?: string; phone?: string; email?: string; note?: string }
export interface CleanSupplier { name: string; nameKey: string; taxCode: string; address: string; phone: string; email: string; note: string }

const LIMITS = { name: 180, taxCode: 40, address: 1000, phone: 40, email: 254, note: 2000 } as const;

export function cleanSupplierInput(input: unknown): CleanSupplier {
  const bad = () => new AppError(400, 'Thông tin nhà cung cấp không hợp lệ.');
  if (!input || typeof input !== 'object') throw bad();
  const src = input as Record<string, unknown>, out: Record<string, string> = {};
  for (const [field, max] of Object.entries(LIMITS)) {
    const v = src[field] ?? '';
    if (typeof v !== 'string' || v.length > max) throw bad();
    out[field] = v.trim();
  }
  if (!out.name) throw new AppError(400, 'Cần nhập tên nhà cung cấp.');
  if (out.email && !EMAIL.test(out.email)) throw new AppError(400, 'Email nhà cung cấp không hợp lệ.');
  return { name: out.name!, nameKey: supplierNameKey(out.name!), taxCode: out.taxCode!, address: out.address!, phone: out.phone!, email: out.email!, note: out.note! };
}

export interface ContactInput { kind: 'order' | 'cc'; email: string; name?: string; phone?: string }
export function cleanContacts(list: unknown): Required<ContactInput>[] {
  if (!Array.isArray(list)) throw new AppError(400, 'Danh sách liên hệ không hợp lệ.');
  const seen = new Set<string>(), out: Required<ContactInput>[] = [];
  for (const c of list as ContactInput[]) {
    const email = String(c?.email ?? '').trim().toLowerCase();
    if (!['order', 'cc'].includes(c?.kind) || !EMAIL.test(email) || email.length > 254) throw new AppError(400, 'Email liên hệ không hợp lệ.');
    const name = String(c.name ?? '').trim(), phone = String(c.phone ?? '').trim();
    if (name.length > 120 || phone.length > 40) throw new AppError(400, 'Thông tin liên hệ quá dài.');
    const key = `${c.kind}:${email}`;
    if (seen.has(key)) continue; // bỏ trùng thay vì báo lỗi (gõ lặp là chuyện thường)
    seen.add(key); out.push({ kind: c.kind, email, name, phone });
  }
  if (out.filter(c => c.kind === 'cc').length > MAX_CC_EMAILS) throw new AppError(400, 'Email CC không hợp lệ.');
  return out;
}

/** Địa chỉ gửi đơn điền sẵn khi duyệt đơn: To = liên hệ `order` đầu tiên, CC = mọi liên hệ `cc`. */
export function defaultRecipients(contacts: readonly { kind: 'order' | 'cc'; email: string }[]): { to: string; cc: string[] } {
  return { to: contacts.find(c => c.kind === 'order')?.email ?? '', cc: contacts.filter(c => c.kind === 'cc').map(c => c.email) };
}

/** Chỉ Manager quản lý danh mục NCC và gắn tài khoản. */
export const canManageSuppliers = (actor: { role: Role; active: boolean; positionId?: string | null } | null | undefined): boolean =>
  Boolean(actor?.active && actor.role === 'manager' && !isSupplier(actor));

export interface MemberRef { id: string; role: Role; active: boolean; positionId?: string | null }
export interface SupplierRef { id: string; active: boolean }

/** Kiểm tra trước khi gắn một tài khoản vào NCC (mỗi tài khoản thuộc đúng một NCC; đổi NCC = gắn lại). */
export function planAccountLink(actor: Parameters<typeof canManageSuppliers>[0], member: MemberRef | null | undefined, supplier: SupplierRef | null | undefined): { memberId: string; supplierId: string } {
  if (!canManageSuppliers(actor)) throw forbidden('Chỉ Manager được quản lý nhà cung cấp.');
  if (!supplier?.active) throw new AppError(400, 'Nhà cung cấp không tồn tại hoặc đã ngừng hoạt động.');
  if (!member?.active) throw new AppError(400, 'Tài khoản không tồn tại hoặc đã bị khoá.');
  if (!isSupplier(member)) throw new AppError(400, 'Chỉ gắn được tài khoản có chức vụ NCC vào nhà cung cấp.');
  return { memberId: member.id, supplierId: supplier.id };
}
