import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { setup } from '../helpers/pos-fixture.ts';
import { productMovements } from '../../src/modules/catalog/schema.ts';
import { salesOrders } from '../../src/modules/sales/schema.ts';
import { posFeeFacts } from '../../src/modules/profit/domain/pos-fees.ts';
import { calculatePosFees } from '../../src/modules/sales/domain/pos-fees.ts';

/** Phí đơn POS: thu phí khách (chưa VAT, trừ phần hoàn) + phí GHN trả hãng; không đụng phí ship lịch giao của đơn CRM. */
const ok = (r: { status: number; data: any }, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.data)); return r.data; };

test('domain: thu phí khách quy chưa VAT, trừ hoàn theo tỉ lệ; phí GHN; không có vận đơn = 0', () => {
  const fees = calculatePosFees({ feeName: 'Gói quà', feeAmount: 10800, shippingFee: 32400 }, 8, 8);
  const snap = JSON.stringify({ fees, ghn: { orderCode: 'GHN1', fee: 28000 } });
  assert.deepEqual(posFeeFacts(snap, 0), { feeRevenue: fees.subtotal, carrierFee: 28000, carrierKnown: true });
  assert.equal(fees.subtotal, 40000, 'chưa VAT: 10.000 + 30.000');
  assert.equal(posFeeFacts(snap, 10800).feeRevenue, 30000, 'hoàn phí gói quà 10.800 gồm VAT → trừ 10.000 chưa VAT');
  assert.deepEqual(posFeeFacts(JSON.stringify({ fees }), 0), { feeRevenue: 40000, carrierFee: 0, carrierKnown: false });
  assert.deepEqual(posFeeFacts('lỗi', 0), { feeRevenue: 0, carrierFee: 0, carrierKnown: false });
});

test('API: đơn POS cộng thu phí khách, trừ phí GHN vào LN sau chi phí; LN gộp giữ nguyên; báo chưa có phí quẹt thẻ', async () => {
  const f = await setup();
  await f.db.insert(productMovements).values({ id: 'p1', refKey: 'buy-p1', sku: '00123', kind: 'purchase', qty: 10, unitPrice: 40000, occurredAt: '2026-01-01T02:00:00Z', recordedAt: '2026-01-01T02:00:00Z' });
  const shift = await f.open();
  const sale = ok(await f.call('/pos/checkout', f.emp, 'POST', f.cart(shift.id, { confirmed: true, feeName: 'Gói quà', feeAmount: 10000, tendered: 300000 })), 201);
  const orderId = sale.order?.id ?? sale.id;
  const [o] = await f.db.select().from(salesOrders).where(eq(salesOrders.id, orderId));
  const snap = JSON.parse(o!.posSnapshot!);
  await f.db.update(salesOrders).set({ posSnapshot: JSON.stringify({ ...snap, ghn: { orderCode: 'GHNTEST', fee: 25000 } }) }).where(eq(salesOrders.id, orderId));
  const day = o!.orderDate, d = ok(await f.call(`/profit?from=${day}&to=${day}`, f.mgr));
  const row = d.orders.find((x: any) => x.id === orderId);
  const feeNet = snap.fees.subtotal;
  assert.ok(feeNet > 0, 'có phí dịch vụ chưa VAT');
  assert.equal(row.feeRevenue, feeNet); assert.equal(row.carrierFee, 25000);
  assert.equal(row.net, row.gross + feeNet - 25000);
  assert.equal(d.summary.net, d.summary.gross + d.summary.feeRevenue - d.summary.carrierFee, 'đối soát tổng');
  assert.equal(d.cardFees.available, false);
  // Có vận đơn nhưng chưa biết phí → cờ cảnh báo, không tính 0 lặng lẽ.
  await f.db.update(salesOrders).set({ posSnapshot: JSON.stringify({ ...snap, ghn: { orderCode: 'GHNTEST' } }) }).where(eq(salesOrders.id, orderId));
  const d2 = ok(await f.call(`/profit?from=${day}&to=${day}`, f.mgr));
  assert.equal(d2.summary.carrierUnknownOrders, 1);
});
