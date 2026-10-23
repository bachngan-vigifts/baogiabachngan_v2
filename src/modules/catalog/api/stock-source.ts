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
  /** Kho riêng người xem không được thấy tồn (VD kho Hoá đơn với nhân viên không bán kho đó) – docs/SO-KHO.md. */
  hidden?: (db: StockReadDb, m: { role: string; positionId?: string | null }) => Promise<Set<string>>;
  /** Kho đã chốt tồn đầu kỳ: tồn hiển thị lấy từ sổ kho CRM, file Sapo không đổi được (chỉ để đối chiếu). */
  ledger?: (db: StockReadDb) => Promise<string[]>;
} = {};
export const hiddenStockWarehouses = (db: StockReadDb, m: { role: string; positionId?: string | null }) =>
  catalogStockHooks.hidden ? catalogStockHooks.hidden(db, m) : Promise.resolve(new Set<string>());
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
