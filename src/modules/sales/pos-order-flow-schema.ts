import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  doublePrecision,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { salesOrders, salesOrderLines, customerPayments } from './schema.ts';
import { posShifts } from './pos-schema.ts';
import { employees } from '../staff/schema.ts';
import { warehouses } from '../catalog/schema.ts';

export const posOrderReservations = pgTable(
  'pos_order_reservations',
  {
    id: text('id').primaryKey(),
    orderId: text('order_id')
      .notNull()
      .references(() => salesOrders.id),
    orderLineId: text('order_line_id')
      .notNull()
      .references(() => salesOrderLines.id),
    warehouseId: text('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    qty: doublePrecision('qty').notNull(),
    status: text('status').notNull(),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => employees.id),
    closedBy: text('closed_by').references(() => employees.id),
    closedAt: text('closed_at'),
    closeReason: text('close_reason').notNull().default(''),
  },
  (t) => [
    check('chk_pos_reservation_qty', sql`${t.qty}>0`),
    check(
      'chk_pos_reservation_status',
      sql`${t.status} in ('active','released','consumed')`,
    ),
    uniqueIndex('uq_pos_order_reservation').on(
      t.orderId,
      t.orderLineId,
      t.warehouseId,
    ),
    index('idx_pos_reservation_expiry').on(
      t.warehouseId,
      t.status,
      t.expiresAt,
    ),
    index('idx_pos_reservation_order').on(t.orderId),
  ],
).enableRLS();

export const posPaymentIntents = pgTable(
  'pos_payment_intents',
  {
    id: text('id').primaryKey(),
    orderId: text('order_id')
      .notNull()
      .references(() => salesOrders.id),
    requestedShiftId: text('requested_shift_id')
      .notNull()
      .references(() => posShifts.id),
    kind: text('kind').notNull(),
    method: text('method').notNull(),
    amount: doublePrecision('amount').notNull(),
    requestKey: text('request_key').notNull(),
    requestHash: text('request_hash').notNull(),
    status: text('status').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => employees.id),
    createdAt: text('created_at').notNull(),
    confirmedBy: text('confirmed_by').references(() => employees.id),
    confirmedAt: text('confirmed_at'),
    confirmedShiftId: text('confirmed_shift_id').references(() => posShifts.id),
    cancelledBy: text('cancelled_by').references(() => employees.id),
    cancelledAt: text('cancelled_at'),
    cancelReason: text('cancel_reason').notNull().default(''),
    paymentId: text('payment_id').references(() => customerPayments.id),
    reference: text('reference').notNull().default(''),
  },
  (t) => [
    check(
      'chk_pos_intent_amount',
      sql`${t.amount}>0 and ${t.amount}=trunc(${t.amount}) and ${t.amount}<=1000000000000`,
    ),
    check(
      'chk_pos_intent_status',
      sql`${t.status} in ('pending','confirmed','cancelled')`,
    ),
    check(
      'chk_pos_intent_kind',
      sql`${t.kind} in ('deposit','balance','prepaid')`,
    ),
    check('chk_pos_intent_method', sql`${t.method}='transfer'`),
    uniqueIndex('uq_pos_intent_key').on(t.requestKey),
    uniqueIndex('uq_pos_intent_payment').on(t.paymentId),
    index('idx_pos_intent_order').on(t.orderId, t.status),
    index('idx_pos_intent_shift').on(t.requestedShiftId, t.status, t.createdAt),
  ],
).enableRLS();
