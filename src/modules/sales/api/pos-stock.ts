import { and, eq, inArray, sql } from 'drizzle-orm';
import type { CatalogStockRow, StockReadDb } from '../../catalog/api/stock-source.ts';
import { stockBalances, stockMoves } from '../../inventory/schema.ts';
import { warehouses } from '../../catalog/schema.ts';
/**
 * Tồn chuẩn (docs/SO-KHO.md): kho thật đã chốt tồn đầu kỳ đọc số dư sổ kho (bán quầy, bán đơn / HĐKT, điều chuyển, nhận NCC…);
 * kho chưa chốt vẫn đọc tồn đồng bộ Sapo. Trước đây chỉ áp cho kho quầy POS – nay áp cho mọi kho đã chốt (yêu cầu 18/10/2026).
 */
export async function ledgerWarehouses(db: StockReadDb) {
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
