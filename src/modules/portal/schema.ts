import { pgTable, text, index } from 'drizzle-orm/pg-core';
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
