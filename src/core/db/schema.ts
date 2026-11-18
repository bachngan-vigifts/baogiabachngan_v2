import { pgTable, text, index, integer } from 'drizzle-orm/pg-core';

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

/**
 * Bản tính sẵn của trang báo cáo nặng (Tổng quan, Phân tích lợi nhuận): `key` = loại báo cáo + người xem + bộ lọc.
 * Hết hạn sau 30 phút (core/cache/report-cache.ts), nút "Cập nhật" tính lại ngay. Chỉ là bản sao – xoá bất kỳ lúc nào cũng an toàn.
 */
export const reportCache = pgTable('report_cache', {
  key: text('key').primaryKey(),
  scope: text('scope').notNull(),
  data: text('data').notNull(),
  computedAt: text('computed_at').notNull(),
  computedBy: text('computed_by'),
}, t => [index('idx_report_cache_scope').on(t.scope, t.computedAt)]).enableRLS();

/** Internal durable sync state. No client policies: only the existing server DB role can access it. */
export const syncJobs = pgTable('edge_sync_jobs', {
  key: text('key').primaryKey(), kind: text('kind').notNull(),
  status: text('status').notNull().default('queued'), state: text('state').notNull().default('{}'),
  result: text('result').notNull().default('{}'), token: text('token'),
  leaseUntil: text('lease_until').notNull().default('1970-01-01T00:00:00.000Z'),
  availableAt: text('available_at').notNull(), updatedAt: text('updated_at').notNull(),
  attempts: integer('attempts').notNull().default(0), errorCode: text('error_code'),
}).enableRLS();
