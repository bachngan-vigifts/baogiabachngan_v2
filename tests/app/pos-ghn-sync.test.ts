import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { setup } from '../helpers/pos-fixture.ts';
import { customerPayments, deliveries, salesOrders } from '../../src/modules/sales/schema.ts';
import { stockBalances, stockMoves } from '../../src/modules/inventory/schema.ts';
import { syncPosLockGhn } from '../../src/modules/sales/api/pos-ghn-sync.ts';

const delivery = { address: '123 Test', receiverName: 'Khách', receiverPhone: '0901234567', plannedDate: '2026-10-22' };

test('GHN Lock: lấy hàng trừ kho một lần; giao xong hoàn tất và ghi nhận COD một lần', async () => {
  const f = await setup(), shift = await f.open();
  const made = await f.call('/pos/checkout', f.emp, 'POST', f.cart(shift.id, {
    fulfillmentMode: 'cod', delivery, note: 'GHN-ABC1234', depositAmount: 0,
  }));
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const [ship] = await f.db.select().from(deliveries);
  assert.equal(ship!.trackingCode, 'ABC1234');
  let ghnStatus = 'picked';
  f.env.ghnToken = 'test-ghn-token';
  f.env.ghnFetch = (async (_input, init) => {
    assert.equal((init?.headers as Record<string, string>).Token, 'test-ghn-token');
    assert.equal((init?.headers as Record<string, string>).ShopId, '6096731');
    assert.deepEqual(JSON.parse(String(init?.body)), { order_code: 'ABC1234' });
    return Response.json({ data: { order_code: 'ABC1234', status: ghnStatus, updated_date: '2026-10-22T02:00:00Z' } });
  }) as typeof fetch;

  assert.deepEqual(await syncPosLockGhn(f.env), { ok: true, checked: 1, updated: 1, errors: [] });
  assert.equal((await f.db.select().from(deliveries))[0]!.status, 'in_transit');
  assert.equal((await f.db.select().from(salesOrders).where(eq(salesOrders.id, made.data.id)))[0]!.status, 'delivering');
  assert.equal((await f.db.select().from(stockBalances))[0]!.qty, 8, 'trừ kho lúc GHN đã lấy hàng');
  assert.equal((await f.db.select().from(customerPayments)).length, 0);

  await syncPosLockGhn(f.env);
  assert.equal((await f.db.select().from(stockBalances))[0]!.qty, 8, 'poll lặp không trừ kho lần hai');
  assert.equal((await f.db.select().from(stockMoves).where(eq(stockMoves.refId, ship!.id))).length, 1);

  ghnStatus = 'delivered';
  await syncPosLockGhn(f.env);
  assert.equal((await f.db.select().from(deliveries))[0]!.status, 'delivered');
  assert.equal((await f.db.select().from(salesOrders).where(eq(salesOrders.id, made.data.id)))[0]!.status, 'delivered');
  assert.equal((await f.db.select().from(stockBalances))[0]!.qty, 8, 'giao xong không trừ kho lại');
  const receipts = await f.db.select().from(customerPayments);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0]!.amount, 194400);
  assert.equal(receipts[0]!.paymentSource, 'ghn_cod');
  assert.equal(receipts[0]!.shiftId, null, 'tiền GHN không tự cộng vào két tiền mặt');
  assert.equal((await syncPosLockGhn(f.env)).checked, 0, 'đơn hoàn thành không bị poll lại');
  assert.equal((await f.db.select().from(customerPayments)).length, 1, 'không ghi thu trùng');
});

test('Đồng bộ GHN ngay trong CRM: cần quyền bán hàng nhanh, báo rõ khi chưa có token, bấm liên tục không gọi GHN lại', async () => {
  const { resetGhnSyncThrottle } = await import('../../src/modules/sales/api/pos-ghn-sync.ts');
  resetGhnSyncThrottle();
  const f = await setup(), shift = await f.open();
  assert.equal((await f.call('/pos/checkout', f.emp, 'POST', f.cart(shift.id, { fulfillmentMode: 'cod', delivery, note: 'GHN-XYZ9876', depositAmount: 0 }))).status, 201);
  const noToken = await f.call('/pos/ghn/sync', f.emp, 'POST', {});
  assert.equal(noToken.status, 503); assert.match(noToken.data.error, /GHN_API_TOKEN/);
  assert.equal((await f.call('/pos/ghn/sync', f.ncc, 'POST', {})).status, 403, 'NCC không được đồng bộ');
  let calls = 0;
  f.env.ghnToken = 'test-ghn-token';
  f.env.ghnFetch = (async () => { calls++; return Response.json({ data: { status: 'delivered', updated_date: '2026-10-22T03:00:00Z' } }); }) as typeof fetch;
  const first = await f.call('/pos/ghn/sync', f.emp, 'POST', {});
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(first.data.checked, 1); assert.equal(first.data.updated, 1); assert.equal(first.data.cached, false);
  assert.equal((await f.db.select().from(deliveries))[0]!.status, 'delivered');
  const again = await f.call('/pos/ghn/sync', f.emp, 'POST', {});
  assert.equal(again.data.cached, true); assert.equal(calls, 1, 'trong 60 giây không gọi GHN lại');
  resetGhnSyncThrottle();
});
