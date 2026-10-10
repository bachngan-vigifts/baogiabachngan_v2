import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { eq, and } from 'drizzle-orm';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { pricePolicies, productPrices, products, productStock, warehouses, stockImports, stockImportLines } from '../../src/modules/catalog/schema.ts';

test('file: số Việt Nam, dòng ẩn, mã trùng, ô trống, số 0 và quy cách mm → cm', () => {
  const source = readFileSync(new URL('../../trial-ui/product-file.js', import.meta.url), 'utf8').replace(/export /g, '');
  const ctx: any = {}; vm.createContext(ctx); vm.runInContext(source + '; globalThis.parse = parseProductFile; globalThis.header = findHeader;', ctx);
  assert.equal(ctx.header([['Báo cáo'], ['MÃ HÀNG', 'TỒN']]), 1);
  const p = ctx.parse([['SKU', 'Tồn'], ['A', '49,7'], ['A', 10], ['B', ''], ['C', 0], ['D', 999]], 0, { sku: 0, ncc: 1 }, 'stock', [,,,,,{ hidden: true }]);
  assert.deepEqual(JSON.parse(JSON.stringify(p.rows)), [{ sku: 'A', stock: { ncc: 50 } }, { sku: 'C', stock: { ncc: 0 } }]);
  assert.equal(p.hidden, 1); assert.equal(p.duplicates, 1); assert.equal(p.blanks, 1);
  const lock = ctx.parse([['SKU', 'QTY', 'G.W', 'Dài'], ['L', 24, '8,5', 320]], 0, { sku: 0, perCarton: 1, cartonWeight: 2, cartonLength: 3 }, 'packing');
  assert.deepEqual(JSON.parse(JSON.stringify(lock.rows)), [{ sku: 'L', fields: { perCarton: 24, cartonWeight: 8.5, cartonLength: 32 } }]);
  assert.throws(() => ctx.parse([['SKU', 'Tồn'], ['A', 'abc']], 0, { sku: 0, ncc: 1 }, 'stock'));
  assert.throws(() => ctx.parse([['SKU', 'QTY'], ['A', 2], ['a', 3]], 0, { sku: 0, perCarton: 1 }, 'packing'));
  assert.throws(() => ctx.parse([['SKU', 'QTY'], ['A', 2.5]], 0, { sku: 0, perCarton: 1 }, 'packing'));
  assert.throws(() => ctx.parse([['SKU', 'Tồn'], ['A', 1]], -1, { sku: 0, ncc: 1 }, 'stock'));
});

test('Excel thật: đọc mẫu Lock có tiêu đề ghép và file tồn có dòng ẩn', () => {
  const ctx: any = {}; vm.createContext(ctx); vm.runInContext(readFileSync(new URL('../../trial-ui/xlsx.full.min.js', import.meta.url), 'utf8'), ctx);
  const x = ctx.XLSX, ws = x.utils.aoa_to_sheet([['MÃ HÀNG', 'TỒN'], ['A', 0], ['B', 999]]);
  ws['!rows'] = [{}, {}, { hidden: true }]; const book = x.utils.book_new(); x.utils.book_append_sheet(book, ws, 'Tồn');
  const restored = x.read(x.write(book, { type: 'array', bookType: 'xlsx' }), { type: 'array', cellStyles: true });
  const rows = x.utils.sheet_to_json(restored.Sheets['Tồn'], { header: 1, raw: true });
  assert.equal(rows[1][1], 0); assert.equal(restored.Sheets['Tồn']['!rows'][2].hidden, true);
  const csv = x.read('Mã hàng,Tồn\n00123,0', { type: 'string', raw: true });
  assert.equal(x.utils.sheet_to_json(csv.Sheets[csv.SheetNames[0]], { header: 1, raw: true })[1][0], '00123');
});

test('Manager: báo cáo toàn danh mục, nhập tồn/quy cách có xem trước, giữ giá/ảnh, ghi lịch sử và chặn bản cũ', async () => {
  const { db, d1 } = await createTestDb(); await seedStaff(d1); const router = createAppRouter(), origin = 'https://trial.test';
  const call = async (path: string, cookie = '', method = 'GET', body?: object) => {
    const r = await router.handle(new Request(origin + '/api/staff' + path, { method, headers: { origin, cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), { db, passwordIterations: 1000 });
    return { status: r.status, data: await r.json() as any, cookie: r.headers.get('set-cookie')?.split(';')[0] || '' };
  };
  const mgr = (await call('/login', '', 'POST', { email: 'mgr@x.vn', password: PASSWORD })).cookie, emp = (await call('/login', '', 'POST', { email: 'emp@x.vn', password: PASSWORD })).cookie;
  const t = '2026-09-01T00:00:00.000Z';
  await db.insert(pricePolicies).values({ id: 'retail', name: 'Giá bán lẻ' });
  await db.insert(warehouses).values([{ id: 'kho', name: 'Kho VIGIFTS' }, { id: 'ncc', name: 'NCC', kind: 'supplier' }]);
  await db.insert(products).values([{ sku: 'LOCK', name: 'Bình Lock', brand: 'Lock&Lock', imageUrl: 'https://image.test/a.jpg', updatedAt: t }, { sku: 'ML', name: 'Minh Long', brand: 'Minh Long', updatedAt: t }, { sku: 'ZERO', name: 'Có giá 0', updatedAt: t }]);
  await db.insert(productPrices).values([{ sku: 'LOCK', policyId: 'retail', price: 100 }, { sku: 'ZERO', policyId: 'retail', price: 0 }]);
  await db.insert(productStock).values([{ sku: 'LOCK', warehouseId: 'kho', quantity: 10, updatedAt: t }, { sku: 'LOCK', warehouseId: 'ncc', quantity: 50, updatedAt: t }, { sku: 'ML', warehouseId: 'kho', quantity: -2, updatedAt: t }, { sku: 'ZERO', warehouseId: 'kho', quantity: 2, updatedAt: t }]);
  const report = await call('/admin/products/report?policy=retail', mgr);
  assert.equal(report.status, 200, JSON.stringify(report.data)); assert.equal(report.data.summary.totalValue, 1000); assert.equal(report.data.inventory.length, 1); assert.equal(report.data.inventory[0].priced, 2); assert.equal(report.data.summary.missingPrice, 1); assert.equal(report.data.summary.negativeStock, 1);
  assert.equal((await call('/admin/products/report', emp)).status, 403);
  const stock = { filename: 'ton.xlsx', observedAt: '2026-10-01T00:00:00.000Z', rows: [{ sku: 'lock', stock: { ncc: 0 } }, { sku: 'UNKNOWN', stock: { ncc: 5 } }] };
  assert.equal((await call('/admin/products/import/stock/preview', emp, 'POST', stock)).status, 403);
  assert.equal((await call('/admin/products/import/stock/apply', mgr, 'POST', stock)).status, 400);
  const preview = await call('/admin/products/import/stock/preview', mgr, 'POST', stock);
  assert.equal(preview.status, 200, JSON.stringify(preview.data)); assert.equal(preview.data.matched, 1); assert.equal(preview.data.unknownCount, 1); assert.equal(preview.data.samples[0].before, 50);
  const applied = await call('/admin/products/import/stock/apply', mgr, 'POST', { ...stock, version: preview.data.version });
  assert.equal(applied.status, 200, JSON.stringify(applied.data));
  assert.equal((await db.select().from(productStock).where(and(eq(productStock.sku, 'LOCK'), eq(productStock.warehouseId, 'ncc'))))[0]!.quantity, 0);
  assert.equal((await db.select().from(stockImports)).length, 1); assert.equal((await db.select().from(stockImportLines)).length, 1);
  assert.equal((await call('/admin/products/import/stock/apply', mgr, 'POST', { ...stock, version: preview.data.version })).status, 409);
  assert.equal((await call('/admin/products/import/stock/preview', mgr, 'POST', { ...stock, observedAt: '2026-09-01T00:00:00.000Z' })).status, 409);
  const pack = { filename: 'lock.xlsx', rows: [{ sku: 'LOCK', fields: { perCarton: 24, cartonLength: 32 } }, { sku: 'ML', fields: { perCarton: 12 } }] };
  const pp = await call('/admin/products/import/packing/preview', mgr, 'POST', pack); assert.equal(pp.status, 200, JSON.stringify(pp.data)); assert.equal(pp.data.notLockCount, 1);
  const changed = await call('/admin/products/import/packing/apply', mgr, 'POST', { ...pack, rows: [{ sku: 'LOCK', fields: { perCarton: 25 } }], version: pp.data.version }); assert.equal(changed.status, 409);
  assert.equal((await call('/admin/products/import/packing/apply', mgr, 'POST', { ...pack, version: pp.data.version })).status, 200);
  const p = (await db.select().from(products).where(eq(products.sku, 'LOCK')))[0]!;
  assert.equal(p.perCarton, 24); assert.equal(p.cartonLength, 32); assert.equal(p.cartonWeight, null); assert.equal(p.imageUrl, 'https://image.test/a.jpg');
  assert.equal((await db.select().from(productPrices).where(eq(productPrices.sku, 'LOCK')))[0]!.price, 100);
  assert.equal((await db.select().from(products).where(eq(products.sku, 'UNKNOWN'))).length, 0);
});
