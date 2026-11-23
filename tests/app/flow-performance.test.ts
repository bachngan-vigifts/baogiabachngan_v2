import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drizzle } from 'drizzle-orm/pglite';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createStaffRouter, type SessionState } from '../../src/modules/staff/api/auth-routes.ts';
import { registerFlowRoutes } from '../../src/app/flow-routes.ts';
import { listPurchaseFlow, listPurchases } from '../../src/modules/suppliers/api/purchase-store.ts';
import { employees } from '../../src/modules/staff/schema.ts';
import { incomingShipments, incomingShipmentLines, suppliers, supplierReceipts, supplierReceiptLines } from '../../src/modules/suppliers/schema.ts';
import * as schema from '../../src/db/schema.ts';

test('flow progress projection preserves purchase visibility, receipt states, promised dates and pending Sapo without financial queries', async () => {
  const s = await createTestDb(); await seedStaff(s.d1);
  await s.db.insert(suppliers).values({ id: 'sup', name: 'NCC', nameKey: 'ncc', createdAt: '', updatedAt: '', createdBy: 'mgr' });
  for (const [i, approval, creator, cancelled] of [
    ['draft', 'pending', 'mgr', false], ['own', 'pending', 'emp', false], ['partial', 'approved', 'mgr', false],
    ['full', 'approved', 'mgr', false], ['damaged', 'approved', 'mgr', false], ['cancelled', 'approved', 'mgr', true],
  ] as const) {
    await s.db.insert(incomingShipments).values({ id: i, ticketNumber: i, source: 'supplier-order', supplierId: 'sup',
      warehouse: 'Kho', approvalStatus: approval, supplierStatus: 'confirmed', createdBy: creator,
      cancelledAt: cancelled ? '2026-01-01' : null, arrivalDate: '2026-02-01', createdAt: i, updatedAt: '' });
    await s.db.insert(incomingShipmentLines).values({ id: 'line-' + i, shipmentId: i, lineNo: 1, sku: 'A', name: 'A', unit: 'Cái', quantity: 10, promisedDate: '2026-01-01' });
  }
  for (const [id, order, qty, damaged, cancelled] of [
    ['r1', 'partial', 4, 0, false], ['r2', 'full', 10, 0, false], ['r3', 'partial', 6, 0, true], ['r4', 'damaged', 0, 2, false],
  ] as const) {
    await s.db.insert(supplierReceipts).values({ id, shipmentId: order, receiptNo: id, clientKey: id,
      receivedDate: '2026-01-01', receivedBy: 'mgr', createdAt: '', cancelledAt: cancelled ? '2026-01-02' : null, sapoStatus: 'failed' });
    await s.db.insert(supplierReceiptLines).values({ receiptId: id, lineId: 'line-' + order, sku: 'A', goodQty: qty, damagedQty: damaged });
  }
  const queries: string[] = [];
  const db = drizzle(s.client, { schema, logger: { logQuery(query) { queries.push(query); } } }) as unknown as typeof s.db;
  const pick = (r: Awaited<ReturnType<typeof listPurchases>>[number]) => ({ id: r.id, ticketNumber: r.ticketNumber,
    supplierName: r.supplierName, arrivalDate: r.arrivalDate, state: r.state, submitted: r.submitted, late: r.late, sapoPending: r.sapoPending });
  const members = await s.db.select().from(employees);
  for (const id of ['mgr', 'emp']) {
    const me = { ...members.find(m => m.id === id)!, positionName: '' } as SessionState['member'];
    const expected = (await listPurchases(s.db, me, { openOnly: true, limit: 500 }, '2026-01-15')).map(pick);
    queries.length = 0;
    const actual = await listPurchaseFlow(db, me, '2026-01-15');
    assert.deepEqual(actual, expected);
    assert.equal(queries.length,id==='emp'?1:4,'vai trò bị chặn chỉ chạy truy vấn scope rỗng, Manager giữ batch cố định');
    assert.doesNotMatch(queries.join('\n'), /supplier_payments|supplier_payment_schedules|staff_members|design_image/);
  }
});

test('flow request stays within query budget and no block silently fails', async () => {
  const s = await createTestDb(); await seedStaff(s.d1);
  let queries = 0;
  const db = drizzle(s.client, { schema, logger: { logQuery() { queries++; } } }) as unknown as typeof s.db;
  const router = createStaffRouter(); registerFlowRoutes(router);
  const env = { db, passwordIterations: 1000 };
  const login = await router.handle(new Request('https://trial.test/api/staff/login', { method: 'POST',
    headers: { origin: 'https://trial.test', 'content-type': 'application/json' }, body: JSON.stringify({ email: 'mgr@x.vn', password: PASSWORD }),
  }), env);
  const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
  queries = 0;
  const res = await router.handle(new Request('https://trial.test/api/staff/flow', { headers: { cookie } }), env);
  const data = await res.json() as { nodes: Record<string, { error?: string } | null> };
  assert.equal(res.status, 200);
  assert.ok(queries <= 26, `flow must not regress to dozens of serial round trips: ${queries}`);
  for (const [id, node] of Object.entries(data.nodes)) assert.equal(node?.error, undefined, id);
});
