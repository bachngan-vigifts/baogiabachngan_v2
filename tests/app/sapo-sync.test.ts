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
  const env = { db, passwordIterations: 1000, sapoOrderPush: 'off' as const, sapoSyncToken };
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
  assert.deepEqual(r1.data, { received: 4, applied: 1, skipped: 3, duplicates: 0 });
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

test('mọi route đồng bộ dưới /integrations/ thuộc khu vực xác thực Sapo, SyncTime hoặc SePay riêng (bỏ Origin chỉ khi có mã bí mật)', () => {
  for (const r of createAppRouter().list()) {
    const isSync = r.pattern.startsWith('^\\/integrations\\/');
    assert.equal(isSync, r.meta === 'sapo-sync' || r.meta === 'transfer-sync' || r.meta === 'warehouse-image-sync' || r.meta === 'synctime-sync' || r.meta === 'sepay-sync' || r.meta === 'web-order-sync' || r.meta === 'ghn-webhook', r.pattern);
    if (r.meta === 'ghn-webhook') assert.equal(r.pattern, new RegExp('^/integrations/ghn/pos-lock/webhook/?$').source);
    if (r.meta === 'synctime-sync') assert.equal(r.pattern, new RegExp('^/integrations/synctime/webhook/?$').source);
    if (r.meta === 'sepay-sync') assert.ok([
      new RegExp('^/integrations/sepay/pos-payment/?$').source,
      new RegExp('^/integrations/sepay/payment/?$').source,
    ].includes(r.pattern), r.pattern);
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

// ---------------- Kéo dữ liệu từ Sapo bằng phiên Manager ----------------
import { sapoRuntimeSessions, sapoHealthMonitorState, sapoInventoryDocs, sapoInventoryDocLines } from '../../src/modules/integrations/schema.ts';

function fakeSapo(data: Record<string, any[]>, opts: { expired?: boolean } = {}) {
  const calls: string[] = [];
  const fetch: typeof globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input)); calls.push(url.pathname + url.search);
    assert.equal(init?.method, 'GET', 'chỉ đọc Sapo');
    assert.match(String((init?.headers as Record<string, string>).cookie), /_admin_session_id=abc|sapo-admin=CfDJ8gia/);
    if (opts.expired) return new Response('', { status: 302, headers: { location: '/admin/login' } });
    const key = url.pathname.replace(/^\/admin\//, '').replace(/\.json$/, '');
    const page = Number(url.searchParams.get('page') || 1), all = data[key] ?? [];
    return Response.json({ [key]: all.slice((page - 1) * 250, page * 250), metadata: { total: all.length } });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

test('kéo từ Sapo: Manager lưu phiên (mã hoá), bấm Đồng bộ ngay, lịch tự động dùng mã bí mật; phiên hết hạn được báo rõ', async () => {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  await db.insert(pricePolicies).values({ id: 'le', name: 'Giá bán lẻ', sortOrder: 0 });
  await db.insert(warehouses).values({ id: 'q1', name: 'Kho Q1' });
  const sapo = fakeSapo({
    accounts: [{ id: 21, full_name: 'NV Sapo', email: 'nv21@x.vn' }],
    customers: [{ id: 501, name: 'Công ty C', tax_code: '0312345678', modified_on: '2026-10-06T00:00:00Z' }, ...Array.from({ length: 300 }, (_, i) => ({ id: 600 + i, name: 'Khách lẻ ' + i }))],
    locations: [{ id: 7, name: 'Kho Q1' }],
    products: [{ id: 9, name: 'Nồi', variants: [{ sku: 'N-24', price: 420000, inventories: [{ location_id: 7, available: 5 }] }] }],
    purchase_orders: [{ id: 31, code: 'PON001', status: 'active', location_id: 7, supplier: { name: 'Minh Long I' }, created_on: '2026-10-05T02:00:00Z',
      line_items: [{ variant_id: 90, sku: 'N-24', variant_name: 'Nồi 24', quantity: 10, price: 300000 }] }],
    stock_transfers: [{ id: 41, code: 'TRN001', status: 'shipped', source_location_id: 7, destination_location_id: 8, line_items: [{ sku: 'N-24', quantity: 3 }] }],
    stock_adjustments: [{ id: 51, code: 'ADJ001', location: { name: 'Kho Q1' }, line_items: [{ sku: 'N-24', actual_quantity: 4, adjustment_quantity: -1 }] }],
  });
  const expiredSapo = fakeSapo({}, { expired: true });
  let fake = sapo;
  const router = createAppRouter();
  const env = { db, passwordIterations: 1000, sapoOrderPush: 'off' as const, sapoSyncToken: SECRET, get sapoFetch() { return fake.fetch; } };
  const call = async (path: string, cookie = '', method = 'GET', body?: object, headers: Record<string, string> = { origin }) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { 'content-type': 'application/json', cookie, ...headers }, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const mgr = (await call('/login', '', 'POST', { email: 'mgr@x.vn', password: PASSWORD })).cookie;
  const emp = (await call('/login', '', 'POST', { email: 'emp@x.vn', password: PASSWORD })).cookie;

  assert.equal((await call('/admin/sapo-pull', mgr, 'POST', {})).status, 409, 'chưa kết nối');
  assert.equal((await call('/admin/sapo-session', emp, 'POST', { cookie: '_admin_session_id=abc' })).status, 403);
  assert.equal((await call('/admin/sapo-session', mgr, 'POST', { cookie: 'khong-co-phien=1' })).status, 400);
  // Sapo đổi cookie phiên sang `sapo-admin` (10/2026): vẫn nhận; tên gần giống thì không.
  assert.equal((await call('/admin/sapo-session', mgr, 'POST', { cookie: 'x-sapo-admin=1; lang=vi' })).status, 400);
  assert.equal((await call('/admin/sapo-session', mgr, 'POST', { cookie: 'lang=vi; sapo-admin=CfDJ8gia; _ga=1' })).status, 200, 'cookie phiên dạng mới');
  const saved = await call('/admin/sapo-session', mgr, 'POST', { cookie: 'Cookie: _admin_session_id=abc; other=1' });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const [row] = await db.select().from(sapoRuntimeSessions);
  assert.ok(!row!.encryptedCookie.includes('abc'), 'cookie lưu mã hoá');

  const run = await call('/admin/sapo-pull', mgr, 'POST', {});
  assert.equal(run.status, 200, JSON.stringify(run.data));
  assert.equal(run.data.results.staff.created, 1);
  assert.equal(run.data.results.customers.applied, 1);
  assert.equal(run.data.results.products.created, 1);
  assert.equal((await db.select().from(productStock)).find(s => s.sku === 'N-24')!.quantity, 5, 'ghép tồn theo location_id');
  assert.ok(sapo.calls.some(u => u.startsWith('/admin/customers.json?limit=250&page=2')), 'đọc đủ các trang');
  // Chứng từ kho: đơn nhập, điều chuyển, kiểm hàng; quét tồn kho xoay vòng.
  assert.deepEqual([run.data.results.purchase_order.created, run.data.results.stock_transfer.created, run.data.results.stock_adjustment.created], [1, 1, 1]);
  assert.equal(run.data.results.stock.wrapped, 1, 'quét hết vòng tồn kho');
  const docs = await db.select().from(sapoInventoryDocs);
  const po = docs.find(d => d.kind === 'purchase_order')!, tr = docs.find(d => d.kind === 'stock_transfer')!, adj = docs.find(d => d.kind === 'stock_adjustment')!;
  assert.deepEqual([po.code, po.partnerName, po.locationName, po.totalQty, po.totalAmount], ['PON001', 'Minh Long I', 'Kho Q1', 10, 3_000_000]);
  assert.deepEqual([tr.locationName, tr.toLocationName, tr.totalQty], ['Kho Q1', '8', 3]);
  const adjLines = await db.select().from(sapoInventoryDocLines).where(eq(sapoInventoryDocLines.docId, adj.id));
  assert.deepEqual([adj.locationName, adjLines[0]!.qty, adjLines[0]!.diffQty], ['Kho Q1', 4, -1]);
  // Lần sau chỉ lấy bản ghi sửa sau lần trước (gửi kèm bộ lọc modified_on_min).
  sapo.calls.length = 0;
  const cron = await call('/integrations/sapo/pull', '', 'POST', {}, { authorization: 'Bearer ' + SECRET });
  assert.equal(cron.status, 200); assert.equal(cron.data.ok, true);
  assert.ok(sapo.calls.some(u => u.includes('modified_on_min=')));
  assert.equal(cron.data.results.customers.applied ?? 0, 0, 'không có gì mới'); assert.equal(cron.data.results.customers.received, 300, 'bản ghi thiếu mốc thời gian vẫn được xét lại');
  assert.equal((await db.select().from(sapoInventoryDocs)).length, 3, 'đồng bộ lại không tạo trùng chứng từ');
  assert.equal((await call('/integrations/sapo/pull', '', 'POST', {}, {})).status, 401);

  // Phiên hết hạn: báo rõ cho Manager; trang tình trạng hiện "hết hạn"; cookie không bao giờ trả về.
  fake = expiredSapo;
  const bad = await call('/admin/sapo-pull', mgr, 'POST', {});
  assert.equal(bad.status, 409); assert.equal(bad.data.code, 'SAPO_SESSION_EXPIRED');
  assert.match(bad.data.error, /→ 302 \/admin\/login/, 'báo rõ Sapo chuyển về trang đăng nhập (để chẩn đoán)');
  const status = await call('/admin/sapo-sync', mgr);
  assert.equal(status.data.session.connected, true); assert.equal(status.data.session.expired, true);
  assert.ok(!JSON.stringify(status.data).includes('abc'));
  // Lưu phiên mới kiểm tra với Sapo trước: phiên hỏng thì không lưu.
  assert.equal((await call('/admin/sapo-session', mgr, 'POST', { cookie: '_admin_session_id=abc' })).status, 503);
  fake = sapo;
  assert.equal((await call('/admin/sapo-session', mgr, 'DELETE', {})).data.connected, false);
  assert.equal((await db.select().from(sapoRuntimeSessions)).length, 0);
  // Khoá chạy chồng: đang có lượt chạy thì từ chối.
  await call('/admin/sapo-session', mgr, 'POST', { cookie: '_admin_session_id=abc' });
  await db.update(sapoHealthMonitorState).set({ updatedAt: new Date().toISOString() }).where(eq(sapoHealthMonitorState.id, 'pull-lock'));
  assert.equal((await call('/admin/sapo-pull', mgr, 'POST', {})).status, 409);
});

import { mergeSetCookies, decryptCookie } from '../../src/modules/integrations/domain/sapo-session.ts';

test('gộp Set-Cookie của Sapo: thay giá trị, thêm mới, bỏ cookie bị xoá', () => {
  assert.equal(mergeSetCookies('_admin_session_id=old; a=1; b=2', [
    '_admin_session_id=new; Path=/; HttpOnly', 'c=3; Path=/', 'b=; Max-Age=0', 'a=9; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ]), '_admin_session_id=new; c=3');
  assert.equal(mergeSetCookies('_admin_session_id=x', ['bad name=1', 'evil=1\r\nx']), '_admin_session_id=x');
});

test('giữ phiên Sapo: gọi nhẹ, lưu cookie mới Sapo cấp; hết hạn thì báo; không đè phiên Manager vừa kết nối lại', async () => {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  let mode: 'renew' | 'same' | 'expired' = 'renew';
  const sapoFetch = (async (_: string | URL | Request, init?: RequestInit) => {
    assert.equal(init?.method, 'GET');
    if (mode === 'expired') return new Response('', { status: 302, headers: { location: '/admin/login' } });
    const res = Response.json({ accounts: [] });
    if (mode === 'renew') res.headers.append('set-cookie', '_admin_session_id=moi; Path=/; HttpOnly');
    return res;
  }) as typeof globalThis.fetch;
  const router = createAppRouter(), env = { db, passwordIterations: 1000, sapoOrderPush: 'off' as const, sapoSyncToken: SECRET, sapoFetch };
  const call = async (path: string, cookie = '', method = 'GET', body?: object, headers: Record<string, string> = { origin }) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { 'content-type': 'application/json', cookie, ...headers }, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const mgr = (await call('/login', '', 'POST', { email: 'mgr@x.vn', password: PASSWORD })).cookie;
  mode = 'same';
  assert.equal((await call('/admin/sapo-session', mgr, 'POST', { cookie: '_admin_session_id=cu; khac=1' })).status, 200);
  const stored = async () => decryptCookie(SECRET, (await db.select().from(sapoRuntimeSessions))[0]!.encryptedCookie);
  const ping = () => call('/integrations/sapo/keepalive', '', 'POST', {}, { authorization: 'Bearer ' + SECRET });

  mode = 'renew';
  const r1 = await ping();
  assert.equal(r1.status, 200); assert.equal(r1.data.ok, true); assert.equal(r1.data.refreshed, true);
  assert.equal(await stored(), '_admin_session_id=moi; khac=1');
  mode = 'same';
  assert.equal((await ping()).data.refreshed, false);

  mode = 'expired';
  const r2 = await ping();
  assert.equal(r2.data.ok, false); assert.equal(r2.data.code, 'SAPO_SESSION_EXPIRED');
  assert.equal((await call('/admin/sapo-sync', mgr)).data.session.expired, true);
  assert.equal(await stored(), '_admin_session_id=moi; khac=1', 'phiên hỏng thì giữ nguyên bản đã lưu');
  // Manager kết nối lại: hết báo hết hạn.
  mode = 'same';
  await new Promise(r => setTimeout(r, 5));
  assert.equal((await call('/admin/sapo-session', mgr, 'POST', { cookie: '_admin_session_id=lan2' })).status, 200);
  assert.equal((await call('/admin/sapo-sync', mgr)).data.session.expired, false);
  assert.equal((await call('/integrations/sapo/keepalive', '', 'POST', {}, {})).status, 401);
});

test('kết nối lại Sapo: lỗi của lần đồng bộ trước đó không còn hiện', async () => {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  const sapoFetch = (async () => Response.json({ accounts: [] })) as typeof globalThis.fetch;
  const router = createAppRouter(), env = { db, passwordIterations: 1000, sapoOrderPush: 'off' as const, sapoSyncToken: SECRET, sapoFetch };
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { 'content-type': 'application/json', origin, cookie }, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const mgr = (await call('/login', '', 'POST', { email: 'mgr@x.vn', password: PASSWORD })).cookie;
  // Phiên lưu bằng mã cũ (không giải mã được) → lần đồng bộ báo lỗi.
  await db.insert(sapoRuntimeSessions).values({ id: 'active', encryptedCookie: 'hong.hong', updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'mgr' });
  assert.equal((await call('/admin/sapo-pull', mgr, 'POST', {})).status, 409);
  assert.equal((await call('/admin/sapo-sync', mgr)).data.pull.stale, false);
  await new Promise(r => setTimeout(r, 5));
  assert.equal((await call('/admin/sapo-session', mgr, 'POST', { cookie: '_admin_session_id=moi' })).status, 200);
  const st = (await call('/admin/sapo-sync', mgr)).data;
  assert.equal(st.pull.ok, false); assert.equal(st.pull.stale, true, 'lỗi cũ được đánh dấu đã qua');
});

test('kéo từ Sapo: loại chứng từ Sapo không cho đọc (404/403) thì ghi cảnh báo, các phần khác vẫn đồng bộ', async () => {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  const sapoFetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input)), key = url.pathname.replace(/^\/admin\//, '').replace(/\.json$/, '');
    if (key === 'stock_adjustments') return new Response('', { status: 404 });
    if (key === 'stock_transfers') return new Response('', { status: 403 });
    return Response.json({ [key]: key === 'purchase_orders' ? [{ id: 1, code: 'PO1', line_items: [] }] : [] });
  }) as typeof globalThis.fetch;
  const router = createAppRouter(), env = { db, passwordIterations: 1000, sapoOrderPush: 'off' as const, sapoSyncToken: SECRET, sapoFetch };
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { 'content-type': 'application/json', cookie, origin }, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const mgr = (await call('/login', '', 'POST', { email: 'mgr@x.vn', password: PASSWORD })).cookie;
  await call('/admin/sapo-session', mgr, 'POST', { cookie: '_admin_session_id=abc' });
  const run = await call('/admin/sapo-pull', mgr, 'POST', {});
  assert.equal(run.status, 200, JSON.stringify(run.data));
  assert.equal(run.data.results.purchase_order.created, 1);
  assert.equal(run.data.results.stock_adjustment.unavailable, 1);
  assert.equal(run.data.results.stock_transfer.unavailable, 1);
  assert.equal(run.data.warnings.length, 2);
});

test('kết nối Sapo chỉ với cookie sapo-admin: tự mở trang admin lấy _admin_session_id rồi mới gọi API, lưu cookie đã gộp', async () => {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  const seen: string[] = [];
  // Sapo mới: API .json cần _admin_session_id; cookie đó chỉ được cấp (Set-Cookie) khi mở trang admin bằng sapo-admin.
  const sapoFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input)), cookie = String((init?.headers as Record<string, string>).cookie);
    seen.push(url.pathname);
    assert.equal(init?.method, 'GET');
    const hasSid = /_admin_session_id=sid1/.test(cookie);
    if (url.pathname === '/admin') {
      if (!/sapo-admin=tok/.test(cookie)) return new Response('', { status: 302, headers: { location: '/admin/login' } });
      const res = new Response('', { status: 302, headers: { location: '/admin/dashboard' } });
      res.headers.append('set-cookie', '_admin_session_id=sid1; expires=Sat, 10 Oct 2099 22:10:53 GMT; path=/');
      res.headers.append('set-cookie', '.AspNetCore.Session=abc; path=/; samesite=lax; httponly');
      return res;
    }
    if (url.pathname === '/admin/dashboard') return new Response('<html>ok</html>', { status: 200 });
    if (!hasSid) return new Response('', { status: 302, headers: { location: '/admin/login' } });
    return Response.json({ accounts: [] });
  }) as typeof globalThis.fetch;
  const router = createAppRouter(), env = { db, passwordIterations: 1000, sapoOrderPush: 'off' as const, sapoSyncToken: SECRET, sapoFetch };
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { 'content-type': 'application/json', cookie, origin }, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const mgr = (await call('/login', '', 'POST', { email: 'mgr@x.vn', password: PASSWORD })).cookie;
  const r = await call('/admin/sapo-session', mgr, 'POST', { cookie: 'lang=vi; sapo-admin=tok' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(seen, ['/admin', '/admin/accounts.json'], 'có _admin_session_id ngay lần đầu thì không cần theo chuyển hướng');
  const saved = await decryptCookie(SECRET, (await db.select().from(sapoRuntimeSessions))[0]!.encryptedCookie);
  assert.match(saved, /sapo-admin=tok/); assert.match(saved, /_admin_session_id=sid1/); assert.match(saved, /\.AspNetCore\.Session=abc/);
  // sapo-admin sai → Sapo đưa về trang đăng nhập → báo phiên không dùng được, không lưu đè.
  const bad = await call('/admin/sapo-session', mgr, 'POST', { cookie: 'sapo-admin=sai' });
  assert.equal(bad.data.code, 'SAPO_SESSION_EXPIRED');
});
