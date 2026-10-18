import { test } from 'node:test';
import assert from 'node:assert/strict';
import { posLine, posMoney, posCashDifference } from './pos-money.ts';
const base = { price: 108000, qty: 2, taxRate: 8, priceIncludesVat: true, vatEnabled: true };
test('POS: phần trăm / VNĐ theo cả dòng; VAT đã gồm không cộng hai lần', () => {
  const percent = posLine({ ...base, discountType: 'percent', discountValue: 10 });
  assert.deepEqual(
    [percent.discountAmount, percent.subtotal, percent.tax, percent.total],
    [21600, 180000, 14400, 194400],
  );
  const fixed = posLine({ ...base, discountType: 'amount', discountValue: 20000 });
  assert.equal(fixed.total, 196000);
  assert.equal(fixed.discountAmount, 20000);
  assert.equal(fixed.subtotal + fixed.tax, fixed.total);
  const retail = posLine({ ...base, price: 100000, taxRate: 0, priceIncludesVat: false, vatEnabled: false });
  assert.equal(retail.total, 200000);
  assert.equal(retail.tax, 0);
});
test('POS: cho tự do CK nhưng từ chối vượt tiền hàng, âm, NaN và quá 100%', () => {
  for (const [mode, value] of [
    ['percent', 100.01],
    ['percent', -1],
    ['amount', 216001],
    ['amount', 1.5],
    ['amount', NaN],
  ])
    assert.throws(() => posLine({ ...base, discountType: mode, discountValue: value }));
  assert.equal(posLine({ ...base, discountType: 'percent', discountValue: 100 }).total, 0);
  assert.throws(() => posLine({ ...base, qty: 0 }));
  assert.throws(() => posMoney(Infinity));
  assert.equal(posCashDifference(100000, 200000, 299999), -1);
});
