import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from '../helpers/pos-fixture.ts';
import { productBarcodes, products, productPrices } from '../../src/modules/catalog/schema.ts';

test('Barcode file: Manager preview trước khi lưu, giữ số 0, nhận POS; không đổi giá/tồn, barcode cũ còn dùng', async () => {
  const f = await setup();
  await f.db.insert(productBarcodes).values({ sku: '00123', barcode: 'OLD00123' });
  const body = { filename: 'barcode.csv', rows: [{ sku: '00123', barcode: '0001234567890', rowNumber: 5 }, { sku: '00123', barcode: '0001234567890', rowNumber: 6 }] };
  for (const role of [f.emp, f.ncc, '']) assert.notEqual((await f.call('/admin/product-barcodes/preview', role, 'POST', body)).status, 200);
  assert.equal((await f.call('/admin/product-barcodes/apply', f.mgr, 'POST', body)).status, 400);
  const before = await f.db.select().from(productPrices);
  const preview = await f.call('/admin/product-barcodes/preview', f.mgr, 'POST', body);
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
  assert.equal(preview.data.added, 1); assert.equal(preview.data.duplicates, 1); assert.equal(preview.data.issueCount, 0);
  assert.equal((await f.db.select().from(productBarcodes)).length, 1, 'Preview chỉ đọc');
  const saved = await f.call('/admin/product-barcodes/apply', f.mgr, 'POST', { ...body, version: preview.data.version });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.deepEqual((await f.db.select().from(productBarcodes)).map(r => r.barcode).sort(), ['0001234567890', 'OLD00123']);
  assert.deepEqual(await f.db.select().from(productPrices), before);
  const result = await f.call('/pos/catalog?registerId=' + f.registerId + '&q=0001234567890', f.emp);
  assert.equal(result.status, 200); assert.equal(result.data.products[0].sku, '00123'); assert.equal(result.data.products[0].available, 10);
  const repeat = await f.call('/admin/product-barcodes/preview', f.mgr, 'POST', body);
  assert.equal(repeat.data.added, 0); assert.equal(repeat.data.existing, 1);
});

test('Barcode file: mã không có/trùng SKU/đã gắn sản phẩm khác chặn toàn file; kiểm version tránh ghi đè', async () => {
  const f = await setup();
  await f.db.insert(products).values({ sku: 'OTHER', name: 'Tên chứa 0001234567890', unit: 'cái', updatedAt: new Date().toISOString() });
  await f.db.insert(productPrices).values({ sku: 'OTHER', policyId: 'retail-vat', price: 10000 });
  await f.db.insert(productBarcodes).values({ sku: 'OTHER', barcode: 'TAKEN' });
  for (const row of [{ sku: 'missing', barcode: 'FREE' }, { sku: '00123', barcode: 'OTHER' }, { sku: '00123', barcode: 'TAKEN' }]) {
    const b = { filename: 'test.csv', rows: [{ sku: '00123', barcode: 'VALID' }, row] };
    const p = await f.call('/admin/product-barcodes/preview', f.mgr, 'POST', b);
    assert.equal(p.status, 200); assert.equal(p.data.issueCount, 1);
    assert.equal((await f.call('/admin/product-barcodes/apply', f.mgr, 'POST', { ...b, version: p.data.version })).status, 409);
    assert.equal((await f.db.select().from(productBarcodes)).length, 1);
  }
  const clash = await f.call('/admin/product-barcodes/preview', f.mgr, 'POST', { filename: 'x.csv', rows: [{ sku: '00123', barcode: 'SAME' }, { sku: 'OTHER', barcode: 'SAME' }] });
  assert.equal(clash.data.issueCount, 1);
  const b = { filename: 'x.csv', rows: [{ sku: '00123', barcode: 'CHANGED' }] }, p = await f.call('/admin/product-barcodes/preview', f.mgr, 'POST', b);
  await f.db.insert(productBarcodes).values({ sku: 'OTHER', barcode: 'CHANGED' });
  assert.equal((await f.call('/admin/product-barcodes/apply', f.mgr, 'POST', { ...b, version: p.data.version })).status, 409);
  for (const barcode of ['', 'two words', 'é']) assert.equal((await f.call('/admin/product-barcodes/preview', f.mgr, 'POST', { filename: 'x', rows: [{ sku: '00123', barcode }] })).status, 400);
  await f.db.insert(productBarcodes).values({ sku: '00123', barcode: '0001234567890' });
  assert.equal((await f.call('/pos/barcodes', f.mgr, 'POST', { sku: '00123', barcode: 'OTHER' })).status, 409);
  const found = await f.call('/pos/catalog?registerId=' + f.registerId + '&q=0001234567890', f.emp);
  assert.deepEqual(found.data.products.map((r: any) => r.sku), ['00123'], 'Barcode chính xác ưu tiên tên hàng chứa cùng chữ số');
  await f.db.insert(productBarcodes).values({ sku: '00123', barcode: 'OTHER' });
  assert.equal((await f.call('/pos/catalog?registerId=' + f.registerId + '&q=OTHER', f.emp)).status, 409, 'Dữ liệu cũ lẫn SKU/barcode phải báo xung đột');
});
