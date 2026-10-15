import { sql } from 'drizzle-orm';
import { pgTable, text, doublePrecision, index, uniqueIndex, primaryKey, check } from 'drizzle-orm/pg-core';
import { employees } from '../staff/schema.ts';
import { warehouses } from '../catalog/schema.ts';
import { enumCheck } from '../../core/db/enum-check.ts';
import { STOCK_MOVE_KINDS, STOCK_REF_TYPES } from './domain/kinds.ts';

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
