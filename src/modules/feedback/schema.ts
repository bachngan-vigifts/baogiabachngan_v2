import { pgTable, text, bigint, index, uniqueIndex, check, primaryKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { employees } from '../staff/schema.ts';
import { enumCheck } from '../../core/db/enum-check.ts';
import { FEEDBACK_IMPACTS, FEEDBACK_KINDS, FEEDBACK_PRIORITIES, FEEDBACK_STATUSES, FEEDBACK_VISIBILITIES } from './domain/feedback.ts';

/** Góp ý phát triển phần mềm của nhân viên. `client_key` + `payload_hash`: gửi lặp cùng nội dung không tạo bản thứ hai. */
export const softwareFeedback = pgTable('software_feedback', {
  id: text('id').primaryKey(),
  ticketNo: bigint('ticket_no', { mode: 'number' }).notNull(),
  kind: text('kind', { enum: FEEDBACK_KINDS }).notNull(),
  impact: text('impact', { enum: FEEDBACK_IMPACTS }).notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  steps: text('steps').notNull().default(''),
  /** Trang đang dùng khi gửi (#/…) và thông tin máy (trình duyệt, kích thước màn hình, phiên bản) – tự ghi. */
  pageUrl: text('page_url').notNull().default(''),
  clientInfo: text('client_info').notNull().default(''),
  visibility: text('visibility', { enum: FEEDBACK_VISIBILITIES }).notNull().default('public'),
  status: text('status', { enum: FEEDBACK_STATUSES }).notNull().default('new'),
  priority: text('priority', { enum: FEEDBACK_PRIORITIES }),
  duplicateOf: text('duplicate_of'),
  createdBy: text('created_by').notNull().references(() => employees.id),
  clientKey: text('client_key').notNull(),
  payloadHash: text('payload_hash').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, t => [
  uniqueIndex('uq_software_feedback_ticket').on(t.ticketNo),
  uniqueIndex('uq_software_feedback_client_key').on(t.createdBy, t.clientKey),
  index('idx_software_feedback_status').on(t.status, t.updatedAt),
  index('idx_software_feedback_creator').on(t.createdBy, t.createdAt),
  enumCheck('chk_software_feedback_kind', t.kind, FEEDBACK_KINDS),
  enumCheck('chk_software_feedback_impact', t.impact, FEEDBACK_IMPACTS),
  enumCheck('chk_software_feedback_status', t.status, FEEDBACK_STATUSES),
  enumCheck('chk_software_feedback_visibility', t.visibility, FEEDBACK_VISIBILITIES),
  check('chk_software_feedback_priority', sql`${t.priority} is null or ${t.priority} in ('low','medium','high','urgent')`),
  check('chk_software_feedback_ticket', sql`${t.ticketNo} > 0`),
]).enableRLS();

/** Ảnh chụp màn hình (kho file private; bảng giữ khoá file). */
export const softwareFeedbackPhotos = pgTable('software_feedback_photos', {
  id: text('id').primaryKey(),
  feedbackId: text('feedback_id').notNull().references(() => softwareFeedback.id),
  fileKey: text('file_key').notNull(),
  bytes: bigint('bytes', { mode: 'number' }).notNull(),
  createdBy: text('created_by').notNull().references(() => employees.id),
  createdAt: text('created_at').notNull(),
}, t => [index('idx_software_feedback_photos').on(t.feedbackId)]).enableRLS();

/** +1: mỗi người một lượt / góp ý. */
export const softwareFeedbackVotes = pgTable('software_feedback_votes', {
  feedbackId: text('feedback_id').notNull().references(() => softwareFeedback.id),
  memberId: text('member_id').notNull().references(() => employees.id),
  createdAt: text('created_at').notNull(),
}, t => [primaryKey({ columns: [t.feedbackId, t.memberId] }), index('idx_software_feedback_votes_member').on(t.memberId)]).enableRLS();

/** Trao đổi + lịch sử đổi trạng thái (kind = status: body ghi trạng thái cũ → mới và lý do). */
export const softwareFeedbackComments = pgTable('software_feedback_comments', {
  id: text('id').primaryKey(),
  feedbackId: text('feedback_id').notNull().references(() => softwareFeedback.id),
  authorId: text('author_id').notNull().references(() => employees.id),
  kind: text('kind', { enum: ['comment', 'status'] }).notNull().default('comment'),
  body: text('body').notNull(),
  createdAt: text('created_at').notNull(),
}, t => [index('idx_software_feedback_comments').on(t.feedbackId, t.createdAt), enumCheck('chk_software_feedback_comment_kind', t.kind, ['comment', 'status'])]).enableRLS();
