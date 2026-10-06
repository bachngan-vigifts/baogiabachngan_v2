import { pgTable, text, bigint, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { enumCheck } from '../../core/db/enum-check.ts';
import { employees } from '../staff/schema.ts';
import { TASK_PRIORITIES, TASK_SOURCES, TASK_STATUSES } from './domain/task-config.ts';

/**
 * Công việc: việc TỰ SINH từ nghiệp vụ (báo giá chờ duyệt, check tồn, đơn chờ xác nhận, lên lịch giao, HĐKT chờ ký,
 * công nợ quá hạn, đơn nhập hàng…) và việc GIAO THỦ CÔNG giữa nhân viên.
 * - Việc tự sinh có `auto_key` (duy nhất) = quy tắc + id chứng từ; tự hoàn thành khi chứng từ hết cần xử lý.
 * - `assignee_id` = người nhận; trống + `assignee_position` = giao cho nhóm (Kho, Kế toán…); trống cả hai = chưa giao (Manager thấy).
 * - `created_by` = người giao (trống = hệ thống).
 */
export const tasks = pgTable('tasks', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  status: text('status', { enum: TASK_STATUSES }).notNull().default('todo'),
  priority: text('priority', { enum: TASK_PRIORITIES }).notNull().default('normal'),
  source: text('source', { enum: TASK_SOURCES }).notNull().default('manual'),
  /** Id chứng từ nguồn (báo giá / đơn / HĐKT…) và đường dẫn mở trên giao diện (vd. `#/orders/<id>`). */
  sourceId: text('source_id'),
  link: text('link').notNull().default(''),
  autoKey: text('auto_key'),
  assigneeId: text('assignee_id').references(() => employees.id),
  /** Giao cho nhóm (id chức vụ, vd. `warehouse` = Kho) khi chưa có người nhận cụ thể; người trong nhóm bấm "Nhận việc". */
  assigneePosition: text('assignee_position'),
  createdBy: text('created_by').references(() => employees.id),
  /** Hạn hoàn thành: ngày (YYYY-MM-DD) + giờ tuỳ chọn (HH:MM). */
  dueDate: text('due_date'),
  dueTime: text('due_time'),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  completedBy: text('completed_by').references(() => employees.id),
  revision: bigint('revision', { mode: 'number' }).notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, t => [
  uniqueIndex('idx_tasks_auto_key').on(t.autoKey),
  index('idx_tasks_assignee').on(t.assigneeId, t.status, t.dueDate),
  index('idx_tasks_team').on(t.assigneePosition, t.status),
  index('idx_tasks_creator').on(t.createdBy, t.status),
  index('idx_tasks_status_due').on(t.status, t.dueDate),
  index('idx_tasks_source').on(t.source, t.sourceId),
  enumCheck('chk_tasks_status', t.status, TASK_STATUSES),
  enumCheck('chk_tasks_priority', t.priority, TASK_PRIORITIES),
  enumCheck('chk_tasks_source', t.source, TASK_SOURCES),
]).enableRLS();

/** Trao đổi trong một công việc (người giao ↔ người nhận). */
export const taskComments = pgTable('task_comments', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  memberId: text('member_id').notNull().references(() => employees.id),
  body: text('body').notNull(),
  createdAt: text('created_at').notNull(),
}, t => [index('idx_task_comments_task').on(t.taskId, t.createdAt)]).enableRLS();
