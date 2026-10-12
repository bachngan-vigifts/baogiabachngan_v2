import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { employees } from '../schema.ts';
import { departmentOf, type DepartmentViewer } from '../domain/department.ts';
/** Active, non-deleted employees in the requester's assigned department. */
export function departmentOwner(column: AnyPgColumn, viewer: DepartmentViewer): SQL | undefined {
  const position = departmentOf(viewer);
  return position ? sql`${column} IN (SELECT ${employees.id} FROM ${employees} WHERE ${employees.positionId} = ${position} AND ${employees.role} = 'employee' AND ${employees.active} = true AND ${employees.deletedAt} IS NULL)` : undefined;
}
