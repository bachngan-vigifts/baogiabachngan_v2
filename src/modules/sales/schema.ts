import { sql } from 'drizzle-orm';
import { pgTable, text, bigint, doublePrecision, index, uniqueIndex, primaryKey, check } from 'drizzle-orm/pg-core';
import { enumCheck } from '../../core/db/enum-check.ts';
import { employees } from '../staff/schema.ts';
import { customers } from '../customers/schema.ts';
import { quotations } from '../quotes/schema.ts';
import { CONTRACT_STATUSES, DELIVERY_STATUSES, INVOICE_STATUSES, LEGAL_ENTITIES, ORDER_STATUSES, PACKING_SOURCES, PACKING_STATUSES, PAYMENT_METHODS, SCHEDULE_KINDS } from './domain/statuses.ts';

/*
 * Bán hàng sau báo giá: Báo giá → Đơn đặt hàng → (HĐKT) → Lịch giao hàng → Công nợ.
 *
 *   staff_quotations 1 ──── 0..1 sales_orders 1 ──── * sales_order_lines
 *                                   │ 1                      │ 1
 *                                   ├── 0..1 sales_contracts  │
 *                                   ├── *    deliveries 1 ── * delivery_lines (→ sales_order_lines)
 *                                   ├── *    payment_schedules (kỳ phải thu: cọc / đợt / còn lại)
 *                                   └── *    customer_payments (phiếu thu, có thể gắn một kỳ)
 *   sapo_customers 1 ── * sales_orders / sales_contracts / customer_payments
 *
 * Đơn chụp lại khách hàng và dòng hàng tại thời điểm tạo (báo giá sửa sau không làm đổi đơn).
 * Công nợ = tổng các kỳ phải thu − tổng phiếu thu, tính theo đơn (xem domain/sales.ts).
 */


/** Đơn đặt hàng của khách (tạo từ báo giá, hoặc tạo tay). */
export const salesOrders = pgTable('sales_orders', {
  id: text('id').primaryKey(),
  orderNo: text('order_no').notNull(),
  quoteId: text('quote_id').references(() => quotations.id),
  quoteNo: text('quote_no').notNull().default(''),
  quoteType: text('quote_type', { enum: ['HRC', 'B2B', 'VIGIFTS'] }).notNull(),
  customerId: text('customer_id').references(() => customers.id),
  customerName: text('customer_name').notNull(),
  contact: text('contact').notNull().default(''),
  phone: text('phone').notNull().default(''),
  email: text('email').notNull().default(''),
  taxCode: text('tax_code').notNull().default(''),
  address: text('address').notNull().default(''),
  /** Người phụ trách đơn (mặc định người phụ trách báo giá). */
  ownerId: text('owner_id').notNull().references(() => employees.id),
  createdBy: text('created_by').notNull().references(() => employees.id),
  orderDate: text('order_date').notNull(),
  expectedDeliveryDate: text('expected_delivery_date'),
  status: text('status', { enum: ORDER_STATUSES }).notNull().default('confirmed'),
  subtotal: doublePrecision('subtotal').notNull().default(0),
  tax: doublePrecision('tax').notNull().default(0),
  total: doublePrecision('total').notNull().default(0),
  note: text('note').notNull().default(''),
  /** Liên kết đơn Sapo khi đã chuyển sang Sapo (để sau). */
  sapoOrderId: text('sapo_order_id'),
  sapoOrderCode: text('sapo_order_code'),
  /** Xuất hoá đơn: yêu cầu (tự động khi giao xong / nhân viên bấm) → việc cho nhóm Kế toán → kế toán nhập số hoá đơn. */
  invoiceStatus: text('invoice_status', { enum: INVOICE_STATUSES }).notNull().default('none'),
  invoiceRequestedAt: text('invoice_requested_at'),
  /** null khi yêu cầu tự động (giao xong). */
  invoiceRequestedBy: text('invoice_requested_by').references(() => employees.id),
  invoiceRequestNote: text('invoice_request_note').notNull().default(''),
  invoiceNo: text('invoice_no').notNull().default(''),
  invoiceDate: text('invoice_date'),
  invoiceIssuedAt: text('invoice_issued_at'),
  invoiceIssuedBy: text('invoice_issued_by').references(() => employees.id),
  revision: bigint('revision', { mode: 'number' }).notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, t => [
  uniqueIndex('idx_sales_orders_no').on(t.orderNo),
  // Một báo giá chỉ có một đơn đang hiệu lực (đơn huỷ thì tạo lại được).
  uniqueIndex('idx_sales_orders_quote_active').on(t.quoteId).where(sql`${t.quoteId} IS NOT NULL AND ${t.status} <> 'cancelled'`),
  index('idx_sales_orders_customer').on(t.customerId, t.orderDate),
  index('idx_sales_orders_owner').on(t.ownerId, t.updatedAt),
  index('idx_sales_orders_status').on(t.status, t.orderDate),
  enumCheck('chk_sales_orders_status', t.status, ORDER_STATUSES),
  enumCheck('chk_sales_orders_invoice_status', t.invoiceStatus, INVOICE_STATUSES),
  index('idx_sales_orders_invoice').on(t.invoiceStatus).where(sql`${t.invoiceStatus} = 'requested'`),
  enumCheck('chk_sales_orders_type', t.quoteType, ['HRC', 'B2B', 'VIGIFTS']),
  check('chk_sales_orders_total', sql`${t.total} >= 0`),
]).enableRLS();

/** Dòng hàng của đơn: giá sau chiết khấu (đã cộng phí in), chưa VAT; `delivered_qty` cộng dồn từ các lần giao thành công. */
export const salesOrderLines = pgTable('sales_order_lines', {
  id: text('id').primaryKey(),
  orderId: text('order_id').notNull().references(() => salesOrders.id, { onDelete: 'cascade' }),
  lineNo: bigint('line_no', { mode: 'number' }).notNull(),
  sku: text('sku').notNull().default(''),
  name: text('name').notNull(),
  unit: text('unit').notNull().default(''),
  qty: doublePrecision('qty').notNull(),
  unitPrice: doublePrecision('unit_price').notNull().default(0),
  taxRate: doublePrecision('tax_rate').notNull().default(0),
  amount: doublePrecision('amount').notNull().default(0),
  deliveredQty: doublePrecision('delivered_qty').notNull().default(0),
}, t => [
  uniqueIndex('idx_sales_order_lines_order').on(t.orderId, t.lineNo),
  index('idx_sales_order_lines_sku').on(t.sku),
  check('chk_sales_order_lines_qty', sql`${t.qty} > 0 AND ${t.deliveredQty} >= 0 AND ${t.deliveredQty} <= ${t.qty}`),
  check('chk_sales_order_lines_price', sql`${t.unitPrice} >= 0 AND ${t.taxRate} >= 0 AND ${t.taxRate} <= 100`),
]).enableRLS();

/** Hợp đồng kinh tế: tối đa một HĐKT cho mỗi đơn. Số HĐKT cấp theo `contract_counters` như web cũ. */
export const salesContracts = pgTable('sales_contracts', {
  id: text('id').primaryKey(),
  contractNo: text('contract_no').notNull(),
  orderId: text('order_id').notNull().references(() => salesOrders.id),
  quoteId: text('quote_id').references(() => quotations.id),
  customerId: text('customer_id').references(() => customers.id),
  legalEntity: text('legal_entity', { enum: LEGAL_ENTITIES }).notNull(),
  status: text('status', { enum: CONTRACT_STATUSES }).notNull().default('draft'),
  signedDate: text('signed_date'),
  value: doublePrecision('value').notNull().default(0),
  depositRate: doublePrecision('deposit_rate').notNull().default(0),
  depositAmount: doublePrecision('deposit_amount').notNull().default(0),
  /** Số ngày được thanh toán phần còn lại, tính từ ngày giao xong. */
  paymentDays: bigint('payment_days', { mode: 'number' }).notNull().default(0),
  paymentMethod: text('payment_method').notNull().default(''),
  deliveryAddress: text('delivery_address').notNull().default(''),
  /** Nội dung văn bản HĐKT (đại diện, chức vụ, chỉnh sửa Word…) – JSON như `contractDocument.details` bản cũ. */
  data: text('data').notNull().default('{}'),
  createdBy: text('created_by').notNull().references(() => employees.id),
  revision: bigint('revision', { mode: 'number' }).notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, t => [
  uniqueIndex('idx_sales_contracts_no').on(t.contractNo),
  uniqueIndex('idx_sales_contracts_order').on(t.orderId),
  index('idx_sales_contracts_customer').on(t.customerId),
  index('idx_sales_contracts_status').on(t.status, t.updatedAt),
  enumCheck('chk_sales_contracts_status', t.status, CONTRACT_STATUSES),
  enumCheck('chk_sales_contracts_entity', t.legalEntity, LEGAL_ENTITIES),
  check('chk_sales_contracts_money', sql`${t.value} >= 0 AND ${t.depositAmount} >= 0 AND ${t.depositRate} >= 0 AND ${t.depositRate} <= 100 AND ${t.paymentDays} >= 0`),
]).enableRLS();

/** Lịch giao hàng: mỗi chuyến giao một phần hoặc toàn bộ đơn. */
export const deliveries = pgTable('deliveries', {
  id: text('id').primaryKey(),
  deliveryNo: text('delivery_no').notNull(),
  orderId: text('order_id').notNull().references(() => salesOrders.id),
  plannedDate: text('planned_date').notNull(),
  timeSlot: text('time_slot').notNull().default(''),
  address: text('address').notNull().default(''),
  receiverName: text('receiver_name').notNull().default(''),
  receiverPhone: text('receiver_phone').notNull().default(''),
  carrier: text('carrier').notNull().default(''),
  shippingFee: doublePrecision('shipping_fee').notNull().default(0),
  status: text('status', { enum: DELIVERY_STATUSES }).notNull().default('planned'),
  assigneeId: text('assignee_id').references(() => employees.id),
  deliveredAt: text('delivered_at'),
  note: text('note').notNull().default(''),
  createdBy: text('created_by').notNull().references(() => employees.id),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, t => [
  uniqueIndex('idx_deliveries_no').on(t.deliveryNo),
  index('idx_deliveries_date').on(t.plannedDate, t.status),
  index('idx_deliveries_order').on(t.orderId),
  enumCheck('chk_deliveries_status', t.status, DELIVERY_STATUSES),
  check('chk_deliveries_fee', sql`${t.shippingFee} >= 0`),
]).enableRLS();

export const deliveryLines = pgTable('delivery_lines', {
  deliveryId: text('delivery_id').notNull().references(() => deliveries.id, { onDelete: 'cascade' }),
  orderLineId: text('order_line_id').notNull().references(() => salesOrderLines.id),
  qty: doublePrecision('qty').notNull(),
}, t => [primaryKey({ columns: [t.deliveryId, t.orderLineId] }), index('idx_delivery_lines_order_line').on(t.orderLineId), check('chk_delivery_lines_qty', sql`${t.qty} > 0`)]).enableRLS();

/** Kỳ phải thu của đơn (công nợ): đặt cọc, các đợt, phần còn lại. */
export const paymentSchedules = pgTable('payment_schedules', {
  id: text('id').primaryKey(),
  orderId: text('order_id').notNull().references(() => salesOrders.id, { onDelete: 'cascade' }),
  contractId: text('contract_id').references(() => salesContracts.id),
  kind: text('kind', { enum: SCHEDULE_KINDS }).notNull(),
  amount: doublePrecision('amount').notNull(),
  /** null = chưa xác định (vd phần còn lại tính từ ngày giao xong). */
  dueDate: text('due_date'),
  note: text('note').notNull().default(''),
  createdAt: text('created_at').notNull(),
}, t => [
  index('idx_payment_schedules_order').on(t.orderId),
  index('idx_payment_schedules_due').on(t.dueDate),
  enumCheck('chk_payment_schedules_kind', t.kind, SCHEDULE_KINDS),
  check('chk_payment_schedules_amount', sql`${t.amount} >= 0`),
]).enableRLS();

/** Phiếu thu tiền khách (ghi nhận thanh toán). */
export const customerPayments = pgTable('customer_payments', {
  id: text('id').primaryKey(),
  orderId: text('order_id').notNull().references(() => salesOrders.id),
  scheduleId: text('schedule_id').references(() => paymentSchedules.id),
  customerId: text('customer_id').references(() => customers.id),
  amount: doublePrecision('amount').notNull(),
  paidAt: text('paid_at').notNull(),
  method: text('method', { enum: PAYMENT_METHODS }).notNull().default('transfer'),
  reference: text('reference').notNull().default(''),
  note: text('note').notNull().default(''),
  createdBy: text('created_by').notNull().references(() => employees.id),
  createdAt: text('created_at').notNull(),
}, t => [
  index('idx_customer_payments_order').on(t.orderId, t.paidAt),
  index('idx_customer_payments_customer').on(t.customerId, t.paidAt),
  enumCheck('chk_customer_payments_method', t.method, PAYMENT_METHODS),
  check('chk_customer_payments_amount', sql`${t.amount} > 0`),
]).enableRLS();

/**
 * Phiếu đóng gói (xuất kho) của đơn. Nhân viên phụ trách bấm "Yêu cầu đóng gói": mỗi nguồn hàng (kho, điều chuyển cửa hàng,
 * NCC, đại lý…) một phiếu. Gửi kho → việc cho nhóm Kho; kho đóng xong xác nhận kèm 1–3 ảnh.
 */
export const packingSlips = pgTable('packing_slips', {
  id: text('id').primaryKey(),
  slipNo: text('slip_no').notNull(),
  orderId: text('order_id').notNull().references(() => salesOrders.id),
  source: text('source', { enum: PACKING_SOURCES }).notNull().default('warehouse'),
  /** Tên cửa hàng / NCC / đại lý cụ thể. */
  sourceNote: text('source_note').notNull().default(''),
  status: text('status', { enum: PACKING_STATUSES }).notNull().default('draft'),
  note: text('note').notNull().default(''),
  totalQty: doublePrecision('total_qty').notNull().default(0),
  /** Cân nặng ước tính (kg) theo quy cách thùng của sản phẩm; null = chưa có số liệu. */
  totalWeight: doublePrecision('total_weight'),
  createdBy: text('created_by').notNull().references(() => employees.id),
  sentAt: text('sent_at'),
  sentBy: text('sent_by').references(() => employees.id),
  packedAt: text('packed_at'),
  packedBy: text('packed_by').references(() => employees.id),
  packedNote: text('packed_note').notNull().default(''),
  revision: bigint('revision', { mode: 'number' }).notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, t => [
  uniqueIndex('idx_packing_slips_no').on(t.slipNo),
  index('idx_packing_slips_order').on(t.orderId),
  index('idx_packing_slips_status').on(t.status, t.updatedAt),
  enumCheck('chk_packing_slips_status', t.status, PACKING_STATUSES),
  enumCheck('chk_packing_slips_source', t.source, PACKING_SOURCES),
  check('chk_packing_slips_qty', sql`${t.totalQty} >= 0`),
]).enableRLS();

/** Dòng hàng của phiếu đóng gói, kèm gợi ý quy cách (thùng) và cân nặng lấy từ danh mục sản phẩm lúc lập phiếu. */
export const packingSlipLines = pgTable('packing_slip_lines', {
  id: text('id').primaryKey(),
  slipId: text('slip_id').notNull().references(() => packingSlips.id, { onDelete: 'cascade' }),
  orderLineId: text('order_line_id').notNull().references(() => salesOrderLines.id),
  sku: text('sku').notNull().default(''),
  name: text('name').notNull(),
  unit: text('unit').notNull().default(''),
  qty: doublePrecision('qty').notNull(),
  perCarton: doublePrecision('per_carton'),
  cartonWeight: doublePrecision('carton_weight'),
  cartonSize: text('carton_size').notNull().default(''),
  weight: doublePrecision('weight'),
}, t => [
  index('idx_packing_slip_lines_slip').on(t.slipId),
  index('idx_packing_slip_lines_order_line').on(t.orderLineId),
  check('chk_packing_slip_lines_qty', sql`${t.qty} > 0`),
]).enableRLS();

/** Ảnh kho chụp khi xác nhận đã đóng hàng (đã nén ở trình duyệt, lưu dạng data URL). */
export const packingSlipPhotos = pgTable('packing_slip_photos', {
  id: text('id').primaryKey(),
  slipId: text('slip_id').notNull().references(() => packingSlips.id, { onDelete: 'cascade' }),
  dataUrl: text('data_url').notNull(),
  bytes: bigint('bytes', { mode: 'number' }).notNull().default(0),
  createdBy: text('created_by').notNull().references(() => employees.id),
  createdAt: text('created_at').notNull(),
}, t => [index('idx_packing_slip_photos_slip').on(t.slipId)]).enableRLS();
