import { and, asc, eq, inArray } from 'drizzle-orm';
import type { AnyDb } from '../../../core/db/client.ts';
import { warehouses } from '../../catalog/schema.ts';
import { warehouseSellers } from '../schema.ts';
import type { LedgerDb } from './ledger.ts';

/**
 * KHO BÁN THEO CHỨC VỤ (docs/SO-KHO.md "Kho bán theo chức vụ").
 *  - Manager bán / xem mọi kho.
 *  - Nhân viên chỉ lập đơn / HĐKT từ kho mà chức vụ được gán (`warehouse_sellers`); vẫn xem tồn các kho khác, trừ kho riêng
 *    (`warehouses.stock_private`, VD kho Hoá đơn) – kho riêng chỉ chức vụ bán kho đó thấy.
 *  - Bảng gán còn trống = chưa bật: không bắt chọn kho bán, đơn không trừ kho theo đơn (giữ cách cũ).
 */
export interface WarehouseMember { role: string; positionId?: string | null }
type Db = AnyDb | LedgerDb;

const stockWarehouses = (db: Db) => db.select({ id: warehouses.id, name: warehouses.name, stockPrivate: warehouses.stockPrivate }).from(warehouses)
  .where(and(eq(warehouses.kind, 'stock'), eq(warehouses.active, true))).orderBy(asc(warehouses.sortOrder), asc(warehouses.name));

/** Đã gán kho bán cho chức vụ nào chưa (chưa = tính năng chưa bật). */
export async function sellersConfigured(db: Db) {
  return (await db.select({ id: warehouseSellers.warehouseId }).from(warehouseSellers).limit(1)).length > 0;
}

/** Kho thật đang dùng mà người này bán được (Manager: mọi kho). */
export async function sellableWarehouses(db: Db, m: WarehouseMember) {
  const all = await stockWarehouses(db);
  if (m.role === 'manager') return all;
  if (m.role !== 'employee' || !m.positionId) return [];
  const mine = new Set((await db.select({ id: warehouseSellers.warehouseId }).from(warehouseSellers).where(eq(warehouseSellers.positionId, m.positionId))).map(r => r.id));
  return all.filter(w => mine.has(w.id));
}

/** Kho riêng người này KHÔNG được xem tồn (Manager và chức vụ bán kho riêng đó thì thấy). */
export async function hiddenWarehouseIds(db: Db, m: WarehouseMember): Promise<Set<string>> {
  if (m.role === 'manager') return new Set();
  const priv = (await db.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.stockPrivate, true))).map(r => r.id);
  if (!priv.length) return new Set();
  const mine = m.positionId ? new Set((await db.select({ id: warehouseSellers.warehouseId }).from(warehouseSellers)
    .where(and(eq(warehouseSellers.positionId, m.positionId), inArray(warehouseSellers.warehouseId, priv)))).map(r => r.id)) : new Set<string>();
  return new Set(priv.filter(id => !mine.has(id)));
}

/** Kho bán theo chức vụ cho trang Phân quyền: mỗi kho thật kèm danh sách chức vụ được bán + cờ kho riêng. */
export async function sellerMatrix(db: Db) {
  const [whs, rows] = await Promise.all([stockWarehouses(db), db.select().from(warehouseSellers)]);
  return whs.map(w => ({ ...w, positions: rows.filter(r => r.warehouseId === w.id).map(r => r.positionId) }));
}
