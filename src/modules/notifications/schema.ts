import { pgTable, text, bigint, boolean, integer, index, uniqueIndex, primaryKey } from 'drizzle-orm/pg-core';
import { employees } from '../staff/schema.ts';

export const webPushSubscriptions = pgTable('staff_web_push_subscriptions', {
  id: text('id').primaryKey(),
  memberId: text('member_id').notNull().references(() => employees.id),
  endpoint: text('endpoint').notNull(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  userAgent: text('user_agent').notNull().default(''),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  lastSeenAt: text('last_seen_at'),
  disabledAt: text('disabled_at'),
  failureCount: bigint('failure_count', { mode: 'number' }).notNull().default(0),
  /** Lần gửi gần nhất: mã HTTP của dịch vụ push (201 = đã nhận; 0 = lỗi mạng) + nội dung lỗi (rút gọn) để kiểm tra thiết bị. */
  lastStatus: integer('last_status'),
  lastError: text('last_error').notNull().default(''),
  lastAttemptAt: text('last_attempt_at'),
  lastOkAt: text('last_ok_at'),
}, t => [uniqueIndex('idx_web_push_endpoint').on(t.endpoint), index('idx_web_push_member').on(t.memberId, t.disabledAt)]).enableRLS();
export const webNotifications = pgTable('staff_web_notifications', {
  id: text('id').primaryKey(),
  eventType: text('event_type').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  url: text('url').notNull(),
  targetRole: text('target_role').default('manager'),
  targetMemberId: text('target_member_id'),
  actorId: text('actor_id').references(() => employees.id),
  dataJson: text('data_json').notNull().default('{}'),
  createdAt: text('created_at').notNull(),
}, t => [index('idx_web_notifications_created').on(t.createdAt), index('idx_web_notifications_target').on(t.targetRole, t.targetMemberId, t.createdAt)]).enableRLS();
export const webNotificationReads = pgTable('staff_web_notification_reads', {
  notificationId: text('notification_id').notNull().references(() => webNotifications.id),
  memberId: text('member_id').notNull().references(() => employees.id),
  readAt: text('read_at').notNull(),
}, t => [primaryKey({columns: [t.notificationId, t.memberId]})]).enableRLS();

/** Khoá VAPID của Web Push: máy chủ tự sinh lần đầu (không cần cài mã bí mật); khoá riêng mã hoá AES-GCM bằng SAPO_SYNC_TOKEN. */
export const webPushKeys = pgTable('web_push_keys', {
  id: text('id').primaryKey(),
  publicKey: text('public_key').notNull(),
  encryptedPrivateKey: text('encrypted_private_key').notNull(),
  createdAt: text('created_at').notNull(),
}).enableRLS();

/**
 * Nhật ký gửi Web Push: mỗi lần gửi tới một thiết bị (hoặc không gửi được vì máy chủ chưa bật push / người nhận chưa có thiết bị) một dòng.
 * Dùng để kiểm tra "thông báo X có tới máy Y không". Giữ 30 ngày (tự xoá dòng cũ).
 */
export const webPushAttempts = pgTable('web_push_attempts', {
  id: text('id').primaryKey(),
  notificationId: text('notification_id').notNull(),
  eventType: text('event_type').notNull(),
  memberId: text('member_id'),
  subscriptionId: text('subscription_id'),
  /** 201/200 = dịch vụ push đã nhận; 404/410 = thiết bị huỷ đăng ký; 0 = lỗi mạng / lỗi máy chủ; null = không gửi (xem `error`). */
  status: integer('status'),
  error: text('error').notNull().default(''),
  createdAt: text('created_at').notNull(),
}, t => [index('idx_web_push_attempts_created').on(t.createdAt), index('idx_web_push_attempts_member').on(t.memberId, t.createdAt)]).enableRLS();
