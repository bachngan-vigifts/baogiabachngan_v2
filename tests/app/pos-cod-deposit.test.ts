import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { setup } from '../helpers/pos-fixture.ts';
import { customerPayments, deliveries, salesOrders } from '../../src/modules/sales/schema.ts';
import { stockBalances } from '../../src/modules/inventory/schema.ts';

const delivery = { address: '123 Test', receiverName: 'Khách', receiverPhone: '0901234567', plannedDate: '2026-10-19' };

test('COD thu trước tiền mặt vào ca hiện tại, giữ hàng, ca sau chỉ thu còn lại; retry không ghi hai lần', async () => {
  const f = await setup(), shift = await f.open();
  const body = f.cart(shift.id, { fulfillmentMode: 'cod', delivery, depositAmount: 50000, method: 'cash' });
  const [a, b] = await Promise.all([f.call('/pos/checkout', f.emp, 'POST', body), f.call('/pos/checkout', f.emp, 'POST', body)]);
  assert.equal(a.status, 201, JSON.stringify(a.data)); assert.equal(b.status, 201, JSON.stringify(b.data)); assert.equal(a.data.id, b.data.id);
  assert.equal(a.data.depositAmount, 50000); assert.equal(a.data.codAmount, 144400);
  assert.equal((await f.db.select().from(customerPayments)).length, 1);
  assert.equal((await f.db.select().from(stockBalances))[0]!.qty, 10, 'chưa giao thì giữ hàng, chưa trừ kho');
  assert.equal((await f.call('/pos/checkout', f.emp, 'POST', { ...body, depositAmount: 60000 })).status, 409);
  let report = (await f.call('/pos/shifts/' + shift.id, f.emp)).data;
  assert.equal(report.cash, 50000); assert.equal(report.expectedCash, 550000);
  const [ship] = await f.db.select().from(deliveries); assert.equal(ship!.codAmount, 144400);
  assert.equal((await f.call('/deliveries/' + ship!.id + '/status', f.mgr, 'PUT', { status: 'delivered' })).status, 200);
  report = (await f.call('/pos/shifts/' + shift.id, f.emp)).data;
  assert.equal(report.cod.pending.amount, 144400);
  assert.equal((await f.call('/pos/shifts/' + shift.id + '/close', f.emp, 'POST', { countedCash: 550000 })).status, 200);
  const next = await f.open(f.other);
  const collect = { key: crypto.randomUUID(), shiftId: next.id, method: 'cash', confirmed: true };
  const paid = await f.call('/pos/cod/' + ship!.id + '/collect', f.other, 'POST', collect); assert.equal(paid.status, 201, JSON.stringify(paid.data));
  assert.equal((await f.call('/pos/cod/' + ship!.id + '/collect', f.other, 'POST', collect)).status, 201);
  report = (await f.call('/pos/shifts/' + next.id, f.other)).data;
  assert.equal(report.cash, 144400); assert.equal(report.cod.pending.amount, 0);
  const receipts = await f.db.select().from(customerPayments); assert.equal(receipts.length, 2); assert.equal(receipts.reduce((n, p) => n + p.amount, 0), 194400);
  assert.equal((await f.call('/pos/shifts/' + shift.id, f.emp)).data.cod.pending.amount, 144400, 'giữ nguyên ca cũ');
});

test('COD chuyển khoản thu trước cần xác nhận, không vào két; được thu đủ trước khi giao', async () => {
  const f = await setup(), shift = await f.open();
  const body = f.cart(shift.id, { fulfillmentMode: 'cod', delivery, depositAmount: 194400, method: 'transfer' });
  assert.equal((await f.call('/pos/checkout', f.emp, 'POST', body)).status, 400);
  const made = await f.call('/pos/checkout', f.emp, 'POST', { ...body, confirmed: true });
  assert.equal(made.status, 201, JSON.stringify(made.data)); assert.equal(made.data.codAmount, 0);
  const report = (await f.call('/pos/shifts/' + shift.id, f.emp)).data;
  assert.equal(report.cash, 0); assert.equal(report.transfer, 194400); assert.equal(report.expectedCash, 500000);
  assert.equal((await f.db.select().from(deliveries))[0]!.codAmount, 0);
  assert.equal((await f.db.select().from(customerPayments))[0]!.amount, 194400);
});

test('COD từ chối thu trước không hợp lệ/quá tổng và form thiếu địa chỉ: không tạo phiếu hay đơn dở', async () => {
  const f = await setup(), shift = await f.open();
  for (const depositAmount of [-1, 1.5, 194401, 'abc']) {
    const res = await f.call('/pos/checkout', f.emp, 'POST', f.cart(shift.id, { fulfillmentMode: 'cod', delivery, depositAmount }));
    assert.equal(res.status, 400, JSON.stringify(res.data));
  }
  assert.equal((await f.call('/pos/checkout', f.emp, 'POST', f.cart(shift.id, { depositAmount: 1 }))).status, 400);
  assert.equal((await f.call('/pos/checkout', f.emp, 'POST', f.cart(shift.id, { fulfillmentMode: 'cod', delivery: {}, depositAmount: 50000 }))).status, 400);
  assert.equal((await f.db.select().from(customerPayments)).length, 0);
  assert.equal((await f.db.select().from(salesOrders)).length, 0);
  const made = await f.call('/pos/checkout', f.emp, 'POST', f.cart(shift.id, { fulfillmentMode: 'cod', delivery, depositAmount: 0 }));
  assert.equal(made.status, 201, JSON.stringify(made.data)); assert.equal((await f.db.select().from(customerPayments)).length, 0);
  assert.equal((await f.db.select().from(deliveries))[0]!.codAmount, 194400);
});

test('huỷ phiếu thu trước có lý do trả khoản đó về COD còn phải thu, không cộng hàng về kho', async () => {
  const f = await setup(), shift = await f.open();
  const made = await f.call('/pos/checkout', f.emp, 'POST', f.cart(shift.id, { fulfillmentMode: 'cod', delivery, depositAmount: 50000 }));
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const [receipt] = await f.db.select().from(customerPayments), [ship] = await f.db.select().from(deliveries);
  assert.equal((await f.call('/payments/' + receipt!.id + '/void', f.mgr, 'POST', { reason: 'Ghi nhầm tiền cọc' })).status, 200);
  assert.equal((await f.db.select().from(deliveries).where(eq(deliveries.id, ship!.id)))[0]!.codAmount, 194400);
  // Gửi lại y hệt sau khi mạng rớt: báo đã huỷ (không lỗi) và không trả COD lần hai; lý do khác vẫn bị chặn.
  const again = await f.call('/payments/' + receipt!.id + '/void', f.mgr, 'POST', { reason: 'Ghi nhầm tiền cọc' });
  assert.equal(again.status, 200); assert.equal(again.data.alreadyApplied, true);
  assert.equal((await f.db.select().from(deliveries).where(eq(deliveries.id, ship!.id)))[0]!.codAmount, 194400);
  assert.equal((await f.call('/payments/' + receipt!.id + '/void', f.mgr, 'POST', { reason: 'Lý do khác' })).status, 409);
  assert.equal((await f.call('/pos/shifts/' + shift.id, f.emp)).data.cash, 0);
  assert.equal((await f.db.select().from(stockBalances))[0]!.qty, 10);
});

test('đã có vận đơn GHN: không huỷ phiếu cọc (GHN thu hộ số cũ – tránh ghi thu thừa khi GHN giao xong)', async () => {
  const f = await setup(), shift = await f.open();
  const made = await f.call('/pos/checkout', f.emp, 'POST', f.cart(shift.id, { fulfillmentMode: 'cod', delivery, depositAmount: 50000 }));
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const [receipt] = await f.db.select().from(customerPayments), [ship] = await f.db.select().from(deliveries);
  await f.db.update(deliveries).set({ trackingCode: 'GHN123', carrier: 'GHN' }).where(eq(deliveries.id, ship!.id));
  const res = await f.call('/payments/' + receipt!.id + '/void', f.mgr, 'POST', { reason: 'Ghi nhầm tiền cọc' });
  assert.equal(res.status, 409); assert.equal(res.data.code, 'COD_SHIPMENT_EXISTS');
  assert.equal((await f.db.select().from(customerPayments))[0]!.voidedAt, null, 'phiếu cọc giữ nguyên');
  assert.equal((await f.db.select().from(deliveries))[0]!.codAmount, 144400, 'tiền thu hộ không đổi');
});
