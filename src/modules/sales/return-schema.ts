import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  doublePrecision,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { employees } from '../staff/schema.ts';
import { warehouses } from '../catalog/schema.ts';
import { salesOrders, salesOrderLines, customerPayments } from './schema.ts';
import { posRegisters, posShifts } from './pos-schema.ts';
import { cashDrawers, cashEntries } from './cash-schema.ts';
export const posReturns = pgTable(
  'pos_returns',
  {
    id: text('id').primaryKey(),
    returnNo: text('return_no').notNull(),
    orderId: text('order_id')
      .notNull()
      .references(() => salesOrders.id),
    registerId: text('register_id')
      .notNull()
      .references(() => posRegisters.id),
    warehouseId: text('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    createdShiftId: text('created_shift_id')
      .notNull()
      .references(() => posShifts.id),
    kind: text('kind').notNull(),
    status: text('status').notNull(),
    reason: text('reason').notNull(),
    requestedServiceFee: doublePrecision('requested_service_fee')
      .notNull()
      .default(0),
    requestedShippingFee: doublePrecision('requested_shipping_fee')
      .notNull()
      .default(0),
    approvedServiceFee: doublePrecision('approved_service_fee')
      .notNull()
      .default(0),
    approvedShippingFee: doublePrecision('approved_shipping_fee')
      .notNull()
      .default(0),
    subtotal: doublePrecision('subtotal').notNull().default(0),
    tax: doublePrecision('tax').notNull().default(0),
    total: doublePrecision('total').notNull().default(0),
    sourceSnapshot: text('source_snapshot').notNull(),
    requestKey: text('request_key').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => employees.id),
    createdAt: text('created_at').notNull(),
    approvedBy: text('approved_by').references(() => employees.id),
    approvedAt: text('approved_at'),
    approvalNote: text('approval_note').notNull().default(''),
    receivedBy: text('received_by').references(() => employees.id),
    receivedAt: text('received_at'),
    receivedShiftId: text('received_shift_id').references(() => posShifts.id),
    creditEffectiveAt: text('credit_effective_at'),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('uq_pos_return_no').on(t.returnNo),
    uniqueIndex('uq_pos_return_key').on(t.requestKey),
    check('chk_pos_return_kind', sql`${t.kind} in ('return','exchange')`),
    check(
      'chk_pos_return_status',
      sql`${t.status} in ('pending','approved','processing','completed','rejected','cancelled')`,
    ),
    check(
      'chk_pos_return_money',
      sql`${t.requestedServiceFee}>=0 and ${t.requestedServiceFee}=trunc(${t.requestedServiceFee}) and ${t.requestedServiceFee}<=1000000000000 and ${t.requestedShippingFee}>=0 and ${t.requestedShippingFee}=trunc(${t.requestedShippingFee}) and ${t.requestedShippingFee}<=1000000000000 and ${t.approvedServiceFee}>=0 and ${t.approvedServiceFee}=trunc(${t.approvedServiceFee}) and ${t.approvedServiceFee}<=1000000000000 and ${t.approvedShippingFee}>=0 and ${t.approvedShippingFee}=trunc(${t.approvedShippingFee}) and ${t.approvedShippingFee}<=1000000000000 and ${t.subtotal}>=0 and ${t.subtotal}=trunc(${t.subtotal}) and ${t.subtotal}<=1000000000000 and ${t.tax}>=0 and ${t.tax}=trunc(${t.tax}) and ${t.tax}<=1000000000000 and ${t.total}>=0 and ${t.total}=trunc(${t.total}) and ${t.total}<=1000000000000`,
    ),
    check('chk_pos_return_total', sql`${t.total}=${t.subtotal}+${t.tax}`),
    index('idx_pos_returns_lookup').on(
      t.orderId,
      t.registerId,
      t.status,
      t.createdAt,
    ),
  ],
).enableRLS();
export const posReturnLines = pgTable(
  'pos_return_lines',
  {
    id: text('id').primaryKey(),
    returnId: text('return_id')
      .notNull()
      .references(() => posReturns.id),
    orderLineId: text('order_line_id')
      .notNull()
      .references(() => salesOrderLines.id),
    sku: text('sku').notNull(),
    name: text('name').notNull(),
    unit: text('unit').notNull(),
    requestedQty: doublePrecision('requested_qty').notNull(),
    receivedQty: doublePrecision('received_qty').notNull().default(0),
    restockQty: doublePrecision('restock_qty').notNull().default(0),
    disposition: text('disposition').notNull(),
    conditionNote: text('condition_note').notNull().default(''),
    subtotal: doublePrecision('subtotal').notNull(),
    tax: doublePrecision('tax').notNull(),
    total: doublePrecision('total').notNull(),
  },
  (t) => [
    uniqueIndex('uq_pos_return_line').on(t.returnId, t.orderLineId),
    check(
      'chk_pos_return_qty',
      sql`${t.requestedQty}>0 and ${t.receivedQty}>=0 and ${t.receivedQty}<=${t.requestedQty} and ${t.restockQty}>=0 and ${t.restockQty}<=${t.receivedQty}`,
    ),
    check(
      'chk_pos_return_line_money',
      sql`${t.subtotal}>=0 and ${t.tax}>=0 and ${t.total}=${t.subtotal}+${t.tax} and ${t.total}=trunc(${t.total}) and ${t.subtotal}=trunc(${t.subtotal})`,
    ),
    check(
      'chk_pos_return_condition',
      sql`${t.disposition} in ('restock','damaged')`,
    ),
    index('idx_pos_return_lines_lookup').on(t.orderLineId),
  ],
).enableRLS();
export const posRefunds = pgTable(
  'pos_refunds',
  {
    id: text('id').primaryKey(),
    refundNo: text('refund_no').notNull(),
    returnId: text('return_id')
      .notNull()
      .references(() => posReturns.id),
    shiftId: text('shift_id')
      .notNull()
      .references(() => posShifts.id),
    drawerId: text('drawer_id')
      .notNull()
      .references(() => cashDrawers.id),
    method: text('method').notNull(),
    amount: doublePrecision('amount').notNull(),
    cashEntryId: text('cash_entry_id').references(() => cashEntries.id),
    reference: text('reference').notNull().default(''),
    confirmationNote: text('confirmation_note').notNull().default(''),
    confirmedBy: text('confirmed_by')
      .notNull()
      .references(() => employees.id),
    confirmedAt: text('confirmed_at').notNull(),
    requestKey: text('request_key').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('uq_pos_refund_no').on(t.refundNo),
    uniqueIndex('uq_pos_refund_key').on(t.requestKey),
    uniqueIndex('uq_pos_refund_cash').on(t.cashEntryId),
    check(
      'chk_pos_refund_amount',
      sql`${t.amount}>0 and ${t.amount}=trunc(${t.amount}) and ${t.amount}<=1000000000000`,
    ),
    check(
      'chk_pos_refund_method',
      sql`(${t.method}='cash' and ${t.cashEntryId} is not null) or (${t.method}='transfer' and ${t.cashEntryId} is null and length(trim(${t.reference}))>0)`,
    ),
    index('idx_pos_refunds_lookup').on(t.returnId, t.shiftId),
  ],
).enableRLS();
export const posExchangeAllocations = pgTable(
  'pos_exchange_allocations',
  {
    id: text('id').primaryKey(),
    returnId: text('return_id')
      .notNull()
      .references(() => posReturns.id),
    replacementOrderId: text('replacement_order_id').references(
      () => salesOrders.id,
    ),
    amount: doublePrecision('amount').notNull(),
    paymentId: text('payment_id').references(() => customerPayments.id),
    status: text('status').notNull(),
    reservedAt: text('reserved_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    appliedAt: text('applied_at'),
    createdBy: text('created_by')
      .notNull()
      .references(() => employees.id),
    requestKey: text('request_key').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('uq_pos_exchange_key').on(t.requestKey),
    uniqueIndex('uq_pos_exchange_payment').on(t.paymentId),
    check(
      'chk_pos_exchange_amount',
      sql`${t.amount}>0 and ${t.amount}=trunc(${t.amount}) and ${t.amount}<=1000000000000`,
    ),
    check(
      'chk_pos_exchange_status',
      sql`${t.status} in ('reserved','applied','cancelled')`,
    ),
    check(
      'chk_pos_exchange_applied',
      sql`${t.status}<>'applied' or (${t.paymentId} is not null and ${t.replacementOrderId} is not null and ${t.appliedAt} is not null)`,
    ),
    index('idx_pos_exchange_allocations_lookup').on(
      t.returnId,
      t.status,
      t.expiresAt,
    ),
  ],
).enableRLS();
