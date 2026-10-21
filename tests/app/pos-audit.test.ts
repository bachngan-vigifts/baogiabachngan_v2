import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { setup } from '../helpers/pos-fixture.ts';
import { customerPayments, deliveries, salesOrders } from '../../src/modules/sales/schema.ts';
import { posPaymentRequests } from '../../src/modules/sales/pos-schema.ts';
import { posOrderReservations } from '../../src/modules/sales/pos-order-flow-schema.ts';
import { RULES } from '../../src/modules/tasks/api/auto-tasks.ts';

const ok = (r: { status: number; data: unknown }, status = 200) => assert.equal(r.status, status, JSON.stringify(r.data));
const delivery = { address: '123 Test', receiverName: 'Khách', receiverPhone: '0901234567', plannedDate: '2026-10-19' };
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

test('giỏ đã nhận chuyển khoản QR không thu lại bằng tiền mặt / COD; chọn Chuyển khoản thì tự gắn đúng khoản QR', async () => {
  const f = await setup(), s = await f.open(), body = f.cart(s.id), qr = await f.call('/pos/qr', f.emp, 'POST', body);
  ok(qr);
  await f.db.update(posPaymentRequests).set({ confirmedAt: new Date().toISOString() }).where(eq(posPaymentRequests.id, qr.data.id));
  const cash = await f.call('/pos/checkout', f.emp, 'POST', { ...body, key: crypto.randomUUID(), method: 'cash', tendered: 500000 });
  ok(cash, 409); assert.equal(cash.data.code, 'POS_QR_ALREADY_PAID');
  const cod = await f.call('/pos/checkout', f.emp, 'POST', { ...body, key: crypto.randomUUID(), fulfillmentMode: 'cod', delivery });
  ok(cod, 409); assert.equal(cod.data.code, 'POS_QR_ALREADY_PAID');
  assert.equal((await f.db.select().from(customerPayments)).length, 0, 'không ghi thu lần hai');
  const done = await f.call('/pos/checkout', f.emp, 'POST', { ...body, key: crypto.randomUUID(), method: 'transfer', confirmed: true });
  ok(done, 201);
  const [order] = await f.db.select().from(salesOrders).where(eq(salesOrders.id, done.data.id));
  assert.equal(order!.posPaymentRequestId, qr.data.id, 'gắn khoản QR đã nhận thay vì tạo khoản chuyển khoản mới');
  ok(await f.call('/pos/checkout', f.emp, 'POST', { ...body, key: crypto.randomUUID(), method: 'cash', tendered: 500000 }), 201);
});

test('việc tự sinh: COD đã giao ≥ 2 ngày chưa thu; tự hoàn thành khi thu đủ', async () => {
  const f = await setup(), s = await f.open();
  ok(await f.call('/pos/checkout', f.emp, 'POST', f.cart(s.id, { fulfillmentMode: 'cod', delivery })), 201);
  const [ship] = await f.db.select().from(deliveries);
  ok(await f.call('/deliveries/' + ship!.id + '/status', f.mgr, 'PUT', { status: 'delivered' }));
  assert.equal((await RULES.posCodUncollected!(f.db, '')).length, 0, 'vừa giao: chưa nhắc');
  await f.db.update(deliveries).set({ deliveredAt: daysAgo(3) }).where(eq(deliveries.id, ship!.id));
  const due = await RULES.posCodUncollected!(f.db, '');
  assert.equal(due.length, 1); assert.equal(due[0]!.autoKey, 'pos-cod:' + ship!.id); assert.match(due[0]!.description!, /194\.400 đ/);
  ok(await f.call('/pos/cod/' + ship!.id + '/collect', f.emp, 'POST', { key: crypto.randomUUID(), shiftId: s.id, method: 'cash', confirmed: true }), 201);
  assert.equal((await RULES.posCodUncollected!(f.db, '')).length, 0);
});

test('việc tự sinh: chuyển khoản cọc chờ xác nhận và đơn cọc sắp hết hạn giữ hàng', async () => {
  const f = await setup(), s = await f.open();
  const made = await f.call('/pos/order-flows/checkout', f.emp, 'POST', f.cart(s.id, { saleFlow: 'deposit', method: 'transfer', confirmed: false }));
  ok(made, 201);
  const pending = await RULES.posTransferPending!(f.db, '');
  assert.equal(pending.length, 1); assert.match(pending[0]!.title, /Xác nhận chuyển khoản cọc/); assert.equal(pending[0]!.link, '#/orders/' + made.data.id);
  assert.equal((await RULES.posHoldExpiring!(f.db, '')).length, 0, 'còn 5 ngày: chưa nhắc');
  await f.db.update(posOrderReservations).set({ expiresAt: new Date(Date.now() + 3_600_000).toISOString() }).where(eq(posOrderReservations.orderId, made.data.id));
  const hold = await RULES.posHoldExpiring!(f.db, '');
  assert.equal(hold.length, 1); assert.match(hold[0]!.title, /sắp hết hạn giữ hàng/);
  await f.db.update(posOrderReservations).set({ expiresAt: daysAgo(1) }).where(eq(posOrderReservations.orderId, made.data.id));
  assert.match((await RULES.posHoldExpiring!(f.db, ''))[0]!.title, /đã hết hạn giữ hàng/);
});
