import { pgTable, text, index, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { employees } from '../staff/schema.ts';
import { posRegisters } from '../sales/pos-schema.ts';
import { enumCheck } from '../../core/db/enum-check.ts';
import { STORE_REPORT_KINDS, STORE_REVIEW_STATUSES } from './domain/reports.ts';

/** Cửa hàng trưởng (CHT) của từng cửa hàng (quầy POS): mỗi cửa hàng một CHT, mỗi người phụ trách tối đa một cửa hàng. */
export const storeManagers = pgTable('store_managers', {
  registerId: text('register_id').primaryKey().references(() => posRegisters.id),
  memberId: text('member_id').notNull().references(() => employees.id),
  assignedBy: text('assigned_by').notNull().references(() => employees.id),
  assignedAt: text('assigned_at').notNull(),
}, t => [uniqueIndex('uq_store_managers_member').on(t.memberId)]).enableRLS();

/**
 * Báo cáo CHT (ngày / tuần / tháng / kiểm tồn kho). Một báo cáo / cửa hàng / loại / kỳ; nộp lại thì cập nhật nội dung
 * nhưng giữ giờ nộp lần đầu (`submitted_at`) để xét đúng hạn. `data`: số liệu CRM tự điền lúc nộp + phần CHT nhập (JSON).
 */
export const storeReports = pgTable('store_reports', {
  id: text('id').primaryKey(),
  registerId: text('register_id').notNull().references(() => posRegisters.id),
  kind: text('kind', { enum: STORE_REPORT_KINDS }).notNull(),
  period: text('period').notNull(),
  memberId: text('member_id').notNull().references(() => employees.id),
  data: text('data').notNull(),
  submittedAt: text('submitted_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  clientKey: text('client_key').notNull(),
  review: text('review', { enum: STORE_REVIEW_STATUSES }).notNull().default('pending'),
  reviewNote: text('review_note').notNull().default(''),
  reviewedBy: text('reviewed_by').references(() => employees.id),
  reviewedAt: text('reviewed_at'),
  explanation: text('explanation').notNull().default(''),
}, t => [
  uniqueIndex('uq_store_reports_period').on(t.registerId, t.kind, t.period),
  uniqueIndex('uq_store_reports_client_key').on(t.memberId, t.clientKey),
  index('idx_store_reports_review').on(t.review, t.submittedAt),
  enumCheck('chk_store_reports_kind', t.kind, STORE_REPORT_KINDS),
  enumCheck('chk_store_reports_review', t.review, STORE_REVIEW_STATUSES),
  check('chk_store_reports_period', sql`${t.period} ~ '^[0-9]{4}-[0-9]{2}(-[0-9]{2})?$'`),
]).enableRLS();
