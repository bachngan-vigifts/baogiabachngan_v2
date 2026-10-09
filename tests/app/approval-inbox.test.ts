import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { customers } from '../../src/modules/customers/schema.ts';

/**
 * HỘP "CẦN DUYỆT" (GET /approvals, thẻ trong trang Công việc): gom báo giá chờ duyệt, đơn nháp, HĐKT của đơn nháp,
 * khách hàng và sản phẩm nhân viên tạo. Chỉ Manager xem; chỉ đọc – duyệt xong ở màn hình gốc thì tự biến khỏi hộp.
 */
const origin = 'https://trial.test';
async function setup() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  await db.insert(customers).values({ id: 'K1', name: 'Công ty An Phú', contact: 'Anh Phú', phone: '0902', email: '', address: 'Cần Thơ', search: '', taxCode: '0309', customerCode: 'AP01', sourceVersion: 0, syncedAt: '' });
  const router = createAppRouter();
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), { db, passwordIterations: 1000, sapoOrderPush: 'off' as const });
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const login = async (email: string) => (await call('/login', '', 'POST', { email, password: PASSWORD })).cookie;
  return { call, emp: await login('emp@x.vn'), mgr: await login('mgr@x.vn') };
}

test('Cần duyệt: gom báo giá / đơn / HĐKT / khách / sản phẩm chờ duyệt; chỉ Manager; duyệt xong thì biến mất', async () => {
  const { call, emp, mgr } = await setup();
  const inbox = async () => (await call('/approvals', mgr)).data;
  assert.deepEqual((await inbox()).counts, { quote: 0, order: 0, contract: 0, customer: 0, product: 0, total: 0 });
  assert.equal((await call('/approvals', emp)).status, 403, 'nhân viên không xem');

  // Báo giá chờ duyệt (nhân viên lập).
  const rows = [{ name: 'Bộ trà', qty: 10, price: 100000 }];
  const q1 = await call('/quotes', emp, 'POST', { type: 'HRC', quoteNo: 'HRC_I1', customer: 'Công ty An Phú', customerId: 'K1', vat: 8, rows });
  // Báo giá đã duyệt → 2 đơn nháp: một đơn thường, một đơn có HĐKT.
  const q2 = await call('/quotes', emp, 'POST', { type: 'HRC', quoteNo: 'HRC_I2', customer: 'Công ty An Phú', customerId: 'K1', vat: 8, rows });
  const q3 = await call('/quotes', emp, 'POST', { type: 'HRC', quoteNo: 'HRC_I3', customer: 'Công ty An Phú', customerId: 'K1', vat: 8, rows });
  await call(`/quotes/${q2.data.id}/approve`, mgr, 'POST', { revision: 1 });
  await call(`/quotes/${q3.data.id}/approve`, mgr, 'POST', { revision: 1 });
  const o2 = await call('/orders', emp, 'POST', { quoteId: q2.data.id }), o3 = await call('/orders', emp, 'POST', { quoteId: q3.data.id });
  assert.equal((await call('/contracts', emp, 'POST', { orderId: o3.data.id, legalEntity: 'BN', depositRate: 30, paymentDays: 15 })).status, 201);
  // Khách hàng và sản phẩm nhân viên tạo.
  assert.equal((await call('/customers', emp, 'POST', { name: 'Công ty Mới Tạo' })).status, 201);
  assert.equal((await call('/products', emp, 'POST', { sku: 'NEW-01', name: 'Ly sứ mới', unit: 'cái' })).status, 201);

  let d = await inbox();
  assert.deepEqual(d.counts, { quote: 1, order: 1, contract: 1, customer: 1, product: 1, total: 5 });
  const byKind = Object.fromEntries(d.items.map((i: any) => [i.kind, i]));
  assert.deepEqual([byKind.quote.title, byKind.quote.by, byKind.quote.link], ['Báo giá HRC_I1', 'Tên emp', `#/quotes/${q1.data.id}`]);
  assert.equal(byKind.order.link, `#/orders/${o2.data.id}`); assert.ok(byKind.order.amount > 0, 'đơn kèm giá trị');
  assert.match(byKind.contract.title, /^HĐKT .* · đơn /); assert.equal(byKind.contract.link, `#/orders/${o3.data.id}`);
  assert.equal(byKind.product.sub, 'Mã NEW-01');
  assert.ok(d.items.every((i: any, k: number) => k === 0 || (d.items[k - 1].at || '') <= (i.at || '')), 'chờ lâu nhất lên trước');

  // Duyệt ở màn hình gốc → biến khỏi hộp.
  await call(`/quotes/${q1.data.id}/approve`, mgr, 'POST', { revision: 1 });
  await call(`/orders/${o2.data.id}/status`, mgr, 'PUT', { status: 'confirmed', verified: true });
  await call(`/orders/${o3.data.id}/status`, mgr, 'PUT', { status: 'confirmed', verified: true });
  await call(`/customers/${byKind.customer.id}/approve`, mgr, 'POST', {});
  await call('/products/NEW-01/approve', mgr, 'POST', {});
  d = await inbox();
  assert.equal(d.counts.total, 0, JSON.stringify(d.items));
});
