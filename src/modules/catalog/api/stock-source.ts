import { inArray } from 'drizzle-orm';
import type { AnyDb } from '../../../core/db/client.ts';
import { productStock } from '../schema.ts';
export type StockReadDb = AnyDb | Parameters<Parameters<AnyDb['transaction']>[0]>[0];
export interface CatalogStockRow {
  sku: string;
  warehouseId: string;
  quantity: number;
  updatedAt: string;
}
/** App assembly injects an authoritative local warehouse reader without catalog depending on sales/inventory. */
export const catalogStockHooks: {
  overlay?: (db: StockReadDb, rows: CatalogStockRow[], skus?: readonly string[]) => Promise<CatalogStockRow[]>;
  stamp?: (db: StockReadDb) => Promise<string>;
} = {};
export async function effectiveCatalogStock(db: StockReadDb, rows: CatalogStockRow[], skus?: readonly string[]) {
  return catalogStockHooks.overlay ? catalogStockHooks.overlay(db, rows, skus) : rows;
}
export async function readCatalogStock(db: StockReadDb, skus: readonly string[]) {
  if (!skus.length) return [];
  const rows = await db
    .select()
    .from(productStock)
    .where(inArray(productStock.sku, [...skus]));
  return effectiveCatalogStock(db, rows, skus);
}
