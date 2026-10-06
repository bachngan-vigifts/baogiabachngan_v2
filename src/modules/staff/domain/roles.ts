/**
 * Vai trò và chức vụ. Bản cũ SUY vai trò từ chức vụ (`roleFromPosition` trong staff-api.mjs):
 * chức vụ 'manager' → manager, chức vụ 'supplier' (tên hiển thị "NCC") → supplier, còn lại → employee.
 */
export type Role = 'employee' | 'manager' | 'supplier' | 'customer';
export const MANAGER_POSITION_ID = 'manager';
export const SUPPLIER_POSITION_ID = 'supplier';
/** Tài khoản khách hàng (trang riêng của khách: xem/tạo báo giá, đặt hàng). Không phải nhân viên. */
export const CUSTOMER_POSITION_ID = 'customer';

export const roleFromPosition = (positionId: string | null | undefined): Role =>
  positionId === MANAGER_POSITION_ID ? 'manager' : positionId === SUPPLIER_POSITION_ID ? 'supplier' : positionId === CUSTOMER_POSITION_ID ? 'customer' : 'employee';

export interface MemberLike { role: Role; positionId?: string | null }

/**
 * Tài khoản NCC = vai trò supplier HOẶC chức vụ 'supplier'. Kiểm tra cả hai (phòng thủ nhiều lớp):
 * dữ liệu lệch (role=employee nhưng chức vụ NCC) vẫn bị coi là NCC, tức là bị giới hạn chứ không được nới quyền.
 */
export const isSupplier = (m: MemberLike | null | undefined): boolean =>
  Boolean(m && (m.role === 'supplier' || m.positionId === SUPPLIER_POSITION_ID));

/** Tài khoản khách hàng = vai trò customer HOẶC chức vụ 'customer' (phòng thủ như NCC). */
export const isCustomer = (m: MemberLike | null | undefined): boolean =>
  Boolean(m && (m.role === 'customer' || m.positionId === CUSTOMER_POSITION_ID));

/** Báo lỗi dữ liệu lệch giữa vai trò và chức vụ (null = nhất quán). Dùng khi tạo/sửa nhân viên và khi chuyển dữ liệu. */
export function roleConsistencyIssue(m: MemberLike): string | null {
  const expected = roleFromPosition(m.positionId);
  return m.role === expected ? null : `vai trò "${m.role}" không khớp chức vụ "${m.positionId ?? ''}" (mong đợi "${expected}")`;
}
