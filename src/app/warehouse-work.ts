import { incomingShipments, supplierReceipts } from '../modules/suppliers/schema.ts';
import { and, asc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { Router } from '../core/http/router.ts';
import { json } from '../core/http/router.ts';
import type { StaffEnv, SessionState } from '../modules/staff/api/auth-routes.ts';
import { can } from '../modules/staff/domain/permissions.ts';
import { deliveries, packingSlips, orderProgressMarks, salesOrders } from '../modules/sales/schema.ts';
import { orderScopeFor } from '../modules/sales/api/routes.ts';
import { vietnamDate } from '../modules/sales/domain/sales.ts';
import { receivingCalendar } from '../modules/suppliers/api/receiving-calendar.ts';
import { purchaseScope, asActor } from '../modules/suppliers/api/purchase-store.ts';
import { canUsePurchasing, isWarehouseStaff } from '../modules/suppliers/domain/purchasing.ts';
import { transferWork } from '../modules/inventory/api/transfer-work.ts';

/** Read-only operational previews; no money columns, stock writes, or background integrations. */
export function registerWarehouseWork(router: Router<StaffEnv>) {
  router.get('/warehouse-work', async c => {
    const db = c.env.db, member = (c.state.session as SessionState).member, today = vietnamDate().iso;
    const tomorrow = new Date(Date.parse(today + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10);
    const warehouse = isWarehouseStaff(asActor(member)), purchase = can(member, 'page.purchases') && canUsePurchasing(asActor(member));
    const count = sql<number>`count(*)`.mapWith(Number);
    const packWhere = and(warehouse ? undefined : orderScopeFor(member), eq(packingSlips.status, 'sent'),
      sql`${salesOrders.status} not in ('delivered','cancelled') and not exists(select 1 from ${orderProgressMarks} where ${orderProgressMarks.orderId}=${salesOrders.id} and ${orderProgressMarks.stage}='delivered')`);
    const shipWhere = and(warehouse ? undefined : orderScopeFor(member), sql`${salesOrders.channel}<>'pos'`, sql`${salesOrders.status}<>'cancelled'`,
      inArray(deliveries.status, ['planned', 'in_transit', 'failed']), lte(deliveries.plannedDate, tomorrow));
    const sapoWhere=and(purchaseScope(member),isNull(incomingShipments.cancelledAt),isNull(supplierReceipts.cancelledAt),inArray(supplierReceipts.sapoStatus,['pending','failed']));
    const [packing, shipping, incoming, early, transfers, sapo] = await Promise.all([
      can(member, 'page.packing') ? Promise.all([
        db.select({ count }).from(packingSlips).innerJoin(salesOrders, eq(salesOrders.id, packingSlips.orderId)).where(packWhere),
        db.select({ id: packingSlips.id, slipNo: packingSlips.slipNo, customerName: salesOrders.customerName, date: salesOrders.expectedDeliveryDate }).from(packingSlips).innerJoin(salesOrders, eq(salesOrders.id, packingSlips.orderId)).where(packWhere).orderBy(asc(packingSlips.createdAt)).limit(6),
      ]).then(([[total], rows]) => ({ count: total?.count || 0, rows })) : null,
      can(member, 'page.deliveries') || can(member, 'page.orders') || can(member, 'page.contracts') ? Promise.all([
        db.select({ due: sql<number>`count(*) filter(where ${deliveries.plannedDate}<=${today})`.mapWith(Number), tomorrow: sql<number>`count(*) filter(where ${deliveries.plannedDate}=${tomorrow})`.mapWith(Number), failed: sql<number>`count(*) filter(where ${deliveries.status}='failed')`.mapWith(Number) }).from(deliveries).innerJoin(salesOrders, eq(salesOrders.id, deliveries.orderId)).where(shipWhere),
        db.select({ id: deliveries.id, deliveryNo: deliveries.deliveryNo, customerName: salesOrders.customerName, plannedDate: deliveries.plannedDate, status: deliveries.status, address: deliveries.address }).from(deliveries).innerJoin(salesOrders, eq(salesOrders.id, deliveries.orderId)).where(shipWhere).orderBy(asc(deliveries.plannedDate), asc(deliveries.id)).limit(6),
      ]).then(([[totals], rows]) => ({ due: totals?.due || 0, tomorrow: totals?.tomorrow || 0, failed: totals?.failed || 0, rows })) : null,
      purchase ? receivingCalendar(db, new URLSearchParams({ type: 'purchase' }), today) : null,
      purchase ? receivingCalendar(db, new URLSearchParams({ type: 'early' }), today, { reminderOnly: true }) : null,
      transferWork(db, member),
      purchase ? Promise.all([
        db.select({count:sql<number>`count(distinct ${incomingShipments.id})`.mapWith(Number)}).from(incomingShipments).innerJoin(supplierReceipts,eq(supplierReceipts.shipmentId,incomingShipments.id)).where(sapoWhere),
        db.select({id:incomingShipments.id,ticketNumber:incomingShipments.ticketNumber,supplierName:incomingShipments.supplierName,pending:count}).from(incomingShipments).innerJoin(supplierReceipts,eq(supplierReceipts.shipmentId,incomingShipments.id)).where(sapoWhere)
          .groupBy(incomingShipments.id,incomingShipments.ticketNumber,incomingShipments.supplierName).orderBy(asc(incomingShipments.createdAt)).limit(6),
      ]).then(([[totals],rows])=>({count:totals?.count||0,rows})) : null,
    ]);
    // Calendar metadata counts all documents, before pagination. A preview never becomes the count.
    return json({ today, packing, shipping, transfers,
      incoming: incoming && { count: incoming.orderCount, rows: incoming.rows.slice(0, 6) },
      early: early && { count: early.orderCount, rows: early.rows.slice(0, 6) }, sapo });
  }, 'business');
}
