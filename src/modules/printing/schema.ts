import { pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

/** Xưởng in. Bản cũ tạo bảng này ngầm lúc chạy (lib/printing-workshops.mjs); định nghĩa giữ nguyên. */
export const printingWorkshops = pgTable('printing_workshops', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  nameKey: text('name_key').notNull(),
  taxCode: text('tax_code').notNull().default(''),
  address: text('address').notNull().default(''),
  phone: text('phone').notNull().default(''),
  email: text('email').notNull().default(''),
  createdAt: text('created_at').notNull(),
  createdBy: text('created_by').notNull(),
}, t => [uniqueIndex('idx_printing_workshops_name_key').on(t.nameKey)]).enableRLS();
