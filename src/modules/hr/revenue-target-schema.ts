import {sql} from 'drizzle-orm';
import {pgTable,text,doublePrecision,primaryKey,index,check} from 'drizzle-orm/pg-core';
import {employees} from '../staff/schema.ts';

/** Đăng ký từng tháng, không kế thừa sang tháng/năm sau như hồ sơ lương. Chỉ backend HR được truy cập. */
export const hrRevenueTargets=pgTable('hr_revenue_targets',{
  memberId:text('member_id').notNull().references(()=>employees.id),
  month:text('month').notNull(),
  amount:doublePrecision('amount').notNull(),
  updatedBy:text('updated_by').references(()=>employees.id),
  updatedAt:text('updated_at').notNull(),
},t=>[
  primaryKey({columns:[t.memberId,t.month]}),
  index('idx_hr_revenue_targets_month').on(t.month),
  check('chk_hr_revenue_target_month',sql`${t.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
  check('chk_hr_revenue_target_amount',sql`${t.amount}>0 and ${t.amount}<=10000000000000 and ${t.amount}=floor(${t.amount})`),
]).enableRLS();
