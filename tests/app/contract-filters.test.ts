import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { customerPayments, salesContracts, salesOrders } from '../../src/modules/sales/schema.ts';

/** Trang HĐKT: bộ lọc như trang Đơn hàng (trạng thái, nhân viên, khoảng ngày) + pháp nhân; dòng tổng chạy theo bộ lọc, không tính HĐKT huỷ. */
const origin = 'https://trial.test';
test('HĐKT: lọc trạng thái / pháp nhân / nhân viên / ngày; dòng tổng số HĐKT, doanh thu, cọc, đã thu theo bộ lọc', async () => {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  const router = createAppRouter(), env = { db, passwordIterations: 1000, sapoOrderPush: 'off' as const };
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const login = async (email: string) => (await call('/login', '', 'POST', { email, password: PASSWORD })).cookie;
  const emp = await login('emp@x.vn'), mgr = await login('mgr@x.vn');
  const lap = async (quoteNo: string, legalEntity: string, price: number) => {
    const q = await call('/quotes', emp, 'POST', { type: 'HRC', quoteNo, customer: 'Khách ' + quoteNo, customerTaxCode: '0312345678', vat: 0, rows: [{ name: 'Ly', sku: 'LY1', unit: 'cái', qty: 1, price }] });
    await call(`/quotes/${q.data.id}/approve`, mgr, 'POST', { revision: 1 });
    const k = await call('/contracts', emp, 'POST', { quoteId: q.data.id, legalEntity, depositRate: 50, paymentDays: 15 });
    assert.equal(k.status, 201, JSON.stringify(k.data));
    return k.data;
  };
  const a = await lap('HRC_F1', 'BN', 1000), b = await lap('HRC_F2', 'BN', 2000), v = await lap('HRC_F3', 'VG', 4000);
  const list = async (qs = '') => (await call('/contracts?' + qs, mgr)).data;

  let d = await list();
  assert.deepEqual(d.summary, { count: 3, cancelled: 0, revenue: 7000, deposit: 3500, paid: 0, remaining: 7000 });
  assert.ok(d.filterOptions.owners.length >= 1);
  assert.equal(d.contracts[0].ownerName.length > 0, true);

  // Pháp nhân
  d = await list('entity=VG');
  assert.deepEqual(d.contracts.map((k: any) => k.contractNo), [v.contractNo]);
  assert.equal(d.summary.revenue, 4000);

  // Đã thu: cộng phiếu thu còn hiệu lực, bỏ phiếu đã huỷ; HĐKT huỷ không tính tiền.
  const orderOf = async (contractNo: string) => (await db.select({ orderId: salesContracts.orderId }).from(salesContracts).where(eq(salesContracts.contractNo, contractNo)))[0]!.orderId;
  const now = new Date().toISOString();
  await db.insert(customerPayments).values([
    { id: 'p1', orderId: await orderOf(a.contractNo), amount: 600, paidAt: now, createdBy: 'mgr', createdAt: now },
    { id: 'p2', orderId: await orderOf(a.contractNo), amount: 999, paidAt: now, createdBy: 'mgr', createdAt: now, voidedAt: now, voidedBy: 'mgr' },
  ]);
  await db.update(salesOrders).set({ status: 'cancelled' }).where(eq(salesOrders.id, await orderOf(b.contractNo)));
  d = await list('entity=BN');
  assert.equal(d.total, 2, 'danh sách vẫn có HĐKT huỷ');
  assert.deepEqual(d.summary, { count: 1, cancelled: 1, revenue: 1000, deposit: 500, paid: 600, remaining: 400 });

  // Trạng thái như trang Đơn hàng
  assert.deepEqual((await list('status=cancelled')).contracts.map((k: any) => k.contractNo), [b.contractNo]);
  const live = (await list()).contracts.find((k: any) => k.contractNo === a.contractNo);
  assert.ok((await list('status=' + live.orderStatus)).contracts.some((k: any) => k.contractNo === a.contractNo));

  // Nhân viên + khoảng ngày (ngày lập / ngày ký)
  const owner = d.filterOptions.owners[0].id;
  assert.equal((await list('owner=' + owner)).total, 3);
  assert.equal((await list('owner=nobody')).total, 0);
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10), later = '2099-01-01';
  assert.equal((await list(`from=${today}&to=${today}`)).total, 3);
  assert.equal((await list(`from=${later}`)).summary.count, 0);
  assert.equal((await list(`dateBy=signed&from=${later}`)).total, 0);

  // Tham số sai → 400 (không lọc âm thầm)
  assert.equal((await call('/contracts?status=xyz', mgr)).status, 400);
  assert.equal((await call('/contracts?entity=XX', mgr)).status, 400);
  assert.equal((await call('/contracts?from=2026-13-01', mgr)).status, 400);
});
