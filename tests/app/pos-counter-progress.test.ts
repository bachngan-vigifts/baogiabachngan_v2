import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff } from '../helpers/staff-fixture.ts';
import { salesOrders, salesOrderLines, packingSlips } from '../../src/modules/sales/schema.ts';
import { stockMoves } from '../../src/modules/inventory/schema.ts';
import { warehouses } from '../../src/modules/catalog/schema.ts';
import { progressOf } from '../../src/modules/sales/api/progress.ts';
import { orderProgress } from '../../src/modules/sales/domain/progress.ts';

test('counter POS export follows full direct stock evidence, without altering orders or inventory', async () => {
  const { db, d1 } = await createTestDb(); await seedStaff(d1); const now = new Date().toISOString();
  await db.insert(warehouses).values({ id: 'progress-wh', name: 'Kho kiểm thử', kind: 'stock' });
  const ids = ['complete', 'missing', 'partial', 'reversed', 'wrong-sku', 'cancelled', 'cod', 'crm', 'duplicate-sku', 'multi-sku', 'pending-flow', 'packed', 'returned'];
  await db.insert(salesOrders).values(ids.map(id => ({ id, orderNo: 'POS-' + id, channel: id === 'crm' || id === 'packed' ? 'crm' as const : 'pos' as const,
    fulfillmentMode: id === 'cod' ? 'cod' as const : 'counter' as const, status: id === 'cancelled' ? 'cancelled' as const : id === 'pending-flow' || id === 'packed' ? 'confirmed' as const : 'delivered' as const,
    quoteType: 'B2B' as const, customerName: 'Test', ownerId: 'emp', createdBy: 'emp', orderDate: '2026-10-22', createdAt: now, updatedAt: now })));
  await db.insert(salesOrderLines).values(ids.map(id => ({ id: id + '-line', orderId: id, lineNo: 1, sku: '00123', name: 'Ly', qty: 2 })));
  await db.insert(salesOrderLines).values([{ id: 'dup-extra', orderId: 'duplicate-sku', lineNo: 2, sku: '00123', name: 'Ly', qty: 2 }, { id: 'multi-extra', orderId: 'multi-sku', lineNo: 2, sku: '00456', name: 'Đĩa', qty: 1 }]);
  await db.insert(stockMoves).values(ids.filter(id => id !== 'missing' && id !== 'packed').map(id => ({ id: 'move-' + id, sku: id === 'wrong-sku' ? '999' : '00123', warehouseId: 'progress-wh', qty: id === 'partial' ? -1 : -2, kind: 'issue' as const, refType: 'pos_order' as const, refId: id, createdBy: 'emp', createdAt: now })));
  await db.insert(stockMoves).values([{ id: 'reverse', sku: '00123', warehouseId: 'progress-wh', qty: 2, kind: 'reverse', refType: 'pos_order', refId: 'reversed', createdBy: 'emp', createdAt: now }, { id: 'return', sku: '00123', warehouseId: 'progress-wh', qty: 1, kind: 'customer_return', refType: 'pos_return', refId: 'returned', createdBy: 'emp', createdAt: now }]);
  await db.insert(packingSlips).values({ id: 'slip', orderId: 'packed', slipNo: 'PDG-1', source: 'warehouse', status: 'packed', createdBy: 'emp', createdAt: now, updatedAt: now });
  const before = await db.select({ total: sql<number>`sum(${stockMoves.qty})`, count: sql<number>`count(*)` }).from(stockMoves);
  const p = await progressOf(db, ids);
  for (const id of ['complete', 'returned']) { assert.equal(p.get(id)!.done, true, id); assert.equal(p.get(id)!.stages.find(s => s.key === 'export')!.by, 'auto'); }
  for (const id of ['missing', 'partial', 'reversed', 'wrong-sku', 'cod', 'crm', 'duplicate-sku', 'multi-sku', 'pending-flow']) assert.equal(p.get(id)!.stages.find(s => s.key === 'export')!.done, false, id);
  assert.equal(p.get('cancelled')!.done, false); assert.equal(p.get('cancelled')!.current, null);
  assert.equal(p.get('packed')!.stages.find(s => s.key === 'export')!.done, false, 'CRM packed label without confirmed lines and ledger is not proof of export');
  assert.deepEqual(await db.select({ total: sql<number>`sum(${stockMoves.qty})`, count: sql<number>`count(*)` }).from(stockMoves), before);
  assert.equal((await progressOf(db, ['complete', 'complete'])).size, 1);
  assert.equal((await progressOf(db, [])).size, 0);
  assert.equal(orderProgress({ status: 'delivered', packed: false, printing: false, marks: {} }).current, 'export', 'delivered alone never proves export');
});
