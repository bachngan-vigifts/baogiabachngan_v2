import { sql } from 'drizzle-orm';
import { pgTable, text, bigint, boolean, doublePrecision, index, uniqueIndex, primaryKey, check } from 'drizzle-orm/pg-core';
import { employees } from '../staff/schema.ts';
import { enumCheck } from '../../core/db/enum-check.ts';

/*
 * DANH MỤC NHÀ CUNG CẤP (NCC) – bảng riêng để quản lý/sửa trên trang quản lý NCC, không viết cứng trong code.
 * Bản cũ chỉ có tên và email NCC gõ tay trên từng đơn, và nhận biết "NCC nào xem đơn nào" bằng cách so email
 * (kèm hai email nội bộ viết cứng trong lib/product-catalog.mjs `supplierEmailMatches`). Nay:
 *   suppliers          công ty NCC
 *   supplier_contacts  email nhận đơn (To) và CC của từng NCC – điền sẵn khi duyệt đơn
 *   supplier_accounts  tài khoản đăng nhập NCC thuộc NCC nào → quyết định tài khoản đó thấy đơn nào
 * Không xoá NCC (đã có đơn tham chiếu): ngừng hoạt động bằng `active = 0`.
 */
export const suppliers = pgTable('suppliers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** Tên đã chuẩn hoá (bỏ dấu, hạ chữ, gộp khoảng trắng) do ứng dụng tính bằng JS – tránh lower() ASCII của SQLite. */
  nameKey: text('name_key').notNull(),
  taxCode: text('tax_code').notNull().default(''),
  address: text('address').notNull().default(''),
  phone: text('phone').notNull().default(''),
  email: text('email').notNull().default(''),
  note: text('note').notNull().default(''),
  active: boolean('active').notNull().default(true),
  createdAt: text('created_at').notNull(),
  createdBy: text('created_by').notNull(),
  updatedAt: text('updated_at').notNull(),
  updatedBy: text('updated_by'),
}, t => [
  uniqueIndex('idx_suppliers_name_key').on(t.nameKey),
  index('idx_suppliers_active').on(t.active, t.name),
  check('chk_suppliers_name', sql`length(trim(${t.name})) > 0 AND length(${t.nameKey}) > 0`),
]).enableRLS();

export const supplierContacts = pgTable('supplier_contacts', {
  id: text('id').primaryKey(),
  supplierId: text('supplier_id').notNull().references(() => suppliers.id, { onDelete: 'cascade' }),
  /** order = nhận đơn (To), cc = đồng gửi. */
  kind: text('kind', { enum: ['order', 'cc'] }).notNull().default('order'),
  name: text('name').notNull().default(''),
  email: text('email').notNull(),
  phone: text('phone').notNull().default(''),
  createdAt: text('created_at').notNull(),
}, t => [
  uniqueIndex('idx_supplier_contacts_once').on(t.supplierId, t.kind, sql`lower(${t.email})`),
  enumCheck('chk_supplier_contacts_kind', t.kind, ['order', 'cc']),
  check('chk_supplier_contacts_email', sql`${t.email} LIKE '%_@_%._%' AND ${t.email} NOT LIKE '% %'`),
]).enableRLS();

/**
 * Tài khoản đăng nhập NCC thuộc NCC nào. Mỗi tài khoản thuộc đúng MỘT NCC (khoá chính = member_id);
 * một NCC có nhiều tài khoản. Ứng dụng chỉ cho gắn tài khoản NCC (chức vụ `supplier`) đang hoạt động.
 */
export const supplierAccounts = pgTable('supplier_accounts', {
  memberId: text('member_id').primaryKey().references(() => employees.id, { onDelete: 'cascade' }),
  supplierId: text('supplier_id').notNull().references(() => suppliers.id),
  createdAt: text('created_at').notNull(),
  createdBy: text('created_by').notNull(),
}, t => [index('idx_supplier_accounts_supplier').on(t.supplierId)]).enableRLS();

/*
 * Hàng sắp về + đơn đặt hàng NCC.
 *
 * Bản cũ gom CẢ HAI vào một file JSON `incoming-stock/index.json` trên R2 (mảng `shipments`, mỗi phiếu
 * có thêm một file chi tiết `incoming-stock/<id>-<uuid>.json` chứa các dòng hàng), ghi bằng khoá lạc quan
 * theo ETag của cả file – nên hai người cùng sửa bất kỳ phiếu nào cũng đụng nhau. Hai loại phiếu phân biệt
 * bằng `source`:
 *   'incoming-stock'          manager nhập file hàng sắp về
 *   'supplier-order'          đơn đặt hàng NCC (qua duyệt → NCC xác nhận → đặt cọc → giao → nhập kho)
 *   'supplier-delivery-note'  phiếu giao hàng NCC xác nhận
 * Tên trường lấy từ lib/product-catalog.mjs (importIncomingStock, approveSupplierOrder, supplierOrderDetail,
 * confirmSupplierOrder, paySupplierDeposit, markSupplierDeliveryReady, receiveIncomingStock).
 * Các số tổng (subtotal, vat, total, depositAmount, remainingAmount) là DỮ LIỆU SUY RA từ dòng hàng
 * – tính trong domain, không lưu cột để khỏi lệch.
 */
export const incomingShipments = pgTable('incoming_shipments', {
  id: text('id').primaryKey(),
  ticketNumber: text('ticket_number').notNull(),
  source: text('source', { enum: ['incoming-stock', 'supplier-order', 'supplier-delivery-note'] }).notNull().default('incoming-stock'),
  approvalStatus: text('approval_status', { enum: ['pending', 'approved'] }).notNull().default('approved'),
  warehouse: text('warehouse').notNull(),
  /** YYYY-MM-DD */
  arrivalDate: text('arrival_date'),
  filename: text('filename').notNull().default(''),
  quoteNumber: text('quote_number').notNull().default(''),

  /** NCC của đơn (bắt buộc với đơn NCC – xem CHECK). `supplier_name/email` bên dưới là ảnh chụp tại thời điểm tạo/duyệt đơn. */
  supplierId: text('supplier_id').references(() => suppliers.id),
  supplierName: text('supplier_name').notNull().default(''),
  supplierEmail: text('supplier_email').notNull().default(''),
  ccEmail: text('cc_email').notNull().default(''),
  supplierInternalOrderNumber: text('supplier_internal_order_number').notNull().default(''),
  supplierStatus: text('supplier_status', { enum: ['pending', 'confirmed'] }).notNull().default('pending'),
  supplierConfirmedAt: text('supplier_confirmed_at'),
  supplierConfirmedBy: text('supplier_confirmed_by'),

  approvedAt: text('approved_at'),
  approvedBy: text('approved_by'),

  /** Tỷ lệ cọc %, chỉ có với đơn NCC (mặc định 30). */
  depositRate: doublePrecision('deposit_rate'),
  depositRequestedAt: text('deposit_requested_at'),
  depositRequestedBy: text('deposit_requested_by'),
  /** Số tiền đã thanh toán. Bản cũ lưu trùng hai tên `paidAmount` và `depositPaidAmount`; gộp thành một cột. */
  paidAmount: doublePrecision('paid_amount').notNull().default(0),
  depositPaidAt: text('deposit_paid_at'),
  depositPaidBy: text('deposit_paid_by'),

  deliveryNoteId: text('delivery_note_id'),
  deliveryReadyAt: text('delivery_ready_at'),
  deliveryReadyBy: text('delivery_ready_by'),
  deliveryReadyMode: text('delivery_ready_mode', { enum: ['full', 'partial'] }),
  deliveryReadyDate: text('delivery_ready_date'),

  /**
   * Lần NCC tải mẫu đơn về để ký. Bản cũ coi "đã tải" cũng thoả bước chữ ký khi xác nhận (xem workflow.ts).
   * File chữ ký đã tải lên nằm ở bảng `incoming_shipment_files`.
   */
  supplierSignatureDownloadedAt: text('supplier_signature_downloaded_at'),
  supplierSignatureDownloadedBy: text('supplier_signature_downloaded_by'),

  receivedAt: text('received_at'),
  receivedBy: text('received_by'),
  receivedWarehouse: text('received_warehouse'),
  sapoReceiptId: text('sapo_receipt_id').notNull().default(''),
  sapoReceiptCode: text('sapo_receipt_code').notNull().default(''),
  stockSyncedAt: text('stock_synced_at'),

  createdAt: text('created_at').notNull(),
  createdBy: text('created_by').notNull(),
  updatedAt: text('updated_at').notNull(),
  updatedBy: text('updated_by'),
  /** Trường chưa mô hình hoá (giữ để không mất dữ liệu khi chuyển từ bản cũ). */
  extra: text('extra').notNull().default('{}'),
}, t => [
  // Bản cũ so sánh số phiếu KHÔNG phân biệt hoa thường (bằng JS). lower() của SQLite chỉ hạ chữ ASCII –
  // repo phải tự kiểm tra trùng bằng JS cho phần chữ có dấu (xem test 'GIỚI HẠN ĐÃ BIẾT').
  uniqueIndex('idx_incoming_shipments_ticket').on(sql`lower(${t.ticketNumber})`),
  uniqueIndex('idx_incoming_shipments_delivery_note').on(t.deliveryNoteId).where(sql`${t.deliveryNoteId} IS NOT NULL`),
  index('idx_incoming_shipments_queue').on(t.source, t.approvalStatus, t.createdAt),
  index('idx_incoming_shipments_received').on(t.receivedAt),
  index('idx_incoming_shipments_quote').on(t.quoteNumber),
  index('idx_incoming_shipments_supplier').on(t.supplierId, t.source, t.approvalStatus),
  // Mọi đơn NCC phải thuộc một NCC trong danh mục (bản cũ bắt buộc nhập tên NCC khi tạo đơn NCC).
  check('chk_incoming_shipments_supplier_required', sql`${t.source} <> 'supplier-order' OR ${t.supplierId} IS NOT NULL`),
  index('idx_incoming_shipments_supplier_email').on(sql`lower(${t.supplierEmail})`),
  enumCheck('chk_incoming_shipments_source', t.source, ['incoming-stock', 'supplier-order', 'supplier-delivery-note']),
  enumCheck('chk_incoming_shipments_approval', t.approvalStatus, ['pending', 'approved']),
  enumCheck('chk_incoming_shipments_supplier_status', t.supplierStatus, ['pending', 'confirmed']),
  enumCheck('chk_incoming_shipments_ready_mode', t.deliveryReadyMode, ['full', 'partial']),
  check('chk_incoming_shipments_deposit', sql`${t.depositRate} IS NULL OR (${t.depositRate} >= 0 AND ${t.depositRate} <= 100)`),
  check('chk_incoming_shipments_paid', sql`${t.paidAmount} >= 0`),
]).enableRLS();

export const incomingShipmentLines = pgTable('incoming_shipment_lines', {
  id: text('id').primaryKey(),
  shipmentId: text('shipment_id').notNull().references(() => incomingShipments.id, { onDelete: 'cascade' }),
  lineNo: bigint('line_no', { mode: 'number' }).notNull(),
  sku: text('sku').notNull(),
  name: text('name').notNull().default(''),
  unit: text('unit').notNull().default(''),
  quantity: doublePrecision('quantity').notNull(),

  /** Đơn giá niêm yết / VAT / phí in – chỉ bắt buộc với đơn NCC. */
  price: doublePrecision('price'),
  manualPrice: boolean('manual_price').notNull().default(false),
  taxRate: doublePrecision('tax_rate'),
  printDescription: text('print_description').notNull().default(''),
  printFee: doublePrecision('print_fee').notNull().default(0),
  /** Khoá R2 hoặc URL https. Bản cũ có thể lưu cả ảnh base64 (tới ~950 KB) trong JSON; chuyển dữ liệu phải đưa ảnh đó lên R2. */
  designImage: text('design_image').notNull().default(''),

  /** Quy cách đóng gói tại thời điểm tạo phiếu (ảnh chụp, không đổi theo catalog). */
  perCarton: doublePrecision('per_carton'),
  cartonWeight: doublePrecision('carton_weight'),
  cartonLength: doublePrecision('carton_length'),
  cartonWidth: doublePrecision('carton_width'),
  cartonHeight: doublePrecision('carton_height'),
  cartons: doublePrecision('cartons'),
  weightKg: doublePrecision('weight_kg'),
  volumeM3: doublePrecision('volume_m3'),

  /** % chiết khấu mua vào do manager nhập khi duyệt (itemDiscounts). */
  purchaseDiscount: doublePrecision('purchase_discount'),
  /** Phần NCC xác nhận (supplierConfirmations): có thể ghi đè chiết khấu, hẹn ngày giao, ghi chú. */
  supplierConfirmed: boolean('supplier_confirmed').notNull().default(false),
  confirmedPurchaseDiscount: doublePrecision('confirmed_purchase_discount'),
  promisedDate: text('promised_date').notNull().default(''),
  supplierNote: text('supplier_note').notNull().default(''),
  /** Số lượng NCC báo sẵn sàng giao (supplierDeliveryReadyRows) và số lượng đã giao thực tế. */
  deliveryReadyQuantity: doublePrecision('delivery_ready_quantity'),
  deliveredQuantity: doublePrecision('delivered_quantity'),
  stockSyncedAt: text('stock_synced_at'),
}, t => [
  uniqueIndex('idx_incoming_shipment_lines_order').on(t.shipmentId, t.lineNo),
  // Bản cũ từ chối SKU lặp trong một phiếu (không phân biệt hoa thường).
  uniqueIndex('idx_incoming_shipment_lines_sku').on(t.shipmentId, sql`lower(${t.sku})`),
  index('idx_incoming_shipment_lines_by_sku').on(t.sku),
  check('chk_incoming_lines_qty', sql`${t.quantity} >= 0`),
  check('chk_incoming_lines_price', sql`${t.price} IS NULL OR ${t.price} >= 0`),
  check('chk_incoming_lines_tax', sql`${t.taxRate} IS NULL OR (${t.taxRate} >= 0 AND ${t.taxRate} <= 100)`),
  check('chk_incoming_lines_print_fee', sql`${t.printFee} >= 0`),
  check('chk_incoming_lines_discount', sql`${t.purchaseDiscount} IS NULL OR (${t.purchaseDiscount} >= 0 AND ${t.purchaseDiscount} <= 100)`),
  check('chk_incoming_lines_confirmed_discount', sql`${t.confirmedPurchaseDiscount} IS NULL OR (${t.confirmedPurchaseDiscount} >= 0 AND ${t.confirmedPurchaseDiscount} <= 100)`),
]).enableRLS();

/**
 * File đính kèm của phiếu (hiện chỉ có bản ký xác nhận của NCC). Bản cũ lưu thành object `supplierSignatureFile`
 * trong JSON; mỗi phiếu có tối đa một file, tải lên lại thì thay. Nội dung nằm trên R2 (khoá `r2_key`).
 */
export const incomingShipmentFiles = pgTable('incoming_shipment_files', {
  id: text('id').primaryKey(),
  shipmentId: text('shipment_id').notNull().references(() => incomingShipments.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['signature'] }).notNull().default('signature'),
  r2Key: text('r2_key').notNull(),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type', { enum: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] }).notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  uploadedAt: text('uploaded_at').notNull(),
  uploadedBy: text('uploaded_by').notNull(),
  downloadedAt: text('downloaded_at'),
  downloadedBy: text('downloaded_by'),
}, t => [
  uniqueIndex('idx_incoming_shipment_files_once').on(t.shipmentId, t.kind),
  enumCheck('chk_incoming_shipment_files_kind', t.kind, ['signature']),
  enumCheck('chk_incoming_shipment_files_mime', t.mimeType, ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  // Giới hạn 6 MB như bản cũ.
  check('chk_incoming_shipment_files_size', sql`${t.sizeBytes} > 0 AND ${t.sizeBytes} <= 6291456`),
]).enableRLS();

/** Yêu cầu xin hàng của NCC (bản cũ: mảng `supplierStockRequests` trong cùng file index). */
export const supplierStockRequests = pgTable('supplier_stock_requests', {
  id: text('id').primaryKey(),
  status: text('status', { enum: ['pending', 'accepted', 'rejected'] }).notNull().default('pending'),
  supplierName: text('supplier_name').notNull().default(''),
  supplierEmail: text('supplier_email').notNull().default(''),
  note: text('note').notNull().default(''),
  createdAt: text('created_at').notNull(),
  createdBy: text('created_by').notNull(),
  createdByName: text('created_by_name').notNull().default(''),
  createdByPositionId: text('created_by_position_id').notNull().default(''),
  respondedAt: text('responded_at'),
  respondedBy: text('responded_by'),
  responseNote: text('response_note').notNull().default(''),
}, t => [index('idx_supplier_stock_requests_status').on(t.status, t.createdAt), enumCheck('chk_supplier_stock_requests_status', t.status, ['pending', 'accepted', 'rejected'])]).enableRLS();

export const supplierStockRequestLines = pgTable('supplier_stock_request_lines', {
  requestId: text('request_id').notNull().references(() => supplierStockRequests.id, { onDelete: 'cascade' }),
  lineNo: bigint('line_no', { mode: 'number' }).notNull(),
  shipmentId: text('shipment_id').notNull().references(() => incomingShipments.id, { onDelete: 'cascade' }),
  sku: text('sku').notNull(),
  name: text('name').notNull().default(''),
  unit: text('unit').notNull().default(''),
  quantity: doublePrecision('quantity').notNull(),
  /** Số lượng tối đa có thể xin (còn lại trên đơn). */
  maxQuantity: doublePrecision('max_quantity').notNull(),
  arrivalDate: text('arrival_date').notNull().default(''),
}, t => [
  primaryKey({ columns: [t.requestId, t.lineNo] }),
  index('idx_supplier_stock_request_lines_shipment').on(t.shipmentId),
  check('chk_stock_request_qty', sql`${t.quantity} > 0 AND ${t.quantity} <= ${t.maxQuantity}`),
]).enableRLS();
