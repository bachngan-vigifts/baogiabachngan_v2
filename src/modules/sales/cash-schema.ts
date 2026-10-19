import { sql } from 'drizzle-orm';
import { pgTable, text, doublePrecision, index, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { employees } from '../staff/schema.ts';
import { posShifts } from './pos-schema.ts';
export const cashDrawers = pgTable(
  'cash_drawers',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    approvalThreshold: doublePrecision('approval_threshold').notNull().default(1000000),
    openingAmount: doublePrecision('opening_amount'),
    openingReason: text('opening_reason').notNull().default(''),
    openingSetAt: text('opening_set_at'),
    openingSetBy: text('opening_set_by').references(() => employees.id),
    updatedAt: text('updated_at').notNull(),
    updatedBy: text('updated_by').references(() => employees.id),
  },
  (t) => [
    check(
      'chk_cash_threshold',
      sql`${t.approvalThreshold}>0 and ${t.approvalThreshold}=trunc(${t.approvalThreshold}) and ${t.approvalThreshold}<=1000000000000`,
    ),
    check(
      'chk_cash_opening',
      sql`${t.openingAmount} is null or (${t.openingAmount}>=0 and ${t.openingAmount}=trunc(${t.openingAmount}) and ${t.openingAmount}<=1000000000000)`,
    ),
  ],
).enableRLS();
export const cashReconciliations = pgTable(
  'cash_reconciliations',
  {
    id: text('id').primaryKey(),
    reconciliationNo: text('reconciliation_no').notNull(),
    drawerId: text('drawer_id')
      .notNull()
      .references(() => cashDrawers.id),
    shiftId: text('shift_id')
      .notNull()
      .references(() => posShifts.id),
    closedBy: text('closed_by')
      .notNull()
      .references(() => employees.id),
    expectedCash: doublePrecision('expected_cash').notNull(),
    countedCash: doublePrecision('counted_cash').notNull(),
    difference: doublePrecision('difference').notNull(),
    reasonCode: text('reason_code').notNull(),
    reasonNote: text('reason_note').notNull().default(''),
    explanation: text('explanation').notNull().default(''),
    explainedBy: text('explained_by').references(() => employees.id),
    explainedAt: text('explained_at'),
    status: text('status').notNull().default('pending'),
    closeReason: text('close_reason').notNull().default(''),
    resolvedBy: text('resolved_by').references(() => employees.id),
    resolvedAt: text('resolved_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('uq_cash_reconciliation_shift').on(t.shiftId),
    uniqueIndex('uq_cash_reconciliation_no').on(t.reconciliationNo),
    index('idx_cash_reconciliation_status').on(t.drawerId, t.status, t.createdAt),
    check('chk_cash_reconciliation_status', sql`${t.status} in ('pending','explained','closed')`),
  ],
).enableRLS();
export const cashEntries = pgTable(
  'cash_entries',
  {
    id: text('id').primaryKey(),
    entryNo: text('entry_no').notNull(),
    drawerId: text('drawer_id')
      .notNull()
      .references(() => cashDrawers.id),
    shiftId: text('shift_id')
      .notNull()
      .references(() => posShifts.id),
    kind: text('kind').notNull(),
    direction: text('direction').notNull(),
    amount: doublePrecision('amount').notNull(),
    reason: text('reason').notNull(),
    photoFileKey: text('photo_file_key'),
    status: text('status').notNull(),
    approvalThresholdSnapshot: doublePrecision('approval_threshold_snapshot').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => employees.id),
    createdAt: text('created_at').notNull(),
    approvedBy: text('approved_by').references(() => employees.id),
    approvedAt: text('approved_at'),
    voidedBy: text('voided_by').references(() => employees.id),
    voidedAt: text('voided_at'),
    voidReason: text('void_reason').notNull().default(''),
    reconciliationId: text('reconciliation_id').references(() => cashReconciliations.id),
    requestKey: text('request_key').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('uq_cash_entry_key').on(t.requestKey),
    uniqueIndex('uq_cash_entry_no').on(t.entryNo),
    index('idx_cash_entry_shift').on(t.shiftId, t.status),
    index('idx_cash_entry_date').on(t.drawerId, t.createdAt),
    check(
      'chk_cash_entry_amount',
      sql`${t.amount}>0 and ${t.amount}=trunc(${t.amount}) and ${t.amount}<=1000000000000`,
    ),
    check('chk_cash_entry_status', sql`${t.status} in ('pending','posted','voided')`),
    check(
      'chk_cash_entry_direction',
      sql`(${t.kind} in ('other_income','cash_in') and ${t.direction}='in') or (${t.kind} in ('petty_expense','advance','cash_out') and ${t.direction}='out') or (${t.kind}='adjustment' and ${t.direction} in ('in','out'))`,
    ),
    check(
      'chk_cash_void_reason',
      sql`${t.status}<>'voided' or (${t.voidedAt} is not null and length(trim(${t.voidReason}))>0)`,
    ),
  ],
).enableRLS();
