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
  const legacy = { ...vat, service: Object.fromEntries(Object.entries(vat.service).filter(([key]) => key !== 'quantity')) } as typeof vat;
  assert.equal(snapshotPosFees({ fees: legacy }).service.amount, 10800, 'Bill cũ lưu tổng phí không bị tính lại thành đơn giá trước VAT');
  assert.deepEqual(posFeeInput({}), {}, 'Bill cũ không phí giữ input hash cũ');
  const multi = calculatePosFees({ feeName: 'Khắc tên', feeAmount: 5400, feeQuantity: 2 }, 8);
  assert.equal(multi.service.unitPrice, 5400); assert.equal(multi.service.quantity, 2); assert.equal(multi.service.amount, 10800);
  for (const b of [{ feeAmount: 10 }, { feeName: 'x', feeAmount: -1 }, { shippingFee: 1.5 }, { shippingFee: 1e13 }, { feeName: 'x'.repeat(201) }]) assert.throws(() => calculatePosFees(b, 8));
});

test('Nhiều phí: tính VAT mỗi dòng, không giảm giá phí, lưu snapshot và đọc bill cũ', () => {
  const fees = [{ name: 'In', quantity: 3, unitPrice: 65000 }, { name: 'Gói quà', quantity: 2, unitPrice: 5400 }];
  const d = calculatePosFees({ serviceFees: fees, shippingFee: 20000 }, 8);
  assert.equal(d.services.length, 2); assert.equal(d.service.amount, 205800); assert.equal(d.total, 225800);
  assert.equal(d.service.subtotal, d.services.reduce((n, f) => n + f.subtotal, 0));
  assert.equal(d.tax, d.services.reduce((n, f) => n + f.tax, 0));
  assert.deepEqual(snapshotPosFees({ fees: d }), d);
  assert.equal(calculatePosFees({ serviceFees: fees, shippingFee: 20000 }, 0).tax, 0);
  assert.deepEqual(posFeeInput({ serviceFees: [] }), {});
  const perLine = calculatePosFees({ serviceFees: [{name:'A',unitPrice:7,quantity:1},{name:'B',unitPrice:7,quantity:1}] }, 8);
  assert.equal(perLine.tax, 2, 'làm tròn VAT theo từng dòng, không gộp làm mất 1 đồng');
  for (const serviceFees of [null, {}, [null], [{ name:'x', quantity:0, unitPrice:2 }], [{ name:'', quantity:1, unitPrice:1 }], [{ name:'x', quantity:1, unitPrice:-1 }], Array(51).fill({ name:'x', quantity:1, unitPrice:1 })]) assert.throws(() => calculatePosFees({ serviceFees }, 8));
  assert.throws(() => calculatePosFees({ serviceFees: fees, feeName:'Phí cũ',feeAmount:1 },8));
  assert.throws(() => calculatePosFees({ serviceFees: [{name:'A',unitPrice:1e12,quantity:1},{name:'B',unitPrice:1e12,quantity:1}] },8));
});
