import { and, eq, inArray, sql } from 'drizzle-orm';
import { auditLogs } from '../../../core/db/schema.ts';
import type { StaffEnv } from '../../staff/api/auth-routes.ts';
import { stockMoves } from '../../inventory/schema.ts';
import { deliveries, salesOrderLines } from '../schema.ts';

type Db = StaffEnv['db'] | Parameters<Parameters<StaffEnv['db']['transaction']>[0]>[0];
type Order = { id: string; status: string; channel: string; createdAt: string; holdsStock: boolean; warehouseId: string | null };
type Mark = { orderId: string; stage: string; source: string; at: string };
type Proof = {
  orderId: string; warehouseId: string; openingAt: string; markedAt: string;
  lines: Array<{ lineId: string; sku: string; qty: number } | null>;
  confirmation: { at: string };
};

/** Closed pre-ledger orders may have an explicit, audited owner confirmation. This is display reconciliation,
 * never physical fulfilment evidence: dispatch/completion guards continue to use crmStockFulfilment unchanged. */
export async function legacyStockProgress(db: Db, orders: Order[], marks: Mark[]) {
  const result = new Set<string>();
  const candidates = orders.filter(o => o.channel === 'crm' && o.status === 'delivered' && !o.holdsStock);
  if (!candidates.length) return result;
  const audits = await db.select({ orderId: auditLogs.entityId, data: auditLogs.data }).from(auditLogs).where(and(
    eq(auditLogs.entityType, 'sales_order'), inArray(auditLogs.entityId, candidates.map(o => o.id)),
    eq(auditLogs.module, 'sales'), eq(auditLogs.action, 'legacy_stock_progress_reconciled'),
  ));
  const proofs: Proof[] = audits.flatMap(a => {
    try {
      const p = JSON.parse(a.data);
      return p?.version === 1 && p.kind === 'legacy_preopening_owner_confirmation' && p.orderId === a.orderId
        && typeof p.warehouseId === 'string' && Array.isArray(p.lines) && p.confirmation?.alreadyDeducted === true
        && p.confirmation?.warehouseId === p.warehouseId && p.confirmation?.source === 'owner_chat' ? [p] : [];
    } catch { return []; }
  });
  if (!proofs.length) return result;
  const ids = [...new Set(proofs.map(p => p.orderId))];
  const warehouseIds = [...new Set(proofs.map(p => p.warehouseId))];
  const [lines, ships, openings] = await Promise.all([
    db.select({ id: salesOrderLines.id, orderId: salesOrderLines.orderId, sku: salesOrderLines.sku, qty: salesOrderLines.qty, delivered: salesOrderLines.deliveredQty })
      .from(salesOrderLines).where(inArray(salesOrderLines.orderId, ids)),
    db.select({ orderId: deliveries.orderId, status: deliveries.status, at: deliveries.deliveredAt })
      .from(deliveries).where(inArray(deliveries.orderId, ids)),
    db.select({ warehouseId: stockMoves.warehouseId, at: sql<string>`min(${stockMoves.createdAt})` }).from(stockMoves)
      .where(and(inArray(stockMoves.warehouseId, warehouseIds), eq(stockMoves.refType, 'opening'))).groupBy(stockMoves.warehouseId),
  ]);
  for (const p of proofs) {
    const o = candidates.find(o => o.id === p.orderId);
    const mark = marks.find(m => m.orderId === p.orderId && m.stage === 'export' && m.source === 'manual');
    const opening = openings.find(w => w.warehouseId === p.warehouseId)?.at;
    if (!o || !mark || mark.at !== p.markedAt || p.confirmation.at !== p.markedAt
      || !Number.isFinite(Date.parse(p.markedAt)) || !opening || Date.parse(p.markedAt) < Date.parse(opening)
      || opening !== p.openingAt || !(Date.parse(o.createdAt) < Date.parse(opening))
      || o.warehouseId && o.warehouseId !== p.warehouseId) continue;
    const actual = lines.filter(l => l.orderId === o.id);
    const sent = ships.filter(d => d.orderId === o.id && d.status !== 'cancelled');
    if (!actual.length || actual.length !== p.lines.length || actual.some(l => !(l.qty > 0)
      || l.delivered + 0.0005 < l.qty || !p.lines.some(x => x?.lineId === l.id && x.sku === l.sku && x.qty === l.qty))) continue;
    if (!sent.length || sent.some(d => d.status !== 'delivered' || !d.at || !(Date.parse(d.at) < Date.parse(opening)))) continue;
    result.add(o.id);
  }
  return result;
}
