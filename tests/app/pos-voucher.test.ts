import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { setup } from '../helpers/pos-fixture.ts';
import { salesOrderLines, salesOrders } from '../../src/modules/sales/schema.ts';

/**
 * VOUCHER nhập tay trên đơn Bán hàng nhanh (pos-money.ts › parsePosVoucher / allocatePosVoucher):
 * mã / ghi chú bắt buộc, VNĐ hoặc %, giảm cả đơn – chia vào dòng hàng, trừ vào giá gồm VAT (VAT tính lại); không vượt tiền hàng; lưu trên đơn + bill + báo cáo ca.
 */
test('voucher: xem trước, thanh toán, dòng hàng chia voucher (trừ vào giá gồm VAT), lưu trên đơn, báo cáo ca tính vào chiết khấu', async () => {
  const f = await setup();
  const s = await f.open();
  // Giỏ mẫu: 2 × 108.000 (giá gồm VAT 8%), CK dòng 10% → 194.400; voucher 20.000 → 174.400.
  const voucher = { code: 'VC-TET2026', type: 'amount', value: 20000 };
  const pre = await f.call('/pos/preview', f.emp, 'POST', f.cart(s.id, { voucher }));
  assert.equal(pre.status, 200, JSON.stringify(pre.data));
  assert.deepEqual(pre.data.voucher, { ...voucher, amount: 20000 });
  assert.deepEqual([pre.data.total, pre.data.discount, pre.data.subtotal, pre.data.tax], [174400, 41600, 161481, 12919]);
  assert.equal(pre.data.lines[0].voucherAmount, 20000);
  // Không voucher: tổng như cũ (không đổi hành vi giỏ cũ).
  assert.equal((await f.call('/pos/preview', f.emp, 'POST', f.cart(s.id))).data.total, 194400);

  const paid = await f.call('/pos/checkout', f.emp, 'POST', f.cart(s.id, { voucher, tendered: 200000 }));
  assert.equal(paid.status, 201, JSON.stringify(paid.data));
  assert.deepEqual([paid.data.total, paid.data.change, paid.data.voucher.code, paid.data.voucher.amount], [174400, 25600, 'VC-TET2026', 20000]);
  const [order] = await f.db.select().from(salesOrders).where(eq(salesOrders.id, paid.data.id));
  assert.equal(order!.total, 174400);
  assert.deepEqual(JSON.parse(order!.posSnapshot!).voucher, { ...voucher, amount: 20000 });
  const [line] = await f.db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, paid.data.id));
  assert.deepEqual([line!.discountType, line!.discountValue, line!.discountAmount, line!.amount], ['percent', 10, 41600, 161481], 'CK dòng giữ nguyên; tiền dòng (chưa VAT) đã trừ voucher');
  const detail = (await f.call(`/orders/${paid.data.id}`, f.emp)).data.order;
  assert.equal(JSON.parse(detail.posSnapshot).voucher.code, 'VC-TET2026');
  const report = (await f.call(`/pos/shifts/${s.id}`, f.emp)).data;
  assert.equal(report.bills.discount, 41600, 'báo cáo ca: chiết khấu gồm cả voucher');

  // % theo tiền hàng sau CK dòng.
  const pct = await f.call('/pos/preview', f.emp, 'POST', f.cart(s.id, { voucher: { code: 'KH thân thiết', type: 'percent', value: 10 } }));
  assert.deepEqual([pct.data.voucher.amount, pct.data.total], [19440, 174960]);
  // Bắt buộc mã; không vượt tiền hàng; giá trị sai.
  for (const [bad, re] of [[{ code: '', type: 'amount', value: 5000 }, /mã/], [{ code: 'VC', type: 'amount', value: 194401 }, /vượt/], [{ code: 'VC', type: 'percent', value: 120 }, /%/]] as const) {
    const r = await f.call('/pos/preview', f.emp, 'POST', f.cart(s.id, { voucher: bad }));
    assert.equal(r.status, 400); assert.match(r.data.error ?? r.data.message ?? JSON.stringify(r.data), re);
  }
});
