import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';

const origin = 'https://trial.test';
test('trial: customer CRUD, quote save/revision và chặn NCC/nhân viên khác', async () => {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  const router = createAppRouter();
  const call = async (path: string, method = 'GET', body?: object, cookie = '') => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), { db, passwordIterations: 1000 });
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  assert.equal((await call('/quotes')).status, 401);
  const emp = (await call('/login', 'POST', { email: 'emp@x.vn', password: PASSWORD })).cookie;
  const mgr = (await call('/login', 'POST', { email: 'mgr@x.vn', password: PASSWORD })).cookie;
  const ncc = (await call('/login', 'POST', { email: 'ncc@x.vn', password: PASSWORD })).cookie;
  assert.equal((await call('/customers', 'GET', undefined, ncc)).status, 403);
  const c = await call('/customers', 'POST', { name: 'Khách thử', phone: '0900000000' }, emp);
  assert.equal(c.status, 201);
  assert.equal((await call('/customers/' + c.data.id, 'PUT', { name: 'Khách thử 2' }, emp)).status, 200);
  const doc = { type: 'B2B', quoteNo: 'BG-TEST', customer: 'Khách thử', vat: 8, rows: [{ name: 'Sản phẩm', qty: 1.5, price: 12.5 }] };
  const q = await call('/quotes', 'POST', doc, emp); assert.equal(q.status, 201, JSON.stringify(q.data));
  const other = await call('/quotes', 'POST', { ...doc, quoteNo: 'BG-MGR' }, mgr);
  assert.equal((await call('/quotes/' + other.data.id, 'GET', undefined, emp)).status, 404);
  const list = (await call('/quotes', 'GET', undefined, emp)).data.quotes;
  assert.deepEqual(list.map((x: any) => [x.quoteNo, x.mine, x.lineCount, x.total]), [['BG-TEST', true, 1, 1.5 * 12.5 * 1.08]]);
  const saved = await call('/quotes/' + q.data.id, 'PUT', { revision: 1, data: { ...q.data.data, customer: 'Sửa' } }, emp);
  assert.equal(saved.status, 200, JSON.stringify(saved.data)); assert.equal(saved.data.revision, 2);
  assert.equal((await call('/quotes/' + q.data.id, 'PUT', { revision: 1, data: q.data.data }, emp)).status, 409);
  const lines = await d1.sqlite.prepare('SELECT qty,price FROM quote_lines WHERE quote_id=?').all(q.data.id);
  assert.deepEqual(lines, [{ qty: 1.5, price: 12.5 }]);
});
