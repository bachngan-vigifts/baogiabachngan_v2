import { sql } from 'drizzle-orm';
import { pgTable, text, bigint, index, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { employees } from '../staff/schema.ts';
import { incomingShipmentLines, suppliers } from './schema.ts';

export const purchaseEarlyRequests = pgTable('purchase_early_requests', {
  id: text('id').primaryKey(), ticketNumber:text('ticket_number').notNull().default(''), clientKey: text('client_key').notNull(), payloadHash: text('payload_hash').notNull(),
  createdBy: text('created_by').notNull().references(() => employees.id), createdAt: text('created_at').notNull(),
  status: text('status',{enum:['draft','submitted']}).notNull().default('submitted'), pickupDate: text('pickup_date').notNull().default(''),
  deletedAt:text('deleted_at'),deletedBy:text('deleted_by').references(()=>employees.id),
  scope: text('scope').notNull().default('{}'), updatedAt: text('updated_at').notNull().default(''), revision: bigint('revision',{mode:'number'}).notNull().default(1),
}, t => [uniqueIndex('idx_purchase_early_requests_number').on(t.ticketNumber).where(sql`${t.ticketNumber}<>''`), uniqueIndex('idx_purchase_early_requests_key').on(t.createdBy,t.clientKey), index('idx_purchase_early_requests_created').on(t.createdAt),
  check('chk_purchase_early_request_status',sql`${t.status} in ('draft','submitted')`)]).enableRLS();
export const purchaseEarlyRequestLines = pgTable('purchase_early_request_lines', {
  id: text('id').primaryKey(), requestId: text('request_id').notNull().references(() => purchaseEarlyRequests.id),
  lineNo: bigint('line_no',{mode:'number'}).notNull(), sku: text('sku').notNull(), name: text('name').notNull(), unit: text('unit').notNull(),
  quantity: bigint('quantity',{mode:'number'}).notNull(),
}, t => [uniqueIndex('idx_purchase_early_lines_sku').on(t.requestId,t.sku), uniqueIndex('idx_purchase_early_lines_no').on(t.requestId,t.lineNo), check('chk_purchase_early_line_qty',sql`${t.quantity}>0`)]).enableRLS();
export const purchaseEarlyRequestAllocations = pgTable('purchase_early_request_allocations', {
  id: text('id').primaryKey(), requestLineId: text('request_line_id').notNull().references(() => purchaseEarlyRequestLines.id),
  purchaseLineId: text('purchase_line_id').notNull().references(() => incomingShipmentLines.id), supplierId: text('supplier_id').notNull().references(() => suppliers.id),
  quantity: bigint('quantity',{mode:'number'}).notNull(), status: text('status',{enum:['pending','accepted','rejected']}).notNull().default('pending'),
  respondedBy: text('responded_by').references(() => employees.id), respondedAt: text('responded_at'), responseNote: text('response_note').notNull().default(''),
}, t => [uniqueIndex('idx_purchase_early_alloc_line').on(t.requestLineId,t.purchaseLineId), index('idx_purchase_early_alloc_supplier').on(t.supplierId,t.status),
  index('idx_purchase_early_alloc_purchase').on(t.purchaseLineId), check('chk_purchase_early_alloc_qty',sql`${t.quantity}>0`),
  check('chk_purchase_early_alloc_status',sql`${t.status} in ('pending','accepted','rejected')`)]).enableRLS();
