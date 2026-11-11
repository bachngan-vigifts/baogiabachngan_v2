import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { employees, departments, positions, positionPermissions } from '../../src/modules/staff/schema.ts';
import { salesOrders, packingSlips } from '../../src/modules/sales/schema.ts';
import { setup as posSetup } from '../helpers/pos-fixture.ts';
import { posRegisters, webStoreOrders } from '../../src/modules/sales/pos-schema.ts';
import { quotations } from '../../src/modules/quotes/schema.ts';
import { warehouses } from '../../src/modules/catalog/schema.ts';
import { warehouseSellers, stockTransfers } from '../../src/modules/inventory/schema.ts';
import { tasks } from '../../src/modules/tasks/schema.ts';
import { webNotifications, webPushSubscriptions } from '../../src/modules/notifications/schema.ts';
import { notificationScope } from '../../src/modules/notifications/api/recipient-scope.ts';
import { notify, notifyMany, latestNotificationAt } from '../../src/modules/notifications/api/routes.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { b64url } from '../../src/modules/notifications/domain/web-push.ts';
const at = '2026-11-11T01:00:00.000Z';

async function setup() {
  const f = await createTestDb(); await seedStaff(f.d1);
  const { db } = f;
  await db.insert(departments).values([{ id: 'dept-a', name: 'Test A', createdAt: at }, { id: 'dept-b', name: 'Test B', createdAt: at }]);
  await db.update(positions).set({ dataScope: 'own', departmentId: 'dept-a' }).where(eq(positions.id, 'sale'));
  await db.update(employees).set({ canApprove: true }).where(eq(employees.id, 'new'));
  const specs = [
    ['lead-a', 'department', 'dept-a', ['page.orders', 'page.quotes', 'page.purchases']],
    ['lead-b', 'department', 'dept-b', ['page.orders', 'page.quotes', 'page.purchases']],
    ['wh-a', 'own', 'dept-a', ['page.packing', 'purchases.receive', 'stock.transfer']],
    ['wh-b', 'own', 'dept-b', ['page.packing', 'purchases.receive', 'stock.transfer']],
  ] as const;
  for (const [id, dataScope, departmentId, perms] of specs) {
    await db.insert(positions).values({ id, name: id, dataScope, departmentId });
    await db.insert(employees).values({ id, email: id + '@test.invalid', name: id, role: 'employee', positionId: id, canApprove: true, createdAt: at });
    await db.insert(positionPermissions).values(perms.map(permission => ({ positionId: id, permission })));
  }
  await db.insert(warehouses).values([{ id: 'wh-a', name: 'Test Kho A', kind: 'stock' }, { id: 'wh-b', name: 'Test Kho B', kind: 'stock' }]);
  await db.insert(warehouseSellers).values([{ warehouseId: 'wh-a', positionId: 'wh-a' }, { warehouseId: 'wh-b', positionId: 'wh-b' }]);
  await db.insert(salesOrders).values({ id: 'order-a', orderNo: 'DH_TEST_A', quoteType: 'B2B', ownerId: 'emp', createdBy: 'emp', customerName: 'Fixture', orderDate: '2026-11-11', warehouseId: 'wh-a', status: 'draft', submittedAt: at, createdAt: at, updatedAt: at });
  await db.insert(packingSlips).values({ id: 'slip-a', slipNo: 'DG_TEST_A', orderId: 'order-a', source: 'warehouse', status: 'sent', createdBy: 'emp', createdAt: at, updatedAt: at });
  return f;
}

test('document notifications: delegated approvers obey own/department/page grants; bell and encrypted push have identical explicit recipients', async () => {
  const { db } = await setup();
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const p256dh = b64url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
  const auth = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const candidates = ['mgr', 'emp', 'new', 'lead-a', 'lead-b', 'wh-a', 'wh-b', 'off'];
  for (const id of candidates) await db.insert(webPushSubscriptions).values({ id, memberId: id, endpoint: 'https://push.test.invalid/' + id, p256dh, auth, createdAt: at, updatedAt: at });
  const sent: string[] = [];
  const env = { db, sapoSyncToken: 's'.repeat(40), pushFetch: (async (url: unknown) => { sent.push(String(url).split('/').pop()!); return new Response('', { status: 201 }); }) as typeof fetch };
  const n = { eventType: 'order_pending', title: 'Fixture approval', url: '/index.html#/orders/order-a', actorId: 'emp' };
  assert.equal(await notifyMany(env, 'approvers', n), 2);
  assert.deepEqual(sent.sort(), ['lead-a', 'mgr']);
  let notes = await db.select().from(webNotifications);
  assert.deepEqual(notes.map(n => n.targetMemberId).sort(), ['lead-a', 'mgr']);
  assert.ok(notes.every(n => n.targetRole === null), 'no role-wide persistence');
  sent.length = 0;
  await notify(env, { ...n, targetMemberId: 'lead-b' });
  await notify(env, { ...n, targetMemberId: 'off' });
  assert.deepEqual(sent, []);
  assert.equal((await db.select().from(webNotifications)).length, 2);
  // Permission revocation is reflected in document authorization immediately.
  await db.delete(positionPermissions).where(eq(positionPermissions.positionId, 'lead-a'));
  assert.deepEqual(await (await notificationScope(db)).recipients(n, ['lead-a']), []);
  assert.notEqual(await latestNotificationAt(db, { id: 'mgr', role: 'manager' }), '');
  await db.update(employees).set({ deletedAt: at }).where(eq(employees.id, 'lead-b'));
  assert.deepEqual(await (await notificationScope(db)).recipients(n, ['lead-b']), []);
});

test('packing, auto tasks and transfers stay in the relevant warehouse; direct order updates stay with the employee', async () => {
  const { db } = await setup();
  const env = { db };
  const wh = ['wh-a', 'wh-b', 'mgr'];
  await notifyMany(env, wh, { eventType: 'packing', title: 'Fixture packing', url: '/index.html#/packing/slip-a' });
  assert.deepEqual((await db.select().from(webNotifications)).map(n => n.targetMemberId).sort(), ['mgr', 'wh-a']);
  // An unrelated read-all role must not become a warehouse operator through page visibility.
  await db.insert(positions).values({ id: 'it-fixture', name: 'IT fixture', dataScope: 'all' });
  await db.insert(employees).values({ id: 'it-fixture', name: 'IT fixture', email: 'it@test.invalid', role: 'employee', positionId: 'it-fixture', createdAt: at });
  await db.insert(positionPermissions).values({ positionId: 'it-fixture', permission: 'page.packing' });
  assert.deepEqual(await (await notificationScope(db)).recipients({ eventType: 'packing', url: '/index.html#/packing/slip-a' }, ['it-fixture']), []);
  await db.insert(tasks).values({ id: 'task-a', title: 'Fixture packing task', source: 'packing', sourceId: 'slip-a', link: '#/packing/slip-a', assigneePosition: 'warehouse', createdAt: at, updatedAt: at });
  const scope = await notificationScope(db);
  assert.deepEqual((await scope.recipients({ eventType: 'task_assigned', url: '/index.html#/tasks/task-a' }, wh)).sort(), ['mgr', 'wh-a']);
  await db.insert(stockTransfers).values({ id: 'transfer-a', transferNo: 'PCK_TEST', requestedBy: 'emp', fromWarehouseId: 'wh-a', toWarehouseId: 'wh-b', status: 'shipped', reason: 'Fixture', createdAt: at, updatedAt: at });
  assert.deepEqual((await scope.recipients({ eventType: 'transfer_shipped', url: '/index.html#/transfers/transfer-a' }, wh)).sort(), ['mgr', 'wh-b']);
  await notifyMany(env, ['emp', 'new', 'lead-b'], { eventType: 'order_approved', title: 'Fixture approved', url: '/index.html#/orders/order-a', actorId: 'mgr' });
  const own = (await db.select().from(webNotifications)).filter(n => n.eventType === 'order_approved');
  assert.deepEqual(own.map(n => n.targetMemberId), ['emp']);
  await db.update(warehouses).set({ stockPrivate: true }).where(eq(warehouses.id, 'wh-a'));
  assert.deepEqual(await (await notificationScope(db)).recipients({ eventType: 'transfer_shipped', url: '/index.html#/transfers/transfer-a' }, ['wh-b']), [], 'destination assignment does not grant visibility into a private source warehouse');
  // Moving the task to a specific colleague stops future group notifications.
  await db.update(tasks).set({ assigneeId: 'wh-b' }).where(eq(tasks.id, 'task-a'));
  assert.deepEqual(await (await notificationScope(db)).recipients({ eventType: 'task_assigned', url: '/index.html#/tasks/task-a' }, ['wh-a', 'wh-b']), []);
});

test('legacy role-wide document notes are hidden from unrelated staff, including read-all and explicit read IDs', async () => {
  const { db } = await setup();
  await db.insert(webNotifications).values({ id: 'legacy-a', eventType: 'order_pending', title: 'Fixture legacy', body: 'Private fixture', url: '/index.html#/orders/order-a', targetRole: 'employee', createdAt: at });
  const router = createAppRouter(), env = { db, passwordIterations: 1000 };
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request('https://trial.test/api/staff' + path, { method, headers: { origin: 'https://trial.test', cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const own = await call('/login', '', 'POST', { email: 'emp@x.vn', password: PASSWORD });
  // emp owns the document but does not have approval authority for a pending-approval broadcast.
  assert.equal((await call('/notifications', own.cookie)).data.notifications.length, 0);
  assert.equal((await call('/notifications/read', own.cookie, 'POST', { all: true })).data.read, 0);
  assert.equal((await call('/notifications/read', own.cookie, 'POST', { ids: ['legacy-a'] })).data.read, 0);
  await db.update(employees).set({ canApprove: true }).where(eq(employees.id, 'emp'));
  assert.equal((await call('/notifications', own.cookie)).data.notifications.length, 1);
});


test('store boundaries override ownership, dataScope=all and delegated approval for POS/web/cash notifications', async () => {
  const f = await posSetup();
  const shift = await f.open();
  const created = await f.call('/pos/checkout', f.emp, 'POST', f.cart(shift.id));
  assert.equal(created.status, 201, JSON.stringify(created.data));
  await f.db.insert(employees).values({ id: 'ml-recipient', name: 'ML fixture', email: 'ml@test.invalid', role: 'employee', positionId: 'sales-ml', canApprove: true, createdAt: at });
  await f.db.update(positions).set({ dataScope: 'all' }).where(eq(positions.id, 'sales-ml'));
  await f.db.update(salesOrders).set({ ownerId: 'ml-recipient', status: 'draft', submittedAt: at }).where(eq(salesOrders.id, created.data.id));
  await f.db.update(employees).set({ canApprove: true }).where(eq(employees.id, 'emp'));
  const scope = await notificationScope(f.db), ids = ['mgr', 'emp', 'ml-recipient'];
  assert.deepEqual((await scope.recipients({ eventType: 'order_approved', url: '/index.html#/orders/' + created.data.id }, ids)).sort(), ['emp', 'mgr']);
  assert.deepEqual(await scope.recipients({ eventType: 'order_pending', url: '/index.html#/orders/' + created.data.id }, ['ml-recipient']), []);
  const [register] = await f.db.select().from(posRegisters).where(eq(posRegisters.id, f.registerId));
  assert.deepEqual((await scope.recipients({ eventType: 'cash_entry_pending', url: '/index.html#/cash?drawerId=' + register!.cashDrawerId }, ids)).sort(), ['emp', 'mgr']);
  await f.db.insert(webStoreOrders).values({ id: 'web-fixture', source: 'lock', externalId: 'fixture', orderNo: 'WEB_TEST', registerId: f.registerId, status: 'processing', orderedAt: at, updatedAt: at });
  await f.db.insert(tasks).values({ id: 'invoice-web-fixture', title: 'Fixture invoice', source: 'invoice', sourceId: 'web-fixture', link: '/index.html#/orders/web%3Aweb-fixture', assigneePosition: 'accounting', createdAt: at, updatedAt: at });
  assert.deepEqual((await scope.recipients({ eventType: 'invoice_issued', url: '/index.html#/orders/web%3Aweb-fixture' }, ids)).sort(), ['emp', 'mgr']);
  assert.deepEqual(await scope.recipients({ eventType: 'order_approved', url: '/index.html#/orders/%XX' }, ids), []);
});

test('quotation approval notifications follow the assignee department and disappear after page permission revocation', async () => {
  const { db } = await setup();
  await db.insert(quotations).values({ id: 'quote-fixture', quoteNo: 'BG_TEST', quoteType: 'B2B', creatorId: 'emp', assigneeId: 'emp', customer: 'Fixture', data: '{}', revision: 1, createdAt: at, updatedAt: at });
  const note = { eventType: 'quote_pending', title: 'Fixture', url: '/index.html#/quotes/quote-fixture', actorId: 'emp' };
  await notifyMany({ db }, 'approvers', note);
  assert.deepEqual((await db.select().from(webNotifications)).map(n => n.targetMemberId).sort(), ['lead-a', 'mgr']);
  await db.update(positions).set({ dataScope: 'own' }).where(eq(positions.id, 'lead-a'));
  assert.deepEqual(await (await notificationScope(db)).recipients(note, ['lead-a']), []);
});
