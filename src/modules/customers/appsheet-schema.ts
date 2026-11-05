import { sql } from 'drizzle-orm';
import { pgTable, text, primaryKey, index, check } from 'drizzle-orm/pg-core';
import { customers, customerContacts } from './schema.ts';

/** Multiple external rows may resolve to one CRM entity. Null FK retains a deletion tombstone. */
export const appsheetCustomerLinks = pgTable('appsheet_customer_links', {
  appId: text('app_id').notNull(),
  tableName: text('table_name').notNull(),
  rowId: text('row_id').notNull(),
  customerId: text('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  state: text('state').notNull().default('active'),
  sourceCreatedAt: text('source_created_at'),
  sourceUpdatedAt: text('source_updated_at').notNull(),
  approvalRaw: text('approval_raw').notNull(),
  sourceJson: text('source_json').notNull(),
  appliedJson: text('applied_json').notNull(),
  syncedAt: text('synced_at').notNull(),
}, t => [primaryKey({ columns: [t.appId, t.tableName, t.rowId] }),
  index('idx_appsheet_customer_target').on(t.customerId),
  check('chk_appsheet_customer_key', sql`length(trim(${t.appId})) > 0 and length(trim(${t.tableName})) > 0 and length(trim(${t.rowId})) > 0`),
  check('chk_appsheet_customer_state', sql`${t.state} in ('active', 'quarantined')`),
]).enableRLS();

export const appsheetContactLinks = pgTable('appsheet_contact_links', {
  appId: text('app_id').notNull(),
  tableName: text('table_name').notNull(),
  rowId: text('row_id').notNull(),
  contactId: text('contact_id').references(() => customerContacts.id, { onDelete: 'set null' }),
  customerRowId: text('customer_row_id').notNull(),
  sourceUpdatedAt: text('source_updated_at').notNull(),
  sourceJson: text('source_json').notNull(),
  appliedJson: text('applied_json').notNull(),
  syncedAt: text('synced_at').notNull(),
}, t => [primaryKey({ columns: [t.appId, t.tableName, t.rowId] }),
  index('idx_appsheet_contact_target').on(t.contactId),
  check('chk_appsheet_contact_key', sql`length(trim(${t.appId})) > 0 and length(trim(${t.tableName})) > 0 and length(trim(${t.rowId})) > 0`),
]).enableRLS();

/** Counts and opaque source keys only; no customer names, phones, emails or source payload in logs. */
export const appsheetSyncRuns = pgTable('appsheet_sync_runs', {
  id: text('id').primaryKey(),
  actorId: text('actor_id').notNull(),
  appId: text('app_id').notNull(),
  planHash: text('plan_hash').notNull(),
  summaryJson: text('summary_json').notNull(),
  createdAt: text('created_at').notNull(),
}, t => [index('idx_appsheet_runs_created').on(t.createdAt)]).enableRLS();
