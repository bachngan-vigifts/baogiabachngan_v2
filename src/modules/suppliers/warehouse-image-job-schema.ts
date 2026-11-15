import { sql } from 'drizzle-orm';
import { pgTable, text, integer, index, check } from 'drizzle-orm/pg-core';

export const warehouseImageQueueState = pgTable('warehouse_image_queue_state', {
  id: text('id').primaryKey(),
  updatedAt: text('updated_at').notNull(),
}).enableRLS();

export const warehouseImageJobs = pgTable('warehouse_image_jobs', {
  id: text('id').primaryKey(),
  imageHash: text('image_hash').notNull().unique(),
  source: text('source').notNull(),
  imagePayload: text('image_payload').notNull(),
  status: text('status').notNull().default('queued'),
  positionHint: integer('position_hint').notNull().default(0),
  callbackTokenHash: text('callback_token_hash'),
  createdBy: text('created_by').notNull(),
  startedAt: text('started_at'),
  finishedAt: text('finished_at'),
  draftId: text('draft_id'),
  draftNo: text('draft_no'),
  draftUrl: text('draft_url'),
  pxkNo: text('pxk_no'),
  warnings: text('warnings').notNull().default('[]'),
  lastError: text('last_error').notNull().default(''),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, t => [
  index('idx_warehouse_image_jobs_queue').on(t.status, t.createdAt),
  check('chk_warehouse_image_jobs_status', sql`${t.status} in ('queued','processing','completed','needs_review','failed')`),
]).enableRLS();
