import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { StaffEnv, SessionState } from '../../staff/api/auth-routes.ts';
import { warehouses } from '../../catalog/schema.ts';
import { stockTransfers } from '../schema.ts';
import { hiddenWarehouseIds } from './warehouse-access.ts';
/** Same visible active warehouses as the transfer page; count all open documents before any preview limit. */
export async function transferWork(db: StaffEnv['db'], member: SessionState['member'], limit = 6) {
  const hidden = await hiddenWarehouseIds(db, member);
  const whs = (await db.select({ id: warehouses.id, name: warehouses.name }).from(warehouses).where(and(eq(warehouses.kind, 'stock'), eq(warehouses.active, true)))).filter(w => !hidden.has(w.id));
  const ids = whs.map(w => w.id);
  if (!ids.length) return { count: 0, pending: 0, approved: 0, shipped: 0, rows: [] };
  const where = and(inArray(stockTransfers.fromWarehouseId, ids), inArray(stockTransfers.toWarehouseId, ids), inArray(stockTransfers.status, ['pending', 'approved', 'shipped']));
  const [[totals], rows] = await Promise.all([
    db.select({ count: sql<number>`count(*)`.mapWith(Number), pending: sql<number>`count(*) filter(where ${stockTransfers.status}='pending')`.mapWith(Number), approved: sql<number>`count(*) filter(where ${stockTransfers.status}='approved')`.mapWith(Number), shipped: sql<number>`count(*) filter(where ${stockTransfers.status}='shipped')`.mapWith(Number) }).from(stockTransfers).where(where),
    limit ? db.select({ id: stockTransfers.id, transferNo: stockTransfers.transferNo, fromWarehouseId: stockTransfers.fromWarehouseId, toWarehouseId: stockTransfers.toWarehouseId, status: stockTransfers.status, createdAt: stockTransfers.createdAt })
      .from(stockTransfers).where(where).orderBy(asc(stockTransfers.createdAt), asc(stockTransfers.id)).limit(limit) : Promise.resolve([]),
  ]);
  const name = (id: string) => whs.find(w => w.id === id)?.name || '';
  return { count: totals?.count || 0, pending: totals?.pending || 0, approved: totals?.approved || 0, shipped: totals?.shipped || 0, rows: rows.map(r => ({ ...r, fromName: name(r.fromWarehouseId), toName: name(r.toWarehouseId) })) };
}
