import { and, eq, inArray, sql } from 'drizzle-orm';
import type { CatalogStockRow, StockReadDb } from '../../catalog/api/stock-source.ts';
import { stockBalances, stockMoves } from '../../inventory/schema.ts';
import { AppError } from '../../../core/errors.ts';
import { posRegisters } from '../pos-schema.ts';
import { warehouses } from '../../catalog/schema.ts';
/**
 * Tồn chuẩn (docs/SO-KHO.md): kho thật đã chốt tồn đầu kỳ đọc số dư sổ kho (bán quầy, bán đơn / HĐKT, điều chuyển, nhận NCC…);
 * kho chưa chốt vẫn đọc tồn đồng bộ Sapo. Trước đây chỉ áp cho kho quầy POS – nay áp cho mọi kho đã chốt (yêu cầu 18/10/2026).
 */
async function ledgerWarehouses(db: StockReadDb) {
  return (await db.selectDistinct({ id: stockMoves.warehouseId }).from(stockMoves)
    .innerJoin(warehouses, and(eq(warehouses.id, stockMoves.warehouseId), eq(warehouses.kind, 'stock')))
    .where(eq(stockMoves.refType, 'opening'))).map(r => r.id);
}
export async function overlayPosStock(db: StockReadDb, rows: CatalogStockRow[], skus?: readonly string[]) {
  const ids = await ledgerWarehouses(db);
  if (!ids.length) return rows;
  const local = await db
    .select()
    .from(stockBalances)
    .where(and(inArray(stockBalances.warehouseId, ids), skus ? inArray(stockBalances.sku, [...skus]) : undefined));
  return [
    ...rows.filter((r) => !ids.includes(r.warehouseId)),
    ...local.map((r) => ({ sku: r.sku, warehouseId: r.warehouseId, quantity: r.qty, updatedAt: r.updatedAt })),
  ];
}
export async function posStockStamp(db: StockReadDb) {
  const [r] = await db
    .select({
      count: sql<number>`count(*)`,
      stamp: sql<string>`coalesce(max(${stockBalances.updatedAt}),'')`,
      qty: sql<number>`coalesce(sum(${stockBalances.qty}),0)`,
    })
    .from(stockBalances);
  const [w] = await db.select({ p: sql<string>`coalesce(string_agg(${warehouses.id}, ',' order by ${warehouses.id}),'')` }).from(warehouses).where(eq(warehouses.stockPrivate, true));
  return [r?.count, r?.stamp, r?.qty, w?.p].join(':');
}
/**
 * Chốt lại đầu kỳ từ tồn Sapo không được xoá phát sinh chỉ có trong app: kho quầy POS đã có phát sinh, hoặc kho đã có bán đơn / HĐKT,
 * điều chuyển (Sapo không biết các phát sinh này). Kiểm kê lệch thì dùng phiếu điều chỉnh có lý do.
 */
export async function guardPosOpening(db: StockReadDb, warehouseIds: string[]) {
  const [used] = await db
    .select({ id: stockMoves.id })
    .from(stockMoves)
    .leftJoin(posRegisters, eq(posRegisters.warehouseId, stockMoves.warehouseId))
    .where(and(inArray(stockMoves.warehouseId, warehouseIds), sql`${stockMoves.refType} <> 'opening'`,
      sql`(${posRegisters.id} is not null or ${stockMoves.refType} in ('sales_order','stock_transfer'))`))
    .limit(1);
  if (used)
    throw new AppError(
      409,
      'Kho đã có phát sinh bán / điều chuyển trong app. Dùng phiếu điều chỉnh kho để kiểm kê; không chốt lại đầu kỳ từ tồn Sapo.',
    );
}
