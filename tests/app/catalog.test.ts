import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { pricePolicies, productPrices, products, productStock, warehouses, catalogVersions } from '../../src/modules/catalog/schema.ts';
import { customers } from '../../src/modules/customers/schema.ts';
import { fold } from '../../src/core/text/fold.ts';

const origin = 'https://trial.test';
async function setup() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  const router = createAppRouter();
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), { db, passwordIterations: 1000 });
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const login = async (email: string) => (await call('/login', '', 'POST', { email, password: PASSWORD })).cookie;
  return { db, call, emp: await login('emp@x.vn'), ncc: await login('ncc@x.vn') };
}

test('fold: bỏ dấu tiếng Việt, chữ thường, gộp khoảng trắng', () => {
  assert.equal(fold('  Bình GIỮ   nhiệt Đà Nẵng '), 'binh giu nhiet da nang');
  assert.equal(fold('Ỷ Ỵ Ữ'), 'y y u');
});

test('sản phẩm: tìm không dấu nhiều từ, lọc thương hiệu, phân trang, kèm giá & tồn; NCC bị chặn', async () => {
  const { db, call, emp, ncc } = await setup();
  const t = '2026-10-06T00:00:00.000Z';
  await db.insert(pricePolicies).values([{ id: 'le', name: 'Giá bán lẻ', sortOrder: 0 }, { id: 'si', name: 'Giá sỉ', sortOrder: 1 }]);
  await db.insert(warehouses).values([{ id: 'k1', name: 'Kho Q1', sortOrder: 0 }, { id: 'hcv', name: 'Hàng chờ về', kind: 'incoming', sortOrder: 9 }]);
  await db.insert(products).values([
    { sku: 'LHC4125', name: 'Bình giữ nhiệt 500ml', brand: 'Lock&Lock', unit: 'cái', updatedAt: t },
    { sku: 'ML-01', name: 'Bộ ly sứ Minh Long', brand: 'Minh Long', unit: 'bộ', updatedAt: t },
    { sku: 'OLD', name: 'Bình cũ ngừng bán', brand: 'Lock&Lock', active: false, updatedAt: t },
    ...Array.from({ length: 5 }, (_, i) => ({ sku: 'X' + i, name: 'Hộp quà ' + i, brand: 'Khác', updatedAt: t })),
  ]);
  await db.insert(productPrices).values([{ sku: 'LHC4125', policyId: 'le', price: 185000 }, { sku: 'LHC4125', policyId: 'si', price: null }]);
  await db.insert(productStock).values([{ sku: 'LHC4125', warehouseId: 'k1', quantity: 12, updatedAt: t }]);
  await db.insert(catalogVersions).values({ id: 'v1', observedAt: t, productCount: 8, isCurrent: true, createdBy: 'mgr', createdAt: t });

  assert.equal((await call('/products', ncc)).status, 403);
  const hit = await call('/products?q=' + encodeURIComponent('binh GIU'), emp);
  assert.equal(hit.status, 200, JSON.stringify(hit.data));
  assert.deepEqual(hit.data.products.map((p: any) => p.sku), ['LHC4125']);
  assert.deepEqual(hit.data.products[0].prices, [{ policyId: 'le', price: 185000 }, { policyId: 'si', price: null }]);
  assert.deepEqual(hit.data.products[0].stock, { k1: 12 });
  assert.deepEqual(hit.data.policies.map((p: any) => p.name), ['Giá bán lẻ', 'Giá sỉ']);
  assert.equal(hit.data.observedAt, t);
  assert.deepEqual((await call('/products?q=lhc4125', emp)).data.products.map((p: any) => p.sku), ['LHC4125']);
  assert.deepEqual((await call('/products?brand=' + encodeURIComponent('Minh Long'), emp)).data.products.map((p: any) => p.sku), ['ML-01']);
  assert.equal((await call('/products?q=' + encodeURIComponent('100%_'), emp)).data.total, 0);
  const page = await call('/products?limit=3&offset=3', emp);
  assert.equal(page.data.total, 7); assert.equal(page.data.products.length, 3);
  assert.deepEqual((await call('/product-brands', emp)).data.brands, [{ name: 'Khác', count: 5 }, { name: 'Lock&Lock', count: 1 }, { name: 'Minh Long', count: 1 }]);
  assert.equal((await call('/products/ML-01', emp)).data.product.name, 'Bộ ly sứ Minh Long');
  assert.equal((await call('/products/KHONG-CO', emp)).status, 404);
});

test('khách hàng: tìm không dấu theo tên/điện thoại/MST, phân trang có tổng; lưu mới tạo cột search', async () => {
  const { db, call, emp } = await setup();
  const base = { contact: '', email: '', address: '', search: '', sourceVersion: 0, syncedAt: 'x', taxCode: '', customerCode: '' };
  await db.insert(customers).values([
    { id: 'a', name: 'Công ty Hoa Mai', phone: '0901 234 567', ...base, taxCode: '0312345678' },
    { id: 'b', name: 'Trường Ánh Dương', phone: '0909', ...base },
    ...Array.from({ length: 4 }, (_, i) => ({ id: 'z' + i, name: 'Zeta ' + i, phone: '', ...base })),
  ]);
  assert.deepEqual((await call('/customers?q=hoa%20mai', emp)).data.customers.map((c: any) => c.id), ['a']);
  assert.deepEqual((await call('/customers?q=anh%20duong', emp)).data.customers.map((c: any) => c.id), ['b']);
  assert.deepEqual((await call('/customers?q=0312345', emp)).data.customers.map((c: any) => c.id), ['a']);
  const page = await call('/customers?limit=2&offset=2', emp);
  assert.equal(page.data.total, 6); assert.deepEqual(page.data.customers.map((c: any) => c.id), ['z0', 'z1']);
  const created = await call('/customers', emp, 'POST', { name: 'Đại lý Phúc Lộc', phone: '0911' });
  const [row] = await db.select().from(customers).where((await import('drizzle-orm')).eq(customers.id, created.data.id));
  assert.equal(row!.search, 'dai ly phuc loc 0911');
});

test('nhập danh mục (Manager): tạo bảng giá/kho/sản phẩm; nhập lại thì cập nhật giá/tồn và ẩn mã không còn', async () => {
  const { db, call, emp } = await setup();
  const mgr = (await call('/login', '', 'POST', { email: 'mgr@x.vn', password: PASSWORD })).cookie;
  const file = (products: object[]) => ({ format: 'sapo-catalog-v1', observedAt: '2026-10-06T01:00:00.000Z', warehouses: ['Kho A', 'NCC', 'Hàng chờ về'], pricePolicies: ['Giá bán lẻ', 'Giá sỉ'], products, extraField: 1 });
  const p = (sku: string, le: number | null, stock: (number | null)[]) => ({ sku, name: 'SP ' + sku, brand: 'B', unit: 'cái', image: '', taxBasis: '', taxable: true, taxIn: 8, taxOut: 8, prices: [le, null], stock, incomingQuantity: 0 });
  assert.equal((await call('/admin/catalog-import', emp, 'POST', file([p('A', 1, [1, 0, 0])]))).status, 403);
  assert.equal((await call('/admin/catalog-import', mgr, 'POST', { format: 'khac' })).status, 400);
  assert.equal((await call('/admin/catalog-import', mgr, 'POST', file([{ ...p('A', 1, [1]), }]))).status, 400); // thiếu cột tồn
  await db.insert(pricePolicies).values({ id: 'le', name: 'Giá bán lẻ', sortOrder: 5 }); // đã có sẵn cùng tên → dùng lại id
  await db.insert(warehouses).values({ id: 'cu', name: 'Kho cũ', sortOrder: 0 }); // không có trong file → ngừng dùng
  const first = await call('/admin/catalog-import', mgr, 'POST', file([p('A', 100, [5, null, 2]), p('B', 200, [null, null, null])]));
  assert.equal(first.status, 200, JSON.stringify(first.data)); assert.equal(first.data.count, 2);
  let list = (await call('/products', emp)).data;
  assert.deepEqual(list.products.map((x: any) => [x.sku, x.prices, x.stock]), [
    ['A', [{ policyId: 'le', price: 100 }, { policyId: 'legacy:Giá sỉ', price: null }], { 'legacy:Kho A': 5, 'legacy:Hàng chờ về': 2 }],
    ['B', [{ policyId: 'le', price: 200 }, { policyId: 'legacy:Giá sỉ', price: null }], {}],
  ]);
  assert.deepEqual(list.warehouses.map((w: any) => [w.name, w.kind]), [['Kho A', 'stock'], ['NCC', 'supplier'], ['Hàng chờ về', 'incoming']]);
  assert.equal(list.observedAt, '2026-10-06T01:00:00.000Z');
  await call('/admin/catalog-import', mgr, 'POST', file([p('A', 150, [7, null, null])]));
  list = (await call('/products', emp)).data;
  assert.deepEqual(list.products.map((x: any) => [x.sku, x.prices[0].price, x.stock]), [['A', 150, { 'legacy:Kho A': 7 }]]);
  assert.equal(list.total, 1); // B không còn trong file → ẩn
});
