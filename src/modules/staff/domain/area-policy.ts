import { isCustomer, isSupplier, type MemberLike } from './roles.ts';

/**
 * Khu vực chức năng và ai được vào.
 *  - 'public'          không cần đăng nhập (đăng nhập, kích hoạt tài khoản)
 *  - 'self'            /me, /logout, /password – mọi tài khoản đang hoạt động
 *  - 'supplier-portal' cổng NCC (xem đơn đã duyệt, xác nhận, ký, đặt cọc, báo giao hàng) – NCC và manager
 *  - 'ncc-admin'       quản lý NCC phía công ty (duyệt đơn, xin hàng, thanh toán cọc) – chỉ manager
 *  - 'admin'           quản trị hệ thống (nhân viên, sao lưu...) – chỉ manager
 *  - 'customer-portal' trang riêng của khách hàng (xem/tạo báo giá, đặt hàng) – CHỈ tài khoản khách hàng
 *  - 'sapo-sync'       nhận dữ liệu đồng bộ từ Sapo – KHÔNG dùng phiên đăng nhập, chỉ mã bí mật SAPO_SYNC_TOKEN
 *  - 'synctime-sync'   nhận webhook SyncTime – mã Bearer riêng được Manager tạo, không dùng mã Sapo
 *  - 'business'        mọi chức năng còn lại (báo giá, khách hàng, sản phẩm, hợp đồng, CRM, báo cáo...) – nhân viên và manager
 *
 * Quy tắc chốt 05/10/2026: tài khoản NCC CHỈ được vào 'self' và 'supplier-portal' – trang NCC, không gì khác.
 * Mọi route mới BẮT BUỘC khai báo khu vực; không khai báo thì không được đăng ký (sẽ có test chặn khi có API).
 */
export type Area = 'public' | 'self' | 'supplier-portal' | 'ncc-admin' | 'admin' | 'business' | 'sapo-sync' | 'transfer-sync' | 'sepay-sync' | 'web-order-sync' | 'ghn-webhook' | 'synctime-sync' | 'customer-portal';

/** Thông báo 403 theo khu vực (giữ như bản cũ). NCC đi sai khu vực luôn nhận thông báo riêng của NCC. */
export const FORBIDDEN_MESSAGE: Record<Area, string> = {
  public: '', self: '', business: 'Bạn không có quyền sử dụng chức năng này.', 'supplier-portal': 'Bạn không có quyền sử dụng chức năng này.',
  'ncc-admin': 'Chỉ Manager được xem chức năng NCC.', admin: 'Chỉ Manager được quản lý nhân viên.', 'sapo-sync': 'Không được phép đồng bộ.', 'sepay-sync': 'Webhook SePay không hợp lệ.', 'web-order-sync': 'Webhook đơn web không hợp lệ.', 'ghn-webhook': 'Webhook GHN không hợp lệ.', 'synctime-sync': 'Mã webhook không hợp lệ.',
  'customer-portal': 'Trang này dành cho tài khoản khách hàng.',
  'transfer-sync': 'Không được phép tích hợp điều chuyển.',
};
export const SUPPLIER_FORBIDDEN_MESSAGE = 'Tài khoản NCC chỉ được xem đơn hàng NCC đã duyệt.';
export const CUSTOMER_FORBIDDEN_MESSAGE = 'Tài khoản khách hàng chỉ dùng được trang khách hàng.';
export type PolicyMember = MemberLike & { active: boolean };

export function canAccessArea(member: PolicyMember | null | undefined, area: Area): boolean {
  if (area === 'public') return true;
  if (area === 'sapo-sync' || area === 'transfer-sync' || area === 'sepay-sync' || area === 'web-order-sync' || area === 'ghn-webhook' || area === 'synctime-sync' || !member?.active) return false; // webhook không dùng phiên tài khoản người dùng
  if (isSupplier(member)) return area === 'self' || area === 'supplier-portal';
  // Khách hàng chỉ vào trang khách hàng; ngược lại trang khách hàng chỉ dành cho khách (nhân viên/Manager không gọi được).
  if (isCustomer(member)) return area === 'self' || area === 'customer-portal';
  if (area === 'customer-portal') return false;
  if (member.role === 'manager') return true;
  return area === 'self' || area === 'business';
}

const SUPPLIER_PAGES = new Set(['/supplier', '/supplier.html']);
const SUPPLIER_ALLOWED_PAGES = new Set([...SUPPLIER_PAGES, '/login.html']);

/**
 * Chuyển hướng ở tầng TRANG (port từ worker/index.ts). Trả về đường dẫn cần chuyển tới, hoặc null nếu cho qua.
 * NCC chỉ ở /supplier (và trang đăng nhập); nhân viên thường không vào trang NCC; manager vào được cả hai.
 */
export function pageRedirect(member: PolicyMember | null | undefined, pathname: string): string | null {
  if (!member?.active) return null; // chưa đăng nhập: để lớp đăng nhập xử lý
  if (isSupplier(member)) return SUPPLIER_ALLOWED_PAGES.has(pathname) ? null : '/supplier';
  if (member.role === 'employee' && SUPPLIER_PAGES.has(pathname)) return '/';
  return null;
}
