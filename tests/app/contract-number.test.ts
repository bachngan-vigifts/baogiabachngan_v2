import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';

/** Popup Lập HĐKT: ô "Số HĐKT" điền sẵn số tự sinh (xem trước), sửa được; số trùng báo lỗi rõ. */
const origin = 'https://trial.test';
test('số HĐKT: xem trước = số được cấp; sửa số thì dùng số đã sửa, không nhảy số tự sinh; trùng số → 409', async () => {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  const router = createAppRouter(), env = { db, passwordIterations: 1000, sapoOrderPush: 'off' as const };
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const login = async (email: string) => (await call('/login', '', 'POST', { email, password: PASSWORD })).cookie;
  const emp = await login('emp@x.vn'), mgr = await login('mgr@x.vn');
  const quote = async (quoteNo: string, tax = '0312345678') => {
    const q = await call('/quotes', emp, 'POST', { type: 'HRC', quoteNo, customer: 'Khách', customerTaxCode: tax, vat: 8, rows: [{ name: 'Ly', sku: 'LY1', unit: 'cái', qty: 1, price: 1000 }] });
    await call(`/quotes/${q.data.id}/approve`, mgr, 'POST', { revision: 1 });
    return q.data.id as string;
  };
  const lap = (quoteId: string, extra: object = {}) => call('/contracts', emp, 'POST', { quoteId, legalEntity: 'BN', depositRate: 30, paymentDays: 15, ...extra });

  const q1 = await quote('HRC_K1');
  assert.equal((await call(`/contracts/next-no?quoteId=${q1}&legalEntity=XX`, emp)).status, 400);
  const pre = (await call(`/contracts/next-no?quoteId=${q1}&legalEntity=BN`, emp)).data.contractNo as string;
  assert.match(pre, /^\d{2}-01\/\d{8}\/HĐKT\/BN-0312345678$/);
  assert.equal((await call(`/contracts/next-no?quoteId=${q1}&legalEntity=BN`, emp)).data.contractNo, pre, 'xem trước không giữ / tăng số');
  const k1 = await lap(q1);
  assert.equal(k1.status, 201, JSON.stringify(k1.data)); assert.equal(k1.data.contractNo, pre);

  // Sửa số: dùng đúng số đã sửa; số tự sinh kế tiếp không bị nhảy.
  const q2 = await quote('HRC_K2'), q3 = await quote('HRC_K3');
  const next = (await call(`/contracts/next-no?quoteId=${q2}&legalEntity=BN`, emp)).data.contractNo as string;
  const k2 = await lap(q2, { contractNo: '  HĐ 123/2026/BN  ' });
  assert.equal(k2.status, 201, JSON.stringify(k2.data)); assert.equal(k2.data.contractNo, 'HĐ 123/2026/BN');
  assert.equal((await lap(q3)).data.contractNo, next, 'số tự sinh vẫn là số kế tiếp');

  // Trùng số đã có → báo rõ, không lập.
  const q4 = await quote('HRC_K4');
  const dup = await lap(q4, { contractNo: 'HĐ 123/2026/BN' });
  assert.equal(dup.status, 409); assert.equal(dup.data.code, 'CONTRACT_NO_EXISTS'); assert.match(dup.data.error, /đã dùng/);
  assert.equal((await lap(q4, { contractNo: 'HĐ <x>' })).status, 400);
  assert.equal((await lap(q4)).status, 201, 'đổi lại số tự sinh thì lập được');
  // Báo giá không có mã KH / MST: xem trước báo lỗi rõ, không cấp số.
  const q5 = await quote('HRC_K5', '');
  assert.match((await call(`/contracts/next-no?quoteId=${q5}&legalEntity=BN`, emp)).data.error, /mã khách hàng hoặc MST/);
});
