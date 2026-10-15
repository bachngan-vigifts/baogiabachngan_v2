import { sql } from 'drizzle-orm';
import { pgTable, text, bigint, boolean, doublePrecision, index, uniqueIndex, primaryKey, check } from 'drizzle-orm/pg-core';
import { enumCheck } from '../../core/db/enum-check.ts';
import { employees } from '../staff/schema.ts';
import { APPROVAL_STATUSES, CUSTOMER_STAFF_ROLES } from './domain/customer-config.ts';

export const customers = pgTable('sapo_customers', {
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
  sourceVersion: bigint('source_version', { mode: 'number' }).notNull(),
  syncedAt: text('synced_at').notNull(),
  /** Duyệt: khách nhân viên tạo chờ Manager duyệt mới dùng được (`APPROVAL_STATUSES`). Khách Sapo / dữ liệu cũ = approved. */
  approvalStatus: text('approval_status', { enum: APPROVAL_STATUSES }).notNull().default('approved'),
  createdBy: text('created_by'),
  approvedBy: text('approved_by'),
  approvedAt: text('approved_at'),
}, t => [index('idx_sapo_customers_name').on(t.name), index('idx_sapo_customers_approval').on(t.approvalStatus),
  enumCheck('chk_sapo_customers_approval', t.approvalStatus, APPROVAL_STATUSES)]).enableRLS();
export const customerContractProfiles = pgTable('customer_contract_profiles', {
  customerId: text('customer_id').primaryKey().references(() => customers.id),
  data: text('data').notNull().default('{}'),
  updatedAt: text('updated_at').notNull(),
}, t => [index('idx_customer_contract_profiles_updated').on(t.updatedAt)]).enableRLS();

/**
 * Chiết khấu theo thương hiệu cho từng khách hàng.
 * Thay cho cột JSON `sapo_customers.discounts` ({lys, minhLong, lock}) của bản cũ.
 */
export const customerBrandDiscounts = pgTable('customer_brand_discounts', {
  customerId: text('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  brandKey: text('brand_key', { enum: ['lys', 'minhLong', 'lock'] }).notNull(),
  percent: doublePrecision('percent').notNull(),
}, t => [
  primaryKey({ columns: [t.customerId, t.brandKey] }),
  enumCheck('chk_customer_discount_brand', t.brandKey, ['lys', 'minhLong', 'lock']),
  check('chk_customer_discount_percent', sql`${t.percent} >= 0 AND ${t.percent} <= 100`),
]).enableRLS();

/**
 * Nhân viên gắn với khách hàng: người phụ trách (`owner`, tối đa một) và người được chia sẻ (`shared`).
 * Người phụ trách / được chia sẻ xem được mọi báo giá, đơn, HĐKT, công nợ của khách.
 */
export const customerStaff = pgTable('customer_staff', {
  customerId: text('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  memberId: text('member_id').notNull().references(() => employees.id),
  role: text('role', { enum: CUSTOMER_STAFF_ROLES }).notNull(),
  createdBy: text('created_by').references(() => employees.id),
  createdAt: text('created_at').notNull(),
}, t => [
  primaryKey({ columns: [t.customerId, t.memberId] }),
  uniqueIndex('idx_customer_staff_owner').on(t.customerId).where(sql`${t.role} = 'owner'`),
  index('idx_customer_staff_member').on(t.memberId, t.role),
  enumCheck('chk_customer_staff_role', t.role, CUSTOMER_STAFF_ROLES),
]).enableRLS();

/**
 * Người liên hệ của khách hàng (nhiều người). Liên hệ chính đồng bộ từ Sapo vẫn nằm ở `sapo_customers.contact/phone/email`;
 * bảng này là danh bạ bổ sung do nhân viên nhập (kế toán, mua hàng, người nhận hàng…).
 */
export const customerContacts = pgTable('customer_contacts', {
  id: text('id').primaryKey(),
  customerId: text('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** Chức vụ / bộ phận (Kế toán, Mua hàng, Giám đốc…). */
  title: text('title').notNull().default(''),
  phone: text('phone').notNull().default(''),
  email: text('email').notNull().default(''),
  note: text('note').notNull().default(''),
  isPrimary: boolean('is_primary').notNull().default(false),
  createdBy: text('created_by').references(() => employees.id),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, t => [
  index('idx_customer_contacts_customer').on(t.customerId, t.isPrimary),
  check('chk_customer_contacts_name', sql`length(trim(${t.name})) > 0`),
]).enableRLS();

/** Ghi chú nội bộ của khách; tách khỏi hồ sơ đồng bộ Sapo và cổng khách hàng. */
export const customerNotes = pgTable('customer_notes', {
  customerId: text('customer_id').primaryKey().references(() => customers.id, { onDelete: 'cascade' }),
  text: text('text').notNull().default(''),
  revision: bigint('revision', { mode: 'number' }).notNull().default(1),
  updatedBy: text('updated_by').notNull().references(() => employees.id),
  updatedAt: text('updated_at').notNull(),
}, t => [check('chk_customer_notes_length', sql`length(${t.text}) <= 5000`),
  check('chk_customer_notes_revision', sql`${t.revision} > 0`)]).enableRLS();
