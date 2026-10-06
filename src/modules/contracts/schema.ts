import { pgTable, text, bigint, boolean, index, uniqueIndex, primaryKey } from 'drizzle-orm/pg-core';

export const contractCounters = pgTable('contract_counters', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  year: bigint('year', { mode: 'number' }).notNull(),
  month: bigint('month', { mode: 'number' }).notNull(),
  legalEntity: text('legal_entity').notNull(),
  lastSequence: bigint('last_sequence', { mode: 'number' }).notNull(),
  updatedAt: text('updated_at').notNull(),
}, t => [uniqueIndex('idx_contract_counters_period').on(t.type,t.year,t.month,t.legalEntity)]).enableRLS();
export const contractTransfers = pgTable('contract_transfers', {
  quoteNumber: text('quote_number').primaryKey(),
  contractNumber: text('contract_number').notNull(),
  contractUrl: text('contract_url'),
  message: text('message').notNull(),
  resultJson: text('result_json').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, t => [index('idx_contract_transfers_updated').on(t.updatedAt)]).enableRLS();
export const contractStatuses = pgTable('contract_statuses', {
  quoteNumber: text('quote_number').primaryKey(),
  contractNumber: text('contract_number'),
  status: text('status').notNull(),
  crmRowId: text('crm_row_id'),
  crmUrl: text('crm_url'),
  customerName: text('customer_name'),
  itemCount: bigint('item_count', { mode: 'number' }),
  message: text('message'),
  resultJson: text('result_json').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, t => [index('idx_contract_statuses_updated').on(t.updatedAt)]).enableRLS();
export const contractDocumentNumbers = pgTable('contract_document_numbers', {
 quoteNumber: text('quote_number').notNull(),
 legalEntity: text('legal_entity').notNull(),
 contractNumber: text('contract_number').notNull(),
}, t => [primaryKey({columns:[t.quoteNumber,t.legalEntity]}), uniqueIndex('idx_contract_document_number').on(t.contractNumber)]).enableRLS();
