import { pgTable, text, index, uniqueIndex, check, integer, doublePrecision, boolean, primaryKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { employees } from '../staff/schema.ts';
import { posRegisters } from '../sales/pos-schema.ts';
import { enumCheck } from '../../core/db/enum-check.ts';
import { DEPOSIT_SCHEDULES, STORE_REPORT_KINDS, STORE_REVIEW_STATUSES } from './domain/reports.ts';

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

/**
 * Bản nháp của CHT (chỉ phần CHT nhập; số liệu CRM luôn tính lại khi mở). Nháp KHÔNG tính là đã nộp / đúng hạn.
 * Một nháp / cửa hàng / loại / kỳ; xoá khi nộp chính thức.
 */
export const storeReportDrafts = pgTable('store_report_drafts', {
  registerId: text('register_id').notNull().references(() => posRegisters.id),
  kind: text('kind', { enum: STORE_REPORT_KINDS }).notNull(),
  period: text('period').notNull(),
  memberId: text('member_id').notNull().references(() => employees.id),
  inputs: text('inputs').notNull(),
  updatedAt: text('updated_at').notNull(),
}, t => [
  primaryKey({ columns: [t.registerId, t.kind, t.period], name: 'store_report_drafts_pkey' }),
  enumCheck('chk_store_report_drafts_kind', t.kind, STORE_REPORT_KINDS),
]).enableRLS();

/**
 * Lịch sử mỗi lần NỘP CHÍNH THỨC (lần 1, nộp lại…): bản chụp số liệu CRM + phần CHT nhập + thời điểm tính + nguồn.
 * Không sửa / xoá; `store_reports.submitted_at` giữ giờ nộp chính thức đầu tiên (xét đúng hạn).
 */
export const storeReportVersions = pgTable('store_report_versions', {
  id: text('id').primaryKey(),
  reportId: text('report_id').notNull().references(() => storeReports.id),
  version: integer('version').notNull(),
  memberId: text('member_id').notNull().references(() => employees.id),
  data: text('data').notNull(),
  provisional: boolean('provisional').notNull().default(false),
  submittedAt: text('submitted_at').notNull(),
}, t => [
  uniqueIndex('uq_store_report_versions').on(t.reportId, t.version),
  check('chk_store_report_versions_version', sql`${t.version} >= 1`),
]).enableRLS();

/**
 * Cấu hình báo cáo theo cửa hàng (Manager đặt). Cột null = chưa cấu hình → báo cáo hiện "thiếu căn cứ", không tự coi là 0.
 *  cash_float: quỹ tiền mặt được giữ lại tại cửa hàng · deposit_schedule: lịch nộp tiền
 *  stocktake_explain_threshold: giá trị lệch / mã (đồng) từ đó phải giải trình riêng mã đó trong báo cáo kiểm tồn.
 */
export const storeSettings = pgTable('store_settings', {
  registerId: text('register_id').primaryKey().references(() => posRegisters.id),
  cashFloat: doublePrecision('cash_float'),
  depositSchedule: text('deposit_schedule', { enum: DEPOSIT_SCHEDULES }),
  stocktakeExplainThreshold: doublePrecision('stocktake_explain_threshold'),
  updatedBy: text('updated_by').notNull().references(() => employees.id),
  updatedAt: text('updated_at').notNull(),
}, t => [
  enumCheck('chk_store_settings_schedule', t.depositSchedule, DEPOSIT_SCHEDULES),
  check('chk_store_settings_cash_float', sql`${t.cashFloat} is null or (${t.cashFloat} >= 0 and ${t.cashFloat} = trunc(${t.cashFloat}) and ${t.cashFloat} <= 100000000000)`),
  check('chk_store_settings_threshold', sql`${t.stocktakeExplainThreshold} is null or (${t.stocktakeExplainThreshold} >= 0 and ${t.stocktakeExplainThreshold} <= 100000000000)`),
]).enableRLS();
