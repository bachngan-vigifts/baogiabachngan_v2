import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculatePosFees, posFeeInput, snapshotPosFees } from './pos-fees.ts';
test('Phí dịch vụ theo bảng giá, ship không VAT và tiền VNĐ nguyên', () => {
  const vat = calculatePosFees({ feeName: 'Phí in', feeAmount: 10800, shippingFee: 20000 }, 8);
  assert.equal(vat.service.subtotal, 10000); assert.equal(vat.tax, 800);
  assert.equal(vat.subtotal, 30000); assert.equal(vat.total, 30800);
  const retail = calculatePosFees({ feeName: 'Phí in', feeAmount: 10800, shippingFee: 20000 }, 0);
  assert.equal(retail.tax, 0); assert.equal(retail.total, 30800);
  assert.equal(snapshotPosFees({}).total, 0);
  assert.deepEqual(snapshotPosFees({ fees: vat }), vat);
  assert.deepEqual(posFeeInput({}), {}, 'Bill cũ không phí giữ input hash cũ');
  for (const b of [{ feeAmount: 10 }, { feeName: 'x', feeAmount: -1 }, { shippingFee: 1.5 }, { shippingFee: 1e13 }, { feeName: 'x'.repeat(201) }]) assert.throws(() => calculatePosFees(b, 8));
});
