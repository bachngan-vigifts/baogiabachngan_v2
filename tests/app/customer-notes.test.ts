import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
async function setup() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  await d1.sqlite.exec("UPDATE staff_credentials SET password_hash=(SELECT password_hash FROM staff_credentials WHERE member_id='emp'), activation_hash=NULL WHERE member_id IN ('new','old'); UPDATE staff_members SET position_id='sales-lock' WHERE id='old';");
  const router = createAppRouter(), env = { db, passwordIterations: 1000, sapoOrderPush: 'off' as const }, origin = 'https://trial.test';
  const call = async (path: string, cookie = '', method = 'GET', body?: unknown) => {
    const r = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    return { status: r.status, data: await r.json() as any, cookie: r.headers.get('set-cookie')?.split(';')[0] || '' };
  };
  const login = async (id: string) => (await call('/login', '', 'POST', { email: id+'@x.vn', password: PASSWORD })).cookie;
  const mgr = await login('mgr'), owner = await login('emp'), peer = await login('new'), outsider = await login('old'), supplier = await login('ncc');
  const c = await call('/customers', mgr, 'POST', { name: 'Khách thử', ownerId: 'emp', taxCode: '1234567890' });
  return { call, d1, mgr, owner, peer, outsider, supplier, id: c.data.id };
}
test('customer notes: server enforces owner/manager write, scoped reading, hidden for unrelated viewers', async () => {
  const s = await setup(), path = `/customers/${s.id}/notes`;
  assert.equal((await s.call(path)).status, 401);
  assert.equal((await s.call(path, s.supplier)).status, 403);
  assert.equal((await s.call(path, s.outsider)).status, 403);
  const overview = await s.call(`/customers/${s.id}/overview`, s.outsider); assert.equal(overview.status, 200, JSON.stringify(overview.data)); assert.equal(overview.data.generalNote, null);
  assert.equal((await s.call(path, s.owner)).data.revision, 0);
  const saved = await s.call(path, s.owner, 'PUT', { text: 'Ưu tiên giao buổi sáng\n<script>alert(1)</script>', revision: 0 });
  assert.equal(saved.status, 200); assert.equal(saved.data.revision, 1);
  for (const cookie of [s.mgr, s.owner, s.peer]) assert.equal((await s.call(path, cookie)).data.text, saved.data.text);
  for (const cookie of [s.peer, s.outsider, s.supplier]) assert.equal((await s.call(path, cookie, 'PUT', { text: 'bad', revision: 1 })).status, 403);
  await s.call(`/customers/${s.id}/staff`, s.mgr, 'PUT', { ownerId: 'emp', sharedIds: ['old'] });
  assert.equal((await s.call(path, s.outsider)).data.text, saved.data.text);
  assert.equal((await s.call(path, s.outsider, 'PUT', { text: 'bad', revision: 1 })).status, 403);
  assert.equal((await s.call(`/customers/${s.id}/overview`, s.mgr)).data.generalNote.text, saved.data.text);
  const account = await s.call('/customer-accounts', s.mgr, 'POST', { customerId: s.id, name: 'Khách đăng nhập', email: 'customer@notes.vn' });
  assert.equal(account.status, 201);
  const token = /token=([a-f0-9]{64})/.exec(account.data.url)![1];
  await s.call('/activate', '', 'POST', { token, password: PASSWORD });
  const customer = await s.call('/login', '', 'POST', { email: 'customer@notes.vn', password: PASSWORD });
  assert.equal((await s.call(path, customer.cookie)).status, 403);
  assert.equal((await s.call(path, customer.cookie, 'PUT', { text: 'bad', revision: 1 })).status, 403);
  const portal = await s.call('/portal/me', customer.cookie); assert.equal(portal.status, 200);
  assert.equal(JSON.stringify(portal.data).includes(saved.data.text), false);
  assert.equal(portal.data.generalNote, undefined);

});
test('customer notes: stale initial/create and update requests conflict; validates input and allows clearing', async () => {
  const s = await setup(), path = `/customers/${s.id}/notes`;
  for (const body of [{ text: 7, revision: 0 }, { text: 'x'.repeat(5001), revision: 0 }, { text: 'x' }, { text: 'x', revision: -1 }, { text: 'x', revision: 1.5 }])
    assert.equal((await s.call(path, s.owner, 'PUT', body)).status, 400);
  assert.equal((await s.call(path, s.owner, 'PUT', { text: '  Ghi chú đầu  ', revision: 0 })).status, 200);
  const beforeReplay=(await s.call(path,s.owner)).data;
  const replay=await s.call(path,s.owner,'PUT',{text:'Ghi chú đầu',revision:0});
  assert.equal(replay.status,200);assert.equal(replay.data.stateMatches,true);
  assert.deepEqual((await s.call(path,s.owner)).data,beforeReplay,'retry must not change revision or timestamp');
  assert.equal((await s.call(path,s.mgr,'PUT',{text:'Ghi chú đầu',revision:0})).status,409,'another actor is not a replay');
  assert.equal((await s.call(path, s.mgr, 'PUT', { text: 'stale', revision: 0 })).status, 409);
  assert.equal((await s.call(path, s.mgr, 'PUT', { text: 'Bản mới', revision: 1 })).status, 200);
  assert.equal((await s.call(path, s.owner, 'PUT', { text: 'stale', revision: 1 })).status, 409);
  assert.equal((await s.call(path, s.owner)).data.text, 'Bản mới');
  const cleared = await s.call(path, s.owner, 'PUT', { text: '', revision: 2 }); assert.equal(cleared.status, 200); assert.equal(cleared.data.text, '');
  assert.equal((await s.call('/customers/missing/notes', s.mgr)).status, 404);
});
test('merging duplicate customers preserves all notes and invalidates old revisions', async () => {
  const s = await setup();
  const other = await s.call('/customers', s.mgr, 'POST', { name: 'Bản trùng', ownerId: 'emp' });
  const id2 = other.data.id;
  await s.d1.sqlite.prepare("UPDATE sapo_customers SET tax_code='1234567890' WHERE id=?").run(id2);
  assert.equal((await s.call(`/customers/${id2}/notes`, s.mgr, 'PUT', { text: 'Ghi chú khác', revision: 0 })).status, 200);
  assert.equal((await s.call(`/customers/${s.id}/notes`, s.mgr, 'PUT', { text: 'Ghi chú gốc', revision: 0 })).status, 200);
  assert.equal((await s.call('/customer-duplicates/merge', s.mgr, 'POST', { keepId: s.id, dropIds: [id2] })).status, 200);
  const merged = (await s.call(`/customers/${s.id}/notes`, s.mgr)).data;
  assert.match(merged.text, /Ghi chú gốc/); assert.match(merged.text, /Ghi chú khác/); assert.equal(merged.revision, 2);
  assert.equal((await s.call(`/customers/${id2}/notes`, s.mgr)).status, 404);
  assert.equal((await s.call(`/customers/${s.id}/notes`, s.owner, 'PUT', { text: 'old', revision: 1 })).status, 409);
});

test('duplicate merge with oversized combined notes rolls back without losing either note', async () => {
  const s = await setup();
  const c = await s.call('/customers', s.mgr, 'POST', { name: 'Trùng', ownerId: 'emp' });
  await s.d1.sqlite.prepare("UPDATE sapo_customers SET tax_code='1234567890' WHERE id=?").run(c.data.id);
  for (const [id, text] of [[s.id, 'a'.repeat(3000)], [c.data.id, 'b'.repeat(3000)]])
    assert.equal((await s.call(`/customers/${id}/notes`, s.mgr, 'PUT', { text, revision: 0 })).status, 200);
  assert.equal((await s.call('/customer-duplicates/merge', s.mgr, 'POST', { keepId: s.id, dropIds: [c.data.id] })).status, 409);
  assert.equal((await s.call(`/customers/${s.id}/notes`, s.mgr)).data.text, 'a'.repeat(3000));
  assert.equal((await s.call(`/customers/${c.data.id}/notes`, s.mgr)).data.text, 'b'.repeat(3000));
});

test('sale admin can read a customer note outside their department but cannot edit it', async () => {
  const s = await setup();
  await s.d1.sqlite.exec("UPDATE staff_members SET position_id='sale-admin' WHERE id='old'");
  assert.equal((await s.call(`/customers/${s.id}/notes`, s.owner, 'PUT', { text: 'Nội bộ', revision: 0 })).status, 200);
  assert.equal((await s.call(`/customers/${s.id}/notes`, s.outsider)).data.text, 'Nội bộ');
  assert.equal((await s.call(`/customers/${s.id}/notes`, s.outsider, 'PUT', { text: 'changed', revision: 1 })).status, 403);
});
