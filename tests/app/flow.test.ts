import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { hashPassword } from '../../src/core/auth/password.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { FLOW_NODE_IDS } from '../../src/app/flow-routes.ts';

/** SƠ ĐỒ QUY TRÌNH: API chỉ đọc, đúng quyền từng vai trò; mọi khối giao diện có dữ liệu máy chủ tương ứng. */
const origin = 'https://trial.test';
async function setup() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  await d1.sqlite.prepare("INSERT INTO staff_members (id,email,name,phone,role,position_id,active,created_at) VALUES ('kho','kho@x.vn','Thủ kho','0900','employee','warehouse',1,'2026-01-01T00:00:00.000Z')").run();
  await d1.sqlite.prepare('INSERT INTO staff_credentials (member_id,password_hash,activation_hash,activation_expires,version) VALUES (?,?,NULL,NULL,0)').run('kho', await hashPassword(PASSWORD, 1000));
  const router = createAppRouter(), env = { db, passwordIterations: 1000, sapoOrderPush: 'off' as const };
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const login = async (email: string) => (await call('/login', '', 'POST', { email, password: PASSWORD })).cookie;
  return { call, emp: await login('emp@x.vn'), mgr: await login('mgr@x.vn'), kho: await login('kho@x.vn') };
}

test('sơ đồ quy trình: số liệu + việc theo vai trò, thao tác nhanh đúng quyền', async () => {
  const { call, emp, mgr, kho } = await setup();
  assert.equal((await call('/flow')).status, 401);
  const q = await call('/quotes', emp, 'POST', { type: 'B2B', quoteNo: 'B2B_FLOW1', customer: 'Khách Flow', customerTaxCode: '0312345678', vat: 8, rows: [{ name: 'Ly', sku: 'LY1', unit: 'cái', qty: 10, price: 100000 }] });
  assert.equal(q.status, 201);

  const m1 = (await call('/flow', mgr)).data;
  assert.deepEqual(Object.keys(m1.nodes).sort(), [...FLOW_NODE_IDS].sort());
  const pend = m1.nodes.quotes.items.find((i: any) => i.id === q.data.id);
  assert.equal(m1.nodes.quotes.metrics.find((x: any) => x.key === 'pending').value, 1);
  assert.deepEqual(pend.actions, ['approve-quote'], 'Manager duyệt nhanh'); assert.equal(pend.revision, 1);
  const e1 = (await call('/flow', emp)).data;
  assert.deepEqual(e1.nodes.quotes.items[0].actions, [], 'nhân viên không có nút duyệt');

  // Duyệt → sinh đơn → duyệt đơn → lịch giao hôm nay.
  assert.equal((await call(`/quotes/${q.data.id}/approve`, mgr, 'POST', { revision: 1 })).status, 200);
  assert.deepEqual((await call('/flow', emp)).data.nodes.quotes.items[0].actions, ['make-order']);
  const o = await call('/orders', emp, 'POST', { quoteId: q.data.id }); assert.equal(o.status, 201, JSON.stringify(o.data));
  assert.equal((await call('/flow', mgr)).data.nodes.orders.metrics[0].value, 1, 'đơn nháp chờ duyệt');
  await call(`/orders/${o.data.id}/status`, mgr, 'PUT', { status: 'confirmed', verified: true });
  const line = (await call(`/orders/${o.data.id}`, mgr)).data.lines[0];
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
  assert.equal((await call('/deliveries', emp, 'POST', { orderId: o.data.id, plannedDate: today, lines: [{ orderLineId: line.id, qty: 5 }] })).status, 201);

  const k = (await call('/flow', kho)).data;
  for (const id of ['quotes', 'orders', 'contracts', 'customers', 'care', 'receivables', 'invoices', 'stock-requests']) assert.equal(k.nodes[id], null, 'kho không thấy ' + id);
  assert.equal(k.nodes.deliveries.metrics.find((x: any) => x.key === 'today').value, 1, 'kho thấy mọi lịch giao');
  assert.deepEqual(k.nodes.deliveries.items[0].actions, ['ship-start', 'ship-done']);
  assert.equal((await call('/flow', emp)).data.nodes.orders.metrics.find((x: any) => x.key === 'confirmed').value, 1);
});

test('giao diện sơ đồ: cấu hình khớp API, không chèn HTML thô', () => {
  const cfg = readFileSync(new URL('../../trial-ui/flow-config.js', import.meta.url), 'utf8');
  for (const id of FLOW_NODE_IDS) assert.match(cfg, new RegExp(`id: '${id}'`), 'thiếu khối ' + id);
  const ui = readFileSync(new URL('../../trial-ui/flow-map.js', import.meta.url), 'utf8');
  assert.doesNotMatch(ui, /innerHTML|insertAdjacentHTML/);
});
