import { pgTable, text } from 'drizzle-orm/pg-core';
import { enumCheck } from '../../core/db/enum-check.ts';
import { cashEntries } from '../sales/cash-schema.ts';
import { employees } from '../staff/schema.ts';
import { CASH_CLASSES } from './domain/branch-costs.ts';

/** Loại phiếu két do Manager xác nhận / sửa; không có dòng → tự phân loại (classifyCashEntry). */
export const cashEntryClasses = pgTable('cash_entry_classes', {
  entryId: text('entry_id').primaryKey().references(() => cashEntries.id, { onDelete: 'cascade' }),
  cls: text('cls', { enum: CASH_CLASSES }).notNull(),
  note: text('note').notNull().default(''),
  updatedBy: text('updated_by').references(() => employees.id),
  updatedAt: text('updated_at').notNull(),
}, t => [enumCheck('chk_cash_entry_classes_cls', t.cls, CASH_CLASSES)]).enableRLS();
