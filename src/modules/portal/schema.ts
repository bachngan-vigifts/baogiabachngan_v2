import { pgTable, text, index } from 'drizzle-orm/pg-core';
import { enumCheck } from '../../core/db/enum-check.ts';
import { employees } from '../staff/schema.ts';
import { customers } from '../customers/schema.ts';

/**
 * Tài khoản khách hàng dùng trang riêng của khách (xem/tạo báo giá, đặt hàng; không thấy tồn kho).
 * Mỗi tài khoản là một `staff_members` vai trò 'customer' (đăng nhập, kích hoạt, phiên như nhân viên)
 * gắn với một khách hàng Sapo, có nhân viên phụ trách và chiết khấu riêng theo nhãn hàng.
 */
export const customerAccounts = pgTable('customer_accounts', {
  memberId: text('member_id').primaryKey().references(() => employees.id),
  customerId: text('customer_id').notNull().references(() => customers.id),
  /** Nhân viên phụ trách: nhận và xác nhận báo giá / đơn khách gửi. */
  ownerId: text('owner_id').notNull().references(() => employees.id),
  /** Chiết khấu riêng theo nhãn hàng (%), JSON `{ minhLong, lys, lock }` như ô chiết khấu khách hàng web cũ. Chỉ Manager đặt. */
  discounts: text('discounts').notNull().default('{}'),
  createdBy: text('created_by').notNull().references(() => employees.id),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, t => [index('idx_customer_accounts_customer').on(t.customerId), index('idx_customer_accounts_owner').on(t.ownerId)]).enableRLS();

/**
 * Khách hỏi tồn kho (khách không xem được tồn): gửi danh sách mã + số lượng cần, nhân viên phụ trách trả lời
 * (số đáp ứng được từng mã + ghi chú). Trả lời được báo lại cho khách.
 */
export const customerStockRequests = pgTable('customer_stock_requests', {
  id: text('id').primaryKey(),
  memberId: text('member_id').notNull().references(() => employees.id),
  customerId: text('customer_id').notNull().references(() => customers.id),
  ownerId: text('owner_id').notNull().references(() => employees.id),
  /** JSON `[{ sku, name, unit, qty }]`. */
  items: text('items').notNull(),
  note: text('note').notNull().default(''),
  status: text('status', { enum: ['open', 'answered'] }).notNull().default('open'),
  /** JSON `[{ sku, available }]` – số nhân viên xác nhận đáp ứng được. */
  answerItems: text('answer_items').notNull().default('[]'),
  answer: text('answer').notNull().default(''),
  answeredBy: text('answered_by').references(() => employees.id),
  answeredAt: text('answered_at'),
  createdAt: text('created_at').notNull(),
}, t => [index('idx_stock_requests_owner').on(t.ownerId, t.status, t.createdAt), index('idx_stock_requests_member').on(t.memberId, t.createdAt),
  enumCheck('chk_stock_requests_status', t.status, ['open', 'answered'])]).enableRLS();
