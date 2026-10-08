import { sql } from 'drizzle-orm';
import { pgTable, text, bigint, index, check } from 'drizzle-orm/pg-core';
import { enumCheck } from '../../core/db/enum-check.ts';
import { employees } from '../staff/schema.ts';
import { customers } from '../customers/schema.ts';
import { CARE_RESULTS, CARE_TYPES } from './domain/care.ts';

/**
 * Nhật ký chăm sóc khách hàng (giao dịch CRM): mỗi dòng = một lần trao đổi với khách + lịch hẹn chăm sóc tiếp (tuỳ chọn).
 * Quyền: nhân viên chỉ xem / sửa dòng mình ghi (`owner_id`); Manager xem / sửa tất cả.
 * Hẹn chăm sóc tiếp chưa xong (`next_at` có, `next_done_at` trống) → việc tự sinh cho người ghi (tasks/api/auto-tasks.ts).
 */
export const customerActivities = pgTable('customer_activities', {
  id: text('id').primaryKey(),
  customerId: text('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  ownerId: text('owner_id').notNull().references(() => employees.id),
  type: text('type', { enum: CARE_TYPES }).notNull(),
  result: text('result', { enum: CARE_RESULTS }).notNull().default('none'),
  /** Thời điểm trao đổi (ISO, UTC). */
  occurredAt: text('occurred_at').notNull(),
  /** Người bên khách đã trao đổi (tự do; gợi ý từ danh bạ khách). */
  contactName: text('contact_name').notNull().default(''),
  subject: text('subject').notNull().default(''),
  content: text('content').notNull().default(''),
  /** Hẹn chăm sóc tiếp: ngày (YYYY-MM-DD, giờ Việt Nam) + việc cần làm; xong thì ghi `next_done_at`. */
  nextAt: text('next_at'),
  nextAction: text('next_action').notNull().default(''),
  nextDoneAt: text('next_done_at'),
  revision: bigint('revision', { mode: 'number' }).notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, t => [
  index('idx_customer_activities_owner').on(t.ownerId, t.occurredAt),
  index('idx_customer_activities_customer').on(t.customerId, t.occurredAt),
  index('idx_customer_activities_follow_up').on(t.ownerId, t.nextAt).where(sql`${t.nextAt} IS NOT NULL AND ${t.nextDoneAt} IS NULL`),
  enumCheck('chk_customer_activities_type', t.type, CARE_TYPES),
  enumCheck('chk_customer_activities_result', t.result, CARE_RESULTS),
  check('chk_customer_activities_text', sql`length(trim(${t.subject})) > 0 OR length(trim(${t.content})) > 0`),
]).enableRLS();
