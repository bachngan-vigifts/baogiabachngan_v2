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

test('GHN hoàn hàng: huỷ đơn đóng cả chuyến thất bại; nhận hàng hoàn cộng kho một lần; GHN báo lại không xuất kho / ghi thu trên đơn đã huỷ', async () => {
  const f = await setup(), shift = await f.open();
  const made = await f.call('/pos/checkout', f.emp, 'POST', f.cart(shift.id, { fulfillmentMode: 'cod', delivery, note: 'GHN-RET1234', depositAmount: 0 }));
  assert.equal(made.status, 201, JSON.stringify(made.data));
  let ghnStatus = 'picked';
  f.env.ghnToken = 'test-ghn-token';
  f.env.ghnFetch = (async () => Response.json({ data: { status: ghnStatus, updated_date: '2026-10-22T02:00:00Z' } })) as typeof fetch;
  await syncPosLockGhn(f.env);
  assert.equal((await f.db.select().from(stockBalances))[0]!.qty, 8, 'GHN lấy hàng: trừ kho');
  ghnStatus = 'returned';
  await syncPosLockGhn(f.env);
  assert.equal((await f.db.select().from(deliveries))[0]!.status, 'failed');

  const cancelled = await f.call('/orders/' + made.data.id + '/status', f.mgr, 'PUT', { status: 'cancelled' });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data));
  assert.equal((await f.db.select().from(deliveries))[0]!.status, 'cancelled', 'chuyến thất bại cũng huỷ theo đơn');
  assert.equal((await syncPosLockGhn(f.env)).checked, 0, 'đơn đã huỷ không còn bị poll GHN');

  const back = await f.call('/pos/orders/' + made.data.id + '/receive-cancelled-stock', f.emp, 'POST', {});
  assert.equal(back.status, 200, JSON.stringify(back.data));
  assert.equal((await f.db.select().from(stockBalances))[0]!.qty, 10, 'nhận hàng hoàn: kho về đủ');
  assert.equal((await f.call('/pos/orders/' + made.data.id + '/receive-cancelled-stock', f.emp, 'POST', {})).data.replayed, true);

  // Dù chuyến còn mở (dữ liệu cũ trước bản sửa), GHN báo "delivered" trên đơn đã huỷ không được xuất kho lại hay ghi thu COD.
  await f.db.update(deliveries).set({ status: 'failed' });
  ghnStatus = 'delivered';
  await syncPosLockGhn(f.env);
  assert.equal((await f.db.select().from(stockBalances))[0]!.qty, 10, 'không trừ kho lần hai');
  assert.equal((await f.db.select().from(customerPayments)).length, 0, 'không ghi thu COD trên đơn đã huỷ');
  assert.equal((await f.db.select().from(deliveries))[0]!.status, 'failed');
});

test('COD đã thu cọc, GHN hoàn hàng: không huỷ thẳng; thu hồi → duyệt huỷ đơn → nhận hàng về kho → hoàn đúng số cọc', async () => {
  const { salesOrderLines } = await import('../../src/modules/sales/schema.ts');
  const f = await setup(), shift = await f.open();
  const made = await f.call('/pos/checkout', f.emp, 'POST', f.cart(shift.id, { fulfillmentMode: 'cod', delivery, note: 'GHN-DEP1234', depositAmount: 50000 }));
  assert.equal(made.status, 201, JSON.stringify(made.data));
  let ghnStatus = 'picked';
  f.env.ghnToken = 'test-ghn-token';
  f.env.ghnFetch = (async () => Response.json({ data: { status: ghnStatus, updated_date: '2026-10-22T02:00:00Z' } })) as typeof fetch;
  await syncPosLockGhn(f.env);
  assert.equal((await f.db.select().from(stockBalances))[0]!.qty, 8, 'GHN lấy hàng: trừ kho');
  ghnStatus = 'returned'; await syncPosLockGhn(f.env);

  const cancel = await f.call('/orders/' + made.data.id + '/status', f.mgr, 'PUT', { status: 'cancelled' });
  assert.equal(cancel.status, 409); assert.equal(cancel.data.code, 'COD_DEPOSIT_RECOVER', 'chỉ đường sang thu hồi');

  const view = (await f.call('/pos/returns?orderId=' + made.data.id, f.emp)).data;
  assert.equal(view.recoveringIssued, true, 'đơn COD đã xuất chưa giao được thu hồi');
  const lines = await f.db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, made.data.id));
  const req = await f.call('/pos/returns', f.emp, 'POST', { key: crypto.randomUUID(), orderId: made.data.id, shiftId: shift.id, reason: 'GHN hoàn hàng',
    lines: lines.map(l => ({ orderLineId: l.id, qty: l.qty })) });
  assert.equal(req.status, 201, JSON.stringify(req.data)); assert.equal(req.data.requestContext, 'after_issue');
  assert.equal((await f.call('/pos/returns/' + req.data.id + '/approve', f.mgr, 'POST', {})).status, 200);
  assert.equal((await f.db.select().from(salesOrders).where(eq(salesOrders.id, made.data.id)))[0]!.status, 'cancelled');
  assert.equal((await f.db.select().from(deliveries))[0]!.status, 'cancelled');
  const got = await f.call('/pos/returns/' + req.data.id + '/receive', f.emp, 'POST', { shiftId: shift.id, confirmed: true });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.equal((await f.db.select().from(stockBalances))[0]!.qty, 10, 'nhận hàng hoàn: kho về đủ');
  const refund = (amount: number) => f.call('/pos/returns/' + req.data.id + '/refund', f.emp, 'POST', { key: crypto.randomUUID(), shiftId: shift.id, confirmed: true, amount, method: 'cash' });
  assert.equal((await refund(50001)).status, 409, 'không hoàn quá số cọc đã thu');
  assert.equal((await refund(50000)).status, 201);
  // Đơn đã huỷ: GHN báo lại không xuất kho / ghi thu.
  ghnStatus = 'delivered'; await syncPosLockGhn(f.env);
  assert.equal((await f.db.select().from(stockBalances))[0]!.qty, 10);
});

test('thu hồi COD chờ duyệt mà đơn kịp giao tới khách: không duyệt được (không huỷ đơn đã giao)', async () => {
  const { salesOrderLines } = await import('../../src/modules/sales/schema.ts');
  const f = await setup(), shift = await f.open();
  const made = await f.call('/pos/checkout', f.emp, 'POST', f.cart(shift.id, { fulfillmentMode: 'cod', delivery, note: 'GHN-LATE123', depositAmount: 0 }));
  f.env.ghnToken = 'test-ghn-token';
  f.env.ghnFetch = (async () => Response.json({ data: { status: 'picked', updated_date: '2026-10-22T02:00:00Z' } })) as typeof fetch;
  await syncPosLockGhn(f.env);
  const lines = await f.db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, made.data.id));
  const req = await f.call('/pos/returns', f.emp, 'POST', { key: crypto.randomUUID(), orderId: made.data.id, shiftId: shift.id, reason: 'Tưởng GHN hoàn',
    lines: lines.map(l => ({ orderLineId: l.id, qty: l.qty })) });
  assert.equal(req.status, 201, JSON.stringify(req.data));
  await f.db.update(salesOrderLines).set({ deliveredQty: lines[0]!.qty }).where(eq(salesOrderLines.id, lines[0]!.id));
  const approve = await f.call('/pos/returns/' + req.data.id + '/approve', f.mgr, 'POST', {});
  assert.equal(approve.status, 409); assert.equal(approve.data.code, 'ORDER_DELIVERED');
  assert.notEqual((await f.db.select().from(salesOrders).where(eq(salesOrders.id, made.data.id)))[0]!.status, 'cancelled');
});
