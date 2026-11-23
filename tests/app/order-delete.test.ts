import {eq} from 'drizzle-orm';
import {salesLineCosts,salesLineCostHistory} from '../../src/modules/sales/line-cost-schema.ts';
import {approveFixtureOrder} from '../helpers/approval-cost-fixture.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';

/** XOÁ ĐƠN HÀNG / HĐKT ĐÃ HUỶ: chỉ Manager, chỉ chứng từ đã huỷ, chưa thu tiền / chưa giao; báo giá lập lại được. */
const origin = 'https://trial.test';
async function setup() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  const router = createAppRouter(), env = { db, passwordIterations: 1000, sapoOrderPush: 'off' as const };
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const login = async (email: string) => (await call('/login', '', 'POST', { email, password: PASSWORD })).cookie;
  const emp = await login('emp@x.vn'), mgr = await login('mgr@x.vn');
  const quote = async (quoteNo: string) => {
    const q = await call('/quotes', emp, 'POST', { type: 'B2B', quoteNo, customer: 'Khách huỷ đơn', customerTaxCode: '0312345678', vat: 8, rows: [{ name: 'Ly sứ', sku: 'LY1', unit: 'cái', qty: 10, price: 100000 }] });
    await call(`/quotes/${q.data.id}/approve`, mgr, 'POST', { revision: 1 });
    return q.data.id as string;
  };
  return { db, call, emp, mgr, quote };
}

test('xoá đơn hàng đã huỷ: chỉ Manager, phải huỷ trước, báo giá lập đơn lại được', async () => {
  const { db, call, emp, mgr, quote } = await setup();
  const qid = await quote('B2B_DEL1');
  const id = (await call('/orders', emp, 'POST', { quoteId: qid })).data.id as string;
  assert.equal((await call(`/orders/${id}`, mgr, 'DELETE')).status, 409, 'chưa huỷ thì không xoá');
  // Đã duyệt + có chuyến giao (chưa giao) → huỷ → xoá được, chuyến giao xoá theo.
  await approveFixtureOrder({db,call},`/orders/${id}/status`,mgr,'PUT',{ status: 'confirmed', verified: true, costWarningsReviewed: true });
  const line = (await call(`/orders/${id}`, mgr)).data.lines[0];
  assert.equal((await call('/deliveries', mgr, 'POST', { orderId: id, plannedDate: '2030-01-15', lines: [{ orderLineId: line.id, qty: 5 }] })).status, 201);
  assert.equal((await call(`/orders/${id}/status`, mgr, 'PUT', { status: 'cancelled' })).status, 200);
  assert.equal((await call(`/orders/${id}`, emp, 'DELETE')).status, 403, 'nhân viên không xoá được');
  const history=await db.select().from(salesLineCostHistory).where(eq(salesLineCostHistory.orderId,id));
  assert.ok(history.length>0,'approved costs have history');
  assert.equal((await call(`/orders/${id}`, mgr, 'DELETE')).status, 200);
  assert.equal((await db.select().from(salesLineCosts).where(eq(salesLineCosts.orderId,id))).length,0);
  assert.deepEqual(await db.select().from(salesLineCostHistory).where(eq(salesLineCostHistory.orderId,id)),history,'cost history survives guarded deletion');
  assert.equal((await call(`/orders/${id}`, mgr)).status, 404);
  assert.ok(!(await call('/orders', mgr)).data.orders.some((o: any) => o.id === id), 'không còn trong danh sách');
  assert.ok(!(await call('/deliveries', mgr)).data.deliveries?.some((d: any) => d.orderId === id), 'chuyến giao xoá theo');
  assert.equal((await call('/orders', emp, 'POST', { quoteId: qid })).status, 201, 'báo giá lập đơn lại được');
});

test('xoá HĐKT đã huỷ (kèm lịch thanh toán); đơn đã thu tiền thì không huỷ / xoá được', async () => {
  const { db, call, emp, mgr, quote } = await setup();
  const k = await call('/contracts', emp, 'POST', { quoteId: await quote('B2B_DEL2'), legalEntity: 'BN', depositRate: 30, paymentDays: 15 });
  assert.equal(k.status, 201, JSON.stringify(k.data));
  const id = k.data.orderId as string;
  assert.equal((await call(`/orders/${id}/status`, emp, 'PUT', { status: 'cancelled' })).status, 200, 'HĐKT nháp: nhân viên huỷ được');
  assert.equal((await call(`/orders/${id}`, mgr, 'DELETE')).status, 200);
  assert.ok(!(await call('/contracts', mgr)).data.contracts.some((x: any) => x.orderId === id), 'không còn trong danh sách HĐKT');

  // Đơn đã thu tiền: không huỷ được → không xoá được.
  const id2 = (await call('/orders', emp, 'POST', { quoteId: await quote('B2B_DEL3') })).data.id as string;
  await approveFixtureOrder({db,call},`/orders/${id2}/status`,mgr,'PUT',{ status: 'confirmed', verified: true, costWarningsReviewed: true });
  const pay = await call('/payments', mgr, 'POST', { orderId: id2, amount: 100000, paidAt: '2026-10-09', method: 'transfer' });
  assert.equal(pay.status, 201, JSON.stringify(pay.data));
  assert.equal((await call(`/orders/${id2}/status`, mgr, 'PUT', { status: 'cancelled' })).status, 409);
  assert.equal((await call(`/orders/${id2}`, mgr, 'DELETE')).status, 409);
});
