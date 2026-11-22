import { sql } from 'drizzle-orm';
import { pgTable, text, date, bigint, boolean, doublePrecision, integer, index, uniqueIndex, primaryKey, check, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { enumCheck } from '../../core/db/enum-check.ts';
import { employees } from '../staff/schema.ts';
import { APPROVAL_STATUSES, CUSTOMER_STAFF_ROLES } from './domain/customer-config.ts';

export const customers = pgTable('sapo_customers', {
  isRetail: boolean('is_retail').notNull().default(false),
  establishedDate: date('established_date', { mode: 'string' }),
  /** AppSheet classification is separate from the retail/business permission segment. */
  customerType: text('customer_type'),
  /** Creation origin only; external identities live in appsheet_customer_links. */
  dataSource: text('data_source'),
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
  /** Phiên bản hồ sơ (ô trong form Sửa khách hàng): trigger CSDL tự tăng mỗi khi ô hồ sơ đổi; PUT kèm bản cũ → 409. Khác sourceVersion (Sapo). */
  profileRevision: bigint('profile_revision', { mode: 'number' }).notNull().default(0),
  syncedAt: text('synced_at').notNull(),
  /** Duyệt: khách nhân viên tạo chờ Manager duyệt mới dùng được (`APPROVAL_STATUSES`). Khách Sapo / dữ liệu cũ = approved. */
  approvalStatus: text('approval_status', { enum: APPROVAL_STATUSES }).notNull().default('approved'),
  createdBy: text('created_by'),
  approvedBy: text('approved_by'),
  approvedAt: text('approved_at'),
  /** Điều khoản riêng của khách (null = dùng mặc định): % đặt cọc, hạn thanh toán phần còn lại (số ngày hoặc nội dung), giới hạn công nợ (đ). Điền sẵn khi tạo báo giá. */
  depositRate: doublePrecision('deposit_rate'),
  paymentTerm: text('payment_term'),
  creditLimit: doublePrecision('credit_limit'),
  /** Số ngày công nợ (số nguyên) để tính hạn; `paymentTerm` vẫn giữ nội dung tự do. */
  paymentDays: integer('payment_days'),
  /** Người đại diện khách: một dòng trong danh bạ `customer_contacts` của chính khách (xoá liên hệ → null). */
  representativeContactId: text('representative_contact_id').references((): AnyPgColumn => customerContacts.id, { onDelete: 'set null' }),
  /** Chỉ có giá trị khi `approvalStatus = 'rejected'`: lý do, người từ chối, thời điểm. */
  rejectReason: text('reject_reason'),
  rejectedBy: text('rejected_by').references(() => employees.id),
  rejectedAt: text('rejected_at'),
}, t => [index('idx_sapo_customers_name').on(t.name), index('idx_sapo_customers_approval').on(t.approvalStatus),
  index('idx_sapo_customers_representative').on(t.representativeContactId).where(sql`${t.representativeContactId} is not null`),
  enumCheck('chk_sapo_customers_approval', t.approvalStatus, APPROVAL_STATUSES),
  check('chk_customer_profile_revision', sql`${t.profileRevision} >= 0`),
  check('chk_customer_payment_days', sql`${t.paymentDays} is null or (${t.paymentDays} >= 0 and ${t.paymentDays} <= 3650)`),
  check('chk_customer_reject_reason', sql`${t.approvalStatus} <> 'rejected' or (${t.rejectReason} is not null and length(btrim(${t.rejectReason})) > 0 and length(${t.rejectReason}) <= 1000 and ${t.rejectedBy} is not null and ${t.rejectedAt} is not null)`),
  check('chk_customer_data_source', sql`${t.dataSource} is null or ${t.dataSource} in ('appsheet', 'sapo', 'web', 'pos')`),
  check('chk_customer_established_date', sql`${t.establishedDate} is null or (${t.establishedDate} >= date '0001-01-01' and ${t.establishedDate} <= date '9999-12-31')`)]).enableRLS();
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
 * Danh sách người liên hệ của khách hàng. Form CRM dùng danh sách này làm nguồn chỉnh sửa duy nhất;
 * tên liên hệ chính được ghi vào `sapo_customers.contact` để tương thích báo giá, đơn hàng và dữ liệu cũ.
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

/**
 * Ghi chú công nợ cũ (từ AppSheet / sổ tay). Bảng riêng, không nằm trên `sapo_customers`: nhiều API trả nguyên dòng khách,
 * nên cột này sẽ rò ra danh sách. Chỉ người có `canSeeAll` với khách mới đọc / sửa được.
 */
export const customerDebtNotes = pgTable('customer_debt_notes', {
  customerId: text('customer_id').primaryKey().references(() => customers.id, { onDelete: 'cascade' }),
  text: text('text').notNull().default(''),
  revision: bigint('revision', { mode: 'number' }).notNull().default(1),
  updatedBy: text('updated_by').notNull().references(() => employees.id),
  updatedAt: text('updated_at').notNull(),
}, t => [check('chk_customer_debt_notes_length', sql`length(${t.text}) <= 2000`),
  check('chk_customer_debt_notes_revision', sql`${t.revision} > 0`)]).enableRLS();
