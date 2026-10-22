import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocatePosVoucher, parsePosVoucher, posLine, posMoney, posCashDifference } from './pos-money.ts';
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
test('POS voucher: chia theo tiền hàng sau CK dòng, tổng đúng bằng voucher; trừ trước VAT; từ chối vượt tiền hàng / thiếu mã', () => {
  assert.deepEqual(allocatePosVoucher([100000, 200000], { code: 'VC', type: 'amount', value: 30000 }), { amount: 30000, shares: [10000, 20000] });
  const odd = allocatePosVoucher([1, 1, 1], { code: 'VC', type: 'amount', value: 2 });
  assert.equal(odd.shares.reduce((n, x) => n + x, 0), 2); assert.ok(odd.shares.every(x => x <= 1));
  assert.equal(allocatePosVoucher([194400], { code: 'VC', type: 'percent', value: 10 }).amount, 19440);
  assert.throws(() => allocatePosVoucher([1000], { code: 'VC', type: 'amount', value: 1001 }), /vượt tiền hàng/);
  assert.deepEqual(allocatePosVoucher([1000], null), { amount: 0, shares: [0] });
  // Giá đã gồm VAT 8%: 2 × 108.000, CK 10% (21.600), voucher 20.000 → tiền hàng 174.400, VAT tính lại trên giá sau giảm.
  const line = posLine({ ...base, discountType: 'percent', discountValue: 10, voucherAmount: 20000 });
  assert.deepEqual([line.discountAmount, line.voucherAmount, line.subtotal, line.tax, line.total], [41600, 20000, 161481, 12919, 174400]);
  assert.throws(() => posLine({ ...base, voucherAmount: 216001 }), /Voucher vượt/);
  assert.equal(parsePosVoucher(undefined), null); assert.equal(parsePosVoucher({ code: '', value: '' }), null);
  assert.deepEqual(parsePosVoucher({ code: '  VC  TET ', type: 'amount', value: '20000' }), { code: 'VC TET', type: 'amount', value: 20000 });
  for (const bad of [{ code: '', type: 'amount', value: 5000 }, { code: 'VC', type: 'x', value: 1 }, { code: 'VC', type: 'percent', value: 101 }, { code: 'VC', type: 'amount', value: 1.5 }, 'VC'])
    assert.throws(() => parsePosVoucher(bad));
});
