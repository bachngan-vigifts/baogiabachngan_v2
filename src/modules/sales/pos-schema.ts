import { cashDrawers } from './cash-schema.ts';
import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  integer,
  doublePrecision,
  boolean,
  index,
  uniqueIndex,
  primaryKey,
  check,
} from 'drizzle-orm/pg-core';
import { employees } from '../staff/schema.ts';
import { warehouses, pricePolicies, products } from '../catalog/schema.ts';
export const posRegisters = pgTable(
  'pos_registers',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    cashDrawerId: text('cash_drawer_id')
      .notNull()
      .default('store')
      .references(() => cashDrawers.id),
    warehouseId: text('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    pricePolicyId: text('price_policy_id')
      .notNull()
      .references(() => pricePolicies.id),
    secondPricePolicyId: text('second_price_policy_id')
      .notNull()
      .references(() => pricePolicies.id),
    priceIncludesVat: boolean('price_includes_vat').notNull().default(true),
    taxRate: doublePrecision('tax_rate').notNull().default(8),
    bankCode: text('bank_code').notNull().default(''),
    bankAccount: text('bank_account').notNull().default(''),
    bankAccountName: text('bank_account_name').notNull().default(''),
    address: text('address').notNull().default(''),
    phone: text('phone').notNull().default(''),
    active: boolean('active').notNull().default(true),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    updatedBy: text('updated_by')
      .notNull()
      .references(() => employees.id),
  },
  (t) => [
    index('idx_pos_register_warehouse').on(t.warehouseId),
    check('chk_pos_register_prices', sql`${t.pricePolicyId} <> ${t.secondPricePolicyId}`),
    check('chk_pos_tax', sql`${t.taxRate} >= 0 and ${t.taxRate} <= 100`),
  ],
).enableRLS();
export const posShiftTemplates = pgTable('pos_shift_templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  startsAt: text('starts_at').notNull(),
  endsAt: text('ends_at').notNull(),
  active: boolean('active').notNull().default(true),
}).enableRLS();
export const posShifts = pgTable(
  'pos_shifts',
  {
    id: text('id').primaryKey(),
    cashDrawerId: text('cash_drawer_id')
      .notNull()
      .default('store')
      .references(() => cashDrawers.id),
    previousShiftId: text('previous_shift_id'),
    differenceReasonCode: text('difference_reason_code').notNull().default(''),
    differenceReasonNote: text('difference_reason_note').notNull().default(''),
    registerId: text('register_id')
      .notNull()
      .references(() => posRegisters.id),
    memberId: text('member_id')
      .notNull()
      .references(() => employees.id),
    templateId: text('template_id')
      .notNull()
      .references(() => posShiftTemplates.id),
    businessDate: text('business_date').notNull(),
    openKey: text('open_key').notNull(),
    openedAt: text('opened_at').notNull(),
    openingCash: doublePrecision('opening_cash').notNull(),
    closedAt: text('closed_at'),
    countedCash: doublePrecision('counted_cash'),
    expectedCash: doublePrecision('expected_cash'),
    cashDifference: doublePrecision('cash_difference'),
    differenceReason: text('difference_reason').notNull().default(''),
    note: text('note').notNull().default(''),
    reportSnapshot: text('report_snapshot'),
  },
  (t) => [
    uniqueIndex('uq_cash_drawer_open_shift')
      .on(t.cashDrawerId)
      .where(sql`${t.closedAt} is null`),
    uniqueIndex('uq_cash_shift_successor').on(t.previousShiftId),
    uniqueIndex('uq_pos_shift_open_key').on(t.openKey),
    uniqueIndex('uq_pos_member_open')
      .on(t.memberId)
      .where(sql`${t.closedAt} is null`),
    uniqueIndex('uq_pos_register_open')
      .on(t.registerId)
      .where(sql`${t.closedAt} is null`),
    index('idx_pos_shifts_member').on(t.memberId, t.openedAt),
    check('chk_pos_opening_cash', sql`${t.openingCash} >= 0 and ${t.openingCash} = trunc(${t.openingCash})`),
    check(
      'chk_pos_close',
      sql`(${t.closedAt} is null and ${t.reportSnapshot} is null) or (${t.closedAt} is not null and ${t.reportSnapshot} is not null and ${t.countedCash} >= 0 and (${t.cashDifference} = 0 or length(trim(${t.differenceReason})) > 0))`,
    ),
  ],
).enableRLS();
export const posStockCounts = pgTable(
  'pos_shift_stock_counts',
  {
    shiftId: text('shift_id')
      .notNull()
      .references(() => posShifts.id),
    sku: text('sku')
      .notNull()
      .references(() => products.sku),
    systemQty: doublePrecision('system_qty').notNull(),
    countedQty: doublePrecision('counted_qty').notNull(),
    note: text('note').notNull().default(''),
  },
  (t) => [primaryKey({ columns: [t.shiftId, t.sku] }), check('chk_pos_count', sql`${t.countedQty} >= 0`)],
).enableRLS();
export const posPaymentRequests = pgTable(
  'pos_payment_requests',
  {
    id: text('id').primaryKey(),
    shiftId: text('shift_id')
      .notNull()
      .references(() => posShifts.id),
    requestKey: text('request_key').notNull(),
    cart: text('cart').notNull(),
    fingerprint: text('fingerprint').notNull(),
    amount: doublePrecision('amount').notNull(),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    confirmedAt: text('confirmed_at'),
  },
  (t) => [
    uniqueIndex('uq_pos_qr_key').on(t.requestKey),
    index('idx_pos_qr_shift').on(t.shiftId),
    check('chk_pos_qr_amount', sql`${t.amount} > 0`),
  ],
).enableRLS();

export const webStoreOrders = pgTable('web_store_orders', {
  id: text('id').primaryKey(),
  source: text('source').notNull(),
  externalId: text('external_id').notNull(),
  orderNo: text('order_no').notNull(),
  registerId: text('register_id').notNull().references(() => posRegisters.id),
  status: text('status').notNull(),
  customerName: text('customer_name').notNull().default('Khách lẻ'),
  phone: text('phone').notNull().default(''),
  email: text('email').notNull().default(''),
  address: text('address').notNull().default(''),
  total: doublePrecision('total').notNull().default(0),
  currency: text('currency').notNull().default('VND'),
  paymentMethod: text('payment_method').notNull().default(''),
  lines: text('lines').notNull().default('[]'),
  financialSnapshot: text('financial_snapshot').notNull().default('{}'),
  ghnOrderCode: text('ghn_order_code').notNull().default(''),
  ghnStatus: text('ghn_status').notNull().default(''),
  ghnSortCode: text('ghn_sort_code').notNull().default(''),
  ghnFee: doublePrecision('ghn_fee').notNull().default(0),
  orderedAt: text('ordered_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, t => [
  uniqueIndex('uq_web_store_order').on(t.source, t.externalId),
  index('idx_web_store_orders_register').on(t.registerId, t.updatedAt),
]).enableRLS();
