import { sql } from 'drizzle-orm';
import { pgTable, text, bigint, boolean, doublePrecision, index, uniqueIndex, primaryKey, check } from 'drizzle-orm/pg-core';
import { enumCheck } from '../../core/db/enum-check.ts';
import { employees } from '../staff/schema.ts';

export const quotations = pgTable('staff_quotations', {
  id: text('id').primaryKey(),
  creatorId: text('creator_id').notNull().references(() => employees.id),
  /** Người phụ trách báo giá. null = chưa giao, mặc định là chủ (`creator_id`). `creator_id` không bao giờ đổi (trigger ở migration 0001). */
  assigneeId: text('assignee_id').references(() => employees.id),
  quoteNo: text('quote_no').notNull(),
  quoteType: text('quote_type', { enum: ['HRC', 'B2B', 'VIGIFTS'] }).notNull(),
  customer: text('customer').notNull(),
  quoteDate: text('quote_date'),
  searchText: text('search_text'),
  contractNumber: text('contract_number'),
  contractQuoteNo: text('contract_quote_no'),
  hasContract: bigint('has_contract', { mode: 'number' }).notNull().default(0),
  data: text('data').notNull(),
  revision: bigint('revision', { mode: 'number' }).notNull().default(1),
  /**
   * Duyệt báo giá (như web cũ): Manager tạo thì tự duyệt; nhân viên lưu thì "pending" (đợi duyệt).
   * Nhân viên sửa nội dung báo giá đã duyệt → về "pending", phải được duyệt lại.
   * Chỉ báo giá đã duyệt mới tải file, tạo đơn hàng, sinh HĐKT.
   */
  /** draft = nhân viên đã lưu, chưa gửi duyệt; pending = đã gửi duyệt (hoặc khách gửi); approved = đã duyệt. */
  approvalStatus: text('approval_status', { enum: ['draft', 'pending', 'approved'] }).notNull().default('pending'),
  approvedAt: text('approved_at'),
  approvedBy: text('approved_by').references(() => employees.id),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, t => [
  index('idx_quotations_creator_updated').on(t.creatorId, t.updatedAt),
  index('idx_quotations_approval').on(t.approvalStatus, t.updatedAt),
  enumCheck('chk_quotations_approval_status', t.approvalStatus, ['draft', 'pending', 'approved']),
  index('idx_quotations_assignee').on(t.assigneeId, t.updatedAt),
  index('idx_quotations_created').on(t.createdAt),
  index('idx_quotations_quote_date').on(t.quoteDate),
  index('idx_quotations_contract').on(t.contractNumber),
  index('idx_quotations_has_contract').on(t.hasContract, t.createdAt),
]).enableRLS();
export const quoteNotifications = pgTable('staff_quote_notifications', {
  id: text('id').primaryKey(),
  quoteId: text('quote_id').notNull().references(() => quotations.id),
  actorId: text('actor_id').notNull().references(() => employees.id),
  eventType: text('event_type').notNull(),
  quoteNo: text('quote_no').notNull(),
  customer: text('customer').notNull(),
  createdAt: text('created_at').notNull(),
}, t => [index('idx_quote_notifications_created').on(t.createdAt)]).enableRLS();
export const notificationReads = pgTable('staff_notification_reads', {
  notificationId: text('notification_id').notNull().references(() => quoteNotifications.id),
  memberId: text('member_id').notNull().references(() => employees.id),
  readAt: text('read_at').notNull(),
}, t => [primaryKey({ columns: [t.notificationId, t.memberId] })]).enableRLS(); // bản cũ chỉ có unique index, không có khoá chính

/**
 * Dòng hàng của báo giá, tách khỏi cột JSON `staff_quotations.data`.
 * `data` vẫn là bản chụp đầy đủ của tài liệu; bảng này phục vụ truy vấn
 * (giao hàng, lợi nhuận, báo cáo theo SKU) và được ghi cùng giao dịch với `data`.
 */
export const quoteLines = pgTable('quote_lines', {
  id: text('id').primaryKey(),
  quoteId: text('quote_id').notNull().references(() => quotations.id, { onDelete: 'cascade' }),
  lineNo: bigint('line_no', { mode: 'number' }).notNull(),
  sku: text('sku').notNull().default(''),
  name: text('name').notNull(),
  brand: text('brand').notNull().default(''),
  unit: text('unit').notNull().default(''),
  qty: doublePrecision('qty').notNull().default(0),
  price: doublePrecision('price').notNull().default(0),
  discount: doublePrecision('discount').notNull().default(0),
  discountType: text('discount_type', { enum: ['percent', 'amount'] }).notNull().default('percent'),
  /** null = dùng VAT chung của báo giá (header). */
  taxRate: doublePrecision('tax_rate'),
  printFee: doublePrecision('print_fee').notNull().default(0),
  costPrice: doublePrecision('cost_price').notNull().default(0),
  deliveryDate: text('delivery_date'),
}, t => [
  uniqueIndex('idx_quote_lines_order').on(t.quoteId, t.lineNo),
  index('idx_quote_lines_sku').on(t.sku),
  enumCheck('chk_quote_lines_discount_type', t.discountType, ['percent', 'amount']),
  check('chk_quote_lines_qty', sql`${t.qty} >= 0`),
  check('chk_quote_lines_price', sql`${t.price} >= 0`),
]).enableRLS();

/** Lịch sử phiên bản báo giá (bản cũ chỉ có bộ đếm `revision`). */
export const quoteRevisions = pgTable('quote_revisions', {
  id: text('id').primaryKey(),
  quoteId: text('quote_id').notNull().references(() => quotations.id, { onDelete: 'cascade' }),
  revision: bigint('revision', { mode: 'number' }).notNull(),
  data: text('data').notNull(),
  changedBy: text('changed_by').notNull().references(() => employees.id),
  createdAt: text('created_at').notNull(),
}, t => [uniqueIndex('idx_quote_revisions_once').on(t.quoteId, t.revision)]).enableRLS();

/**
 * Công nợ dự kiến của đơn đã chuyển sang Sapo (một dòng cho mỗi báo giá).
 * Bản cũ tạo bảng này ngầm lúc chạy với 3 cột (quote_id, data, updated_at);
 * các cột còn lại được tách ra để truy vấn công nợ không phải parse JSON.
 */
export const quoteOrderFollowups = pgTable('quote_order_followups', {
  quoteId: text('quote_id').primaryKey().references(() => quotations.id, { onDelete: 'cascade' }),
  data: text('data').notNull(),
  updatedAt: text('updated_at').notNull(),
  customerId: text('customer_id').notNull().default(''),
  kind: text('kind').notNull().default('expected'),
  total: doublePrecision('total').notNull().default(0),
  paid: doublePrecision('paid').notNull().default(0),
  balance: doublePrecision('balance').notNull().default(0),
  sapoOrderId: text('sapo_order_id').notNull().default(''),
  sapoOrderCode: text('sapo_order_code').notNull().default(''),
  sapoOrderUrl: text('sapo_order_url').notNull().default(''),
  createdAt: text('created_at').notNull().default(''),
}, t => [
  index('idx_followups_customer').on(t.customerId),
  index('idx_followups_balance').on(t.balance),
  check('chk_followup_paid', sql`${t.paid} >= 0`),
]).enableRLS();

/**
 * Nút "Chia sẻ" trên báo giá: chủ báo giá (hoặc manager) cho một nhân viên hoặc cả một chức vụ truy cập báo giá.
 * `permission`: 'edit' (mặc định – người nhận được xem và sửa) hoặc 'view' (chỉ xem).
 * Người nhận KHÔNG được chia sẻ tiếp hay thu hồi chia sẻ; việc đó chỉ của chủ báo giá và manager.
 * Thay cho cấu hình chia sẻ theo chuỗi `SỐ-BG:chức-vụ` của bản cũ (chuyển dữ liệu: mỗi cặp thành một dòng
 * `target_type='position'`; bản cũ chia sẻ để xem nên dùng `permission='view'` cho các dòng chuyển từ đó).
 */
export const quoteShares = pgTable('quote_shares', {
  id: text('id').primaryKey(),
  quoteId: text('quote_id').notNull().references(() => quotations.id, { onDelete: 'cascade' }),
  targetType: text('target_type', { enum: ['member', 'position'] }).notNull(),
  /** id nhân viên hoặc id chức vụ tuỳ `target_type` (không đặt khoá ngoại vì trỏ tới hai bảng). */
  targetId: text('target_id').notNull(),
  permission: text('permission', { enum: ['view', 'edit'] }).notNull().default('edit'),
  createdBy: text('created_by').notNull().references(() => employees.id),
  createdAt: text('created_at').notNull(),
}, t => [
  uniqueIndex('idx_quote_shares_once').on(t.quoteId, t.targetType, t.targetId),
  index('idx_quote_shares_target').on(t.targetType, t.targetId),
  enumCheck('chk_quote_shares_type', t.targetType, ['member', 'position']),
  enumCheck('chk_quote_shares_permission', t.permission, ['view', 'edit']),
  check('chk_quote_shares_target', sql`length(${t.targetId}) > 0`),
]).enableRLS();
