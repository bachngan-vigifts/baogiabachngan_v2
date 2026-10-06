import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { pricePolicies, productPrices, products, productStock, warehouses } from '../../src/modules/catalog/schema.ts';
import { customers } from '../../src/modules/customers/schema.ts';
import { credentials, employees, sessions, staffSapoLinks } from '../../src/modules/staff/schema.ts';
import { mapSapoProduct, mapSapoStaff, isEligibleSapoCustomer } from '../../src/modules/integrations/domain/sapo-mapping.ts';

const origin = 'https://trial.test', SECRET = 'bi-mat-dong-bo-sapo-0123456789abcdef';
async function setup(sapoSyncToken = SECRET) {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  const router = createAppRouter();
  const env = { db, passwordIterations: 1000, sapoSyncToken };
  // Máy chủ gọi đồng bộ: không có Origin, không có cookie.
  const push = async (path: string, body: unknown, headers: Record<string, string> = { authorization: 'Bearer ' + SECRET }) => {
    const res = await router.handle(new Request(origin + '/api/staff/integrations/sapo/' + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }), env);
    return { status: res.status, data: await res.json() as any };
  };
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const login = async (email: string) => (await call('/login', '', 'POST', { email, password: PASSWORD })).cookie;
  return { db, push, call, login };
}

test('đồng bộ Sapo: chỉ nhận đúng mã bí mật (Bearer, header hoặc ?token=); phiên đăng nhập Manager không dùng được', async () => {
  const { push, call, login } = await setup();
  const body = { customers: [] };
  assert.equal((await push('customers', body, {})).status, 401);
  assert.equal((await push('customers', body, { authorization: 'Bearer sai-ma' })).status, 401);
  assert.equal((await push('customers', body, { 'x-sapo-sync-token': SECRET })).status, 200);
  assert.equal((await push('customers?token=' + SECRET, body, {})).status, 200);
  // Manager đã đăng nhập (có cookie, đúng Origin) vẫn không gọi được luồng đồng bộ.
  const mgr = await login('mgr@x.vn');
  assert.equal((await call('/integrations/sapo/customers', mgr, 'POST', body)).status, 401);
  // Chưa cấu hình mã bí mật (hoặc quá ngắn): từ chối toàn bộ.
  const weak = await setup('ngan');
  assert.equal((await weak.push('customers', body, { authorization: 'Bearer ngan' })).status, 503);
});

test('đồng bộ khách hàng: tạo/cập nhật theo mã Sapo, bỏ qua bản cũ hơn, khách lẻ, khách không MST; không đụng khách tạo trên web', async () => {
  const { db, push } = await setup();
  await db.insert(customers).values({ id: 'b1c2d3e4-0000-4000-8000-000000000000', name: 'Khách tạo trên web', contact: '', phone: '', email: '', address: '', search: '', sourceVersion: 0, syncedAt: '' });
  const r1 = await push('customers', { observedAt: '2026-10-06T01:00:00Z', customers: [
    { id: 1001, name: 'Công ty Hoàng Long', tax_code: '0101234567', code: 'CUS01', phone: '0901', email: 'A@HL.VN', updated_at: '2026-10-05T00:00:00Z', default_address: { address1: '1 Lê Lợi', district: 'Q1', province: 'HCM' } },
    { id: 1002, name: 'Khách lẻ', tax_code: '0300000001' },
    { id: 1003, name: 'Cửa hàng không MST', tax_code: '' },
    { id: 'b1c2d3e4-0000-4000-8000-000000000000', name: 'Ghi đè khách web', tax_code: '0101' },
  ] });
  assert.equal(r1.status, 200, JSON.stringify(r1.data));
  assert.deepEqual(r1.data, { received: 4, applied: 1, skipped: 3 });
  const [hl] = await db.select().from(customers).where(eq(customers.id, '1001'));
  assert.equal(hl!.email, 'a@hl.vn'); assert.equal(hl!.customerCode, 'CUS01'); assert.equal(hl!.address, '1 Lê Lợi, Q1, HCM');
  assert.equal((await db.select().from(customers).where(eq(customers.id, 'b1c2d3e4-0000-4000-8000-000000000000')))[0]!.name, 'Khách tạo trên web');
  assert.equal((await db.select().from(customers).where(eq(customers.id, '1002'))).length, 0);
  // Webhook đến trễ mang bản cũ hơn: bỏ qua. Bản mới hơn: cập nhật. Webhook gốc của Sapo (1 khách, không bọc mảng) cũng nhận.
  await push('customers', { customer: { id: 1001, name: 'Tên cũ', tax_code: '0101234567', updated_at: '2026-10-01T00:00:00Z' } });
  assert.equal((await db.select().from(customers).where(eq(customers.id, '1001')))[0]!.name, 'Công ty Hoàng Long');
  const r2 = await push('customers', { id: 1001, name: 'Công ty Hoàng Long (mới)', tax_code: '0101234567', updated_at: '2026-10-06T00:00:00Z' });
  assert.equal(r2.data.applied, 1);
  assert.equal((await db.select().from(customers).where(eq(customers.id, '1001')))[0]!.name, 'Công ty Hoàng Long (mới)');
  assert.equal((await push('customers', { customers: [{ id: 1, name: 'a' }, { id: 1, name: 'b' }] })).status, 400);
  assert.equal((await push('customers', { customers: Array.from({ length: 501 }, (_, i) => ({ id: i + 1, name: 'x' })) })).status, 400);
});

test('đồng bộ nhân viên: tạo hồ sơ Sale chưa kích hoạt, liên kết theo email, khoá người nghỉ, không đụng hồ sơ đã liên kết/Manager', async () => {
  const { db, push, login } = await setup();
  const empCookie = await login('emp@x.vn');
  assert.ok(empCookie);
  const r = await push('staff', { observedAt: '2026-10-06T00:00:00Z', members: [
    { id: 11, name: 'Nguyễn Văn Mới', email: 'moi@x.vn', phone: '0911' },
    { id: 12, full_name: 'Trùng email', email: 'EMP@x.vn' },
    { id: 13, name: 'Đã nghỉ', email: 'nghi@x.vn', status: 'inactive' },
    { id: 14, name: 'Manager trên Sapo', email: 'mgr@x.vn' },
  ] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data, { received: 4, created: 1, updated: 0, linked: 2, deactivated: 0, skipped: 1 });
  const [moi] = await db.select().from(employees).where(eq(employees.id, 'SAPO-11'));
  assert.equal(moi!.positionId, 'sale'); assert.equal(moi!.role, 'employee'); assert.equal(moi!.active, true);
  assert.equal((await db.select().from(credentials).where(eq(credentials.memberId, 'SAPO-11')))[0]!.passwordHash, null);
  assert.equal((await db.select().from(employees).where(eq(employees.id, 'SAPO-13'))).length, 0, 'không tạo người đã nghỉ');
  assert.deepEqual((await db.select().from(staffSapoLinks)).map(l => [l.sapoId, l.memberId]).sort(), [['SAPO-12', 'emp'], ['SAPO-14', 'mgr']]);
  // Chạy lại: cập nhật tên, không tạo trùng. Sapo báo nghỉ: khoá hồ sơ Sapo và đăng xuất; hồ sơ đã liên kết giữ nguyên.
  const again = await push('accounts', { accounts: [{ id: 11, name: 'Nguyễn Văn Mới 2', email: 'moi@x.vn' }] }).catch(() => null);
  assert.equal(again?.status, 404, 'đường dẫn không tồn tại');
  const r2 = await push('staff', { accounts: [{ id: 11, full_name: 'Nguyễn Văn Mới 2', email: 'moi@x.vn' }, { id: 12, name: 'x', active: false }] });
  assert.deepEqual(r2.data, { received: 2, created: 0, updated: 1, linked: 0, deactivated: 0, skipped: 1 });
  assert.equal((await db.select().from(employees).where(eq(employees.id, 'SAPO-11')))[0]!.name, 'Nguyễn Văn Mới 2');
  assert.equal((await db.select().from(employees).where(eq(employees.id, 'emp')))[0]!.active, true);
  await db.insert(sessions).values({ hash: 'h-sapo-11', memberId: 'SAPO-11', version: 0, expires: 9e9 });
  const r3 = await push('staff', { members: [{ id: 11, name: 'Nguyễn Văn Mới', active: 'false' }] });
  assert.equal(r3.data.deactivated, 1);
  assert.equal((await db.select().from(employees).where(eq(employees.id, 'SAPO-11')))[0]!.active, false);
  assert.equal((await db.select().from(sessions).where(eq(sessions.memberId, 'SAPO-11'))).length, 0);
  // Manager khoá trên web thì đồng bộ không tự mở lại.
  await push('staff', { members: [{ id: 11, name: 'Nguyễn Văn Mới' }] });
  assert.equal((await db.select().from(employees).where(eq(employees.id, 'SAPO-11')))[0]!.active, false);
});

test('đồng bộ sản phẩm: webhook Sapo tạo/cập nhật giá theo bảng giá, tồn theo kho, giữ trường nhập tay, ẩn mã ngừng bán', async () => {
  const { db, push, call, login } = await setup();
  const t = '2026-10-01T00:00:00.000Z';
  await db.insert(pricePolicies).values([{ id: 'le', name: 'Giá bán lẻ', sortOrder: 0 }, { id: 'si', name: 'Giá sỉ', sortOrder: 1 }]);
  await db.insert(warehouses).values([{ id: 'q1', name: 'Kho Q1', sortOrder: 0 }]);
  await db.insert(products).values({ sku: 'LHC4125', name: 'Bình cũ', brand: 'Lock&Lock', unit: 'cái', perCarton: 24, updatedAt: t });
  const sapoProduct = {
    id: 555, name: 'Bình giữ nhiệt', brand: '', status: 'active', opt1: 'Màu',
    images: [{ full_path: 'https://sapo.dktcdn.net/100/a.jpg' }],
    variants: [
      { id: 1, sku: 'LHC4125', name: 'Bình giữ nhiệt Xanh', opt1: 'Xanh', unit: 'cái', price: 190000, taxable: true, output_vat_rate: 8,
        variant_prices: [{ price_list_name: 'Giá sỉ', value: 150000 }, { price_list_name: 'Giá nhập', value: 90000 }],
        inventories: [{ location_name: 'Kho Q1', available: 7.6 }, { location_name: 'Chi nhánh lạ', available: 3 }] },
      { id: 2, sku: 'LHC4126', name: 'Bình giữ nhiệt Đỏ', price: 195000 },
      { id: 3, sku: '', name: 'Không SKU' },
    ],
  };
  const r = await push('product', sapoProduct);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data, { received: 2, created: 1, updated: 1, hidden: 0, skipped: 1, unknownPolicies: ['Giá nhập'], unknownWarehouses: ['Chi nhánh lạ'] });
  const [p] = await db.select().from(products).where(eq(products.sku, 'LHC4125'));
  assert.equal(p!.name, 'Bình giữ nhiệt Xanh (LHC4125)'); assert.equal(p!.brand, 'Lock&Lock', 'Sapo để trống thì giữ thương hiệu');
  assert.equal(p!.perCarton, 24, 'giữ quy cách thùng nhập tay'); assert.equal(p!.pattern, 'Xanh'); assert.equal(p!.taxOut, 8);
  assert.equal(p!.imageUrl, 'https://sapo.dktcdn.net/100/a.jpg'); assert.equal(p!.sapoProductId, '555');
  const prices = Object.fromEntries((await db.select().from(productPrices).where(eq(productPrices.sku, 'LHC4125'))).map(x => [x.policyId, x.price]));
  assert.deepEqual(prices, { le: 190000, si: 150000 });
  assert.deepEqual((await db.select().from(productStock).where(eq(productStock.sku, 'LHC4125'))).map(s => [s.warehouseId, s.quantity]), [['q1', 8]]);
  // Chạy lại cùng dữ liệu: không tạo trùng. Đổi giá: cập nhật.
  sapoProduct.variants[0]!.variant_prices![0]!.value = 140000;
  const r2 = await push('product', { products: [sapoProduct] });
  assert.equal(r2.data.created, 0); assert.equal(r2.data.updated, 2);
  assert.equal((await db.select().from(products)).length, 2);
  assert.equal((await db.select().from(productPrices).where(eq(productPrices.policyId, 'si'))).find(x => x.sku === 'LHC4125')!.price, 140000);
  // Ngừng bán trên Sapo: ẩn khỏi danh sách tìm kiếm.
  const r3 = await push('product', { product: { ...sapoProduct, status: 'inactive' } });
  assert.equal(r3.data.hidden, 2);
  const emp = await login('emp@x.vn');
  assert.equal((await call('/products', emp)).data.total, 0);
  // Sapo gửi thử (dry run) và dữ liệu không có SKU.
  assert.deepEqual((await push('product', { dry_run: true })).data, { ok: true, dryRun: true });
  assert.equal((await push('product', { id: 9, name: 'x' })).status, 400);
});

test('Manager xem tình trạng đồng bộ; nhân viên bị chặn; không lộ mã bí mật', async () => {
  const { push, call, login } = await setup();
  await push('customers', { customers: [{ id: 7, name: 'Công ty A', tax_code: '0311111111' }] });
  await push('staff', { members: [{ id: 9, name: 'Nhân viên Sapo', email: 'nv9@x.vn' }] });
  const mgr = await login('mgr@x.vn'), emp = await login('emp@x.vn');
  assert.equal((await call('/admin/sapo-sync', emp)).status, 403);
  const s = await call('/admin/sapo-sync', mgr);
  assert.equal(s.status, 200, JSON.stringify(s.data));
  assert.equal(s.data.configured, true);
  assert.equal(s.data.customers.count, 1); assert.equal(s.data.staff.count, 1);
  assert.ok(!JSON.stringify(s.data).includes(SECRET));
});

test('mọi route đồng bộ dưới /integrations/ thuộc khu vực sapo-sync (bỏ qua kiểm Origin chỉ an toàn khi có mã bí mật)', () => {
  for (const r of createAppRouter().list()) {
    const isSync = r.pattern.startsWith('^\\/integrations\\/');
    assert.equal(isSync, r.meta === 'sapo-sync', r.pattern);
  }
});

test('ánh xạ Sapo: trạng thái nhân viên dạng chuỗi, khách lẻ, biến thể', () => {
  assert.equal(mapSapoStaff({ id: 1, name: 'A', status: 'resigned' })!.active, false);
  assert.equal(mapSapoStaff({ id: 1, name: 'A', active: true, email: 'khong-hop-le' })!.email, '');
  assert.equal(mapSapoStaff({ id: 'a b', name: 'A' }), null);
  assert.equal(isEligibleSapoCustomer({ name: 'Khách hàng lẻ Q1', taxCode: '0301' }), false);
  assert.equal(isEligibleSapoCustomer({ name: 'Công ty B', taxCode: '000' }), false);
  const m = mapSapoProduct({ id: 1, name: 'Nồi', sku: 'N1', price: '420000', images: [{ src: 'http://evil.test/x.jpg' }] });
  assert.equal(m.variants[0]!.retail, 420000); assert.equal(m.variants[0]!.imageUrl, '');
});
