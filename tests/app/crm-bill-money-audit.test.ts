import { test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import { setup } from '../helpers/pos-fixture.ts';
import { products, productPrices } from '../../src/modules/catalog/schema.ts';
import { salesOrders } from '../../src/modules/sales/schema.ts';
// @ts-ignore browser renderer has no ambient DOM dependency when passed a document
import { buildPosPrint } from '../../trial-ui/pos-print.js';

// #780: synthetic data only, never production. Guards the CRM bill against
// fractional VND prices being silently rounded (101000.52 -> 101.001 đ on K80).
const SKU = '00123';
const PRICE = 101000;
const NAME = 'MOP HEADS — fixture kiểm thử, không phải dữ liệu thật';
type Fixture = Awaited<ReturnType<typeof setup>>;

class PrintNode {
  children: PrintNode[] = [];
  className = '';
  private text = '';
  set textContent(value: string) { this.text = String(value); this.children = []; }
  get textContent(): string { return this.text + this.children.map(n => n.textContent).join(''); }
  append(...nodes: PrintNode[]) { this.children.push(...nodes); }
}
const doc = { createElement: () => new PrintNode() };
function printed(data: unknown) {
  const sheet = buildPosPrint(doc, data) as PrintNode;
  const row = sheet.children.find(n => n.className === 'item-row');
  assert.ok(row, 'render the real K80 product row');
  const total = sheet.children.find(n => n.children[0]?.textContent === 'TỔNG THANH TOÁN');
  assert.ok(total, 'render the real K80 grand total');
  return { unit: row.children[0]!.textContent, amount: row.children[2]!.textContent, total: total.children[1]!.textContent };
}
async function prepare(f: Fixture) {
  await f.db.update(products).set({ name: NAME, brand: 'LocknLock', unit: 'cái' }).where(eq(products.sku, SKU));
  await f.db.update(productPrices).set({ price: PRICE }).where(and(eq(productPrices.sku, SKU), eq(productPrices.policyId, 'retail-vat')));
  return f.open();
}
function cart(f: Fixture, shiftId: string, qty: number, discountValue: number) {
  return f.cart(shiftId, {
    rows: [{ sku: SKU, qty, discountType: 'percent', discountValue }],
    tendered: 1000000,
  });
}
function expectBill(data: any, qty: number, discount: number) {
  const total = PRICE * qty - Math.round(PRICE * qty * discount / 100);
  assert.equal(data.lines[0].listUnitPrice, PRICE);
  assert.equal(data.lines[0].total, total);
  assert.equal(data.subtotal + data.tax, total, 'split VAT by the remainder, preserving the gross price');
  assert.equal(data.total, total);
  const paper = printed(data);
  assert.equal(paper.unit, `101.000×${qty} cái`);
  assert.equal(paper.amount, total.toLocaleString('vi-VN'));
  assert.equal(paper.total, total.toLocaleString('vi-VN') + ' đ');
}

test('A/control: 101000 stays exact through POS preview, checkout, saved snapshot and K80 reprint; quantity > 1 and CK %', async t => {
  const f = await setup();
  const shift = await prepare(f);
  // 1 + 3 + 6 uses only the ten synthetic units in the fixture's stock ledger.
  for (const [qty, discount] of [[1, 0], [3, 10], [6, 0]] as const) {
    const body = cart(f, shift.id, qty, discount);
    const preview = await f.call('/pos/preview', f.emp, 'POST', body);
    assert.equal(preview.status, 200, JSON.stringify(preview.data));
    expectBill(preview.data, qty, discount);
    const sale = await f.call('/pos/checkout', f.emp, 'POST', body);
    assert.equal(sale.status, 201, JSON.stringify(sale.data));
    expectBill(sale.data, qty, discount);
    const saved = await f.call('/pos/bills/' + sale.data.id, f.emp);
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    expectBill(saved.data, qty, discount);
    assert.deepEqual(saved.data.lines, sale.data.lines);
    t.diagnostic(`exact 101000 preserved through preview/checkout/reprint: qty=${qty}, CK=${discount}%`);
  }
});

for (const rawPrice of [101000.52, '101000.52', 101000.4]) {
  test(`product PUT rejects fractional VND (${JSON.stringify(rawPrice)}) instead of rounding to a 101001 bill`, async () => {
    const f = await setup();
    await prepare(f);
    const original = (await f.call('/products/' + SKU, f.mgr)).data.product;
    const saved = await f.call('/products/' + SKU, f.mgr, 'PUT', {
      name: NAME, brand: 'LocknLock', unit: 'cái',
      expectedUpdatedAt: original.updatedAt,
      prices: { 'retail-vat': rawPrice },
    });
    assert.equal(saved.status, 400, JSON.stringify(saved.data));
    const [price] = await f.db.select().from(productPrices).where(and(eq(productPrices.sku, SKU), eq(productPrices.policyId, 'retail-vat')));
    assert.equal(price!.price, PRICE, 'rejected update must preserve the approved price');
    assert.equal((await f.db.select().from(salesOrders)).length, 0);
  });
}

test('product PUT still accepts whole VND given as number or string, and clearing a price', async () => {
  const f = await setup();
  await prepare(f);
  for (const value of [101000, '102000', '103000.00']) {
    const original = (await f.call('/products/' + SKU, f.mgr)).data.product;
    const saved = await f.call('/products/' + SKU, f.mgr, 'PUT', {
      name: NAME, brand: 'LocknLock', unit: 'cái', expectedUpdatedAt: original.updatedAt, prices: { 'retail-vat': value },
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    const [price] = await f.db.select().from(productPrices).where(and(eq(productPrices.sku, SKU), eq(productPrices.policyId, 'retail-vat')));
    assert.equal(price!.price, Number(value));
  }
  const original = (await f.call('/products/' + SKU, f.mgr)).data.product;
  const cleared = await f.call('/products/' + SKU, f.mgr, 'PUT', {
    name: NAME, brand: 'LocknLock', unit: 'cái', expectedUpdatedAt: original.updatedAt, prices: { 'retail-vat': null },
  });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.data));
  const [price] = await f.db.select().from(productPrices).where(and(eq(productPrices.sku, SKU), eq(productPrices.policyId, 'retail-vat')));
  assert.equal(price!.price, null);
});

test('A/control: an already-fractional imported catalog price is rejected by POS, not silently rounded by the printer', async () => {
  const f = await setup();
  const shift = await prepare(f);
  // Model an imported fractional price, without calling any external service.
  await f.db.update(productPrices).set({ price: 101000.52 }).where(and(eq(productPrices.sku, SKU), eq(productPrices.policyId, 'retail-vat')));
  const body = cart(f, shift.id, 1, 0);
  assert.equal((await f.call('/pos/preview', f.emp, 'POST', body)).status, 400);
  assert.equal((await f.call('/pos/checkout', f.emp, 'POST', body)).status, 400);
  assert.equal((await f.db.select().from(salesOrders)).length, 0);
});
