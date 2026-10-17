import { scopeOf } from './permissions.ts';
/**
 * Nhóm dữ liệu "cùng phòng" của nhân viên theo phạm vi dữ liệu của chức vụ (trang Phân quyền):
 *  own → không chia sẻ (null) · position → cùng chức vụ · department / all → cùng chức vụ ở đây; mở rộng cả phòng ban
 *  nằm ở `departmentOwner` (api/department.ts); "toàn công ty" xử lý riêng qua `seesAllAsSaleAdmin`.
 */
export interface DepartmentViewer { id: string; role: string; positionId?: string | null; active?: boolean; dataScope?: string | null; departmentId?: string | null }
export const departmentOf = (m: DepartmentViewer) => m.role === 'employee' && m.active !== false && m.positionId && !['manager', 'customer', 'supplier'].includes(m.positionId) && scopeOf(m) !== 'own' ? m.positionId : null;
