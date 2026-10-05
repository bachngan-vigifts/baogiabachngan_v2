import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real, index, uniqueIndex, primaryKey, check } from 'drizzle-orm/sqlite-core';
import { enumCheck } from '../../core/db/enum-check.ts';

export const customers = sqliteTable('sapo_customers', {
  createdAt: text('created_at').notNull().default(''),
  taxCode: text('tax_code').notNull().default(''),
  customerCode: text('customer_code').notNull().default(''),
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  contact: text('contact').notNull(),
  phone: text('phone').notNull(),
  email: text('email').notNull(),
  address: text('address').notNull(),
  search: text('search').notNull(),
  sourceVersion: integer('source_version').notNull(),
  syncedAt: text('synced_at').notNull(),
}, t => [index('idx_sapo_customers_name').on(t.name)]);
export const customerContractProfiles = sqliteTable('customer_contract_profiles', {
  customerId: text('customer_id').primaryKey().references(() => customers.id),
  data: text('data').notNull().default('{}'),
  updatedAt: text('updated_at').notNull(),
}, t => [index('idx_customer_contract_profiles_updated').on(t.updatedAt)]);

/**
 * Chiết khấu theo thương hiệu cho từng khách hàng.
 * Thay cho cột JSON `sapo_customers.discounts` ({lys, minhLong, lock}) của bản cũ.
 */
export const customerBrandDiscounts = sqliteTable('customer_brand_discounts', {
  customerId: text('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  brandKey: text('brand_key', { enum: ['lys', 'minhLong', 'lock'] }).notNull(),
  percent: real('percent').notNull(),
}, t => [
  primaryKey({ columns: [t.customerId, t.brandKey] }),
  enumCheck('chk_customer_discount_brand', t.brandKey, ['lys', 'minhLong', 'lock']),
  check('chk_customer_discount_percent', sql`${t.percent} >= 0 AND ${t.percent} <= 100`),
]);
