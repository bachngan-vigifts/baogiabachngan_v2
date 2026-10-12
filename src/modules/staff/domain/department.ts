/** Departments use the existing staff position assignment, never payroll groups. */
export interface DepartmentViewer { id: string; role: string; positionId?: string | null; active?: boolean }
export const departmentOf = (m: DepartmentViewer) => m.role === 'employee' && m.active !== false && m.positionId && !['manager', 'customer', 'supplier'].includes(m.positionId) ? m.positionId : null;
