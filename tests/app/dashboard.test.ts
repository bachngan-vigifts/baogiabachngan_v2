import { eq } from 'drizzle-orm';
import { employees } from '../../src/modules/staff/schema.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { customers, customerStaff } from '../../src/modules/customers/schema.ts';
import { salesContracts, salesOrders } from '../../src/modules/sales/schema.ts';
import { customerActivities } from '../../src/modules/care/schema.ts';
import { quotations } from '../../src/modules/quotes/schema.ts';
import { sapoHealthMonitorState } from '../../src/modules/integrations/schema.ts';
import { dashboardFilters } from '../../src/modules/dashboard/domain/filters.ts';

const now = '2026-09-20T10:00:00.000Z';
const month = '?from=2026-09&to=2026-09';
async function fixture() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  const router = createAppRouter();
  const call = async (path: string, cookie = '', method = 'GET') => {
    const body = method === 'POST' && path === '/login' ? JSON.stringify({ email: cookie, password: PASSWORD }) : undefined;
    const r = await router.handle(new Request('https://trial.test/api/staff' + path, { method,
      headers: { origin: 'https://trial.test', 'content-type': 'application/json', cookie: body ? '' : cookie }, body }), { db, passwordIterations: 1000 });
    return { status: r.status, data: await r.json() as any, cookie: r.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const mgr = (await call('/login', 'mgr@x.vn', 'POST')).cookie, emp = (await call('/login', 'emp@x.vn', 'POST')).cookie, ncc = (await call('/login', 'ncc@x.vn', 'POST')).cookie;
  await db.insert(customers).values(['one', 'two', 'never'].map(id => ({ id, name: id, contact: '', phone: '', email: '', address: '', search: '', sourceVersion: 0, syncedAt: '' })));
  await db.insert(customers).values({ id: '123', name: 'Sapo', contact: '', phone: '', email: '', address: '', search: '', sourceVersion: 1, syncedAt: now });
  await db.insert(customerStaff).values([{ customerId: 'one', memberId: 'emp', role: 'owner', createdAt: now }, { customerId: 'two', memberId: 'mgr', role: 'owner', createdAt: now }, { customerId: 'never', memberId: 'emp', role: 'owner', createdAt: now }]);
  const quote = (id: string, owner: string) => ({ id, creatorId: owner, quoteNo: id, quoteType: 'HRC' as const, customer: 'C', quoteDate: '2026-09-10', data: '{}', createdAt: now, updatedAt: now });
  await db.insert(quotations).values([quote('q1', 'emp'), quote('q2', 'emp'), quote('q3', 'mgr')]);
  const order = (id: string, ownerId = 'emp', total = 1, status: 'confirmed' | 'draft' | 'cancelled' = 'confirmed') => ({ id, orderNo: id, quoteType: 'HRC' as const, customerName: 'C', ownerId, createdBy: 'mgr', orderDate: '2026-09-10', status, total, createdAt: now, updatedAt: now });
  await db.insert(salesOrders).values([...Array.from({ length: 1001 }, (_, i) => order('o' + i)),
    { ...order('signed', 'emp', 200, 'draft'), quoteId: 'q1' }, order('draft', 'emp', 999, 'draft'), order('cancel', 'emp', 888, 'cancelled'), order('mgr-order', 'mgr', 300)]);
  await db.insert(salesContracts).values({ id: 'contract', orderId: 'signed', contractNo: 'contract', status: 'signed', createdBy: 'mgr', value: 200, legalEntity: 'BN', createdAt: now, updatedAt: now });
  const activity = (id: string, customerId: string, ownerId: string, result: 'consulting' | 'negotiating' | 'won' | 'lost', expectedRevenue: number, occurredAt: string) => ({ id, customerId, ownerId, type: 'call' as const, result, expectedRevenue, occurredAt, content: 'Call', createdAt: occurredAt, updatedAt: occurredAt });
  await db.insert(customerActivities).values([
    activity('a1', 'one', 'emp', 'consulting', 100, '2026-09-01T03:00:00Z'),
    activity('a2', 'one', 'emp', 'negotiating', 150, '2026-09-20T03:00:00Z'),
    activity('a3', 'two', 'mgr', 'lost', 900, '2026-09-20T03:00:00Z'),
    // Own log on somebody else's customer is hidden in employee dashboard.
    activity('a4', 'two', 'emp', 'consulting', 700, '2026-09-21T03:00:00Z'),
    // Excluded from September, but included in October (VN local date boundary).
    activity('oct', 'one', 'emp', 'won', 200, '2026-09-30T17:30:00Z'),
  ]);
  await db.insert(sapoHealthMonitorState).values({ id: 'pull', data: JSON.stringify({ ok: true, finishedAt: now, error: 'NOT_FOR_RESPONSE' }), updatedAt: now });
  return { db, call, mgr, emp, ncc };
}

test('dashboard: server permissions, all-company manager / employee restricted to assigned department, read-only endpoints', async () => {
  const { call, mgr, emp, ncc } = await fixture();
  assert.equal((await call('/dashboard/revenue' + month)).status, 401);
  assert.equal((await call('/dashboard/revenue' + month, ncc)).status, 403);
  assert.equal((await call('/dashboard/revenue' + month + '&owner=mgr', emp)).status, 403);
  assert.equal((await call('/dashboard/revenue' + month + '&group=warehouse', emp)).status, 403);
  assert.equal((await call('/dashboard/revenue', mgr, 'POST')).status, 405);
  const mine = await call('/dashboard/revenue' + month, emp); assert.equal(mine.status, 200, JSON.stringify(mine.data));
  assert.equal(mine.data.scope, 'department'); assert.ok(mine.data.employees.some((x: any) => x.id === 'emp')); assert.ok(mine.data.employees.every((x: any) => x.groupId === 'sale')); assert.deepEqual(mine.data.groups, []);
  assert.equal(mine.data.summary.actual, 1201); assert.equal(mine.data.summary.expected, 150); assert.equal(mine.data.summary.pipeline, 150);
  assert.equal(mine.data.summary.closeRate, 50); assert.equal(mine.data.summary.lost, 0);
  assert.deepEqual(mine.data.neglected.customers.map((x: any) => x.id).sort(), ['never']);
  assert.equal(mine.data.lastSyncedAt, now); assert.ok(!JSON.stringify(mine.data).includes('NOT_FOR_RESPONSE'));
  const all = await call('/dashboard/revenue' + month, mgr); assert.equal(all.status, 200, JSON.stringify(all.data));
  assert.equal(all.data.summary.actual, 1501); assert.equal(all.data.summary.orders, 1003); assert.equal(all.data.summary.lost, 1);
  assert.equal(all.data.summary.expected, 850); assert.equal(all.data.summary.pipeline, 850);
  assert.equal(all.data.groups.reduce((s: number, r: any) => s + r.actual, 0), 1501);
  assert.equal(all.data.months[0].actual, 1501);
  const filtered = await call('/dashboard/revenue' + month + '&owner=emp', mgr); assert.equal(filtered.data.summary.actual, 1201);
});

test('dashboard: period snapshots avoid duplicate follow-ups, month boundaries VN, stable customer pagination', async () => {
  const { db, call, emp, mgr } = await fixture();
  const total = await call('/dashboard/revenue?from=2026-09&to=2026-10', emp);
  assert.equal(total.status, 200, JSON.stringify(total.data)); assert.equal(total.data.summary.expected, 200, 'period latest snapshot, not 150 + 200');
  assert.equal(total.data.summary.pipeline, 0, 'won exits pipeline');
  assert.deepEqual(total.data.months.map((r: any) => r.expected), [150, 200]);
  await db.insert(customers).values(Array.from({ length: 30 }, (_, i) => ({ id: 'page-' + i, name: 'Customer ' + i, contact: '', phone: '', email: '', address: '', search: '', sourceVersion: 0, syncedAt: '' })));
  // Khách chưa có người phụ trách (vd. khách Sapo '123') không tính "lâu chưa chăm sóc" ở phạm vi toàn công ty.
  await db.insert(customerStaff).values(Array.from({ length: 30 }, (_, i) => ({ customerId: 'page-' + i, memberId: 'mgr', role: 'owner' as const, createdAt: now })));
  const first = (await call('/dashboard/revenue' + month, mgr)).data.neglected;
  const second = (await call('/dashboard/revenue' + month + '&page=2', mgr)).data.neglected;
  assert.equal(first.total, 31); assert.equal(first.customers.length, 25); assert.equal(second.customers.length, 6);
  assert.equal(new Set([...first.customers, ...second.customers].map((x: any) => x.id)).size, 31);
  assert.ok(![...first.customers, ...second.customers].some((x: any) => x.id === '123'), 'khách chưa phân công không vào danh sách');
  assert.equal((await call('/dashboard/revenue?from=2026-01&to=2027-01', mgr)).status, 400);
  assert.equal((await call('/dashboard/revenue?from=oops', mgr)).status, 400);
});

test('dashboard: pipeline bỏ khách để quá lâu không cập nhật', async () => {
  const { db, call, emp } = await fixture();
  // Khách 'never' được ghi "đang tư vấn" từ tháng 5, sau đó không cập nhật: tháng 5–6 còn trong pipeline, tháng 9 thì không.
  await db.insert(customerActivities).values({ id: 'old', customerId: 'never', ownerId: 'emp', type: 'call', result: 'consulting', expectedRevenue: 500, occurredAt: '2026-05-10T03:00:00Z', content: 'Call', createdAt: '2026-05-10T03:00:00Z', updatedAt: '2026-05-10T03:00:00Z' });
  assert.equal((await call('/dashboard/revenue?from=2026-06&to=2026-06', emp)).data.summary.pipeline, 500);
  assert.equal((await call('/dashboard/revenue' + month, emp)).data.summary.pipeline, 150, 'quá 90 ngày không cập nhật thì rời pipeline');
});

test('dashboard: role defense and new UI has no HTML injection or token persistence', () => {
  const member = { id: 'emp', active: true, role: 'employee' as const, positionId: 'sale' };
  assert.equal(dashboardFilters(new URLSearchParams(), member, '2026-10-11').owner, undefined);
  assert.throws(() => dashboardFilters(new URLSearchParams(), { ...member, positionId: 'supplier' }, '2026-10-11'), /quyền/);
  const ui = readFileSync(new URL('../../trial-ui/dashboard.js', import.meta.url), 'utf8');
  assert.doesNotMatch(ui, /innerHTML|insertAdjacentHTML|localStorage|sessionStorage/);
});


test('dashboard: ranking and employee selector match staff page, deleted history stays in company totals', async () => {
  const { db, call, mgr } = await fixture();
  const before = (await call('/dashboard/revenue' + month, mgr)).data;
  await db.update(employees).set({ deletedAt: now, active: false }).where(eq(employees.id, 'emp'));
  const res = await call('/dashboard/revenue' + month, mgr);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const staff = (await call('/admin/members', mgr)).data.members.filter((m: any) => ['employee', 'manager'].includes(m.role));
  const ids = (rows: any[]) => rows.map(r => r.id).sort();
  assert.deepEqual(ids(res.data.employees), ids(staff));
  assert.deepEqual(ids(res.data.filters.employees), ids(staff));
  assert.ok(res.data.employees.some((m: any) => m.id === 'off' && !m.active), 'locked but not deleted still exists on staff page');
  assert.equal(res.data.summary.actual, before.summary.actual, 'historical revenue is not lost');
  assert.deepEqual(res.data.months, before.months);
  assert.deepEqual(res.data.groups, before.groups);
  const filtered = (await call('/dashboard/revenue' + month + '&owner=mgr', mgr)).data;
  assert.deepEqual(ids(filtered.employees), ['mgr']);
  assert.deepEqual(ids(filtered.filters.employees), ids(staff), 'selector keeps full visible roster when filtered');
});
