import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../../trial-ui/app.js', import.meta.url), 'utf8');
const render = source.slice(source.indexOf('function renderProducts()'), source.indexOf('function renderSelection()'));
const stockHelpers = source.slice(source.indexOf('const kindStock ='), source.indexOf("document.addEventListener('click', e => { const b = e.target.closest('[data-incoming-sku]')"));
function harness() {
  const elements: Record<string, any> = {};
  const $ = (id: string) => elements[id] ||= { hidden: false, textContent: '', innerHTML: '', title: '' };
  const p = { sku: 'L1', name: 'Product', brand: 'Lock', unit: 'Cái', stock: { a: 10, b: 5, incoming: 7, supplier: 30 } };
  const ctx: any = {
    $, state: { products: [p], productQuery: '', productBrand: '', productMinStock: '', productWarehouse: '', productTotal: 1, selected: new Set(), holdsLoaded: true,
      warehouses: [{ id: 'a', kind: 'stock', name: 'Kho A' }, { id: 'b', kind: 'stock', name: 'Kho B' }, { id: 'incoming', kind: 'incoming' }, { id: 'supplier', kind: 'supplier' }] },
    productPrice: () => 100, heldQty: () => 3, availableStock: () => 12, stockDetail: () => 'Kho A: 10; Kho B: 5',
    fmtNum: (n: number) => String(n), esc: (s: unknown) => String(s ?? ''), thumb: () => '', markWords: (s: string) => s,
    seesPrices: () => true, money: (n: number) => String(n), canUpdateProducts: () => true, can: () => true,
    hasSupplierStock: (p: any) => p.brand === 'Lock', renderSelection() {}, productPager: { render() {} }, skeleton: (n: number) => `skeleton:${n}`,
  };
  runInNewContext(stockHelpers + render + '\nthis.renderProducts = renderProducts;', ctx);
  const cell = (label: string) => {
    const html = $('#product-list').innerHTML;
    return html.match(new RegExp(`<td[^>]*data-label="${label}"[^>]*>([\\s\\S]*?)</td>`))?.[1];
  };
  return { ctx, $, p, cell };
}

test('three quantities reuse loaded data and keep the existing available-stock number', () => {
  const { ctx, $, cell } = harness();
  ctx.renderProducts();
  assert.equal(cell('Tồn'), '12', 'do not subtract the 3 held units again');
  assert.equal(cell('Đang tạm giữ'), '3');
  assert.match(cell('Hàng đang về')!, /data-incoming-sku="L1"[^>]*>7<\/button>/);
  assert.equal(cell('Tồn NCC'), '30');
  assert.equal(($('#product-list').innerHTML.match(/<td\b/g) || []).length, 10);
  assert.match($('#product-stock-head').title, /khả dụng/);
});

test('warehouse filter keeps warehouse stock and explicitly marks holds as global', () => {
  const { ctx, $, cell } = harness();
  ctx.state.productWarehouse = 'a';
  ctx.renderProducts();
  assert.equal(cell('Tồn'), '10');
  assert.equal(cell('Đang tạm giữ'), '3');
  assert.match($('#product-list').innerHTML, /Tổng số đang giữ trên tất cả kho/);
  assert.equal(cell('Tồn NCC'), '30');
});

test('unknown holds and missing incoming/supplier stock are not presented as zero', () => {
  const { ctx, p, cell } = harness();
  ctx.state.holdsLoaded = false;
  delete (p.stock as any).incoming;
  delete (p.stock as any).supplier;
  ctx.renderProducts();
  assert.equal(cell('Đang tạm giữ'), '—');
  assert.equal(cell('Hàng đang về'), '—');
  assert.equal(cell('Tồn NCC'), '—');
});

test('zero remains zero; supplier availability retains the existing brand rule', () => {
  const { ctx, p, cell } = harness();
  ctx.heldQty = () => 0;
  p.stock.incoming = 0;
  p.stock.supplier = 0;
  ctx.renderProducts();
  assert.equal(cell('Đang tạm giữ'), '0');
  assert.equal(cell('Hàng đang về'), '0');
  assert.equal(cell('Tồn NCC'), '0');
  p.brand = 'MINHLONG';
  ctx.renderProducts();
  assert.match(cell('Tồn NCC')!, /—/);
});

test('loading state aligns with all ten table columns', () => {
  const { ctx, $ } = harness();
  ctx.state.products = null;
  ctx.renderProducts();
  assert.equal($('#product-list').innerHTML, 'skeleton:10');
});
