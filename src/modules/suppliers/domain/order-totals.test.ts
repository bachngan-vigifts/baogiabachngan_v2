import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeOrderTotals, hidePrices, normalizeDepositRate, type TotalsRow } from './order-totals.ts';

const row = (o: Partial<TotalsRow>): TotalsRow => ({ quantity: 1, price: 0, printFee: 0, taxRate: 0, purchaseDiscount: null, confirmedPurchaseDiscount: null, ...o });

test('đơn mẫu tính tay: 2 mã, chiết khấu, phí in, VAT khác nhau, cọc 30%', () => {
  const t = computeOrderTotals({
    depositRate: 30, paidAmount: 0,
    rows: [row({ quantity: 10, price: 100000, taxRate: 8, printFee: 2000, purchaseDiscount: 25 }), row({ quantity: 5, price: 200000, taxRate: 10, purchaseDiscount: 10 })],
  });
  assert.deepEqual(t.rows.map(r => [r.lineTotal, r.lineVat]), [[770000, 61600], [900000, 90000]]); // (75.000+2.000)×10 ; 180.000×5
  assert.deepEqual([t.subtotal, t.vat, t.total, t.depositAmount, t.remainingAmount], [1670000, 151600, 1821600, 546480, 1821600]);
});

test('chiết khấu NCC xác nhận ghi đè chiết khấu manager nhập; kẹp trong 0..100', () => {
  const r = (confirmed: number | null, approved: number | null) => computeOrderTotals({ depositRate: 30, paidAmount: 0, rows: [row({ price: 1000, purchaseDiscount: approved, confirmedPurchaseDiscount: confirmed })] }).rows[0]!;
  assert.equal(r(20, 10).purchaseDiscount, 20);
  assert.equal(r(null, 10).purchaseDiscount, 10);
  assert.equal(r(0, 10).purchaseDiscount, 0); // 0% NCC xác nhận là giá trị hợp lệ, không rơi về 10
  assert.equal(r(null, null).purchaseDiscount, 0);
  assert.equal(r(150, 10).purchaseDiscount, 100);
  assert.equal(r(-5, 10).purchaseDiscount, 0);
  assert.equal(r(100, null).priceAfterDiscount, 0);
});

test('tỷ lệ cọc: thiếu/không hợp lệ → 30%; làm tròn 2 chữ số; 0% là hợp lệ', () => {
  const d = (rate: unknown) => computeOrderTotals({ depositRate: rate as number, paidAmount: 0, rows: [row({ price: 1000000 })] }).depositRate;
  assert.deepEqual([d(undefined), d(null), d(150), d(-1), d('abc'), d(0), d(100), d(12.345)], [30, 30, 30, 30, 30, 0, 100, 12.35]);
  assert.equal(normalizeDepositRate(50), 50);
  assert.equal(normalizeDepositRate('x'), null);
});

test('đã trả và còn lại: không âm, rác thành 0', () => {
  const t = (paid: unknown) => computeOrderTotals({ depositRate: 30, paidAmount: paid as number, rows: [row({ price: 1000, quantity: 10 })] });
  assert.deepEqual([t(300).depositPaidAmount, t(300).remainingAmount], [300, 9700]);
  assert.equal(t(-50).depositPaidAmount, 0);
  assert.equal(t(undefined).depositPaidAmount, 0);
  assert.equal(t('abc').depositPaidAmount, 0);
  assert.equal(t(99999999).remainingAmount, 0); // trả thừa không ra âm
});

test('số lượng làm tròn nửa ra xa 0; đơn giá/VAT rác thành 0', () => {
  const t = computeOrderTotals({ depositRate: 30, paidAmount: 0, rows: [row({ quantity: 2.5, price: 100 }), row({ quantity: 1, price: 'abc' as unknown as number, taxRate: null })] });
  assert.equal(t.rows[0]!.quantity, 3);
  assert.equal(t.subtotal, 300);
  assert.equal(t.rows[1]!.lineTotal, 0);
});

test('nhân viên thường xem đơn nhưng bị ẩn giá/tiền, vẫn thấy số lượng và tỷ lệ cọc', () => {
  const t = computeOrderTotals({ depositRate: 50, paidAmount: 100, rows: [row({ quantity: 4, price: 1000, taxRate: 8, purchaseDiscount: 10 })] });
  const h = hidePrices(t);
  assert.equal(h.priceHidden, true);
  assert.deepEqual([h.subtotal, h.vat, h.total, h.depositAmount, h.depositPaidAmount, h.remainingAmount], [0, 0, 0, 0, 0, 0]);
  assert.deepEqual([h.rows[0]!.quantity, h.rows[0]!.unitPrice, h.rows[0]!.lineTotal, h.depositRate], [4, 0, 0, 50]);
});

test('supplier credits allocate fractional stock from original line value without re-rounding each return',()=>{
 const input={quantity:10,creditedQty:0.5,price:100,printFee:5,taxRate:8,purchaseDiscount:25,confirmedPurchaseDiscount:null};
 const total=computeOrderTotals({rows:[input],depositRate:0,paidAmount:0}).total;
 assert.ok(Math.abs(total-820.8)<1e-9);
 const legacy={...input,quantity:10.2,creditedQty:1.02};
 assert.ok(Math.abs(computeOrderTotals({rows:[legacy],depositRate:0,paidAmount:0}).total-777.6)<1e-9);
 assert.equal(computeOrderTotals({rows:[{...input,creditedQty:10}],depositRate:0,paidAmount:0}).total,0);
});
