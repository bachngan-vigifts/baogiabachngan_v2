import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { pricePolicies, productBarcodes, productPrices, products, productStock, warehouses, catalogVersions } from '../../src/modules/catalog/schema.ts';
import { customers } from '../../src/modules/customers/schema.ts';
import { fold } from '../../src/core/text/fold.ts';
import { hydrateSnapshot, matchRanges, searchProducts } from '../../src/modules/catalog/domain/product-search.ts';
import { eq } from 'drizzle-orm';

const origin = 'https://trial.test';
async function setup() {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  const router = createAppRouter();
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }), { db, passwordIterations: 1000, sapoOrderPush: 'off' as const });
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
  await db.insert(productBarcodes).values({ sku: 'LHC4125', barcode: '893000000001' });
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
  // skus=: lấy đúng các mã, kể cả mã đã ngừng bán (để bổ sung ảnh cho dòng báo giá cũ).
  assert.deepEqual((await call('/products?skus=OLD,ML-01,KHONG-CO', emp)).data.products.map((p: any) => p.sku).sort(), ['ML-01', 'OLD']);
  assert.equal((await call('/products/KHONG-CO', emp)).status, 404);
  const exported = await call('/products-export?q=' + encodeURIComponent('binh GIU'), emp);
  assert.equal(exported.status, 200, JSON.stringify(exported.data));
  assert.deepEqual(exported.data.products.map((p: any) => p.sku), ['LHC4125']);
  assert.deepEqual(exported.data.products[0].barcodes, ['893000000001']);
  assert.equal(exported.data.products[0].prices.le, 185000);
  assert.equal(exported.data.products[0].stock.k1, 12);
});

test('khách hàng: tìm không dấu theo tên/điện thoại/MST, phân trang có tổng; lưu mới tạo cột search', async () => {
  const { db, call, emp } = await setup();
  const base = { contact: '', email: '', address: '', search: '', sourceVersion: 0, syncedAt: 'x', taxCode: '', customerCode: '' };
  await db.insert(customers).values([
    { id: 'a', name: 'Công ty Hoa Mai', phone: '0901 234 567', ...base, taxCode: '0312345678' },
    { id: 'b', name: 'Trường Ánh Dương', phone: '0909', ...base },
    ...Array.from({ length: 4 }, (_, i) => ({ id: 'z' + i, name: 'Zeta ' + i, phone: '', ...base })),
    { id: 'u', name: 'Ủy ban phường', phone: '', ...base },
  ]);
  // Sắp xếp theo tên bỏ dấu: "Ủy ban" đứng trước "Zeta", không bị đẩy xuống cuối.
  assert.deepEqual((await call('/customers', emp)).data.customers.map((c: any) => c.id), ['a', 'b', 'u', 'z0', 'z1', 'z2', 'z3']);
  assert.deepEqual((await call('/customers?q=hoa%20mai', emp)).data.customers.map((c: any) => c.id), ['a']);
  assert.deepEqual((await call('/customers?q=anh%20duong', emp)).data.customers.map((c: any) => c.id), ['b']);
  assert.deepEqual((await call('/customers?q=0312345', emp)).data.customers.map((c: any) => c.id), ['a']);
  const page = await call('/customers?limit=2&offset=2', emp);
  assert.equal(page.data.total, 7); assert.deepEqual(page.data.customers.map((c: any) => c.id), ['u', 'z0']);
  const created = await call('/customers', emp, 'POST', { name: 'Đại lý Phúc Lộc', phone: '0911' });
  const [row] = await db.select().from(customers).where((await import('drizzle-orm')).eq(customers.id, created.data.id));
  assert.equal(row!.search, 'dai ly phuc loc 0911');
});

test('nhập danh mục (Manager): tạo bảng giá/kho/sản phẩm; nhập lại thì cập nhật giá/tồn và ẩn mã không còn', async () => {
  const { db, call, emp } = await setup();
  const mgr = (await call('/login', '', 'POST', { email: 'mgr@x.vn', password: PASSWORD })).cookie;
  const file = (products: object[]) => ({ format: 'sapo-catalog-v1', observedAt: '2026-10-06T01:00:00.000Z', warehouses: ['Kho A', 'NCC', 'Hàng chờ về'], pricePolicies: ['Giá bán lẻ', 'Giá sỉ'], products, replaceAll: true, extraField: 1 });
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
    // Cột "Hàng chờ về" trong file bị bỏ qua: tồn kho này do hệ thống tự tính từ Đơn mua NCC.
    ['A', [{ policyId: 'le', price: 100 }, { policyId: 'legacy:Giá sỉ', price: null }], { 'legacy:Kho A': 5 }],
    ['B', [{ policyId: 'le', price: 200 }, { policyId: 'legacy:Giá sỉ', price: null }], {}],
  ]);
  assert.deepEqual(list.warehouses.map((w: any) => [w.name, w.kind]), [['Kho A', 'stock'], ['NCC', 'supplier'], ['Hàng chờ về', 'incoming']]);
  assert.equal(list.observedAt, '2026-10-06T01:00:00.000Z');
  await call('/admin/catalog-import', mgr, 'POST', file([p('A', 150, [7, null, null])]));
  list = (await call('/products', emp)).data;
  assert.deepEqual(list.products.map((x: any) => [x.sku, x.prices[0].price, x.stock]), [['A', 150, { 'legacy:Kho A': 7 }]]);
  assert.equal(list.total, 1); // B không còn trong file → ẩn
});

test('nhập lại danh mục: giá/tồn theo file mới, không sinh dòng trùng, ẩn rồi hiện lại sản phẩm, đổi thứ tự bảng giá/kho', async () => {
  const { db, call, emp } = await setup();
  const mgr = (await call('/login', '', 'POST', { email: 'mgr@x.vn', password: PASSWORD })).cookie;
  const count = async (table: any) => (await db.select().from(table)).length;
  const imp = async (warehouses: string[], pricePolicies: string[], products: object[]) => {
    const r = await call('/admin/catalog-import', mgr, 'POST', { format: 'sapo-catalog-v1', observedAt: new Date().toISOString(), warehouses, pricePolicies, products, replaceAll: true });
    assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data;
  };
  const prod = (sku: string, name: string, prices: (number | null)[], stock: (number | null)[]) => ({ sku, name, brand: 'B', pattern: '', unit: 'cái', image: '', taxBasis: '', taxable: false, taxIn: null, taxOut: null, prices, stock });

  // Lần 1: 3 mã, 2 bảng giá, 2 kho.
  await imp(['Kho A', 'Kho B'], ['Lẻ', 'Sỉ'], [prod('A', 'Áo', [100, 90], [1, 2]), prod('B', 'Bút', [200, null], [null, 5]), prod('C', 'Cốc', [300, 280], [0, 0])]);
  assert.deepEqual([await count(products), await count(productPrices), await count(productStock), await count(pricePolicies), await count(warehouses)], [3, 6, 5, 2, 2]);

  // Lần 2 (cùng file): không sinh thêm dòng nào.
  await imp(['Kho A', 'Kho B'], ['Lẻ', 'Sỉ'], [prod('A', 'Áo', [100, 90], [1, 2]), prod('B', 'Bút', [200, null], [null, 5]), prod('C', 'Cốc', [300, 280], [0, 0])]);
  assert.deepEqual([await count(products), await count(productPrices), await count(productStock), await count(pricePolicies), await count(warehouses)], [3, 6, 5, 2, 2]);
  assert.equal((await db.select().from(catalogVersions)).filter(v => v.isCurrent).length, 1);
  assert.equal(await count(catalogVersions), 2);

  // Lần 3: đổi giá/tồn/tên, xoá tồn một kho (null), bỏ C, thêm D, đảo thứ tự bảng giá và kho, bỏ kho B, thêm kho C.
  await imp(['Kho C', 'Kho A'], ['Sỉ', 'Lẻ'], [prod('A', 'Áo mới', [95, 110], [7, null]), prod('B', 'Bút', [null, 210], [3, 4]), prod('D', 'Dao', [50, 60], [null, 9])]);
  const list = (await call('/products', emp)).data;
  assert.deepEqual(list.policies.map((p: any) => p.name), ['Sỉ', 'Lẻ']);
  assert.deepEqual(list.warehouses.map((w: any) => w.name), ['Kho C', 'Kho A']); // Kho B ngừng dùng
  const bySku = Object.fromEntries(list.products.map((p: any) => [p.sku, p]));
  assert.deepEqual(Object.keys(bySku).sort(), ['A', 'B', 'D']); // C bị ẩn
  const price = (sku: string, name: string) => bySku[sku].prices.find((x: any) => x.policyId === list.policies.find((p: any) => p.name === name).id)?.price;
  const stock = (sku: string, name: string) => bySku[sku].stock[list.warehouses.find((w: any) => w.name === name).id];
  assert.equal(bySku.A.name, 'Áo mới');
  assert.deepEqual([price('A', 'Sỉ'), price('A', 'Lẻ'), price('B', 'Sỉ'), price('B', 'Lẻ'), price('D', 'Lẻ')], [95, 110, null, 210, 60]);
  assert.deepEqual([stock('A', 'Kho C'), stock('A', 'Kho A'), stock('B', 'Kho C'), stock('B', 'Kho A'), stock('D', 'Kho A')], [7, undefined, 3, 4, 9]);
  assert.deepEqual(Object.keys(bySku.A.stock).length, 1); // không còn tồn cũ ở kho B
  // Không trùng: mỗi (sku, bảng giá) và (sku, kho) đúng một dòng; bảng giá/kho không nhân bản theo tên.
  assert.deepEqual([await count(products), await count(pricePolicies), await count(warehouses)], [4, 2, 3]);
  const keys = (rows: any[], f: (r: any) => string) => new Set(rows.map(f)).size === rows.length;
  assert.ok(keys(await db.select().from(productPrices), r => r.sku + '|' + r.policyId));
  assert.ok(keys(await db.select().from(productStock), r => r.sku + '|' + r.warehouseId));
  assert.equal((await call('/products/C', emp)).data.product.active, false);
  assert.equal((await call('/products?q=coc', emp)).data.total, 0);

  // Lần 4: C quay lại file → hiện lại với giá/tồn mới.
  await imp(['Kho C', 'Kho A'], ['Sỉ', 'Lẻ'], [prod('A', 'Áo mới', [95, 110], [7, null]), prod('C', 'Cốc', [1, 2], [8, 0])]);
  const again = (await call('/products', emp)).data;
  assert.deepEqual(again.products.map((p: any) => p.sku), ['A', 'C']);
  assert.equal((await call('/products?q=coc', emp)).data.products[0].prices.length, 2);
});

test('nhập danh mục lỗi giữa chừng không để lại dữ liệu dở dang', async () => {
  const { db, call } = await setup();
  const mgr = (await call('/login', '', 'POST', { email: 'mgr@x.vn', password: PASSWORD })).cookie;
  const ok = await call('/admin/catalog-import', mgr, 'POST', { format: 'sapo-catalog-v1', warehouses: ['K'], pricePolicies: ['L'], products: [{ sku: 'A', name: 'A', prices: [1], stock: [1] }] });
  assert.equal(ok.status, 200);
  // Giá âm bị chặn ngay ở bước kiểm tra; file trùng mã cũng vậy → không đụng vào DB.
  for (const bad of [[{ sku: 'B', name: 'B', prices: [-1], stock: [1] }], [{ sku: 'B', name: 'B', prices: [1], stock: [1] }, { sku: 'B', name: 'B2', prices: [1], stock: [1] }]]) {
    const r = await call('/admin/catalog-import', mgr, 'POST', { format: 'sapo-catalog-v1', warehouses: ['K'], pricePolicies: ['L'], products: bad });
    assert.equal(r.status, 400);
  }
  assert.deepEqual((await db.select().from(products)).map(p => [p.sku, p.active]), [['A', true]]);
});

test('nhập theo lô: lô thường chỉ cập nhật (không ẩn), lô cuối replaceAll + allSkus mới ẩn mã vắng mặt', async () => {
  const { db, call, emp } = await setup();
  const mgr = (await call('/login', '', 'POST', { email: 'mgr@x.vn', password: PASSWORD })).cookie;
  const base = { format: 'sapo-catalog-v1', warehouses: ['K'], pricePolicies: ['L'] };
  const prod = (sku: string, price: number) => ({ sku, name: 'SP ' + sku, prices: [price], stock: [1] });
  const post = (body: object) => call('/admin/catalog-import', mgr, 'POST', { ...base, ...body });
  assert.equal((await post({ products: [prod('A', 1), prod('B', 1), prod('C', 1)], replaceAll: true })).status, 200);
  // Giao diện cũ (không có replaceAll): gửi lô chỉ có A với giá mới → cập nhật A, KHÔNG ẩn B, C.
  assert.equal((await post({ products: [prod('A', 5)] })).status, 200);
  let list = (await call('/products', emp)).data;
  assert.deepEqual(list.products.map((p: any) => [p.sku, p.prices[0].price]), [['A', 5], ['B', 1], ['C', 1]]);
  assert.equal((await db.select().from(catalogVersions)).length, 1); // lô thường không ghi phiên bản
  // File mới có A, B, D chia 2 lô: lô 1 (A, B) thường; lô cuối (D) replaceAll + allSkus.
  assert.equal((await post({ products: [prod('A', 6), prod('B', 7)] })).status, 200);
  assert.equal((await post({ products: [prod('D', 8)], replaceAll: true, allSkus: ['A', 'B', 'D'] })).status, 200);
  list = (await call('/products', emp)).data;
  assert.deepEqual(list.products.map((p: any) => [p.sku, p.prices[0].price]), [['D', 8], ['A', 6], ['B', 7]], 'mã mới tạo (D) lên đầu');
  const current = (await db.select().from(catalogVersions)).filter(v => v.isCurrent);
  assert.equal(current.length, 1); assert.equal(current[0]!.productCount, 3);
  // allSkus phải chứa mọi mã của lô.
  assert.equal((await post({ products: [prod('E', 1)], replaceAll: true, allSkus: ['A'] })).status, 400);
});

test('tìm nhanh sản phẩm như web cũ: nhóm, khoảng giá theo bảng giá, phạm vi theo loại báo giá, mã SKU chính xác', async () => {
  const { db, call, emp, ncc } = await setup();
  const t = '2026-10-06T00:00:00.000Z';
  await db.insert(pricePolicies).values([{ id: 'le', name: 'Giá bán lẻ', sortOrder: 0 }, { id: 'si', name: 'Giá sỉ', sortOrder: 1 }]);
  await db.insert(products).values([
    { sku: '031199000', name: 'Chén cơm 11.2 cm Jas Lys Trắng Ngà', brand: 'MINH LONG - LYS', updatedAt: t },
    { sku: 'ML-TRA', name: 'Bộ trà Minh Long Daisy', brand: 'MINH LONG', updatedAt: t },
    { sku: 'LHC-LY', name: 'Ly giữ nhiệt Lock&Lock 500ml', brand: 'Lock&Lock', updatedAt: t },
    { sku: 'LHC-BINH', name: 'Bình giữ nhiệt Lock&Lock 1L', brand: 'Lock&Lock', updatedAt: t },
    { sku: 'HC-NOI', name: 'Nồi Healthy Cook 24cm', brand: 'Healthy Cook', updatedAt: t },
    { sku: 'BH-01', name: 'Bình hoa sứ dưỡng sinh', brand: '', updatedAt: t },
  ]);
  await db.insert(productPrices).values([
    { sku: '031199000', policyId: 'le', price: 23000 }, { sku: 'ML-TRA', policyId: 'le', price: 1_500_000 },
    { sku: 'LHC-LY', policyId: 'le', price: 350000 }, { sku: 'LHC-LY', policyId: 'si', price: 250000 },
    { sku: 'LHC-BINH', policyId: 'le', price: 650000 }, { sku: 'HC-NOI', policyId: 'le', price: 2_500_000 },
  ]);
  const skus = async (qs: string) => { const r = await call('/products?' + qs, emp); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.products.map((p: any) => p.sku).sort(); };
  // Phạm vi: HRC/B2B = Minh Long (cả Healthy Cook, sứ dưỡng sinh); VIGIFTS = phần còn lại.
  assert.deepEqual(await skus('scope=minhlong'), ['031199000', 'BH-01', 'HC-NOI', 'ML-TRA']);
  assert.deepEqual(await skus('scope=other'), ['LHC-BINH', 'LHC-LY']);
  // Gõ đúng mã thì vẫn ra dù khác phạm vi, và đứng đầu.
  assert.deepEqual(await skus('scope=minhlong&q=lhc-ly'), ['LHC-LY']);
  // Nhóm sản phẩm theo tên (bỏ dấu, đúng từ).
  assert.deepEqual(await skus('group=thermalCup'), ['LHC-LY']);
  assert.deepEqual(await skus('group=thermalBottle'), ['LHC-BINH']);
  assert.deepEqual(await skus('group=tableware'), ['031199000']);
  assert.deepEqual(await skus('group=tea'), ['ML-TRA']);
  assert.deepEqual(await skus('group=vase'), ['BH-01']);
  assert.deepEqual(await skus('group=cookware'), ['HC-NOI']);
  assert.deepEqual(await skus('group=khong-co'), ['031199000', 'BH-01', 'HC-NOI', 'LHC-BINH', 'LHC-LY', 'ML-TRA']);
  // Khoảng giá theo bảng giá đang chọn; sản phẩm chưa có giá ở bảng đó thì không khớp.
  assert.deepEqual(await skus('policy=le&min=300000&max=1000000'), ['LHC-BINH', 'LHC-LY']);
  assert.deepEqual(await skus('policy=si&max=300000'), ['LHC-LY']);
  assert.deepEqual(await skus('policy=le&min=2000000'), ['HC-NOI']);
  assert.equal((await call('/products?policy=le&min=5&max=1', emp)).status, 400);
  assert.equal((await call('/products?policy=le&min=-1', emp)).status, 400);

  // Lọc trên trình duyệt (bản chụp danh mục) phải ra ĐÚNG như máy chủ, cả thứ tự.
  await db.insert(warehouses).values([{ id: 'k1', name: 'Kho Q1', sortOrder: 0 }]);
  await db.insert(productStock).values([{ sku: 'LHC-LY', warehouseId: 'k1', quantity: 7, updatedAt: '2026-10-06T05:00:00.000Z' }]);
  const snap = await call('/catalog-snapshot', emp);
  assert.equal(snap.status, 200);
  assert.equal((await call('/catalog-snapshot?v=' + snap.data.version, emp)).data.unchanged, true);
  assert.equal((await call('/catalog-snapshot', ncc)).status, 403);
  const items = hydrateSnapshot(snap.data);
  const ly = items.find(p => p.sku === 'LHC-LY')!;
  assert.deepEqual([ly.prices, ly.stock, ly.stockUpdatedAt], [{ le: 350000, si: 250000 }, { k1: 7 }, '2026-10-06T05:00:00.000Z']);
  const cases = ['', 'q=binh', 'q=lhc-ly', 'q=LHC-LY&scope=minhlong', 'q=giu nhiet', 'q=minh long', 'q=031199000&scope=other', 'scope=minhlong', 'scope=other',
    'group=thermalCup', 'group=tableware&scope=minhlong', 'group=tea', 'group=khong-co', 'policy=le&min=300000&max=1000000', 'policy=si&max=300000',
    'policy=le&min=2000000', 'policy=le&max=30000&scope=minhlong', 'q=bo&group=tea&scope=minhlong'];
  for (const qs of cases) {
    const server = (await call('/products?limit=200&' + qs, emp)).data.products.map((p: any) => p.sku);
    const o = Object.fromEntries(new URLSearchParams(qs));
    assert.deepEqual(searchProducts(items, o)!.map(p => p.sku), server, qs);
  }
  assert.equal(searchProducts(items, { policy: 'le', min: 5, max: 1 }), null);
  // Sản phẩm/giá/tồn đổi → phiên bản đổi.
  await db.update(productStock).set({ quantity: 8 }).where(eq(productStock.sku, 'LHC-LY'));
  const delta = (await call('/catalog-snapshot?v=' + snap.data.version, emp)).data;
  assert.notEqual(delta.version, snap.data.version);
  // Chỉ tồn đổi: trả riêng tồn theo mã, không tải lại cả danh mục.
  assert.equal(delta.stockOnly, true); assert.equal(delta.products, undefined);
  assert.deepEqual(delta.stock.find((r: any[]) => r[0] === 'LHC-LY'), ['LHC-LY', [8], '2026-10-06T05:00:00.000Z']);
});

test('tìm sản phẩm xếp theo mức liên quan (không theo bảng chữ cái); "0.5l" khớp "0.5 L"; trình duyệt ra đúng như máy chủ', async () => {
  const { db, call, emp } = await setup();
  const t = '2026-10-22T00:00:00.000Z';
  await db.insert(products).values([
    { sku: '01503801403', name: 'Bộ trà 0.5 L Came VCV (01503801403)', brand: 'Minh Long', unit: 'bộ', updatedAt: t },
    { sku: '01503801500', name: 'Bộ trà 0.5 L Jasmine Hoàng Cung', brand: 'Minh Long', unit: 'bộ', updatedAt: t },
    { sku: 'LHC4282DBRW_C', name: 'LHC4282DBRW_C - Ca nước giữ nhiệt 1.2L', brand: 'Lock&Lock', unit: 'cái', updatedAt: t },
    { sku: 'TL-01', name: 'Tách trà Lys Trắng Ngà', brand: 'LYS', unit: 'cái', updatedAt: t },
    { sku: 'ML-LY-02', name: 'Bộ ly sứ 6 món', brand: 'Minh Long', unit: 'bộ', updatedAt: t },
    { sku: 'LY-500', name: 'Ly thủy tinh 500ml', brand: 'Khác', unit: 'cái', updatedAt: t },
    { sku: 'HOP', name: 'Hộp đựng bộ trà cao cấp', brand: 'Khác', unit: 'cái', updatedAt: t },
    { sku: 'XA', name: 'Bình hoa mai trang trí', brand: 'Khác', unit: 'cái', updatedAt: t },
  ]);
  const skus = async (q: string) => (await call('/products?limit=50&q=' + encodeURIComponent(q), emp)).data.products.map((p: any) => p.sku);
  // Tên bắt đầu bằng cụm gõ lên trước, rồi tên chứa nguyên cụm; không còn xếp A→Z làm "Bình hoa…" lên đầu. Cùng hạng, cùng lúc tạo: theo tên.
  assert.deepEqual((await skus('bo tra')).slice(0, 3), ['01503801403', '01503801500', 'HOP']);
  assert.deepEqual((await skus('0.5l')).sort(), ['01503801403', '01503801500'], '"0.5l" khớp "0.5 L"');
  assert.deepEqual(await skus('bo tra 0.5l came'), ['01503801403']);
  assert.equal((await skus('lhc4282'))[0], 'LHC4282DBRW_C', 'mã gõ thiếu đuôi vẫn lên đầu');
  assert.equal((await skus('LHC-4282'))[0], 'LHC4282DBRW_C', 'gõ có gạch nối vẫn khớp');
  assert.equal((await skus('ly'))[0], 'LY-500', 'tên bắt đầu bằng "ly" trước tên chỉ chứa "ly"');
  assert.deepEqual(await skus('500 ml'), ['LY-500']);
  assert.equal((await skus('01503801403'))[0], '01503801403');
  assert.deepEqual(await skus('ly tra khong co'), []);
  // Gợi ý khi lập báo giá lọc trên trình duyệt: cùng kết quả, cùng thứ tự.
  const items = hydrateSnapshot((await call('/catalog-snapshot', emp)).data);
  for (const q of ['bo tra', '0.5l', 'bo tra 0.5l came', 'lhc4282', 'LHC-4282', 'ly', 'tra', '500 ml', '01503801403', 'minh long', 'giu nhiet 1.2l'])
    assert.deepEqual(searchProducts(items, { q })!.map(p => p.sku), await skus(q), q);
  // Mới tạo lên đầu: không gõ tìm thì mã thêm sau đứng trước; cùng hạng liên quan thì mã mới trước. Sản phẩm cũ (chưa có giờ tạo) theo mã Sapo giảm dần.
  await db.update(products).set({ createdAt: null, sapoProductId: '100' }).where(eq(products.sku, 'XA'));
  await db.update(products).set({ createdAt: null, sapoProductId: '900' }).where(eq(products.sku, 'HOP'));
  await db.insert(products).values({ sku: 'BT-NEW', name: 'Bộ trà 0.7 L Chim Lạc', brand: 'Minh Long', unit: 'bộ', updatedAt: t });
  const all = await skus('');
  assert.equal(all[0], 'BT-NEW', 'không gõ tìm: mới tạo lên đầu');
  assert.deepEqual(all.slice(-2), ['HOP', 'XA'], 'sản phẩm cũ xếp cuối, mã Sapo lớn (tạo sau) trước');
  assert.deepEqual((await skus('bo tra')).slice(0, 3), ['BT-NEW', '01503801403', '01503801500'], 'cùng hạng: mã mới tạo trước');
  const fresh = hydrateSnapshot((await call('/catalog-snapshot', emp)).data);
  for (const q of ['', 'bo tra', 'tra'])
    assert.deepEqual(searchProducts(fresh, { q })!.map(p => p.sku), await skus(q), 'trình duyệt cùng thứ tự: ' + q);
});

test('tìm sản phẩm theo mã vạch (đúng một mã) trên máy chủ; mã vạch không khớp một phần', async () => {
  const { db, call, emp } = await setup();
  const t = '2026-10-23T00:00:00.000Z';
  await db.insert(products).values([{ sku: 'BT-01', name: 'Bình giữ nhiệt 500ml', brand: 'Lock&Lock', unit: 'cái', updatedAt: t }, { sku: 'LY-02', name: 'Ly sứ', brand: 'Minh Long', unit: 'cái', updatedAt: t }]);
  await db.insert(productBarcodes).values({ barcode: '8936086370012', sku: 'BT-01' });
  const skus = async (q: string) => (await call('/products?limit=50&q=' + encodeURIComponent(q), emp)).data.products.map((p: any) => p.sku);
  assert.deepEqual(await skus('8936086370012'), ['BT-01']);
  assert.deepEqual(await skus('893608637'), [], 'mã vạch phải đúng cả mã');
  assert.deepEqual(await skus('binh giu nhiet'), ['BT-01'], 'tìm theo tên vẫn như cũ');
});

test('tô từ khoá: không dấu, không phân biệt hoa thường, gộp đoạn chồng nhau, vị trí theo chuỗi gốc', () => {
  const name = 'Bình giữ nhiệt Lock&Lock 500ml';
  const marked = (q: string) => matchRanges(name, q).map(([a, b]) => name.slice(a, b));
  assert.deepEqual(marked('binh giu'), ['Bình', 'giữ']);
  assert.deepEqual(marked('LOCK'), ['Lock', 'Lock']);
  assert.deepEqual(marked('nhi nhiet'), ['nhiệt'], 'đoạn chồng nhau gộp làm một');
  assert.deepEqual(marked('500'), ['500']);
  assert.deepEqual(matchRanges(name, ''), []);
  assert.deepEqual(matchRanges('LHC4282DBRW_C', 'lhc4282').map(([a, b]) => 'LHC4282DBRW_C'.slice(a, b)), ['LHC4282']);
});

test('lọc tồn tối thiểu trước phân trang: biên, kho chọn, ẩn kho riêng, nguồn NCC/chờ về và sổ kho CRM', async () => {
  const {db,call,emp}=await setup();const at=new Date().toISOString();
  const mgr=(await call('/login','','POST',{email:'mgr@x.vn',password:PASSWORD})).cookie;
  await db.insert(warehouses).values([
    {id:'stk1',name:'Kho Một',kind:'stock'}, {id:'stk2',name:'Kho Hai',kind:'stock'},
    {id:'private',name:'Kho riêng',kind:'stock',stockPrivate:true}, {id:'incoming',name:'Chờ về',kind:'incoming'},
    {id:'supplier',name:'NCC',kind:'supplier'}, {id:'inactive',name:'Kho ngừng',kind:'stock',active:false},
  ]);
  await db.insert(products).values(['A','B','C','D','E','F'].map(sku=>({sku,name:sku,updatedAt:at})));
  await db.insert(productStock).values([
    {sku:'A',warehouseId:'stk1',quantity:9}, {sku:'B',warehouseId:'stk1',quantity:10},
    {sku:'C',warehouseId:'stk1',quantity:20}, {sku:'C',warehouseId:'stk2',quantity:30},
    {sku:'D',warehouseId:'private',quantity:500}, {sku:'D',warehouseId:'incoming',quantity:900},
    {sku:'D',warehouseId:'supplier',quantity:900}, {sku:'D',warehouseId:'inactive',quantity:900},
    {sku:'F',warehouseId:'stk1',quantity:200},
  ].map(row=>({...row,updatedAt:at})));
  const ids=(r:any)=>r.data.products.map((p:any)=>p.sku);
  const first=await call('/products?minStock=10&limit=1',emp);assert.equal(first.status,200);assert.equal(first.data.total,3);assert.deepEqual(ids(first),['B']);
  const next=await call('/products?minStock=10&limit=1&offset=1',emp);assert.equal(next.data.total,3);assert.deepEqual(ids(next),['C']);
  const selected=await call('/products?minStock=50&stockWarehouse=stk1',emp);assert.deepEqual(ids(selected),['F']);
  assert.deepEqual(ids(await call('/products?minStock=50',emp)),['C','F']);
  assert.deepEqual(ids(await call('/products?minStock=200',emp)),['F']);
  assert.deepEqual(ids(await call('/products?minStock=500',mgr)),['D']);
  assert.deepEqual(ids(await call('/products?minStock=0',emp)),['A','B','C','D','E','F']);
  for(const bad of ['-1','NaN','Infinity','1000000000001'])assert.equal((await call('/products?minStock='+bad,emp)).status,400);
  for(const bad of ['private','incoming','supplier','inactive','missing'])assert.equal((await call('/products?minStock=10&stockWarehouse='+bad,emp)).status,400);
  const {quotations}=await import('../../src/modules/quotes/schema.ts');
  const {stockHolds}=await import('../../src/modules/sales/schema.ts');
  await db.insert(quotations).values({id:'q-min',quoteNo:'BG-min',quoteType:'HRC',creatorId:'emp',customer:'Khách',data:'{}',createdAt:at,updatedAt:at});
  await db.insert(stockHolds).values({id:'hold-min',quoteId:'q-min',sku:'C',qty:10,expiresAt:'2099-01-01T00:00:00.000Z',createdBy:'emp',createdAt:at});
  assert.deepEqual(ids(await call('/products?minStock=50',emp)),['F']);
  assert.deepEqual(ids(await call('/products?minStock=30&stockWarehouse=stk2',emp)),['C']);
  const {stockMoves,stockBalances}=await import('../../src/modules/inventory/schema.ts');
  await db.insert(stockMoves).values({id:'open1',sku:'B',warehouseId:'stk1',qty:1,kind:'opening',refType:'opening',refId:'open1',createdBy:'mgr',createdAt:at});
  await db.insert(stockBalances).values({sku:'B',warehouseId:'stk1',qty:7,updatedAt:at});
  assert.deepEqual(ids(await call('/products?minStock=10&stockWarehouse=stk1',emp)),[]);
  assert.deepEqual(ids(await call('/products?minStock=7&stockWarehouse=stk1',emp)),['B']);
  assert.equal((await call('/products?minStock=7&stockWarehouse=stk1',emp)).data.products[0].filteredStock,7);
});
