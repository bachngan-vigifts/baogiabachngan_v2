import {pgTable,text,doublePrecision,index,uniqueIndex,check} from 'drizzle-orm/pg-core';
import {sql} from 'drizzle-orm';
import {employees} from '../staff/schema.ts';
import {salesOrders,paymentSchedules,customerPayments} from './schema.ts';
/** Money still held by an employee is not an effective customer payment. */
export const cashCollections=pgTable('customer_cash_collections',{
 id:text('id').primaryKey(),orderId:text('order_id').notNull().references(()=>salesOrders.id),scheduleId:text('schedule_id').references(()=>paymentSchedules.id,{onDelete:'set null'}),
 requestKey:text('request_key').notNull(),amount:doublePrecision('amount').notNull(),paidAt:text('paid_at').notNull(),reference:text('reference').notNull().default(''),note:text('note').notNull().default(''),
 status:text('status',{enum:['held','confirmed','cancelled']}).notNull().default('held'),collectedBy:text('collected_by').notNull().references(()=>employees.id),createdAt:text('created_at').notNull(),
 confirmedBy:text('confirmed_by').references(()=>employees.id),confirmedAt:text('confirmed_at'),paymentId:text('payment_id').references(()=>customerPayments.id),
 cancelledBy:text('cancelled_by').references(()=>employees.id),cancelledAt:text('cancelled_at'),cancelReason:text('cancel_reason').notNull().default(''),
},t=>[uniqueIndex('uq_customer_cash_collection_key').on(t.requestKey),uniqueIndex('uq_customer_cash_collection_payment').on(t.paymentId),index('idx_customer_cash_collections_order').on(t.orderId,t.status),
 check('chk_customer_cash_collection_amount',sql`${t.amount}>0`),check('chk_customer_cash_collection_status',sql`${t.status} in ('held','confirmed','cancelled')`),
 check('chk_customer_cash_collection_confirmation',sql`(${t.status}='confirmed')=(${t.confirmedAt} is not null and ${t.confirmedBy} is not null and ${t.paymentId} is not null)`),
 check('chk_customer_cash_collection_cancellation',sql`(${t.status}='cancelled')=(${t.cancelledAt} is not null and ${t.cancelledBy} is not null and length(${t.cancelReason})>=3)`),
]).enableRLS();
