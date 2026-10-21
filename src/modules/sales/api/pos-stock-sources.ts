import { asc, eq } from 'drizzle-orm';
import type { AnyDb } from '../../../core/db/client.ts';
import { AppError } from '../../../core/errors.ts';
import { warehouses } from '../../catalog/schema.ts';
import { hiddenStockWarehouses, readCatalogStock } from '../../catalog/api/stock-source.ts';
import { incomingLookup } from '../../inventory/api/routes.ts';

type Member = { role: string; positionId?: string | null };
/** Batch read for the visible product page; uses the same stock and purchase readers as Tra tồn. */
export async function posStockSources(db: AnyDb, member: Member, registerWarehouseId: string, skus: string[]) {
  const [all, stock, hidden, incoming] = await Promise.all([
    db.select({ id: warehouses.id, name: warehouses.name, kind: warehouses.kind }).from(warehouses)
      .where(eq(warehouses.active, true)).orderBy(asc(warehouses.sortOrder), asc(warehouses.name)),
    readCatalogStock(db, skus), hiddenStockWarehouses(db, member),
    skus.length && incomingLookup.read ? incomingLookup.read(db, skus) : [],
  ]);
  if (hidden.has(registerWarehouseId)) throw new AppError(403, 'Bạn không được xem tồn kho riêng của quầy này.');
  const visible = all.filter(w => !hidden.has(w.id));
  const quantities = new Map(stock.map(s => [JSON.stringify([s.sku, s.warehouseId]), s.quantity]));
  const qty = (sku: string, id: string) => quantities.get(JSON.stringify([sku, id])) ?? 0;
  const round = (n: number) => Math.round(n * 1000) / 1000;
  type WarehouseStock = { id: string; name: string; kind: string; qty: number };
  type Group = { qty: number; warehouses: WarehouseStock[] };
  const result = new Map<string, {
    vigifts: Group; supplier: Group;
    incoming: { qty: number; orders: { orderId: string; orderNo: string; supplierName: string; arrivalDate: string | null; qty: number }[] };
    requestWarehouses: WarehouseStock[];
    destination: { id: string; name: string; kind: string } | undefined;
  }>();
  for (const sku of skus) {
    const entries = visible.map(w => ({ ...w, qty: round(qty(sku, w.id)) }));
    const vigifts = entries.filter(w => w.id !== registerWarehouseId && w.kind === 'stock' && /vigifts/i.test(w.name));
    const supplier = entries.filter(w => w.kind === 'supplier');
    const orders = incoming.filter(o => o.sku === sku).map(o => ({ orderId: o.orderId, orderNo: o.ticketNumber, supplierName: o.supplierName, arrivalDate: o.arrivalDate, qty: round(o.left) }));
    result.set(sku, {
      vigifts: { qty: round(vigifts.reduce((n, w) => n + w.qty, 0)), warehouses: vigifts },
      supplier: { qty: round(supplier.reduce((n, w) => n + w.qty, 0)), warehouses: supplier },
      incoming: { qty: round(orders.reduce((n, o) => n + o.qty, 0)), orders },
      requestWarehouses: entries.filter(w => w.kind === 'stock' && w.id !== registerWarehouseId),
      destination: visible.find(w => w.id === registerWarehouseId),
    });
  }
  return result;
}
