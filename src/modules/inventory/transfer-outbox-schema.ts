import { sql } from 'drizzle-orm';
import { pgTable, text, boolean, integer, index, check } from 'drizzle-orm/pg-core';
import { stockTransfers } from './schema.ts';
export const transferIntegrationSettings = pgTable('stock_transfer_integration_settings', {
  id: text('id').primaryKey(), enabled: boolean('enabled').notNull().default(false),
  activatedAt: text('integration_activated_at'), updatedAt: text('updated_at').notNull(),
}).enableRLS();
export const transferOutbox = pgTable('stock_transfer_outbox', {
  idempotencyKey: text('idempotency_key').primaryKey(),
  transferId: text('transfer_id').notNull().unique().references(() => stockTransfers.id),
  payloadHash: text('payload_hash').notNull(), payload: text('payload').notNull(),
  status: text('status').notNull().default('pending'), attemptCount: integer('attempt_count').notNull().default(0),
  dispatchToken: text('dispatch_token'), dispatchUntil: text('dispatch_until'), nextAttemptAt: text('next_attempt_at').notNull(),
  claimToken: text('claim_token'), claimedAt: text('claimed_at'), processedAt: text('processed_at'),
  destinationSystem: text('destination_system'), destinationId: text('destination_id'), destinationNo: text('destination_no'), destinationUrl: text('destination_url'),
  lastError: text('last_error').notNull().default(''), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, t => [index('idx_transfer_outbox_due').on(t.status,t.nextAttemptAt),
  check('chk_transfer_outbox_status',sql`${t.status} in ('pending','claimed','succeeded','manual','conflict','unknown','failed')`),
  check('chk_transfer_outbox_attempts',sql`${t.attemptCount} >= 0`),
]).enableRLS();
