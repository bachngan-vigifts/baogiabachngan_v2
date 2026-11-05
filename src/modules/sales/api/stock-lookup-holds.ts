import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import type { AnyDb } from '../../../core/db/client.ts';
import { stockHolds } from '../schema.ts';
import { orderHolds } from './hold-routes.ts';

/** Quantity-only lookup: use existing effective reservations, hide private warehouses, count unassigned holds once. */
export async function stockLookupHolds(
  db: AnyDb,
  skus: string[],
  warehouseIds: string[],
): Promise<{ sku: string; warehouseId: string | null; qty: number }[]> {
  if (!skus.length || !warehouseIds.length) return [];
  const [quotes, orders] = await Promise.all([
    db
      .select({
        sku: stockHolds.sku,
        qty: sql<number>`sum(${stockHolds.qty})`.mapWith(Number),
      })
      .from(stockHolds)
      .where(
        and(
          inArray(stockHolds.sku, skus),
          eq(stockHolds.status, 'active'),
          gt(stockHolds.expiresAt, new Date().toISOString()),
        ),
      )
      .groupBy(stockHolds.sku),
    orderHolds(db, skus, undefined, undefined, true),
  ]);
  const visible = new Set(warehouseIds),
    quantities = new Map<
      string,
      { sku: string; warehouseId: string | null; qty: number }
    >();
  const add = (sku: string, warehouseId: string | null, qty: number): void => {
    if ((warehouseId !== null && !visible.has(warehouseId)) || !(qty > 0))
      return;
    const key = JSON.stringify([sku, warehouseId]),
      prior = quantities.get(key);
    quantities.set(key, {
      sku,
      warehouseId,
      qty: Math.round(((prior?.qty ?? 0) + qty) * 1000) / 1000,
    });
  };
  for (const q of quotes) add(q.sku, null, q.qty);
  for (const o of orders) add(o.sku, o.warehouseId, o.qty);
  return [...quantities.values()];
}
