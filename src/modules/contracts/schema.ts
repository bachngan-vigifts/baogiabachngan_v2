import { sqliteTable, text, integer, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';

export const contractCounters = sqliteTable('contract_counters', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  year: integer('year').notNull(),
  month: integer('month').notNull(),
  legalEntity: text('legal_entity').notNull(),
  lastSequence: integer('last_sequence').notNull(),
  updatedAt: text('updated_at').notNull(),
}, t => [uniqueIndex('idx_contract_counters_period').on(t.type,t.year,t.month,t.legalEntity)]);
export const contractTransfers = sqliteTable('contract_transfers', {
  quoteNumber: text('quote_number').primaryKey(),
  contractNumber: text('contract_number').notNull(),
  contractUrl: text('contract_url'),
  message: text('message').notNull(),
  resultJson: text('result_json').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, t => [index('idx_contract_transfers_updated').on(t.updatedAt)]);
export const contractStatuses = sqliteTable('contract_statuses', {
  quoteNumber: text('quote_number').primaryKey(),
  contractNumber: text('contract_number'),
  status: text('status').notNull(),
  crmRowId: text('crm_row_id'),
  crmUrl: text('crm_url'),
  customerName: text('customer_name'),
  itemCount: integer('item_count'),
  message: text('message'),
  resultJson: text('result_json').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, t => [index('idx_contract_statuses_updated').on(t.updatedAt)]);
export const contractDocumentNumbers = sqliteTable('contract_document_numbers', {
 quoteNumber: text('quote_number').notNull(),
 legalEntity: text('legal_entity').notNull(),
 contractNumber: text('contract_number').notNull(),
}, t => [primaryKey({columns:[t.quoteNumber,t.legalEntity]}), uniqueIndex('idx_contract_document_number').on(t.contractNumber)]);
