import { pgTable, text, integer, primaryKey, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { employees } from '../staff/schema.ts';

// Lượt chấm máy gốc để đối chiếu, độc lập ngày công / lương đã duyệt.
export const admsLogs = pgTable('hr_adms_logs', {
  companyId: integer('company_id').notNull(),
  logId: text('log_id').notNull(),
  empCode: text('emp_code').notNull(),
  fullName: text('full_name').notNull(),
  checkTime: text('check_time').notNull(), // giờ địa phương Asia/Ho_Chi_Minh, không đổi qua UTC
  punchState: integer('punch_state').notNull(),
  deviceSerial: text('device_serial').notNull(),
  source: text('source').notNull(),
  importedAt: text('imported_at').notNull(),
}, t => [primaryKey({ columns: [t.companyId, t.logId] }),
  index('idx_adms_company_time').on(t.companyId, t.checkTime, t.logId),
  index('idx_adms_employee_time').on(t.companyId, t.empCode, t.checkTime)]).enableRLS();

export const admsMembers = pgTable('hr_adms_members', {
  companyId: integer('company_id').notNull(),
  empCode: text('emp_code').notNull(),
  memberId: text('member_id').notNull().references(() => employees.id),
  updatedAt: text('updated_at').notNull(),
  updatedBy: text('updated_by').notNull().references(() => employees.id),
}, t => [primaryKey({ columns: [t.companyId, t.empCode] }),
  uniqueIndex('idx_adms_member_company').on(t.companyId, t.memberId)]).enableRLS();

export const admsSyncState = pgTable('hr_adms_sync_state', {
  companyId: integer('company_id').primaryKey(),
  fromDate: text('from_date').notNull(),
  toDate: text('to_date').notNull(),
  syncedAt: text('synced_at').notNull(),
  syncedBy: text('synced_by').notNull().references(() => employees.id),
  fetched: integer('fetched').notNull(),
}).enableRLS();
