import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { hashPassword } from '../../src/core/auth/password.ts';
import { customerDiscount } from '../../src/modules/quotes/domain/quote-math.ts';

/** Chiết khấu theo thương hiệu của khách (trang chi tiết khách hàng): xem / sửa (người phụ trách, Manager), áp dụng khi thêm sản phẩm. */
const origin = 'https://trial.test';
test('chiết khấu thương hiệu: người phụ trách / Manager sửa, ô trống = chưa thiết lập, kiểm 0–100%, hồ sơ khách trả về', async () => {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  await d1.sqlite.prepare("INSERT INTO staff_members (id,email,name,phone,role,position_id,active,created_at) VALUES ('emp2','emp2@x.vn','Sale 2','0900','employee','sale',1,'2026-01-01T00:00:00.000Z')").run();
  await d1.sqlite.prepare('INSERT INTO staff_credentials (member_id,password_hash,activation_hash,activation_expires,version) VALUES (?,?,NULL,NULL,0)').run('emp2', await hashPassword(PASSWORD, 1000));
  const router = createAppRouter(), env = { db, passwordIterations: 1000, sapoOrderPush: 'off' as const };
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const login = async (email: string) => (await call('/login', '', 'POST', { email, password: PASSWORD })).cookie;
  const emp = await login('emp@x.vn'), emp2 = await login('emp2@x.vn'), mgr = await login('mgr@x.vn');
  const id = (await call('/customers', emp, 'POST', { name: 'Khách CK' })).data.id as string;

  assert.deepEqual((await call(`/customers/${id}`, emp)).data.discounts, { minhLong: null, lys: null, lock: null });
  assert.equal((await call(`/customers/${id}/discounts`, emp, 'PUT', { minhLong: 101 })).status, 400);
  assert.equal((await call(`/customers/${id}/discounts`, emp2, 'PUT', { minhLong: 5 })).status, 403, 'không phụ trách thì không sửa');
  const r = await call(`/customers/${id}/discounts`, emp, 'PUT', { minhLong: 12.5, lys: '8', lock: '' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.discounts, { minhLong: 12.5, lys: 8, lock: null });
  assert.deepEqual((await call(`/customers/${id}/discounts`, emp2)).data.discounts, { minhLong: 12.5, lys: 8, lock: null }, 'ai lập báo giá cũng đọc được để điền CK');
  // Chỉ gửi một ô: các ô khác giữ nguyên; null = xoá.
  await call(`/customers/${id}/discounts`, mgr, 'PUT', { lys: null, lock: 3 });
  assert.deepEqual((await call(`/customers/${id}/overview`, mgr)).data.discounts, { minhLong: 12.5, lys: null, lock: 3 });

  // Áp dụng theo thương hiệu sản phẩm (như web cũ).
  const d = { minhLong: 12.5, lys: 8, lock: 3 };
  assert.deepEqual([customerDiscount('Minh Long', d), customerDiscount('Minh Long - Lys', d), customerDiscount('Lock&Lock', d), customerDiscount('Khác', d)], [12.5, 8, 3, 0]);
  assert.equal(customerDiscount('Minh Long', d, 'amount', 200_000), 25_000);
});
