import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPurchaseCost, costModeOf, parsePurchaseCost, profit, syncPurchaseCost, totals } from './quote-math.ts';
import { cleanQuotation } from './quotation-schema.ts';

test('nhập giá vốn: 160k, tiền định dạng Việt/Anh, 58% và số theo chế độ chọn', () => {
  for (const text of ['160k', '160K', '160.000 đ', '160,000 VND', '160000₫'])
    assert.deepEqual(parsePurchaseCost(text, 'discount'), { mode: 'manual', value: 160000 }, text);
  assert.deepEqual(parsePurchaseCost('160,5k', 'discount'), { mode: 'manual', value: 160500 });
  assert.deepEqual(parsePurchaseCost('58%', 'manual'), { mode: 'discount', value: 58 });
  assert.deepEqual(parsePurchaseCost('58,5%', 'discount'), { mode: 'discount', value: 58.5 });
  assert.deepEqual(parsePurchaseCost('58', 'discount'), { mode: 'discount', value: 58 });
  assert.deepEqual(parsePurchaseCost('58', 'manual'), { mode: 'manual', value: 58 });
  assert.deepEqual(parsePurchaseCost('', 'manual'), { mode: 'manual', value: null });
  for (const text of ['-1', '101%', 'NaN', '1e6', '160k%', 'abc160', '1000000000001đ'])
    assert.equal(parsePurchaseCost(text, 'discount'), null, text);
});

test('giá thủ công không đổi khi thay đơn giá; CK tính lại; chuyển chế độ xoá giá trị không còn dùng', () => {
  const row = { price: 308916, purchaseDiscount: 58, costPrice: 129745 };
  assert.equal(costModeOf(row), 'discount');
  applyPurchaseCost(row, parsePurchaseCost('160k', 'discount')!);
  assert.equal(costModeOf(row), 'manual'); assert.equal(row.costPrice, 160000); assert.equal(row.purchaseDiscount, undefined);
  row.price = 400000; syncPurchaseCost(row); assert.equal(row.costPrice, 160000);
  applyPurchaseCost(row, parsePurchaseCost('58%', 'manual')!);
  assert.equal(row.costPrice, 168000); row.price = 500000; syncPurchaseCost(row); assert.equal(row.costPrice, 210000);
  applyPurchaseCost(row, { mode: 'discount', value: null }); assert.equal(row.costPrice, undefined);
  applyPurchaseCost(row, { mode: 'manual', value: 0 }); assert.equal(row.costPrice, 0);
  assert.equal(costModeOf({ costPrice: 160000 }), 'manual', 'giá nhập cũ chưa có CK vẫn giữ được');
});

test('giá nhập dùng tính lợi nhuận, không đổi tiền khách trả; server giữ mode, kiểm giá và tính CK nhất quán', () => {
  const data = (row: object) => ({ type: 'B2B', customer: 'Khách', quoteNo: 'B2B_1', vat: 8, rows: [{ name: 'Bình', qty: 2, price: 400000, ...row }] });
  const direct = cleanQuotation(data({ costMode: 'manual', costPrice: 160000, purchaseDiscount: 58 }));
  assert.equal(direct.rows[0].costMode, 'manual'); assert.equal(direct.rows[0].purchaseDiscount, undefined);
  const discounted = cleanQuotation(data({ costMode: 'discount', purchaseDiscount: 58, costPrice: 1 }));
  assert.equal(discounted.rows[0].costPrice, 168000);
  const directDoc = { type: 'B2B' as const, vat: 8, rows: direct.rows }, discountDoc = { type: 'B2B' as const, vat: 8, rows: discounted.rows };
  assert.equal(totals(directDoc).total, totals(discountDoc).total);
  assert.equal(profit(directDoc).cost, 320000); assert.equal(profit(discountDoc).cost, 336000);
  const zero = cleanQuotation(data({ costMode: 'manual', costPrice: 0 })); assert.equal(zero.rows[0].costPrice, 0);
  for (const row of [{ costMode: 'unknown' }, { costMode: 'manual', costPrice: -1 }, { costMode: 'discount', purchaseDiscount: 101 }])
    assert.throws(() => cleanQuotation(data(row)));
});
