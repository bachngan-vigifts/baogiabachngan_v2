import { sqliteTable, text, integer, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';

export const sapoOrderStatuses = sqliteTable('sapo_order_statuses', {
  quoteNumber: text('quote_number').primaryKey(),
  status: text('status').notNull(),
  sapoOrderId: text('sapo_order_id'),
  sapoOrderCode: text('sapo_order_code'),
  sapoOrderUrl: text('sapo_order_url'),
  customerName: text('customer_name'),
  message: text('message'),
  payloadJson: text('payload_json'),
  updatedAt: text('updated_at').notNull(),
}, t => [index('idx_sapo_order_statuses_updated').on(t.updatedAt)]);

/** Phiên đăng nhập Sapo admin (cookie mã hoá AES-GCM). Trước đây tạo ngầm lúc chạy. */
export const sapoRuntimeSessions = sqliteTable('sapo_runtime_sessions', {
  id: text('id').primaryKey(),
  encryptedCookie: text('encrypted_cookie').notNull(),
  updatedAt: text('updated_at').notNull(),
  updatedBy: text('updated_by').notNull(),
});

/** Trạng thái giám sát kết nối Sapo. Trước đây tạo ngầm lúc chạy. */
export const sapoHealthMonitorState = sqliteTable('sapo_health_monitor_state', {
  id: text('id').primaryKey(),
  data: text('data').notNull(),
  updatedAt: text('updated_at').notNull(),
});
