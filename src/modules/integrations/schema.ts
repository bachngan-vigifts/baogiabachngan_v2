import { pgTable, text, bigint, boolean, doublePrecision, index, uniqueIndex, primaryKey } from 'drizzle-orm/pg-core';
import { enumCheck } from '../../core/db/enum-check.ts';
import { SAPO_DOC_KINDS } from './domain/sapo-docs.ts';

const SEPAY_TRANSACTION_STATUSES = ['matched', 'unmatched', 'review'] as const;

/**
 * Giao dịch vào do SePay đẩy sang. Giữ nguyên payload để kế toán truy vết; id của SePay là
 * khoá chống ghi nhận hai lần. Liên kết đơn/phiếu thu dùng text để integrations không phụ thuộc
 * schema sales (quy tắc kiến trúc module).
 */
export const sepayTransactions = pgTable('sepay_transactions', {
  id: text('id').primaryKey(),
  providerId: text('provider_id').notNull(),
  transferType: text('transfer_type').notNull(),
  amount: doublePrecision('amount').notNull(),
  accountNumber: text('account_number').notNull().default(''),
  transactionAt: text('transaction_at').notNull(),
  content: text('content').notNull().default(''),
  status: text('status', { enum: SEPAY_TRANSACTION_STATUSES }).notNull(),
  reason: text('reason').notNull().default(''),
  orderId: text('order_id'),
  paymentId: text('payment_id'),
  payload: text('payload').notNull(),
  receivedAt: text('received_at').notNull(),
}, t => [
  uniqueIndex('uq_sepay_transactions_provider').on(t.providerId),
  index('idx_sepay_transactions_status_received').on(t.status, t.receivedAt),
  enumCheck('chk_sepay_transactions_status', t.status, SEPAY_TRANSACTION_STATUSES),
]).enableRLS();

/** Chỉ lưu SHA-256 mã nhận webhook; không dùng khóa SyncTime Client hoặc phiên Sapo. */
export const synctimeConnections = pgTable('synctime_connections', {
  id: text('id').primaryKey(),
  tokenHash: text('token_hash').notNull(),
  updatedAt: text('updated_at').notNull(),
}).enableRLS();

/** Hộp nhận chờ đối chiếu hợp đồng dữ liệu thực tế; chưa ghi ngày công / lương. */
export const synctimeReceipts = pgTable('synctime_receipts', {
  id: text('id').primaryKey(), // SHA-256 của JSON nhận được: retry cùng gói không ghi thêm
  payload: text('payload').notNull(),
  receivedAt: text('received_at').notNull(),
}, t => [index('idx_synctime_received').on(t.receivedAt)]).enableRLS();

export const sapoOrderStatuses = pgTable('sapo_order_statuses', {
  quoteNumber: text('quote_number').primaryKey(),
  status: text('status').notNull(),
  sapoOrderId: text('sapo_order_id'),
  sapoOrderCode: text('sapo_order_code'),
  sapoOrderUrl: text('sapo_order_url'),
  customerName: text('customer_name'),
  message: text('message'),
  payloadJson: text('payload_json'),
  updatedAt: text('updated_at').notNull(),
}, t => [index('idx_sapo_order_statuses_updated').on(t.updatedAt)]).enableRLS();

/** Phiên đăng nhập Sapo admin (cookie mã hoá AES-GCM). Trước đây tạo ngầm lúc chạy. */
export const sapoRuntimeSessions = pgTable('sapo_runtime_sessions', {
  id: text('id').primaryKey(),
  encryptedCookie: text('encrypted_cookie').notNull(),
  updatedAt: text('updated_at').notNull(),
  updatedBy: text('updated_by').notNull(),
}).enableRLS();

/** Trạng thái giám sát kết nối Sapo. Trước đây tạo ngầm lúc chạy. */
export const sapoHealthMonitorState = pgTable('sapo_health_monitor_state', {
  id: text('id').primaryKey(),
  data: text('data').notNull(),
  updatedAt: text('updated_at').notNull(),
}).enableRLS();


/**
 * Chứng từ kho của Sapo (chỉ đọc, chép từ Sapo): đơn nhập hàng, đơn điều chuyển (chuyển kho), phiếu kiểm hàng.
 * `id` = `<kind>:<id Sapo>`; bản gốc Sapo (đã cắt gọn) giữ trong `data` để sau này đối chiếu / tính hàng chờ về.
 */
export const sapoInventoryDocs = pgTable('sapo_inventory_docs', {
  id: text('id').primaryKey(),
  kind: text('kind', { enum: SAPO_DOC_KINDS }).notNull(),
  sapoId: text('sapo_id').notNull(),
  code: text('code').notNull().default(''),
  status: text('status').notNull().default(''),
  /** Chi nhánh/kho của chứng từ (điều chuyển: kho chuyển đi). */
  locationName: text('location_name').notNull().default(''),
  /** Điều chuyển: kho nhận. */
  toLocationName: text('to_location_name').notNull().default(''),
  /** Đơn nhập: nhà cung cấp. */
  partnerName: text('partner_name').notNull().default(''),
  totalQty: doublePrecision('total_qty').notNull().default(0),
  totalAmount: doublePrecision('total_amount').notNull().default(0),
  note: text('note').notNull().default(''),
  createdOn: text('created_on'),
  modifiedOn: text('modified_on'),
  data: text('data').notNull().default('{}'),
  syncedAt: text('synced_at').notNull(),
}, t => [
  uniqueIndex('idx_sapo_inventory_docs_kind_sapo').on(t.kind, t.sapoId),
  index('idx_sapo_inventory_docs_kind_created').on(t.kind, t.createdOn),
  index('idx_sapo_inventory_docs_code').on(t.code),
  enumCheck('chk_sapo_inventory_docs_kind', t.kind, SAPO_DOC_KINDS),
]).enableRLS();

/** Dòng hàng của chứng từ kho Sapo (thay toàn bộ mỗi lần chứng từ được đồng bộ lại). */
export const sapoInventoryDocLines = pgTable('sapo_inventory_doc_lines', {
  docId: text('doc_id').notNull().references(() => sapoInventoryDocs.id, { onDelete: 'cascade' }),
  lineNo: bigint('line_no', { mode: 'number' }).notNull(),
  sku: text('sku').notNull().default(''),
  variantId: text('variant_id').notNull().default(''),
  name: text('name').notNull().default(''),
  /** Số lượng (nhập / chuyển / số thực tế khi kiểm). */
  qty: doublePrecision('qty').notNull().default(0),
  /** Kiểm hàng: chênh lệch so với tồn trên hệ thống (nếu Sapo trả). */
  diffQty: doublePrecision('diff_qty'),
  price: doublePrecision('price'),
}, t => [primaryKey({ columns: [t.docId, t.lineNo] }), index('idx_sapo_inventory_doc_lines_sku').on(t.sku)]).enableRLS();
