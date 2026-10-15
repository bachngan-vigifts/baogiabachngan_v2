import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';

/** GET /pulse: một lượt gọi nhẹ thay cho tải lại nhiều danh sách – dấu thay đổi chỉ đổi khi chứng từ đổi (kể cả xoá). */
const origin = 'https://trial.test';
const doc = { type: 'B2B', quoteNo: 'B2B_BG20261015_001', customer: 'Công ty A', vat: 8, rows: [{ name: 'Ly', qty: 10, price: 1000 }] };
test('pulse: stamp đổi khi tạo / sửa / xoá báo giá, giữ nguyên khi không có gì đổi; trả số tin chat chưa đọc và thông báo mới nhất', async () => {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  const router = createAppRouter();
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), { db, passwordIterations: 1000, sapoOrderPush: 'off' as const });
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const login = async (email: string) => (await call('/login', '', 'POST', { email, password: PASSWORD })).cookie;
  const emp = await login('emp@x.vn');
  assert.equal((await call('/pulse')).status, 401, 'cần đăng nhập');
  const p0 = (await call('/pulse', emp)).data;
  assert.equal(typeof p0.stamp, 'string'); assert.equal(p0.chatUnread, 0); assert.equal(typeof p0.notifyAt, 'string');
  assert.equal((await call('/pulse', emp)).data.stamp, p0.stamp, 'không có gì đổi → giữ nguyên');
  const q = (await call('/quotes', emp, 'POST', doc)).data;
  const p1 = (await call('/pulse', emp)).data; assert.notEqual(p1.stamp, p0.stamp, 'tạo báo giá → đổi');
  await new Promise(r => setTimeout(r, 5));
  await call('/quotes/' + q.id, emp, 'PUT', { revision: q.revision, data: { ...doc, customer: 'Công ty B' } });
  const p2 = (await call('/pulse', emp)).data; assert.notEqual(p2.stamp, p1.stamp, 'sửa → đổi');
  await call('/quotes/' + q.id, emp, 'DELETE', { revision: q.revision + 1 });
  const p3 = (await call('/pulse', emp)).data; assert.notEqual(p3.stamp, p2.stamp, 'xoá → đổi (đếm số dòng)');
});
