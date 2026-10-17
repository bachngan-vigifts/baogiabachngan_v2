import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { employees, positions } from '../schema.ts';
import { scopeOf } from '../domain/permissions.ts';
import { departmentOf, type DepartmentViewer } from '../domain/department.ts';
/**
 * Nhân viên (đang làm, chưa xoá) chia sẻ dữ liệu với người xem: cùng chức vụ, hoặc cả phòng ban khi chức vụ để phạm vi
 * "Cả phòng ban" (trang Phân quyền). Phạm vi "Chỉ của mình" → undefined (chỉ dữ liệu của chính người xem).
 */
export function departmentOwner(column: AnyPgColumn, viewer: DepartmentViewer): SQL | undefined {
  const position = departmentOf(viewer);
  if (!position) return undefined;
  if (scopeOf(viewer) === 'department' && viewer.departmentId)
    return sql`${column} IN (SELECT ${employees.id} FROM ${employees} JOIN ${positions} ON ${positions.id} = ${employees.positionId} WHERE ${positions.departmentId} = ${viewer.departmentId} AND ${employees.role} = 'employee' AND ${employees.active} = true AND ${employees.deletedAt} IS NULL)`;
  return sql`${column} IN (SELECT ${employees.id} FROM ${employees} WHERE ${employees.positionId} = ${position} AND ${employees.role} = 'employee' AND ${employees.active} = true AND ${employees.deletedAt} IS NULL)`;
}
