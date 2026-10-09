import { pgTable, text, index } from 'drizzle-orm/pg-core';

/**
 * Nhật ký thao tác dùng chung cho mọi module (duyệt báo giá, đổi giá, sao lưu...). Ghi tự động qua router (`core/audit.ts`):
 * `module` = khu vực truy cập (business / admin…), `action` = "PHƯƠNG THỨC /route", `data` = thân yêu cầu đã che bí mật.
 * `work_audit` của module work được giữ nguyên vì có luồng riêng.
 */
export const auditLogs = pgTable('audit_logs', {
  id: text('id').primaryKey(),
  actorId: text('actor_id'),
  module: text('module').notNull(),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  data: text('data').notNull().default('{}'),
  createdAt: text('created_at').notNull(),
}, t => [
  index('idx_audit_logs_entity').on(t.entityType, t.entityId, t.createdAt),
  index('idx_audit_logs_actor').on(t.actorId, t.createdAt),
  index('idx_audit_logs_created').on(t.createdAt),
]).enableRLS();
