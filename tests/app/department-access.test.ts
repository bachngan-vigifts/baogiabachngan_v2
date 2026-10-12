import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { credentials, employees } from '../../src/modules/staff/schema.ts';
import { salesOrders } from '../../src/modules/sales/schema.ts';
import { vnToday } from '../../src/modules/care/api/routes.ts';

async function setup() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  const [cred] = await db.select().from(credentials).where(eq(credentials.memberId, 'emp'));
  await db.update(credentials).set({ passwordHash: cred!.passwordHash }).where(eq(credentials.memberId, 'new'));
  const router = createAppRouter(), origin = 'https://trial.test';
  const call = async (path: string, cookie = '', method = 'GET', body?: any) => {
    const r = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), { db, passwordIterations: 1000, sapoOrderPush: 'off' });
    return { status: r.status, data: await r.json() as any, cookie: r.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const login = async (email: string) => { const r = await call('/login', '', 'POST', { email, password: PASSWORD }); assert.equal(r.status, 200); return r.cookie; };
  const emp = await login('emp@x.vn'), peer = await login('new@x.vn'), mgr = await login('mgr@x.vn');
  const customer = await call('/customers', peer, 'POST', { name: 'Khách của đồng nghiệp', taxCode: '1234567890', phone: '0901234567', address: 'Kho khách' });
  assert.equal(customer.status, 201, JSON.stringify(customer.data));
  const customerId = customer.data.id;
  await call('/customers/' + customerId + '/approve', mgr, 'POST');
  let quoteSeq = 0;
  const qdata = (name: string) => ({ type: 'HRC', vat: 8, quoteNo: 'HRC_BG20261012_' + String(++quoteSeq).padStart(3, '0'), customer: 'Khách của đồng nghiệp', customerId, customerTaxCode: '1234567890', date: vnToday(), rows: [{ sku: 'SKU', name, qty: 1, price: 100000, taxRate: 8 }] });
  const makeQuote = async () => { const data = qdata('Sản phẩm'); const q = await call('/quotes', peer, 'POST', data); assert.equal(q.status, 201, JSON.stringify(q.data)); return { id: q.data.id, data }; };
  return { db, call, login, emp, peer, mgr, customerId, makeQuote };
}

test('cùng phòng ban xem/sửa báo giá nháp, giữ chủ, không sửa đã duyệt; khác nhóm/không nhóm không thấy', async () => {
  const s = await setup(), q = await s.makeQuote();
  assert.equal((await s.call('/quotes/' + q.id, s.emp)).status, 200);
  const saved = await s.call('/quotes/' + q.id, s.emp, 'PUT', { revision: 1, data: { ...q.data, rows: [{ sku: 'SKU', name: 'Đã sửa bởi đồng nghiệp', qty: 2, price: 100000 }] } });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const detail = await s.call('/quotes/' + q.id, s.emp); assert.equal(detail.data.data.rows[0].qty, 2);
  await s.call('/quotes/' + q.id + '/approve', s.mgr, 'POST', { revision: detail.data.revision });
  const approved = await s.call('/quotes/' + q.id, s.emp);
  assert.equal((await s.call('/quotes/' + q.id, s.emp, 'PUT', { revision: approved.data.revision, data: { ...approved.data.data, customer: 'Không được sửa' } })).status, 403);
  await s.db.update(employees).set({ positionId: 'warehouse' }).where(eq(employees.id, 'emp'));
  assert.equal((await s.call('/quotes/' + q.id, s.emp)).status, 404);
  await s.db.update(employees).set({ positionId: null }).where(eq(employees.id, 'emp'));
  assert.equal((await s.call('/quotes/' + q.id, s.emp)).status, 404);
  assert.equal((await s.call('/quotes/' + q.id, s.peer)).status, 200);
  await s.db.update(employees).set({ positionId: 'sale' }).where(eq(employees.id, 'emp'));
  await s.db.update(employees).set({ active: false }).where(eq(employees.id, 'new'));
  assert.equal((await s.call('/quotes/' + q.id, s.emp)).status, 404, 'không mở quyền qua tài khoản đồng nghiệp bị khóa');
});

test('đơn và HĐKT cùng phòng ban: đọc/sửa nháp; duyệt chỉ Manager, mất quyền ngay khi chuyển phòng', async () => {
  const s = await setup(), q = await s.makeQuote();
  await s.call('/quotes/' + q.id + '/approve', s.mgr, 'POST', { revision: 1 });
  const order = await s.call('/orders', s.peer, 'POST', { quoteId: q.id, pushSapo: false });
  assert.equal(order.status, 201, JSON.stringify(order.data));
  assert.equal((await s.call('/orders/' + order.data.id, s.emp)).status, 200);
  assert.equal((await s.call('/orders/' + order.data.id + '/delivery-date', s.emp, 'PUT', { date: '2027-01-15' })).status, 200);
  await s.db.update(salesOrders).set({ status: 'confirmed' }).where(eq(salesOrders.id, order.data.id));
  assert.equal((await s.call('/orders/' + order.data.id + '/delivery-date', s.emp, 'PUT', { date: '2027-01-16' })).status, 403);
  const q2 = await s.makeQuote(); await s.call('/quotes/' + q2.id + '/approve', s.mgr, 'POST', { revision: 1 });
  const k = await s.call('/contracts', s.peer, 'POST', { quoteId: q2.id, legalEntity: 'BN', depositRate: 30, paymentDays: 15, pushSapo: false });
  assert.equal(k.status, 201, JSON.stringify(k.data));
  assert.equal((await s.call('/orders/' + k.data.orderId, s.emp)).status, 200);
  assert.equal((await s.call('/contracts/' + k.data.id, s.emp, 'PUT', { data: { deliveryText: 'Giao 15/01/2027' } })).status, 200);
  await s.db.update(employees).set({ positionId: 'warehouse' }).where(eq(employees.id, 'new'));
  assert.equal((await s.call('/orders/' + k.data.orderId, s.emp)).status, 404);
});

test('hồ sơ đồng nghiệp không có dữ liệu lương; care/khách/doanh số cùng nhóm hiển thị, khác nhóm bị chặn', async () => {
  const s = await setup(), today = vnToday();
  const form = { customerId: s.customerId, contactName: 'Anh khách', type: 'call', result: 'consulting', content: 'Gọi khách', expectedRevenue: 100000, nextAt: today, remindBefore: '1d' };
  const care = await s.call('/care', s.peer, 'POST', form); assert.equal(care.status, 201, JSON.stringify(care.data));
  const visible = await s.call('/care/' + care.data.activity.id, s.emp); assert.equal(visible.status, 200); assert.equal(visible.data.activity.canEdit, false);
  assert.equal((await s.call('/care/' + care.data.activity.id, s.emp, 'PUT', form)).status, 404, 'xem cùng nhóm không cấp quyền ghi đè nhật ký chăm sóc');
  const mine = await s.call('/customers?mine=1', s.emp); assert.ok(mine.data.customers.some((x: any) => x.id === s.customerId));
  const overview = await s.call('/members/new/overview', s.emp); assert.equal(overview.status, 200, JSON.stringify(overview.data));
  assert.equal((await s.call('/members/emp/overview', s.emp)).data.access.canViewPayroll, true);
  assert.equal(overview.data.payroll, null); assert.equal(overview.data.access.canViewPayroll, false); assert.equal(overview.data.kpi.workedDays, null);
  assert.equal((await s.call('/hr/payroll/' + today.slice(0, 7), s.emp)).status, 403);
  assert.equal((await s.call('/hr/members/new/salary', s.emp, 'PUT', { effectiveMonth: today.slice(0, 7), baseSalary: 1 })).status, 403);
  const dash = await s.call('/dashboard/revenue?owner=new', s.emp); assert.equal(dash.status, 200, JSON.stringify(dash.data)); assert.equal(dash.data.scope, 'department');
  assert.equal(dash.data.summary.pipeline, 100000);
  await s.db.update(employees).set({ positionId: 'warehouse' }).where(eq(employees.id, 'new'));
  assert.equal((await s.call('/members/new/overview', s.emp)).status, 403);
  assert.equal((await s.call('/care/' + care.data.activity.id, s.emp)).status, 404);
  assert.equal((await s.call('/dashboard/revenue?owner=new', s.emp)).status, 403);
});
