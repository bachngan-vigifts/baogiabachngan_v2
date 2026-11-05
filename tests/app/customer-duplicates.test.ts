import { customerCreateFixture } from '../helpers/customer-fixture.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { customers, customerContacts, customerStaff } from '../../src/modules/customers/schema.ts';
import { salesOrders } from '../../src/modules/sales/schema.ts';
import { quotations } from '../../src/modules/quotes/schema.ts';
import { customerActivities } from '../../src/modules/care/schema.ts';
import { syncCustomers } from '../../src/modules/integrations/api/sapo-sync-routes.ts';
import { normTaxCode, pickKeeper } from '../../src/modules/customers/domain/tax-code.ts';

/** CHỐNG TRÙNG KHÁCH THEO MST: không tạo / đồng bộ bản sao; Manager gộp khách trùng, giữ bản có người liên hệ. */
const origin = 'https://trial.test', now = '2026-10-01T00:00:00.000Z';
async function setup() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  const router = createAppRouter();
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), { db, passwordIterations: 1000, sapoOrderPush: 'off' as const });
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const login = async (email: string) => (await call('/login', '', 'POST', { email, password: PASSWORD })).cookie;
  return { db, call, emp: await login('emp@x.vn'), mgr: await login('mgr@x.vn') };
}
const row = (id: string, over: Partial<typeof customers.$inferInsert> = {}) => ({ id, name: 'CÔNG TY TNHH TMDV KIM TRẦN GIA', contact: '', phone: '0931328616', email: '', address: '366/7 Ấp 3', search: '', sourceVersion: 0, syncedAt: now, taxCode: '0317821742', createdAt: now, ...over });

test('MST: chuẩn hoá và chọn bản giữ lại (có người liên hệ trước)', () => {
  assert.equal(normTaxCode(' 0317 821.742 '), '0317821742');
  assert.notEqual(normTaxCode('0317821742-001'), normTaxCode('0317821742'));
  const base = { name: 'A', phone: '', email: '', address: '', createdAt: now, contacts: 0, refs: 0, hasOwner: false };
  assert.equal(pickKeeper([{ ...base, id: 'sapo', contact: '', refs: 5 }, { ...base, id: 'web', contact: 'Hoàng' }]).id, 'web');
  assert.equal(pickKeeper([{ ...base, id: 'a', contact: '' }, { ...base, id: 'b', contact: '', contacts: 1 }]).id, 'b');
  assert.equal(pickKeeper([{ ...base, id: 'a', contact: 'X' }, { ...base, id: 'b', contact: 'Y', refs: 2 }]).id, 'b');
});

test('tạo / sửa khách: chặn trùng MST; đồng bộ Sapo không tạo bản sao', async () => {
  const { db, call, emp, mgr } = await setup();
  const a = await call('/customers', emp, 'POST', customerCreateFixture({ name: 'Công ty A', taxCode: '0317821742' }));
  assert.equal(a.status, 201);
  const dup = await call('/customers', mgr, 'POST', customerCreateFixture({ name: 'Công ty A (2)', taxCode: '0317 821 742' }));
  assert.equal(dup.status, 409); assert.match(dup.data.error, /Công ty A/);
  assert.equal((await call('/customers', mgr, 'POST', customerCreateFixture({ name: 'Chi nhánh', taxCode: '0317821742-001' }))).status, 201, 'MST chi nhánh khác MST chính');
  assert.equal((await call('/customers', mgr, 'POST', customerCreateFixture({ name: 'Khách thiếu MST', taxCode: '' }))).status, 400, 'CRM tạo mới bắt buộc MST; POS có luồng miễn riêng');
  const b = await call('/customers', mgr, 'POST', customerCreateFixture({ name: 'Công ty B', taxCode: '0100000001' }));
  assert.equal((await call(`/customers/${b.data.id}`, mgr, 'PUT', { name: 'Công ty B', taxCode: '0317821742' })).status, 409, 'đổi sang MST đã có');
  assert.equal((await call(`/customers/${a.data.id}`, emp, 'PUT', { name: 'Công ty A mới', taxCode: '0317821742' })).status, 200);

  // Sapo: khách mới trùng MST với khách web → bỏ qua; khách Sapo khác MST vẫn tạo.
  const r = await syncCustomers(db, { customers: [
    { id: '9001', name: 'CÔNG TY A', tax_code: '0317821742', updated_at: now },
    { id: '9002', name: 'Công ty C', tax_code: '0399999999', updated_at: now },
    { id: '9003', name: 'Công ty C bản 2', tax_code: '0399999999', updated_at: now },
  ] });
  assert.equal(r.duplicates, 2);
  const ids = (await db.select({ id: customers.id }).from(customers)).map(x => x.id);
  assert.ok(!ids.includes('9001') && ids.includes('9002') && !ids.includes('9003'));
  // Khách Sapo đã có vẫn được cập nhật.
  await syncCustomers(db, { customers: [{ id: '9002', name: 'Công ty C đổi tên', tax_code: '0399999999', updated_at: '2026-10-02T00:00:00Z' }] });
  assert.equal((await call('/customers/9002', mgr)).data.customer.name, 'Công ty C đổi tên');
});

test('gộp khách trùng MST: giữ bản có người liên hệ, chuyển đơn / báo giá / chăm sóc / phụ trách, xoá bản thiếu', async () => {
  const { db, call, emp, mgr } = await setup();
  // Dữ liệu trùng sẵn có (trước khi có chống trùng): bản web có người liên hệ, bản Sapo không.
  await db.insert(customers).values([row('web-1', { contact: 'Hoàng', createdAt: '2026-09-01T00:00:00.000Z' }), row('5001', { email: 'kt@kimtran.vn', customerCode: 'CUS01' }), row('other', { taxCode: '0100000002', name: 'Khác' })]);
  await db.insert(customerStaff).values({ customerId: '5001', memberId: 'emp', role: 'owner', createdAt: now });
  await db.insert(customerContacts).values({ id: 'ct1', customerId: 'web-1', name: 'Chị Lan', isPrimary: true, createdAt: now, updatedAt: now });
  await db.insert(salesOrders).values({ id: 'o1', orderNo: 'DH1', quoteType: 'B2B', customerId: '5001', customerName: 'Kim Trần Gia', ownerId: 'emp', createdBy: 'mgr', orderDate: '2026-09-10', status: 'confirmed', total: 100, createdAt: now, updatedAt: now });
  await db.insert(quotations).values({ id: 'q1', creatorId: 'emp', quoteNo: 'B2B_1', quoteType: 'B2B', customer: 'Kim Trần Gia', quoteDate: '2026-09-10', data: JSON.stringify({ customerId: '5001', rows: [] }), createdAt: now, updatedAt: now });
  await db.insert(customerActivities).values({ id: 'a1', customerId: '5001', ownerId: 'emp', type: 'call', result: 'consulting', expectedRevenue: 0, occurredAt: now, content: 'Gọi', createdAt: now, updatedAt: now });

  assert.equal((await call('/customer-duplicates', emp)).status, 403);
  const list = await call('/customer-duplicates', mgr);
  assert.equal(list.status, 200, JSON.stringify(list.data));
  assert.equal(list.data.groups.length, 1); assert.equal(list.data.total, 1);
  assert.equal(list.data.groups[0].keepId, 'web-1', 'giữ bản có người liên hệ');

  assert.equal((await call('/customer-duplicates/merge', emp, 'POST', { all: true })).status, 403);
  const m = await call('/customer-duplicates/merge', mgr, 'POST', { all: true });
  assert.deepEqual(m.data, { ok: true, groups: 1, merged: 1 });
  assert.equal((await call('/customers/5001', mgr)).status, 404, 'bản thiếu người liên hệ đã xoá');
  const kept = (await call('/customers/web-1', mgr)).data;
  assert.equal(kept.customer.contact, 'Hoàng');
  assert.equal(kept.customer.email, 'kt@kimtran.vn', 'bù ô trống từ bản trùng');
  assert.equal(kept.owner.id, 'emp', 'nhận người phụ trách của bản trùng');
  assert.deepEqual(kept.contacts.map((x: any) => x.name), ['Chị Lan']);
  const [o] = await db.select({ c: salesOrders.customerId }).from(salesOrders); assert.equal(o!.c, 'web-1');
  const [q] = await db.select({ d: quotations.data }).from(quotations); assert.equal(JSON.parse(q!.d).customerId, 'web-1');
  const [a] = await db.select({ c: customerActivities.customerId }).from(customerActivities); assert.equal(a!.c, 'web-1');
  assert.equal((await call('/customer-duplicates', mgr)).data.groups.length, 0);

  // Gộp tay: chỉ gộp được khách cùng MST.
  await db.insert(customers).values(row('5002'));
  assert.equal((await call('/customer-duplicates/merge', mgr, 'POST', { keepId: 'web-1', dropIds: ['other'] })).status, 400);
  assert.deepEqual((await call('/customer-duplicates/merge', mgr, 'POST', { keepId: '5002', dropIds: ['web-1'] })).data, { ok: true, groups: 1, merged: 1 });
  const last = (await call('/customers/5002', mgr)).data;
  assert.equal(last.customer.contact, 'Hoàng'); assert.deepEqual(last.contacts.map((x: any) => x.name), ['Chị Lan'], 'người liên hệ chuyển theo');
});
