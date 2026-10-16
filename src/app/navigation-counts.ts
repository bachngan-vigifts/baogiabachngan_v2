import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Router } from '../core/http/router.ts';
import { json } from '../core/http/router.ts';
import type { SessionState, StaffEnv } from '../modules/staff/api/auth-routes.ts';
import { deliveries, orderProgressMarks, packingSlips, salesOrders } from '../modules/sales/schema.ts';
import { orderScopeFor } from '../modules/sales/api/routes.ts';
import { asActor, purchaseCounts } from '../modules/suppliers/api/purchase-store.ts';
import { isWarehouseStaff } from '../modules/suppliers/domain/purchasing.ts';
import { vietnamDate } from '../modules/sales/domain/sales.ts';

/** Unfinished work only; each count uses the same scope as its destination page. */
export function registerNavigationCounts(router: Router<StaffEnv>) {
  router.get('/navigation-counts', async c => {
    const db = c.env.db, m = (c.state.session as SessionState).member;
    const warehouse = isWarehouseStaff(asActor(m));
    const count = sql<number>`count(*)`.mapWith(Number);
    const [[packing], [shipping], purchases] = await Promise.all([
      db.select({ count }).from(packingSlips).innerJoin(salesOrders, eq(salesOrders.id, packingSlips.orderId))
        .where(and(m.role === 'manager' || warehouse ? undefined : orderScopeFor(m), eq(packingSlips.status, 'sent'),
          sql`${salesOrders.status} <> 'delivered' and not exists (select 1 from ${orderProgressMarks}
            where ${orderProgressMarks.orderId} = ${salesOrders.id} and ${orderProgressMarks.stage} = 'delivered')`)),
      db.select({ count }).from(deliveries).innerJoin(salesOrders, eq(salesOrders.id, deliveries.orderId))
        .where(and(warehouse ? undefined : orderScopeFor(m), inArray(deliveries.status, ['planned', 'in_transit', 'failed']))),
      purchaseCounts(db, m, {}, vietnamDate().iso),
    ]);
    return json({ packing: packing?.count ?? 0, deliveries: shipping?.count ?? 0,
      purchases: purchases.all - purchases.received - purchases.cancelled });
  }, 'business');
}
