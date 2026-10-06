import { pgTable, text, bigint, boolean, index, uniqueIndex, primaryKey } from 'drizzle-orm/pg-core';
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
