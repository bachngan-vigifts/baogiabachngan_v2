import { sql } from 'drizzle-orm';
import { pgTable, text, bigint, doublePrecision, index, uniqueIndex, primaryKey, check } from 'drizzle-orm/pg-core';
import { employees, positions } from '../staff/schema.ts';
import { warehouses } from '../catalog/schema.ts';
import { enumCheck } from '../../core/db/enum-check.ts';
import { STOCK_MOVE_KINDS, STOCK_REF_TYPES, TRANSFER_STATUSES, WAREHOUSE_PHOTO_REFS } from './domain/kinds.ts';

/*
 * SỔ KHO (giai đoạn 1 – chạy song song với Sapo, Sapo vẫn là nguồn tồn chính) – xem docs/SO-KHO.md.
 *   stock_moves     mỗi lần nhập / xuất / điều chỉnh = 1 dòng (+/−), KHÔNG sửa / xoá; huỷ chứng từ = ghi dòng ngược lại.
 *   stock_balances  tồn hiện tại theo (mã, kho) = cộng dồn stock_moves, cập nhật cùng giao dịch với dòng phát sinh.
 */

export const stockMoves = pgTable('stock_moves', {
  id: text('id').primaryKey(),
  sku: text('sku').notNull(),
  warehouseId: text('warehouse_id').notNull().references(() => warehouses.id),
  /** Số lượng thay đổi: dương = nhập, âm = xuất. */
  qty: doublePrecision('qty').notNull(),
  kind: text('kind', { enum: STOCK_MOVE_KINDS }).notNull(),
  refType: text('ref_type', { enum: STOCK_REF_TYPES }).notNull(),
  refId: text('ref_id').notNull(),
  /** Số chứng từ để hiển thị (PNH…, PĐG…, ĐC…). */
  refNo: text('ref_no').notNull().default(''),
  note: text('note').notNull().default(''),
  createdBy: text('created_by').notNull().references(() => employees.id),
  createdAt: text('created_at').notNull(),
}, t => [
  // Một chứng từ chỉ ghi một lần cho mỗi (mã, kho, loại) – gọi lặp không cộng hai lần.
  uniqueIndex('uq_stock_moves_ref').on(t.refType, t.refId, t.sku, t.warehouseId, t.kind),
  index('idx_stock_moves_card').on(t.sku, t.warehouseId, t.createdAt),
  index('idx_stock_moves_warehouse').on(t.warehouseId, t.createdAt),
  enumCheck('chk_stock_moves_kind', t.kind, STOCK_MOVE_KINDS),
  enumCheck('chk_stock_moves_ref_type', t.refType, STOCK_REF_TYPES),
  check('chk_stock_moves_qty', sql`${t.qty} <> 0`),
]).enableRLS();

export const stockBalances = pgTable('stock_balances', {
  sku: text('sku').notNull(),
  warehouseId: text('warehouse_id').notNull().references(() => warehouses.id),
  qty: doublePrecision('qty').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
}, t => [primaryKey({ columns: [t.sku, t.warehouseId] }), index('idx_stock_balances_warehouse').on(t.warehouseId)]).enableRLS();

/** Ảnh nghiệp vụ kho: ảnh hàng hỏng khi nhận hàng NCC, ảnh xác nhận đã giao. Nội dung nằm ở kho file private (`file_key`). */
export const warehousePhotos = pgTable('warehouse_photos', {
  id: text('id').primaryKey(),
  refType: text('ref_type', { enum: WAREHOUSE_PHOTO_REFS }).notNull(),
  refId: text('ref_id').notNull(),
  fileKey: text('file_key').notNull(),
  bytes: bigint('bytes', { mode: 'number' }).notNull().default(0),
  createdBy: text('created_by').notNull().references(() => employees.id),
  createdAt: text('created_at').notNull(),
}, t => [
  index('idx_warehouse_photos_ref').on(t.refType, t.refId),
  enumCheck('chk_warehouse_photos_ref_type', t.refType, WAREHOUSE_PHOTO_REFS),
]).enableRLS();

/**
 * KHO BÁN THEO CHỨC VỤ: chức vụ nào được bán hàng (lập đơn / HĐKT, trừ kho khi duyệt) từ kho nào. Manager bán mọi kho.
 * Bảng chưa có dòng nào = chưa bật phân kho bán (đơn không bắt chọn kho). Kho riêng (`warehouses.stock_private`): chỉ các chức vụ này + Manager thấy tồn.
 */
export const warehouseSellers = pgTable('warehouse_sellers', {
  warehouseId: text('warehouse_id').notNull().references(() => warehouses.id, { onDelete: 'cascade' }),
  positionId: text('position_id').notNull().references(() => positions.id, { onDelete: 'cascade' }),
}, t => [primaryKey({ columns: [t.warehouseId, t.positionId] }), index('idx_warehouse_sellers_position').on(t.positionId)]).enableRLS();

/** Phiếu điều chuyển kho (docs/SO-KHO.md "Điều chuyển kho"). Sổ kho chỉ ghi khi Kho bấm "Đã chuyển". */
export const stockTransfers = pgTable('stock_transfers', {
  id: text('id').primaryKey(),
  transferNo: text('transfer_no').notNull(),
  fromWarehouseId: text('from_warehouse_id').notNull().references(() => warehouses.id),
  toWarehouseId: text('to_warehouse_id').notNull().references(() => warehouses.id),
  status: text('status', { enum: TRANSFER_STATUSES }).notNull().default('pending'),
  reason: text('reason').notNull().default(''),
  requestedBy: text('requested_by').notNull().references(() => employees.id),
  approvedBy: text('approved_by').references(() => employees.id),
  approvedAt: text('approved_at'),
  rejectReason: text('reject_reason').notNull().default(''),
  doneBy: text('done_by').references(() => employees.id),
  doneAt: text('done_at'),
  doneNote: text('done_note').notNull().default(''),
  cancelledBy: text('cancelled_by').references(() => employees.id),
  cancelledAt: text('cancelled_at'),
  revision: bigint('revision', { mode: 'number' }).notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, t => [
  uniqueIndex('uq_stock_transfers_no').on(t.transferNo),
  index('idx_stock_transfers_status').on(t.status, t.createdAt),
  enumCheck('chk_stock_transfers_status', t.status, TRANSFER_STATUSES),
  check('chk_stock_transfers_wh', sql`${t.fromWarehouseId} <> ${t.toWarehouseId}`),
]).enableRLS();

export const stockTransferLines = pgTable('stock_transfer_lines', {
  id: text('id').primaryKey(),
  transferId: text('transfer_id').notNull().references(() => stockTransfers.id, { onDelete: 'cascade' }),
  sku: text('sku').notNull(),
  name: text('name').notNull().default(''),
  unit: text('unit').notNull().default(''),
  qty: doublePrecision('qty').notNull(),
}, t => [uniqueIndex('uq_stock_transfer_lines_sku').on(t.transferId, t.sku), check('chk_stock_transfer_lines_qty', sql`${t.qty} > 0`)]).enableRLS();
