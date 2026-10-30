import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quoteStockSku } from '../../src/modules/quotes/domain/quote-math.ts';
const { quoteShortages, initQuoteStockWarnings }: any = await import(new URL('../../trial-ui/quote-stock-warning.js', import.meta.url).href);
const products = new Map([['A', { sku: 'A', available: 8 }], ['B', { sku: 'B', available: 0 }], ['C', { sku: 'C', available: null }]]);
const check = (rows: any[]) => quoteShortages(rows, products, (p: any) => p.available, quoteStockSku);
test('aggregate repeated SKU rows, skip charges, compare strictly against sellable stock', () => {
  const found = check([{ sku: 'a', qty: 5 }, { sku: 'A', qty: 4 }, { sku: 'A', qty: 100, manualLine: true }]);
  assert.deepEqual(found.get('A'), { qty: 9, available: 8, shortage: 1 });
  assert.equal(check([{ sku: 'A', qty: 8 }]).size, 0);
  assert.equal(check([{ sku: 'A', qty: '' }, { sku: 'A', qty: -1 }]).size, 0);
  assert.equal(check([{ sku: 'B', qty: 1 }]).get('B').shortage, 1);
});
test('unknown inventory is not zero; negative sellable stock is clamped to zero', () => {
  assert.equal(check([{ sku: 'C', qty: 100 }, { sku: 'UNKNOWN', qty: 100 }]).size, 0);
  const found = quoteShortages([{ sku: 'A', qty: 1 }], products, () => -4, quoteStockSku);
  assert.deepEqual(found.get('A'), { qty: 1, available: 0, shortage: 1 });
});
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
test('typing quantity reuses one batched lookup and updates badge without replacing rows', async () => {
  const rows = [{ sku: 'A', qty: 9 }], calls: string[][] = [];
  const badge: any = { hidden: true, title: '', closest: () => ({ dataset: { i: '0' } }), setAttribute: () => {} };
  const c = initQuoteStockWarnings({ root: { querySelectorAll: () => [badge] }, getRows: () => rows, skuOf: quoteStockSku,
    ensureHolds: async () => {}, available: (p: any) => p.available,
    fetchProducts: async (skus: string[]) => { calls.push(skus); return [{ sku: 'A', available: 8 }]; } });
  c.refresh(); c.refresh(); await wait(200);
  assert.deepEqual(calls, [['A']]); assert.equal(badge.hidden, false); assert.match(badge.title, /thiếu 1/);
  rows[0]!.qty = 8; c.refresh(); await wait(160); assert.equal(badge.hidden, true); assert.equal(calls.length, 1);
  rows[0]!.qty = 10; c.refresh(); assert.equal(badge.hidden, false); assert.match(badge.title, /thiếu 2/);
});
test('late responses use current rows; failed requests do not warn or repeatedly retry while typing', async () => {
  let rows: any[] = [{ sku: 'A', qty: 100 }], calls = 0;
  const badge: any = { hidden: true, closest: () => ({ dataset: { i: '0' } }), setAttribute: () => {} };
  const c = initQuoteStockWarnings({ root: { querySelectorAll: () => [badge] }, getRows: () => rows, skuOf: quoteStockSku,
    ensureHolds: async () => {}, available: (p: any) => p.available,
    fetchProducts: async () => { calls++; await wait(50); rows = [{ sku: 'MANUAL', qty: 100, manualLine: true }]; return [{ sku: 'A', available: 0 }]; } });
  c.refresh(); await wait(240); assert.equal(badge.hidden, true); assert.equal(calls, 1);
  rows = [{ sku: 'B', qty: 100 }];
  const failed = initQuoteStockWarnings({ root: { querySelectorAll: () => [badge] }, getRows: () => rows, skuOf: quoteStockSku,
    ensureHolds: async () => {}, available: () => 0, fetchProducts: async () => { calls++; throw Error('offline'); } });
  failed.refresh(); await wait(200); assert.equal(badge.hidden, true);
  failed.refresh(); await wait(180); assert.equal(calls, 2);
});
