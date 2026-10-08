import { pgTable, text, bigint, index, uniqueIndex, primaryKey } from 'drizzle-orm/pg-core';
import { enumCheck } from '../../core/db/enum-check.ts';
import { employees } from '../staff/schema.ts';
import { CHAT_KINDS } from './domain/chat-config.ts';

/**
 * Tin nhắn nội bộ giữa nhân viên (không gồm khách hàng / NCC).
 * - Hội thoại 1-1 (`direct`, khoá `direct_key` = cặp id) hoặc nhóm (`group`, có tên).
 * - `chat_members.last_read_at` = mốc đã đọc → đếm tin chưa đọc.
 */
export const chatConversations = pgTable('chat_conversations', {
  id: text('id').primaryKey(),
  kind: text('kind', { enum: CHAT_KINDS }).notNull(),
  title: text('title').notNull().default(''),
  directKey: text('direct_key'),
  createdBy: text('created_by').notNull().references(() => employees.id),
  createdAt: text('created_at').notNull(),
  lastMessageAt: text('last_message_at'),
}, t => [uniqueIndex('idx_chat_direct_key').on(t.directKey), index('idx_chat_last_message').on(t.lastMessageAt), enumCheck('chk_chat_kind', t.kind, CHAT_KINDS)]).enableRLS();

export const chatMembers = pgTable('chat_members', {
  conversationId: text('conversation_id').notNull().references(() => chatConversations.id, { onDelete: 'cascade' }),
  memberId: text('member_id').notNull().references(() => employees.id),
  lastReadAt: text('last_read_at'),
  joinedAt: text('joined_at').notNull(),
}, t => [primaryKey({ columns: [t.conversationId, t.memberId] }), index('idx_chat_members_member').on(t.memberId)]).enableRLS();

export const chatMessages = pgTable('chat_messages', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull().references(() => chatConversations.id, { onDelete: 'cascade' }),
  memberId: text('member_id').notNull().references(() => employees.id),
  body: text('body').notNull(),
  /** Liên kết nhanh (JSON {type,id,label}): đơn hàng / HĐKT / báo giá / phiếu đóng gói / việc. '' = không có. */
  refJson: text('ref_json').notNull().default(''),
  /** Người gửi thu hồi (trong 4 giờ): nội dung, liên kết, file bị xoá. */
  recalledAt: text('recalled_at'),
  createdAt: text('created_at').notNull(),
}, t => [index('idx_chat_messages_conv').on(t.conversationId, t.createdAt)]).enableRLS();

/** File đính kèm tin nhắn: nằm trong bucket private (khoá `file_key`), người trong hội thoại nhận link có hạn. */
export const chatAttachments = pgTable('chat_attachments', {
  id: text('id').primaryKey(),
  messageId: text('message_id').notNull().references(() => chatMessages.id, { onDelete: 'cascade' }),
  conversationId: text('conversation_id').notNull().references(() => chatConversations.id, { onDelete: 'cascade' }),
  fileKey: text('file_key').notNull(),
  name: text('name').notNull(),
  mime: text('mime').notNull(),
  bytes: bigint('bytes', { mode: 'number' }).notNull(),
  createdAt: text('created_at').notNull(),
}, t => [index('idx_chat_attachments_message').on(t.messageId), uniqueIndex('idx_chat_attachments_key').on(t.fileKey)]).enableRLS();
