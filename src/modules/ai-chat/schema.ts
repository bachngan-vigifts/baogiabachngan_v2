import { sql } from 'drizzle-orm';
import { pgTable, text, integer, index, check, primaryKey } from 'drizzle-orm/pg-core';
import { employees } from '../staff/schema.ts';

export const aiChatQuestions = pgTable('ai_chat_questions', {
  id: text('id').primaryKey(),
  question: text('question').notNull(),
  answer: text('answer').notNull().default(''),
  topic: text('topic').notNull().default('CRM'),
  status: text('status').notNull().default('pending'),
  createdBy: text('created_by').notNull().references(() => employees.id),
  callbackTokenHash: text('callback_token_hash'),
  error: text('error').notNull().default(''),
  createdAt: text('created_at').notNull(),
  answeredAt: text('answered_at'),
  updatedAt: text('updated_at').notNull(),
}, t => [
  index('idx_ai_chat_questions_public').on(t.createdAt),
  index('idx_ai_chat_questions_status').on(t.status, t.updatedAt),
  check('chk_ai_chat_questions_status', sql`${t.status} in ('pending','answered','needs_review','failed')`),
]).enableRLS();

export const aiChatHelpfulVotes = pgTable('ai_chat_helpful_votes', {
  questionId: text('question_id').notNull().references(() => aiChatQuestions.id),
  memberId: text('member_id').notNull().references(() => employees.id),
  createdAt: text('created_at').notNull(),
}, t => [primaryKey({ columns: [t.questionId, t.memberId] }), index('idx_ai_chat_helpful_member').on(t.memberId)]).enableRLS();
