import { inArray } from 'drizzle-orm';
import type { StaffEnv } from '../../staff/api/auth-routes.ts';
import { deliveries } from '../schema.ts';
import { posReturns } from '../return-schema.ts';

/** Sổ kho (#/stock-moves): phiếu giao COD / phiếu khách trả của quầy → mở đơn gốc. Gắn vào stockRefLinkHooks ở src/app/router.ts. */
export async function posDeliveryStockLinks(db: StaffEnv['db'], ids: readonly string[]) {
  const rows = await db.select({ id: deliveries.id, orderId: deliveries.orderId }).from(deliveries).where(inArray(deliveries.id, [...ids]));
  return new Map(rows.filter(r => r.orderId).map(r => [r.id, `#/orders/${encodeURIComponent(r.orderId!)}`]));
}
export async function posReturnStockLinks(db: StaffEnv['db'], ids: readonly string[]) {
  const rows = await db.select({ id: posReturns.id, orderId: posReturns.orderId }).from(posReturns).where(inArray(posReturns.id, [...ids]));
  return new Map(rows.map(r => [r.id, `#/orders/${encodeURIComponent(r.orderId)}`]));
}
