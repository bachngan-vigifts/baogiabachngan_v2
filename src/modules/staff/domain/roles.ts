import { scopeOf } from './permissions.ts';
/**
 * Vai trò và chức vụ. Bản cũ SUY vai trò từ chức vụ (`roleFromPosition` trong staff-api.mjs):
 * chức vụ 'manager' → manager, chức vụ 'supplier' (tên hiển thị "NCC") → supplier, còn lại → employee.
 */
export type Role = 'employee' | 'manager' | 'supplier' | 'customer';
export const MANAGER_POSITION_ID = 'manager';
export const SALE_POSITION_ID = 'sale';
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

/**
 * Phạm vi "Toàn công ty (chỉ xem)" của chức vụ (trang Phân quyền; mặc định chỉ Sale Admin – domain/permissions.ts).
 * CHỈ áp cho báo giá, khách hàng, đơn hàng / HĐKT (kèm giao hàng, công nợ của đơn) – yêu cầu 17/10/2026; các mục khác
 * (khách hỏi tồn, chăm sóc, doanh số…) theo phạm vi thường. Không mở quyền duyệt (duyệt = cờ "Được duyệt", domain/permissions.ts).
 * Quyền SỬA dữ liệu người khác của Sale Admin chưa chốt – xem docs/PHAN-QUYEN.md. Muốn thu hồi: cho hàm này trả false.
 */
export const SALE_ADMIN_POSITION_ID = 'sale-admin';
export const seesAllAsSaleAdmin = (m: { role: string; positionId?: string | null; dataScope?: string | null } | null | undefined): boolean =>
  Boolean(m && m.role === 'employee' && scopeOf(m) === 'all');

/** Báo lỗi dữ liệu lệch giữa vai trò và chức vụ (null = nhất quán). Dùng khi tạo/sửa nhân viên và khi chuyển dữ liệu. */
export function roleConsistencyIssue(m: MemberLike): string | null {
  const expected = roleFromPosition(m.positionId);
  return m.role === expected ? null : `vai trò "${m.role}" không khớp chức vụ "${m.positionId ?? ''}" (mong đợi "${expected}")`;
}

/** Target registration and dashboard tracking; never grants salary bonus eligibility. */
export const SALES_KPI_POSITIONS = [SALE_POSITION_ID, SALE_ADMIN_POSITION_ID] as const;
export const tracksSalesKpi = (positionId: string | null | undefined) => SALES_KPI_POSITIONS.some(id => id === positionId);
