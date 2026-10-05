import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from './quote-math.ts';

// Các ca dưới đây lấy từ tests/quote-math.test.mjs của bản cũ (bỏ phần validateQuotation – port ở giai đoạn sau).

test('chiết khấu theo số tiền trừ vào từng đơn vị trước phí in và VAT', () => {
  const q = { type: 'B2B' as const, vat: 8, rows: [{ price: 100000, qty: 3, discount: 12000, discountType: 'amount' as const, printFee: 2000 }] };
  assert.equal(M.after(q.rows[0]!, q), 90000);
  assert.equal(M.totals(q).total, 291600);
});

test('giá sau CK có cộng phí in cho B2B và VIGIFTS, không cộng cho HRC', () => {
  const row = { price: 100000, discount: 10, discountType: 'percent' as const, printFee: 5000, qty: 1 };
  assert.equal(M.after(row, { type: 'HRC' }), 90000);
  assert.equal(M.after(row, { type: 'B2B' }), 95000);
  assert.equal(M.after(row, { type: 'VIGIFTS' }), 95000);
});

test('báo giá cũ và VAT hỗn hợp theo từng sản phẩm cho tổng đúng', () => {
  assert.deepEqual(M.totals({ type: 'HRC', vat: 8, rows: [{ price: 100, qty: 2, discount: 10 }] }), { subtotal: 180, tax: 14.4, total: 194.4, label: 'Thuế VAT 8%' });
  const mixed = { type: 'B2B' as const, vat: 8, rows: [{ price: 100, qty: 2, discount: 0, printFee: 10, taxRate: 8 }, { price: 200, qty: 1, discount: 0, taxRate: 5 }] };
  assert.equal(M.totals(mixed).tax, 27.6);
  assert.equal(M.totals(mixed).label, 'Thuế VAT theo sản phẩm');
  assert.equal(M.netPrice(108, 8, true), 100);
});

test('VIGIFTS giữ đúng đơn giá sau CK lẻ, phí in và tổng tiền', () => {
  const q = { type: 'VIGIFTS' as const, vat: 8, rows: [{ price: 690741, discount: 53, printFee: 25000, qty: 500, taxRate: 8 }] };
  assert.equal(M.after(q.rows[0]!, q), 349648.27);
  assert.equal(M.totals(q).subtotal, 174824135);
  assert.equal(M.totals(q).total, 188810065.8);
});

test('giá vốn mặc định theo chiết khấu mua vào của từng thương hiệu', () => {
  assert.equal(M.purchasePrice(100000, 58), 42000);
  assert.equal(M.defaultCostPrice({ brand: 'LocknLock' }, 100000), 42000);
  assert.equal(M.defaultCostPrice({ brand: 'MINH LONG' }, 100000), 75000);
  assert.equal(M.defaultCostPrice({ brand: 'MINH LONG - LYS' }, 100000), 81000);
  assert.equal(M.defaultCostPrice({ name: 'Nồi Healthy Cook' }, 100000), 85000);
  assert.equal(M.defaultCostPrice({ brand: 'Khác' }, 100000), 0);
});

test('xưởng in mặc định theo sản phẩm; chi phí in chỉ trừ vào lợi nhuận nội bộ', () => {
  const q = { type: 'B2B' as const, vat: 8, rows: [{ brand: 'Minh Long - LYS', qty: 10, price: 100000, costPrice: 75000, printFee: 10000 }], printing: { workshop: 'Xưởng mới', totalCost: 60000, workshopExplicit: true } };
  assert.deepEqual(M.printingInfo(q), { enabled: true, defaultWorkshop: 'Xưởng in Tiến phát' });
  assert.equal(M.profit(q).printingCost, 60000);
  assert.equal(M.profit(q).gross, 290000);
  assert.equal(M.totals(q).subtotal, 1100000);
  assert.equal(M.printingInfo({ ...q, type: 'VIGIFTS', rows: [{ brand: 'LocknLock', qty: 1, printFee: 10 }] }).defaultWorkshop, 'Thương Bé Ba');
  assert.equal(M.printingInfo({ ...q, rows: [{ brand: 'Khác', qty: 1, printFee: 10 }] }).defaultWorkshop, 'Thương Bé Ba');
  assert.equal(M.profit({ ...q, type: 'HRC' }).printingCost, 0);
  assert.equal(M.printingInfo({ ...q, rows: [{ ...q.rows[0]!, printFee: 0 }] }).enabled, false);
});

test('giá in theo từng sản phẩm nhân với số lượng và tính độc lập', () => {
  const rows = [
    { sku: 'ML', brand: 'Minh Long', qty: 10, price: 100000, printFee: 10000, printing: { unitPrice: 6000 } },
    { sku: 'LOCK', brand: 'Lock', qty: 1, price: 50000, printFee: 4000, printing: { unitPrice: 4000 } },
  ];
  const q = { type: 'B2B' as const, vat: 8, rows };
  assert.equal(M.profit(q).printingCost, 64000);
  rows[0]!.qty = 20; assert.equal(M.profit(q).printingCost, 124000);
  rows.splice(0, 1); assert.equal(M.profit(q).printingCost, 4000);
  assert.equal(M.profit({ ...q, type: 'HRC' }).printingCost, 0);
});

test('chiết khấu khách hàng: chỉ nhận số trong 0..100, nhận diện thương hiệu có dấu/hoa thường', () => {
  const d = { lys: 10, minhLong: 20, lock: 58 };
  assert.equal(M.customerDiscount('Lock&Lock', d), 58);
  assert.equal(M.customerDiscount('MINH LONG', d), 20);
  assert.equal(M.customerDiscount('Minh Long - LYS', d), 10);
  assert.equal(M.customerDiscount('Lock', d, 'amount', 200000), 116000);
  assert.equal(M.customerDiscount('Lock', { lock: 101 }), 0);
  assert.equal(M.customerDiscount('Lock', { lock: -1 }), 0);
  assert.equal(M.customerDiscount('Thương hiệu lạ', d), 0);
  assert.equal(M.customerDiscount('Lock', null), 0);
});

test('hợp đồng đầu vào: thiếu/undefined/null coi là 0; chuỗi không phải số cho NaN (phải bị chặn từ bước validate)', () => {
  // Giống bản cũ: quote-math KHÔNG tự làm sạch dữ liệu – schema zod (giai đoạn 3) phải từ chối giá trị không hữu hạn trước khi tính.
  const missing = { type: 'B2B' as const, vat: 8, rows: [{ qty: 2 }, { price: 100, qty: 1, discount: undefined, printFee: null as unknown as number }] };
  assert.deepEqual(M.totals(missing), { subtotal: 100, tax: 8, total: 108, label: 'Thuế VAT 8%' });
  assert.ok(Number.isNaN(M.totals({ type: 'B2B', vat: 8, rows: [{ price: 'abc' as unknown as number, qty: 1 }] }).total));
  // Chiết khấu vượt giá không làm đơn giá âm.
  assert.equal(M.discounted({ price: 100, discount: 500, discountType: 'amount' }), 0);
  assert.equal(M.discounted({ price: 100, discount: 150 }), 0);
});
