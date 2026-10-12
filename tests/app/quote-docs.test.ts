import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { hashPassword } from '../../src/core/auth/password.ts';

/** Danh sách báo giá: báo giá đã sinh đơn hàng / HĐKT → GET /quote-docs trả chứng từ để hiện nút "Xem đơn hàng / HĐKT". */
const origin = 'https://trial.test';
test('quote-docs: đơn hàng, HĐKT, đơn đã huỷ không tính, nhân viên khác không thấy', async () => {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  const router = createAppRouter(), env = { db, passwordIterations: 1000, sapoOrderPush: 'off' as const };
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const login = async (email: string) => (await call('/login', '', 'POST', { email, password: PASSWORD })).cookie;
  const emp = await login('emp@x.vn'), mgr = await login('mgr@x.vn');
  const quote = async (quoteNo: string) => {
    const q = await call('/quotes', emp, 'POST', { type: 'B2B', quoteNo, customer: 'Khách', customerTaxCode: '0312345678', vat: 8, rows: [{ name: 'Ly', sku: 'LY1', unit: 'cái', qty: 1, price: 1000 }] });
    await call(`/quotes/${q.data.id}/approve`, mgr, 'POST', { revision: 1 });
    return q.data.id as string;
  };
  const [q1, q2, q3, q4] = [await quote('B2B_D1'), await quote('B2B_D2'), await quote('B2B_D3'), await quote('B2B_D4')];
  const o1 = (await call('/orders', emp, 'POST', { quoteId: q1 })).data;
  const k2 = (await call('/contracts', emp, 'POST', { quoteId: q2, legalEntity: 'BN', depositRate: 30, paymentDays: 15 })).data;
  const o3 = (await call('/orders', emp, 'POST', { quoteId: q3 })).data;
  await call(`/orders/${o3.id}/status`, emp, 'PUT', { status: 'cancelled' });
  const docs = (await call(`/quote-docs?ids=${[q1, q2, q3, q4].join(',')}`, emp)).data.docs;
  assert.deepEqual(Object.keys(docs).sort(), [q1, q2].sort(), 'đơn đã huỷ / chưa sinh đơn thì không có');
  assert.deepEqual([docs[q1].orderId, docs[q1].contractNo], [o1.id, null]);
  assert.deepEqual([docs[q2].orderId, docs[q2].contractNo], [k2.orderId, k2.contractNo]);
  assert.deepEqual((await call('/quote-docs?ids=', emp)).data.docs, {});
  // Nhân viên phòng ban khác (không phụ trách / không lập đơn): không thấy chứng từ.
  await d1.sqlite.prepare("INSERT INTO staff_members (id,email,name,phone,role,position_id,active,created_at) VALUES ('emp3','emp3@x.vn','Sale 3','0900','employee','sale-admin',1,'2026-01-01T00:00:00.000Z')").run();
  await d1.sqlite.prepare('INSERT INTO staff_credentials (member_id,password_hash,activation_hash,activation_expires,version) VALUES (?,?,NULL,NULL,0)').run('emp3', await hashPassword(PASSWORD, 1000));
  assert.deepEqual((await call(`/quote-docs?ids=${q1}`, await login('emp3@x.vn'))).data.docs, {});
});

