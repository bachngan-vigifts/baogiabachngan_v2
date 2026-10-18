import { and, eq, inArray, sql } from 'drizzle-orm';
import type { CatalogStockRow, StockReadDb } from '../../catalog/api/stock-source.ts';
import { stockBalances, stockMoves } from '../../inventory/schema.ts';
import { AppError } from '../../../core/errors.ts';
import { posRegisters } from '../pos-schema.ts';
export async function overlayPosStock(db: StockReadDb, rows: CatalogStockRow[], skus?: readonly string[]) {
  const regs = await db
    .selectDistinct({ id: posRegisters.warehouseId })
    .from(posRegisters)
    .innerJoin(
      stockMoves,
      and(eq(stockMoves.warehouseId, posRegisters.warehouseId), eq(stockMoves.refType, 'opening')),
    );
  if (!regs.length) return rows;
  const ids = regs.map((r) => r.id);
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
    .from(stockBalances)
    .where(sql`exists(select 1 from ${posRegisters} where ${posRegisters.warehouseId}=${stockBalances.warehouseId})`);
  return [r?.count, r?.stamp, r?.qty].join(':');
}
/** Reimporting a stale Sapo opening balance must never restore locally sold stock. */
export async function guardPosOpening(db: StockReadDb, warehouseIds: string[]) {
  const [used] = await db
    .select({ id: stockMoves.id })
    .from(stockMoves)
    .innerJoin(posRegisters, eq(posRegisters.warehouseId, stockMoves.warehouseId))
    .where(and(inArray(stockMoves.warehouseId, warehouseIds), sql`${stockMoves.refType} <> 'opening'`))
    .limit(1);
  if (used)
    throw new AppError(
      409,
      'Kho POS đã có phát sinh. Dùng phiếu điều chỉnh kho để kiểm kê; không chốt lại đầu kỳ từ tồn Sapo.',
    );
}
