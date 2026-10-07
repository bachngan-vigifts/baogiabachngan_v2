/**
 * Khách hàng: vai trò nhân viên với khách và giới hạn dữ liệu (một chỗ để sửa).
 *  - owner  = nhân viên phụ trách (mỗi khách tối đa một người);
 *  - shared = nhân viên được chia sẻ (xem được báo giá / đơn / HĐKT / công nợ của khách như người phụ trách).
 */
export const CUSTOMER_STAFF_ROLES = ['owner', 'shared'] as const;
export type CustomerStaffRole = typeof CUSTOMER_STAFF_ROLES[number];
export const CUSTOMER_LIMITS = { contacts: 50, shared: 30, contactName: 200, contactTitle: 120, contactNote: 1000 } as const;
/** Duyệt khách hàng mới: nhân viên tạo → `pending` (chưa dùng được cho báo giá / đơn), Manager duyệt → `approved`. Khách Sapo luôn `approved`. */
export const APPROVAL_STATUSES = ['pending', 'approved'] as const;
export type ApprovalStatus = typeof APPROVAL_STATUSES[number];
