import { pgTable, text, index, uniqueIndex, check, integer, primaryKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { employees } from '../staff/schema.ts';
import { enumCheck } from '../../core/db/enum-check.ts';
import { WEEKLY_REVIEWS } from './domain/weekly.ts';

/**
 * Báo cáo tuần của Sale / Sale Admin (nộp chính thức). Một báo cáo / người / tuần (period = thứ Hai).
 * `submitted_at` giữ giờ nộp chính thức đầu tiên (xét đúng hạn); nộp lại thêm bản vào `staff_weekly_report_versions`.
 */
export const staffWeeklyReports = pgTable('staff_weekly_reports', {
  id: text('id').primaryKey(),
  memberId: text('member_id').notNull().references(() => employees.id),
  period: text('period').notNull(),
  data: text('data').notNull(),
  submittedAt: text('submitted_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  clientKey: text('client_key').notNull(),
  review: text('review', { enum: WEEKLY_REVIEWS }).notNull().default('pending'),
  reviewNote: text('review_note').notNull().default(''),
  reviewedBy: text('reviewed_by').references(() => employees.id),
  reviewedAt: text('reviewed_at'),
}, t => [
  uniqueIndex('uq_staff_weekly_reports_period').on(t.memberId, t.period),
  uniqueIndex('uq_staff_weekly_reports_client_key').on(t.memberId, t.clientKey),
  index('idx_staff_weekly_reports_review').on(t.review, t.period),
  enumCheck('chk_staff_weekly_reports_review', t.review, WEEKLY_REVIEWS),
  check('chk_staff_weekly_reports_period', sql`${t.period} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`),
]).enableRLS();

/** Nháp (chỉ phần nhân viên nhập) – không tính là đã nộp. */
export const staffWeeklyReportDrafts = pgTable('staff_weekly_report_drafts', {
  memberId: text('member_id').notNull().references(() => employees.id),
  period: text('period').notNull(),
  inputs: text('inputs').notNull(),
  updatedAt: text('updated_at').notNull(),
}, t => [primaryKey({ columns: [t.memberId, t.period], name: 'staff_weekly_report_drafts_pkey' })]).enableRLS();

/** Lịch sử mỗi lần nộp chính thức (bản chụp số liệu + nội dung). */
export const staffWeeklyReportVersions = pgTable('staff_weekly_report_versions', {
  id: text('id').primaryKey(),
  reportId: text('report_id').notNull().references(() => staffWeeklyReports.id),
  version: integer('version').notNull(),
  data: text('data').notNull(),
  submittedAt: text('submitted_at').notNull(),
}, t => [
  uniqueIndex('uq_staff_weekly_report_versions').on(t.reportId, t.version),
  check('chk_staff_weekly_report_versions_version', sql`${t.version} >= 1`),
]).enableRLS();
