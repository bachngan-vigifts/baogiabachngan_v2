import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderLinesFromQuote, orderTotals } from '../src/modules/sales/domain/sales.ts';
import { totals, type QuoteDoc } from '../src/modules/quotes/domain/quote-math.ts';

test('giữ độ chính xác báo giá đến bước tổng cuối, gồm CK tiền, phí in, nhiều VAT và SL lẻ', () => {
  for (const type of ['HRC', 'B2B', 'VIGIFTS'] as const) for (const qty of [1, 3, 110, 1.25]) {
    const doc: QuoteDoc = { type, vat: 8, rows: [
      { name: 'Bình', price: 581481, discount: 56, qty, printFee: 123.45 },
      { name: 'Ly', price: 1000.75, discountType: 'amount', discount: 45.12, qty: 2.5, taxRate: 10 },
      { name: 'Hộp', price: 1.17, qty: 1, taxRate: 0 },
    ] };
    const lines = orderLinesFromQuote(doc), actual = orderTotals(lines), expected = totals(doc);
    assert.equal(actual.total, Math.round(expected.total));
    assert.equal(actual.subtotal, Math.round(expected.subtotal));
    assert.equal(actual.subtotal + actual.tax, actual.total);
    assert.ok(Math.abs(lines[0]!.unitPrice - (type === 'HRC' ? 255851.64 : 255975.09)) < 1e-8);
    assert.equal(lines[0]!.amount, lines[0]!.unitPrice * qty);
  }
});
