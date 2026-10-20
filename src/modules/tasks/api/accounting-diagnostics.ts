import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { StaffEnv, SessionState } from '../../staff/api/auth-routes.ts';
import { positions } from '../../staff/schema.ts';
import { can } from '../../staff/domain/permissions.ts';
import { incomingShipments, incomingShipmentLines, supplierPaymentSchedules, supplierPayments } from '../../suppliers/schema.ts';
import { asActor, purchaseScope } from '../../suppliers/api/purchase-store.ts';
import { canSeePrices, supplierDebt } from '../../suppliers/domain/purchasing.ts';
import { computeOrderTotals } from '../../suppliers/domain/order-totals.ts';
import { posWebOrderStoreScope } from '../../sales/api/pos-access.ts';
import { webStoreOrders } from '../../sales/pos-schema.ts';

/** Data quality warnings, independent of task filters. Never creates tasks or guesses dates/statuses. */
export async function accountingDiagnostics(db: StaffEnv['db'], member: SessionState['member'], today: string) {
  const purchases: { id: string; docNo: string; missingPeriods: number; link: string; linkLabel: string }[] = [];
  const purchaseAvailable = can(member, 'page.purchases') && canSeePrices(asActor(member));
  if (purchaseAvailable) {
    const orders = await db.select().from(incomingShipments).where(and(purchaseScope(member),
      eq(incomingShipments.approvalStatus, 'approved'), isNull(incomingShipments.cancelledAt),
      sql`exists(select 1 from ${supplierPaymentSchedules} s where s.shipment_id=${incomingShipments.id} and s.due_date is null)`));
    const ids = orders.map(o => o.id);
    const [lines, schedules, payments] = ids.length ? await Promise.all([
      db.select().from(incomingShipmentLines).where(inArray(incomingShipmentLines.shipmentId, ids)),
      db.select().from(supplierPaymentSchedules).where(inArray(supplierPaymentSchedules.shipmentId, ids)).orderBy(supplierPaymentSchedules.createdAt, supplierPaymentSchedules.id),
      db.select().from(supplierPayments).where(inArray(supplierPayments.shipmentId, ids)),
    ]) : [[], [], []];
    for (const o of orders) {
      const total = computeOrderTotals({ rows: lines.filter(l => l.shipmentId === o.id), depositRate: o.depositRate, paidAmount: 0 }).total;
      const paid = payments.filter(p => p.shipmentId === o.id);
      const ordered = schedules.filter(s => s.shipmentId === o.id).sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
      const debt = supplierDebt(total, ordered, paid, today);
      if (debt.balance <= 0) continue;
      // Same earliest-date allocation/rounding as supplierDebt; count unpaid undated rows only.
      let covered = debt.paid, remaining = debt.balance;
      let undated = 0;
      for (const s of ordered) {
        const applied = Math.min(covered, s.amount); covered -= applied;
        const open = Math.min(remaining, Math.max(0, Math.round(s.amount - applied))); remaining -= open;
        if (!s.dueDate && open > 0) undated++;
      }
      if (undated) purchases.push({ id: o.id, docNo: o.ticketNumber, missingPeriods: undated, link: `#/purchases/${o.id}`, linkLabel: 'Bổ sung hạn trả' });
    }
    purchases.sort((a, b) => a.docNo.localeCompare(b.docNo, 'vi'));
  }
  const [position] = member.positionId ? await db.select({ name: positions.name }).from(positions).where(eq(positions.id, member.positionId)) : [];
  // Group Kế toán can see diagnostic metadata, not customer/financial details or a new POS link.
  const webs = await db.select({ id: webStoreOrders.id, docNo: webStoreOrders.orderNo, source: webStoreOrders.source,
    ghnCode: webStoreOrders.ghnOrderCode, ghnStatus: webStoreOrders.ghnStatus, updatedAt: webStoreOrders.updatedAt })
    .from(webStoreOrders).where(and(posWebOrderStoreScope({ ...member, positionName: position?.name }),
      sql`lower(${webStoreOrders.status}) not in ('cancelled','refunded','failed','trash')`));
  const rows = webs.map(w => ({ ...w, ghnCode: w.ghnCode.trim(), ghnStatus: w.ghnStatus.trim().toLowerCase() }));
  rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.docNo.localeCompare(b.docNo));
  const missingCode = rows.filter(w => !w.ghnCode).length, missingStatus = rows.filter(w => !!w.ghnCode && !w.ghnStatus).length;
  return {
    purchases: { available: purchaseAvailable, count: purchases.reduce((n, o) => n + o.missingPeriods, 0), orderCount: purchases.length, orders: purchases },
    web: { count: rows.length, missingCode, missingStatus, delivered: rows.filter(w => w.ghnStatus === 'delivered').length,
      orders: rows.map(w => ({ ...w, issue: !w.ghnCode ? 'missing_code' : !w.ghnStatus ? 'missing_status' : w.ghnStatus === 'delivered' ? 'delivered' : 'tracking' })) },
  };
}
