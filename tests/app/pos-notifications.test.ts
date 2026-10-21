import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from '../helpers/pos-fixture.ts';

async function posNotifications(fixture: Awaited<ReturnType<typeof setup>>, cookie: string) {
  const response = await fixture.call('/notifications', cookie);
  assert.equal(response.status, 200, JSON.stringify(response.data));
  return response.data.notifications.filter((item: any) => item.eventType === 'pos_order_created');
}

test('Bán hàng nhanh báo Manager đúng một lần khi checkout bị gửi lại', async () => {
  const fixture = await setup();
  const shift = await fixture.open();
  const body = fixture.cart(shift.id);

  const created = await fixture.call('/pos/checkout', fixture.emp, 'POST', body);
  const replayed = await fixture.call('/pos/checkout', fixture.emp, 'POST', body);

  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(replayed.status, 201, JSON.stringify(replayed.data));
  assert.equal(replayed.data.id, created.data.id);

  const managerNotifications = await posNotifications(fixture, fixture.mgr);
  assert.equal(managerNotifications.length, 1, 'request idempotent không được Web Push lần hai');
  assert.equal(managerNotifications[0].title, 'Đơn Bán hàng nhanh mới');
  assert.equal(managerNotifications[0].url, `/index.html#/orders/${created.data.id}`);
  assert.equal(managerNotifications[0].data.orderId, created.data.id);
  assert.equal((await posNotifications(fixture, fixture.emp)).length, 0, 'người tạo không tự nhận thông báo');
});

test('Đơn Bán hàng nhanh đặt cọc cũng báo Manager và không báo trùng', async () => {
  const fixture = await setup();
  const shift = await fixture.open();
  const body = fixture.cart(shift.id, { saleFlow: 'deposit' });

  const created = await fixture.call('/pos/order-flows/checkout', fixture.emp, 'POST', body);
  const replayed = await fixture.call('/pos/order-flows/checkout', fixture.emp, 'POST', body);

  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(replayed.status, 201, JSON.stringify(replayed.data));
  assert.equal(replayed.data.id, created.data.id);
  assert.equal((await posNotifications(fixture, fixture.mgr)).length, 1);
});
