import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireNewProductPrices } from './product-approval.ts';

test('new manual products require both positive retail prices, using policy names rather than fixed IDs', () => {
  const policies = [{ id: 'sapo:7', name: 'Giá bán lẻ' }, { id: 'legacy:42', name: 'Giá lẻ +VAT' }];
  const valid = { 'sapo:7': 100000, 'legacy:42': 108000 };
  assert.doesNotThrow(() => requireNewProductPrices(policies, valid));
  assert.doesNotThrow(() => requireNewProductPrices([{ id: 'sapo:7', name: 'GIA BAN LE' }, { id: 'legacy:42', name: 'Giá bán lẻ (+ VAT)' }], valid));
  for (const id of ['sapo:7', 'legacy:42']) {
    for (const bad of [undefined, null, '', ' ', 0, -1, 0.4, true, [], {}, NaN, Infinity, 1e12 + 1]) {
      assert.throws(() => requireNewProductPrices(policies, { ...valid, [id]: bad }), /Bắt buộc nhập/);
    }
  }
  assert.throws(() => requireNewProductPrices(policies, { retail: 100000, 'retail-vat': 108000 }), /Bắt buộc nhập/);
  assert.throws(() => requireNewProductPrices(policies.slice(0, 1), valid), /Chưa có bảng Giá lẻ/);
});
