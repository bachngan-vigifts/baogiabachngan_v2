import { posShifts, posPaymentRequests } from './pos-schema.ts';
import { sql } from 'drizzle-orm';
import { pgTable, text, bigint, boolean, doublePrecision, index, uniqueIndex, primaryKey, check } from 'drizzle-orm/pg-core';
import { enumCheck } from '../../core/db/enum-check.ts';
import { employees } from '../staff/schema.ts';
import { customers } from '../customers/schema.ts';
import { quotations } from '../quotes/schema.ts';
import { products, warehouses } from '../catalog/schema.ts';
import { HOLD_STATUSES, CONTRACT_STATUSES, DELIVERY_STATUSES, INVOICE_MODES, INVOICE_STATUSES, LEGAL_ENTITIES, ORDER_STATUSES, PACKING_SOURCES, PACKING_STATUSES, PAYMENT_METHODS, PROGRESS_STAGES, SCHEDULE_KINDS, SHIP_TO } from './domain/statuses.ts';

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
  channel: text('channel').notNull().default('crm'),
  shiftId: text('shift_id').references(() => posShifts.id),
  checkoutKey: text('checkout_key'),
  posSnapshot: text('pos_snapshot'),
  posPaymentRequestId: text('pos_payment_request_id').references(() => posPaymentRequests.id),
  fulfillmentMode: text('fulfillment_mode').notNull().default('delivery'),
  quoteId: text('quote_id').references(() => quotations.id),
  quoteNo: text('quote_no').notNull().default(''),
  quoteType: text('quote_type', { enum: ['HRC', 'B2B', 'VIGIFTS'] }).notNull(),
  customerId: text('customer_id').references(() => customers.id),
  customerName: text('customer_name').notNull(),
  /** Default recipient for future deliveries; buyer contact/phone remain separate. */
  receiverName: text('receiver_name').notNull().default(''),
  receiverPhone: text('receiver_phone').notNull().default(''),
  contact: text('contact').notNull().default(''),
  phone: text('phone').notNull().default(''),
  email: text('email').notNull().default(''),
  taxCode: text('tax_code').notNull().default(''),
  address: text('address').notNull().default(''),
  /** Người phụ trách đơn (mặc định người phụ trách báo giá). */
  ownerId: text('owner_id').notNull().references(() => employees.id),
  createdBy: text('created_by').notNull().references(() => employees.id),
  /** Kho bán (đơn / HĐKT kênh CRM): hàng trừ khỏi kho này khi được duyệt, huỷ thì cộng lại – docs/SO-KHO.md. Đơn cũ / POS = null. */
  warehouseId: text('warehouse_id').references(() => warehouses.id),
  orderDate: text('order_date').notNull(),
  expectedDeliveryDate: text('expected_delivery_date'),
  status: text('status', { enum: ORDER_STATUSES }).notNull().default('confirmed'),
  /** Đơn / HĐKT nháp: null = nhân viên chưa bấm "Gửi duyệt" (Nháp); có giá trị = đã gửi Manager duyệt (Chờ duyệt). */
  submittedAt: text('submitted_at'),
  subtotal: doublePrecision('subtotal').notNull().default(0),
  tax: doublePrecision('tax').notNull().default(0),
  total: doublePrecision('total').notNull().default(0),
  note: text('note').notNull().default(''),
  /** Liên kết đơn Sapo khi đã chuyển sang Sapo (để sau). */
  sapoOrderId: text('sapo_order_id'),
  sapoOrderCode: text('sapo_order_code'),
  /** Lúc đẩy sang Sapo: khi có lần cập nhật tồn nguồn sau thời điểm này, web thôi giữ để không trừ hai lần. */
  sapoPushedAt: text('sapo_pushed_at'),
  /** Đơn / HĐKT tự giữ hàng từ lúc lập đến khi huỷ / giao xong / tồn Sapo đã trừ (docs/BAN-HANG.md "Giữ hàng"). Đơn có trước migration 0068 = false. */
  holdsStock: boolean('holds_stock').notNull().default(true),
  /** Xuất hoá đơn: yêu cầu (tự động khi giao xong / nhân viên bấm) → việc cho nhóm Kế toán → kế toán nhập số hoá đơn. */
  invoiceStatus: text('invoice_status', { enum: INVOICE_STATUSES }).notNull().default('none'),
  invoiceRequestedAt: text('invoice_requested_at'),
  /** null khi yêu cầu tự động (giao xong). */
  invoiceRequestedBy: text('invoice_requested_by').references(() => employees.id),
  invoiceRequestNote: text('invoice_request_note').notNull().default(''),
  /** Email nhận hoá đơn (mặc định email khách trên đơn, sửa được khi yêu cầu). */
  invoiceEmail: text('invoice_email').notNull().default(''),
  /** `issue` = phát hành chính thức; `draft` = gửi bản nháp cho khách kiểm tra trước. */
  invoiceMode: text('invoice_mode', { enum: INVOICE_MODES }).notNull().default('issue'),
  invoiceNo: text('invoice_no').notNull().default(''),
  invoiceDate: text('invoice_date'),
  invoiceIssuedAt: text('invoice_issued_at'),
  invoiceIssuedBy: text('invoice_issued_by').references(() => employees.id),
  revision: bigint('revision', { mode: 'number' }).notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, t => [
  uniqueIndex('idx_sales_orders_no').on(t.orderNo),
  uniqueIndex('uq_pos_checkout_key').on(t.checkoutKey),
  uniqueIndex('uq_pos_order_qr').on(t.posPaymentRequestId),
  index('idx_pos_orders_shift').on(t.shiftId),
  // Một báo giá chỉ có một đơn đang hiệu lực (đơn huỷ thì tạo lại được).
  uniqueIndex('idx_sales_orders_quote_active').on(t.quoteId).where(sql`${t.quoteId} IS NOT NULL AND ${t.status} <> 'cancelled'`),
  index('idx_sales_orders_customer').on(t.customerId, t.orderDate),
  index('idx_sales_orders_owner').on(t.ownerId, t.updatedAt),
  index('idx_sales_orders_status').on(t.status, t.orderDate),
  enumCheck('chk_sales_orders_status', t.status, ORDER_STATUSES),
  enumCheck('chk_sales_orders_invoice_status', t.invoiceStatus, INVOICE_STATUSES),
  enumCheck('chk_sales_orders_invoice_mode', t.invoiceMode, INVOICE_MODES),
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
  listUnitPrice: doublePrecision('list_unit_price'),
  discountType: text('discount_type').notNull().default('percent'),
  discountValue: doublePrecision('discount_value').notNull().default(0),
  discountAmount: doublePrecision('discount_amount').notNull().default(0),
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
  codAmount: doublePrecision('cod_amount').notNull().default(0),
  id: text('id').primaryKey(),
  deliveryNo: text('delivery_no').notNull(),
  orderId: text('order_id').notNull().references(() => salesOrders.id),
  plannedDate: text('planned_date').notNull(),
  timeSlot: text('time_slot').notNull().default(''),
  address: text('address').notNull().default(''),
  receiverName: text('receiver_name').notNull().default(''),
  receiverPhone: text('receiver_phone').notNull().default(''),
  carrier: text('carrier').notNull().default(''),
  trackingCode: text('tracking_code').notNull().default(''),
  trackingStatus: text('tracking_status').notNull().default(''),
  trackingUpdatedAt: text('tracking_updated_at'),
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
  shiftId: text('shift_id').references(() => posShifts.id),
  deliveryId: text('delivery_id').references(() => deliveries.id),
  requestKey: text('request_key'),
  paymentSource: text('payment_source').notNull().default('manual'),
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
  /** Huỷ phiếu thu ghi nhầm (Manager / quyền "Huỷ phiếu thu"): giữ lại dòng + lý do, không tính vào đã thu. */
  voidedAt: text('voided_at'),
  voidedBy: text('voided_by').references(() => employees.id),
  voidReason: text('void_reason').notNull().default(''),
}, t => [
  index('idx_customer_payments_order').on(t.orderId, t.paidAt),
  index('idx_pos_payments_shift').on(t.shiftId),
  uniqueIndex('uq_pos_payment_request').on(t.requestKey),
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
  /** Kho xuất hàng (nguồn = Kho): kho chọn lúc xác nhận đã đóng hàng → ghi phiếu xuất vào sổ kho. */
  stockWarehouseId: text('stock_warehouse_id'),
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
  /**
   * Giao tới: 'customer' = giao thẳng cho khách (địa chỉ giao của đơn) · 'workshop' = giao về xưởng in (đơn có phí in logo).
   * Tên / địa chỉ / SĐT nơi nhận chụp lại lúc lập phiếu; gửi xe nào (nhà xe + SĐT) nếu đi xe khách / chành.
   */
  shipTo: text('ship_to', { enum: SHIP_TO }).notNull().default('customer'),
  shipName: text('ship_name').notNull().default(''),
  shipAddress: text('ship_address').notNull().default(''),
  shipPhone: text('ship_phone').notNull().default(''),
  carrierName: text('carrier_name').notNull().default(''),
  carrierPhone: text('carrier_phone').notNull().default(''),
  revision: bigint('revision', { mode: 'number' }).notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, t => [
  enumCheck('chk_packing_slips_ship_to', t.shipTo, SHIP_TO),
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

/** Nhà xe / chành xe hay gửi hàng (danh sách chọn nhanh trong "Yêu cầu đóng gói - Giao hàng", nhân viên thêm ngay trong ô). */
export const shippingCarriers = pgTable('shipping_carriers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** Tên không dấu, chữ thường – chống trùng. */
  nameKey: text('name_key').notNull(),
  phone: text('phone').notNull().default(''),
  createdBy: text('created_by').references(() => employees.id),
  createdAt: text('created_at').notNull(),
}, t => [uniqueIndex('idx_shipping_carriers_name_key').on(t.nameKey)]).enableRLS();

/**
 * Bước tiến trình đã xong (thanh tiến trình đơn / HĐKT): ghi khi nhân viên hoàn thành việc "In mẫu" / "Sản xuất"
 * (`source = 'task'`) hoặc Manager bấm hoàn thành nhanh (`source = 'manual'`). Bước "Duyệt", "Xuất kho", "Giao hàng"
 * còn tự xong theo chứng từ (đơn đã duyệt, kho xác nhận đóng gói, đơn đã giao) – không cần dòng ở đây.
 */
export const orderProgressMarks = pgTable('order_progress_marks', {
  orderId: text('order_id').notNull().references(() => salesOrders.id, { onDelete: 'cascade' }),
  stage: text('stage', { enum: PROGRESS_STAGES }).notNull(),
  source: text('source', { enum: ['task', 'manual'] }).notNull(),
  markedBy: text('marked_by').references(() => employees.id),
  markedAt: text('marked_at').notNull(),
}, t => [primaryKey({ columns: [t.orderId, t.stage] }), enumCheck('chk_order_progress_stage', t.stage, PROGRESS_STAGES),
  enumCheck('chk_order_progress_source', t.source, ['task', 'manual'])]).enableRLS();

/**
 * Giữ hàng cho báo giá đã duyệt (nút "Giữ hàng 5 ngày"): mỗi mã một dòng. Tồn khả dụng ở mọi chỗ kiểm tồn = tồn kho thật − tổng đang giữ
 * (dòng `active` chưa quá `expires_at`). Hết hạn → `expired` + báo nhân viên; lập đơn / HĐKT từ báo giá → `converted`.
 */
export const stockHolds = pgTable('stock_holds', {
  id: text('id').primaryKey(),
  quoteId: text('quote_id').notNull().references(() => quotations.id, { onDelete: 'cascade' }),
  sku: text('sku').notNull().references(() => products.sku, { onDelete: 'cascade' }),
  qty: doublePrecision('qty').notNull(),
  status: text('status', { enum: HOLD_STATUSES }).notNull().default('active'),
  expiresAt: text('expires_at').notNull(),
  createdBy: text('created_by').notNull().references(() => employees.id),
  createdAt: text('created_at').notNull(),
  closedAt: text('closed_at'),
  closedBy: text('closed_by'),
  notifiedAt: text('notified_at'),
}, t => [
  index('idx_stock_holds_sku').on(t.sku, t.status),
  index('idx_stock_holds_quote').on(t.quoteId, t.status),
  index('idx_stock_holds_expiry').on(t.status, t.expiresAt),
  enumCheck('chk_stock_holds_status', t.status, HOLD_STATUSES),
  check('chk_stock_holds_qty', sql`${t.qty} > 0`),
]).enableRLS();
