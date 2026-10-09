import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commissionOf, profit } from '../../src/modules/quotes/domain/quote-math.ts';
import { cleanQuotation } from '../../src/modules/quotes/domain/quotation-schema.ts';
import { publicQuote } from '../../src/modules/portal/domain/portal.ts';

/** CK cho khách ("tiền cà phê") ở Lợi nhuận tạm tính: theo % hoặc đ/SP trên đơn giá sau CK KHÔNG gồm phí in; dòng bị loại không tính. */
test('CK cho khách: % / số tiền trên đơn giá sau CK (không phí in), bỏ dòng loại trừ, trừ vào lợi nhuận', () => {
  const ly = { price: 100000, qty: 10, discount: 10, printFee: 5000, costPrice: 50000, commission: { mode: 'percent' as const, value: 5 } };
  const hop = { price: 20000, qty: 10, printFee: 0, commission: { mode: 'amount' as const, value: 1000 } };
  const baoBi = { price: 5000, qty: 10, commission: { mode: 'percent' as const, value: 5, excluded: true } };
  assert.equal(commissionOf(ly), 45000, '5% × 90.000 (không tính phí in 5.000) × 10');
  assert.equal(commissionOf(hop), 10000, '1.000 đ/SP × 10');
  assert.equal(commissionOf(baoBi), 0, 'bao bì bị loại');
  assert.equal(commissionOf({ price: 1, qty: 1 }), 0);
  const p = profit({ type: 'B2B', vat: 8, rows: [ly, hop, baoBi] });
  assert.equal(p.commission, 55000);
  assert.equal(p.gross, p.revenue - p.cost - 55000 - p.printingCost);
});

test('CK cho khách: máy chủ giữ / kiểm dữ liệu; trang khách không thấy', () => {
  const raw = (commission: unknown) => ({ type: 'B2B', quoteNo: 'BG-1', customer: 'Khách', vat: 8, date: '2026-10-09', rows: [{ name: 'Ly', qty: 1, price: 1000, commission }] });
  assert.deepEqual(cleanQuotation(raw({ mode: 'amount', value: 500 })).rows[0].commission, { mode: 'amount', value: 500, excluded: false });
  assert.deepEqual(cleanQuotation(raw({ value: 3, excluded: true })).rows[0].commission, { mode: 'percent', value: 3, excluded: true });
  assert.throws(() => cleanQuotation(raw({ mode: 'percent', value: 120 })), /không hợp lệ/);
  assert.throws(() => cleanQuotation(raw({ mode: 'x', value: 1 })), /CK cho khách không hợp lệ/);
  assert.equal(publicQuote(cleanQuotation(raw({ mode: 'percent', value: 3 }))).rows[0].commission, undefined, 'trang khách không lộ CK');
});
