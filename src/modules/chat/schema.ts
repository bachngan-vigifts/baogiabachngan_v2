import { pgTable, text, index, uniqueIndex, primaryKey } from 'drizzle-orm/pg-core';
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
  createdAt: text('created_at').notNull(),
}, t => [index('idx_chat_messages_conv').on(t.conversationId, t.createdAt)]).enableRLS();
