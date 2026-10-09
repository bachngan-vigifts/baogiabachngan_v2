import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';

const origin = 'https://trial.test';
test('xưởng in dùng chung: chỉ Manager; 5 xưởng mặc định + xưởng thêm mới; chặn trùng tên (bỏ dấu, hoa thường)', async () => {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  const router = createAppRouter();
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), { db, passwordIterations: 1000, sapoOrderPush: 'off' as const });
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const login = async (email: string) => (await call('/login', '', 'POST', { email, password: PASSWORD })).cookie;
  const emp = await login('emp@x.vn'), mgr = await login('mgr@x.vn');

  assert.equal((await call('/printing-workshops', emp)).status, 403);
  assert.equal((await call('/printing-workshops', emp, 'POST', { name: 'Xưởng A' })).status, 403);
  assert.deepEqual((await call('/printing-workshops', mgr)).data.workshops.map((w: any) => w.name),
    ['Xưởng in Tiến phát', 'Thương Bé Ba', 'Trọng Tín', 'Xưởng in Hạnh Nguyên (Anh Liêm)', 'Minh Long']);
  assert.equal((await call('/printing-workshops', mgr, 'POST', { name: '' })).status, 400);
  assert.equal((await call('/printing-workshops', mgr, 'POST', { name: 'Xưởng A', email: 'sai' })).status, 400);
  assert.equal((await call('/printing-workshops', mgr, 'POST', { name: 'trong tin' })).status, 409);
  const ok = await call('/printing-workshops', mgr, 'POST', { name: ' Xưởng Ánh Dương ', phone: '0909' });
  assert.equal(ok.status, 201); assert.equal(ok.data.workshop.name, 'Xưởng Ánh Dương');
  assert.equal((await call('/printing-workshops', mgr, 'POST', { name: 'xuong anh  duong' })).status, 409);
  const list = (await call('/printing-workshops', mgr)).data.workshops;
  assert.equal(list.length, 6); assert.equal(list[5].phone, '0909');
});
