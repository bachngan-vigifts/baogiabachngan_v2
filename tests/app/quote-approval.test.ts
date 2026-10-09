import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';

const origin = 'https://trial.test';
async function setup() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  const router = createAppRouter();
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), { db, passwordIterations: 1000 });
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const login = async (email: string) => (await call('/login', '', 'POST', { email, password: PASSWORD })).cookie;
  return { call, emp: await login('emp@x.vn'), mgr: await login('mgr@x.vn') };
}
const doc = (price = 100000) => ({ type: 'B2B', quoteNo: 'B2B_BG20261006_001', customer: 'Công ty A', vat: 8, rows: [{ name: 'Ly', qty: 10, price }] });

test('duyệt báo giá như web cũ: nhân viên lưu → đợi duyệt; Manager duyệt; đã duyệt thì chỉ Manager được sửa; Manager tạo → tự duyệt', async () => {
  const { call, emp, mgr } = await setup();
  const q = await call('/quotes', emp, 'POST', doc());
  assert.equal(q.data.approvalStatus, 'pending');
  assert.equal((await call('/quotes/pending-count', mgr)).data.count, 1);
  assert.equal((await call('/quotes/' + q.data.id + '/approve', emp, 'POST', { revision: 1 })).status, 403, 'chỉ Manager duyệt');
  assert.equal((await call('/quotes/' + q.data.id + '/approve', mgr, 'POST', { revision: 9 })).status, 409, 'duyệt đúng phiên bản');
  const ok = await call('/quotes/' + q.data.id + '/approve', mgr, 'POST', { revision: 1 });
  assert.equal(ok.status, 200); assert.equal(ok.data.approvedByName.length > 0, true);
  let got = (await call('/quotes/' + q.data.id, emp)).data;
  assert.equal(got.approvalStatus, 'approved'); assert.equal(got.revision, 1, 'duyệt không tăng phiên bản');
  assert.equal((await call('/quotes', emp)).data.quotes[0].approvalStatus, 'approved');

  // Nhân viên không được ghi lại, sửa hoặc xoá báo giá đã duyệt.
  for (const data of [got.data, doc(120000)]) {
    const blocked = await call('/quotes/' + q.data.id, emp, 'PUT', { revision: 1, data });
    assert.equal(blocked.status, 403); assert.equal(blocked.data.code, 'QUOTE_APPROVED');
  }
  assert.equal((await call('/quotes/' + q.data.id, emp, 'DELETE', { revision: 1 })).status, 403);
  got = (await call('/quotes/' + q.data.id, emp)).data;
  assert.equal(got.approvalStatus, 'approved'); assert.equal(got.revision, 1);
  assert.equal(got.data.rows[0].price, 100000, 'yêu cầu bị chặn không thay đổi dữ liệu');

  // Manager sửa báo giá đã duyệt thì giữ duyệt và tăng phiên bản.
  const saved = await call('/quotes/' + q.data.id, mgr, 'PUT', { revision: 1, data: doc(130000) });
  assert.equal(saved.status, 200); assert.equal(saved.data.approvalStatus, 'approved');
  assert.equal(saved.data.revision, 2);

  const m = await call('/quotes', mgr, 'POST', { ...doc(), quoteNo: 'B2B_BG20261006_002' });
  assert.equal(m.data.approvalStatus, 'approved');
  assert.equal((await call('/quotes/pending-count', mgr)).data.count, 0);
});

test('xoá báo giá: chỉ Manager, đúng phiên bản; đã có đơn đặt hàng thì không xoá được', async () => {
  const { call, emp, mgr } = await setup();
  const a = await call('/quotes', emp, 'POST', doc());
  assert.equal((await call('/quotes/' + a.data.id, emp, 'DELETE', { revision: 1 })).status, 403);
  assert.equal((await call('/quotes/' + a.data.id, mgr, 'DELETE', { revision: 5 })).status, 409);
  assert.equal((await call('/quotes/' + a.data.id, mgr, 'DELETE', { revision: 1 })).status, 200);
  assert.equal((await call('/quotes/' + a.data.id, emp)).status, 404);

  const b = await call('/quotes', mgr, 'POST', doc());
  assert.equal((await call('/orders', mgr, 'POST', { quoteId: b.data.id })).status, 201);
  const del = await call('/quotes/' + b.data.id, mgr, 'DELETE', { revision: 1 });
  assert.equal(del.status, 409); assert.match(del.data.error, /đơn đặt hàng/);
});
