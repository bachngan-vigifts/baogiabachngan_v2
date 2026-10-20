import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, sql } from 'drizzle-orm';
import { setup } from '../helpers/pos-fixture.ts';
import {
  customerPayments,
  deliveries,
  salesOrders,
  salesOrderLines,
  packingSlips,
} from '../../src/modules/sales/schema.ts';
import {
  posOrderReservations,
  posPaymentIntents,
} from '../../src/modules/sales/pos-order-flow-schema.ts';
import {
  posReturns,
  posRefunds,
} from '../../src/modules/sales/return-schema.ts';
import {
  stockBalances,
  stockMoves,
} from '../../src/modules/inventory/schema.ts';
import { reservedBySku } from '../../src/modules/sales/api/pos-store.ts';
const delivery = {
  receiverName: 'Khách thử',
  receiverPhone: '0901234567',
  address: '123 Cần Thơ',
  plannedDate: '2026-10-25',
};
const ok = (r: any, status = 200) =>
  assert.equal(r.status, status, JSON.stringify(r.data));
const key = () => crypto.randomUUID();
test('cọc 30% giữ đúng một lần; thu nốt ca khác và xuất đúng một lần; ca đã kết bất biến', async () => {
  const f = await setup({ viaClaw: true }),
    s = await f.open(),
    b = f.cart(s.id, { saleFlow: 'deposit' });
  assert.equal((await f.call('/pos/options', f.emp)).data.orderFlowVersion, 1);
  const [a, retry] = await Promise.all([
    f.call('/pos/order-flows/checkout', f.emp, 'POST', b),
    f.call('/pos/checkout', f.emp, 'POST', b),
  ]);
  ok(a, 201);
  ok(retry, 201);
  assert.equal(a.data.id, retry.data.id);
  assert.equal(a.data.initialAmount, 58320);
  assert.equal(f.hooks.length, 0);
  assert.equal((await f.db.select().from(stockBalances))[0]!.qty, 10);
  assert.equal(
    (await reservedBySku(f.db, ['00123'], 'pos-wh')).get('00123'),
    2,
  );
  let r = (await f.call('/pos/shifts/' + s.id, f.emp)).data;
  assert.equal(r.cash, 58320);
  assert.equal(r.orderFlows.deposit, 58320);
  assert.equal(r.expectedCash, 558320);
  const lines = await f.db.select().from(salesOrderLines);
  assert.equal(lines[0]!.deliveredQty, 0);
  ok(
    await f.call('/pos/order-flows/' + a.data.id + '/collect', f.emp, 'POST', {
      key: key(),
      shiftId: s.id,
      amount: 0,
      method: 'cash',
      pickup: true,
    }),
    400,
  );
  ok(
    await f.call('/pos/shifts/' + s.id + '/close', f.emp, 'POST', {
      countedCash: 558320,
    }),
  );
  const frozen = (await f.call('/pos/shifts/' + s.id, f.emp)).data;
  const next = await f.open(f.other);
  ok(await f.call('/orders/' + a.data.id, f.other));
  const collect = {
    key: key(),
    shiftId: next.id,
    amount: 136080,
    method: 'cash',
    pickup: true,
  };
  const [c, d] = await Promise.all([
    f.call(
      '/pos/order-flows/' + a.data.id + '/collect',
      f.other,
      'POST',
      collect,
    ),
    f.call(
      '/pos/order-flows/' + a.data.id + '/collect',
      f.other,
      'POST',
      collect,
    ),
  ]);
  ok(c, 201);
  ok(d, 201);
  assert.equal(c.data.order.status, 'delivered');
  assert.equal((await f.db.select().from(stockBalances))[0]!.qty, 8);
  assert.equal(
    (await reservedBySku(f.db, ['00123'], 'pos-wh')).get('00123') || 0,
    0,
  );
  assert.equal((await f.db.select().from(customerPayments)).length, 2);
  assert.equal(
    (await f.db.select().from(stockMoves)).filter(
      (m) => m.refType === 'pos_order',
    ).length,
    1,
  );
  assert.equal(
    (await f.call('/pos/shifts/' + next.id, f.other)).data.orderFlows.balance,
    136080,
  );
  assert.deepEqual((await f.call('/pos/shifts/' + s.id, f.emp)).data, frozen);
  ok(
    await f.call(
      '/pos/order-flows/' + a.data.id + '/collect',
      f.other,
      'POST',
      { ...collect, pickup: false },
    ),
    409,
  );
});
test('chuyển khoản cọc pending không vào két; xác nhận ca sau, đồng thời chỉ một phiếu; huỷ không mở lại intent', async () => {
  const f = await setup(),
    s = await f.open(),
    a = await f.call(
      '/pos/checkout',
      f.emp,
      'POST',
      f.cart(s.id, { saleFlow: 'deposit', method: 'transfer' }),
    );
  ok(a, 201);
  assert.equal((await f.db.select().from(customerPayments)).length, 0);
  let report = (await f.call('/pos/shifts/' + s.id, f.emp)).data;
  assert.equal(report.cash, 0);
  assert.equal(report.transfer, 0);
  assert.equal(report.orderFlows.pending.amount, 58320);
  const [i] = await f.db.select().from(posPaymentIntents);
  assert.ok(i);
  ok(
    await f.call('/pos/shifts/' + s.id + '/close', f.emp, 'POST', {
      countedCash: 500000,
    }),
  );
  const next = await f.open(f.other);
  const body = { shiftId: next.id, confirmed: true, reference: 'BANK-REF-1' };
  const [x, y] = await Promise.all([
    f.call(
      '/pos/order-flow-intents/' + i.id + '/confirm',
      f.other,
      'POST',
      body,
    ),
    f.call(
      '/pos/order-flow-intents/' + i.id + '/confirm',
      f.other,
      'POST',
      body,
    ),
  ]);
  ok(x);
  ok(y);
  assert.equal(x.data.paid, 58320);
  const ps = await f.db.select().from(customerPayments);
  assert.equal(ps.length, 1);
  assert.equal(ps[0]!.shiftId, next.id);
  assert.equal(
    (await f.call('/pos/shifts/' + next.id, f.other)).data.transfer,
    58320,
  );
  ok(
    await f.call(
      '/pos/order-flow-intents/' + i.id + '/cancel',
      f.other,
      'POST',
      { shiftId: next.id, reason: 'Nhầm' },
    ),
    409,
  );
  ok(
    await f.call(
      '/pos/order-flow-intents/' + i.id + '/confirm',
      f.other,
      'POST',
      { ...body, reference: 'OTHER' },
    ),
    409,
  );
});
test('hết hạn nhả giữ; không thu nốt khi hàng đã bán; giữ lại sau nhập và nhận đủ mới xuất', async () => {
  const f = await setup(),
    s = await f.open(),
    a = await f.call(
      '/pos/checkout',
      f.emp,
      'POST',
      f.cart(s.id, { saleFlow: 'deposit' }),
    );
  ok(a, 201);
  await f.db
    .update(posOrderReservations)
    .set({ expiresAt: '2020-01-01T00:00:00.000Z' });
  assert.equal(
    (await reservedBySku(f.db, ['00123'], 'pos-wh')).get('00123') || 0,
    0,
  );
  ok(
    await f.call(
      '/pos/checkout',
      f.emp,
      'POST',
      f.cart(s.id, { rows: [{ sku: '00123', qty: 10 }], tendered: 1080000 }),
    ),
    201,
  );
  const b = {
    key: key(),
    shiftId: s.id,
    amount: 136080,
    method: 'cash',
    pickup: true,
  };
  ok(
    await f.call(
      '/pos/order-flows/' + a.data.id + '/collect',
      f.emp,
      'POST',
      b,
    ),
    409,
  );
  assert.equal((await f.db.select().from(customerPayments)).length, 2);
  await f.db
    .update(stockBalances)
    .set({ qty: 2 })
    .where(eq(stockBalances.sku, '00123'));
  ok(
    await f.call('/pos/order-flows/' + a.data.id + '/hold', f.emp, 'POST', {
      shiftId: s.id,
    }),
  );
  ok(
    await f.call(
      '/pos/order-flows/' + a.data.id + '/collect',
      f.emp,
      'POST',
      b,
    ),
    201,
  );
  assert.equal((await f.db.select().from(stockBalances))[0]!.qty, 0);
});
test('ship pending chặn đóng gói/giao; nhận đủ COD0, packing rồi giao không xuất hay giữ hai lần', async () => {
  const f = await setup(),
    s = await f.open(),
    a = await f.call(
      '/pos/checkout',
      f.emp,
      'POST',
      f.cart(s.id, { saleFlow: 'prepaid', method: 'transfer', delivery }),
    );
  ok(a, 201);
  const [l] = await f.db.select().from(salesOrderLines),
    [d] = await f.db.select().from(deliveries);
  assert.equal(d!.codAmount, 0);
  const pack = {
    allocations: [{ orderLineId: l!.id, qty: 2, source: 'warehouse' }],
    send: true,
  };
  ok(
    await f.call('/orders/' + a.data.id + '/packing', f.mgr, 'POST', pack),
    409,
  );
  ok(
    await f.call('/deliveries/' + d!.id + '/status', f.mgr, 'PUT', {
      status: 'delivered',
    }),
    409,
  );
  const [i] = await f.db.select().from(posPaymentIntents);
  ok(
    await f.call(
      '/pos/order-flow-intents/' + i!.id + '/confirm',
      f.emp,
      'POST',
      { shiftId: s.id, confirmed: true, reference: 'PREPAID' },
    ),
  );
  const made = await f.call(
    '/orders/' + a.data.id + '/packing',
    f.mgr,
    'POST',
    pack,
  );
  ok(made, 201);
  const slipId = made.data.slips[0].id;
  if ((await f.db.select().from(packingSlips))[0]!.status === 'draft')
    ok(await f.call('/packing/' + slipId + '/send', f.mgr, 'POST', {}));
  ok(
    await f.call('/packing/' + slipId + '/confirm', f.mgr, 'POST', {
      warehouseId: 'pos-wh',
      photos: ['data:image/jpeg;base64,' + 'A'.repeat(100)],
    }),
  );
  assert.equal((await f.db.select().from(stockBalances))[0]!.qty, 8);
  assert.equal(
    (await reservedBySku(f.db, ['00123'], 'pos-wh')).get('00123') || 0,
    0,
  );
  ok(
    await f.call('/deliveries/' + d!.id + '/status', f.mgr, 'PUT', {
      status: 'delivered',
    }),
  );
  assert.equal((await f.db.select().from(stockBalances))[0]!.qty, 8);
});
test('huỷ cọc trước xuất: duyệt riêng, không nhập giả; hoàn không vượt thực thu, không hoàn hai lần', async () => {
  const f = await setup(),
    s = await f.open(),
    a = await f.call(
      '/pos/checkout',
      f.emp,
      'POST',
      f.cart(s.id, { saleFlow: 'deposit' }),
    );
  ok(a, 201);
  const body = {
      key: key(),
      shiftId: s.id,
      reason: 'Khách không nhận',
      kind: 'return',
    },
    cancel = await f.call(
      '/pos/order-flows/' + a.data.id + '/cancel',
      f.emp,
      'POST',
      body,
    );
  ok(cancel);
  ok(
    await f.call(
      '/pos/order-flows/' + a.data.id + '/cancel',
      f.emp,
      'POST',
      body,
    ),
  );
  const id = cancel.data.returnId;
  assert.ok(id);
  let detail = (await f.call('/pos/returns?orderId=' + a.data.id, f.emp)).data;
  assert.equal(detail.returns[0].requestContext, 'before_fulfillment');
  assert.equal(detail.account.available, 0);
  ok(await f.call('/pos/returns/' + id + '/approve', f.emp, 'POST', {}), 403);
  ok(await f.call('/pos/returns/' + id + '/approve', f.mgr, 'POST', {}));
  detail = (await f.call('/pos/returns?orderId=' + a.data.id, f.emp)).data;
  assert.equal(detail.account.available, 58320);
  ok(
    await f.call('/pos/returns/' + id + '/receive', f.emp, 'POST', {
      shiftId: s.id,
      confirmed: true,
    }),
    409,
  );
  const refund = {
    key: key(),
    shiftId: s.id,
    confirmed: true,
    amount: 58321,
    method: 'cash',
  };
  ok(
    await f.call('/pos/returns/' + id + '/refund', f.emp, 'POST', refund),
    409,
  );
  const paid = { ...refund, amount: 58320 };
  const [x, y] = await Promise.all([
    f.call('/pos/returns/' + id + '/refund', f.emp, 'POST', paid),
    f.call('/pos/returns/' + id + '/refund', f.emp, 'POST', paid),
  ]);
  ok(x, 201);
  ok(y, 201);
  assert.equal((await f.db.select().from(posRefunds)).length, 1);
  ok(await f.call('/pos/returns/' + id + '/complete', f.emp, 'POST', {}));
  assert.equal((await f.db.select().from(stockBalances))[0]!.qty, 10);
  assert.equal(
    (await f.call('/pos/shifts/' + s.id, f.emp)).data.expectedCash,
    500000,
  );
});
test('từ chối số tiền sai, khóa giá/SL, chặn ghi thu và huỷ qua endpoint chung', async () => {
  const f = await setup(),
    s = await f.open();
  ok(
    await f.call('/pos/order-flows/checkout', f.emp, 'POST', f.cart(s.id)),
    400,
  );
  for (const initialAmount of [0, -1, 1.5, 194401, 'abc'])
    ok(
      await f.call(
        '/pos/checkout',
        f.emp,
        'POST',
        f.cart(s.id, { saleFlow: 'deposit', initialAmount }),
      ),
      400,
    );
  ok(
    await f.call(
      '/pos/checkout',
      f.emp,
      'POST',
      f.cart(s.id, { saleFlow: 'prepaid', initialAmount: 100, delivery }),
    ),
    400,
  );
  const a = await f.call(
    '/pos/checkout',
    f.emp,
    'POST',
    f.cart(s.id, { saleFlow: 'deposit' }),
  );
  ok(a, 201);
  ok(
    await f.call('/payments', f.mgr, 'POST', {
      orderId: a.data.id,
      amount: 1,
      method: 'cash',
    }),
    409,
  );
  ok(
    await f.call('/orders/' + a.data.id + '/status', f.mgr, 'PUT', {
      status: 'cancelled',
    }),
    409,
  );
  const d = (await f.call('/orders/' + a.data.id, f.mgr)).data;
  const l = d.lines[0];
  const edit = await f.call('/orders/' + a.data.id + '/pos', f.mgr, 'PUT', {
    revision: d.order.revision,
    reason: 'Đổi SL',
    lines: [
      {
        id: l.id,
        qty: 3,
        price: l.listUnitPrice,
        discountType: l.discountType,
        discountValue: l.discountValue,
      },
    ],
  });
  assert.ok([400, 409].includes(edit.status), JSON.stringify(edit.data));
  assert.equal((await f.db.select().from(salesOrderLines))[0]!.qty, 2);
});

test('huỷ intent và huỷ phiếu thu không tự tạo tiền; đơn chưa thu huỷ không tạo yêu cầu hoàn', async () => {
  const f = await setup(),
    s = await f.open(),
    a = await f.call(
      '/pos/checkout',
      f.emp,
      'POST',
      f.cart(s.id, { saleFlow: 'deposit', method: 'transfer' }),
    );
  ok(a, 201);
  const [i] = await f.db.select().from(posPaymentIntents);
  ok(
    await f.call(
      '/pos/order-flow-intents/' + i!.id + '/cancel',
      f.emp,
      'POST',
      { shiftId: s.id, reason: 'Chưa chuyển khoản' },
    ),
  );
  ok(
    await f.call(
      '/pos/order-flow-intents/' + i!.id + '/confirm',
      f.emp,
      'POST',
      { shiftId: s.id, confirmed: true, reference: 'late' },
    ),
    409,
  );
  const cancelled = await f.call(
    '/pos/order-flows/' + a.data.id + '/cancel',
    f.emp,
    'POST',
    { key: key(), shiftId: s.id, reason: 'Không lấy', kind: 'return' },
  );
  ok(cancelled);
  assert.equal(cancelled.data.returnId, null);
  assert.equal((await f.db.select().from(customerPayments)).length, 0);
  const b = await f.call(
    '/pos/checkout',
    f.emp,
    'POST',
    f.cart(s.id, { saleFlow: 'deposit' }),
  );
  ok(b, 201);
  await f.db
    .update(posOrderReservations)
    .set({ expiresAt: '2020-01-01T00:00:00.000Z' })
    .where(eq(posOrderReservations.orderId, b.data.id));
  const [p] = await f.db.select().from(customerPayments);
  ok(
    await f.call('/payments/' + p!.id + '/void', f.mgr, 'POST', {
      reason: 'Ghi nhầm',
    }),
  );
  assert.equal(
    (await reservedBySku(f.db, ['00123'], 'pos-wh')).get('00123') || 0,
    0,
    'void không tự gia hạn tồn đã hết hạn',
  );
  assert.equal(
    (await f.call('/pos/order-flows/' + b.data.id, f.emp)).data.paid,
    0,
  );
});
test('bank thực nhận sau hết hạn thiếu hàng vẫn ghi đúng tiền, không cho xuất tới khi giữ lại đủ', async () => {
  const f = await setup(),
    s = await f.open(),
    a = await f.call(
      '/pos/checkout',
      f.emp,
      'POST',
      f.cart(s.id, { saleFlow: 'prepaid', method: 'transfer', delivery }),
    );
  ok(a, 201);
  await f.db
    .update(posOrderReservations)
    .set({ expiresAt: '2020-01-01T00:00:00.000Z' });
  await f.db.update(stockBalances).set({ qty: 0 });
  const [i] = await f.db.select().from(posPaymentIntents);
  const paid = await f.call(
    '/pos/order-flow-intents/' + i!.id + '/confirm',
    f.emp,
    'POST',
    { shiftId: s.id, confirmed: true, reference: 'REAL-DELAYED' },
  );
  ok(paid);
  assert.equal(paid.data.paid, 194400);
  assert.equal(paid.data.held, false);
  const [d] = await f.db.select().from(deliveries);
  ok(
    await f.call('/deliveries/' + d!.id + '/status', f.mgr, 'PUT', {
      status: 'delivered',
    }),
    409,
  );
  await f.db.update(stockBalances).set({ qty: 2 });
  ok(
    await f.call('/pos/order-flows/' + a.data.id + '/hold', f.emp, 'POST', {
      shiftId: s.id,
    }),
  );
  ok(
    await f.call('/deliveries/' + d!.id + '/status', f.mgr, 'PUT', {
      status: 'delivered',
    }),
  );
  assert.equal((await f.db.select().from(stockBalances))[0]!.qty, 0);
});
test('đã đóng gói phải trả hàng: duyệt dừng giao nhưng chỉ nhập tồn và cho hoàn khi thực nhận', async () => {
  const f = await setup(),
    s = await f.open(),
    a = await f.call(
      '/pos/checkout',
      f.emp,
      'POST',
      f.cart(s.id, { saleFlow: 'prepaid', delivery }),
    );
  ok(a, 201);
  const [l] = await f.db.select().from(salesOrderLines);
  const made = await f.call(
    '/orders/' + a.data.id + '/packing',
    f.mgr,
    'POST',
    {
      allocations: [{ orderLineId: l!.id, qty: 1, source: 'warehouse' }],
      sendToWarehouse: true,
    },
  );
  ok(made, 201);
  const slipId = made.data.slips[0].id;
  ok(
    await f.call('/packing/' + slipId + '/confirm', f.mgr, 'POST', {
      warehouseId: 'pos-wh',
      photos: ['data:image/jpeg;base64,' + 'A'.repeat(100)],
    }),
  );
  assert.equal(
    (await reservedBySku(f.db, ['00123'], 'pos-wh')).get('00123'),
    1,
    'còn giữ phần chưa xuất',
  );
  ok(
    await f.call('/pos/order-flows/' + a.data.id + '/cancel', f.emp, 'POST', {
      key: key(),
      shiftId: s.id,
      reason: 'Không lấy',
      kind: 'return',
    }),
    409,
  );
  const request = await f.call('/pos/returns', f.emp, 'POST', {
    key: key(),
    shiftId: s.id,
    orderId: a.data.id,
    reason: 'Thu hồi đơn chưa giao',
    lines: [{ orderLineId: l!.id, qty: 1 }],
  });
  ok(request, 201);
  assert.equal(request.data.requestContext, 'after_issue');
  assert.equal(
    request.data.total,
    194400,
    'huỷ cả phần chưa xuất mà không nhập giả phần này',
  );
  const [d] = await f.db.select().from(deliveries);
  ok(
    await f.call('/deliveries/' + d!.id + '/status', f.mgr, 'PUT', {
      status: 'delivered',
    }),
    409,
  );
  ok(
    await f.call(
      '/pos/returns/' + request.data.id + '/approve',
      f.mgr,
      'POST',
      {},
    ),
  );
  assert.equal((await f.db.select().from(stockBalances))[0]!.qty, 9);
  assert.equal((await f.db.select().from(salesOrders))[0]!.status, 'cancelled');
  assert.equal((await f.db.select().from(deliveries))[0]!.status, 'cancelled');
  ok(
    await f.call('/pos/returns/' + request.data.id + '/refund', f.emp, 'POST', {
      key: key(),
      shiftId: s.id,
      amount: 194400,
      method: 'cash',
      confirmed: true,
    }),
    409,
  );
  ok(
    await f.call(
      '/pos/returns/' + request.data.id + '/receive',
      f.emp,
      'POST',
      { shiftId: s.id, confirmed: true },
    ),
  );
  assert.equal((await f.db.select().from(stockBalances))[0]!.qty, 10);
  ok(
    await f.call('/pos/returns/' + request.data.id + '/refund', f.emp, 'POST', {
      key: key(),
      shiftId: s.id,
      amount: 194400,
      method: 'cash',
      confirmed: true,
    }),
    201,
  );
});
test('huỷ cọc dùng tín dụng đổi hàng không trả tiền hay nhập giả, Manager tự duyệt được', async () => {
  const f = await setup(),
    s = await f.open(f.mgr),
    a = await f.call(
      '/pos/checkout',
      f.mgr,
      'POST',
      f.cart(s.id, { saleFlow: 'deposit' }),
    );
  ok(a, 201);
  const c = await f.call(
    '/pos/order-flows/' + a.data.id + '/cancel',
    f.mgr,
    'POST',
    { key: key(), shiftId: s.id, reason: 'Đổi sản phẩm', kind: 'exchange' },
  );
  ok(c);
  ok(
    await f.call(
      '/pos/returns/' + c.data.returnId + '/approve',
      f.mgr,
      'POST',
      {},
    ),
  );
  const allocated = await f.call(
    '/pos/returns/' + c.data.returnId + '/exchange',
    f.mgr,
    'POST',
    { key: key(), shiftId: s.id, amount: 58320 },
  );
  ok(allocated, 201);
  const replacement = await f.call(
    '/pos/checkout',
    f.mgr,
    'POST',
    f.cart(s.id, { exchangeAllocationId: allocated.data.id, tendered: 136080 }),
  );
  ok(replacement, 201);
  assert.equal(replacement.data.exchangeCredit, 58320);
  assert.equal((await f.db.select().from(posRefunds)).length, 0);
  assert.equal((await f.db.select().from(stockBalances))[0]!.qty, 8);
});
test('NVBH Lock và Minh Long không đọc/thu/xác nhận/huỷ chéo đơn, kể cả được chỉ định duyệt', async () => {
  const f = await setup();
  const { employees, positionPermissions } = await import(
    '../../src/modules/staff/schema.ts'
  );
  const { warehouses } = await import('../../src/modules/catalog/schema.ts');
  const { postMoves } = await import(
    '../../src/modules/inventory/api/ledger.ts'
  );
  await f.db
    .update(employees)
    .set({ positionId: 'sales-ml', canApprove: true })
    .where(eq(employees.id, 'emp'));
  await f.db
    .update(warehouses)
    .set({ name: 'MINH LONG - LOCKNLOCK CẦN THƠ' })
    .where(eq(warehouses.id, 'pos-wh'));
  await f.db.insert(warehouses).values({
    id: 'ml-wh',
    name: 'Showroom Gốm Sứ Minh Long Cần Thơ',
    kind: 'stock',
  });
  const ml = await f.call('/pos/registers', f.mgr, 'POST', {
    name: 'Quầy ML',
    warehouseId: 'ml-wh',
    pricePolicyId: 'retail-vat',
    secondPricePolicyId: 'retail',
    taxRate: 8,
  });
  ok(ml);
  const drawer = key();
  ok(
    await f.call('/cash/drawers', f.mgr, 'POST', {
      key: drawer,
      registerId: ml.data.id,
      name: 'Két ML',
    }),
    201,
  );
  ok(
    await f.call('/cash/config?drawerId=' + drawer, f.mgr, 'POST', {
      openingAmount: 500000,
      reason: 'Đầu kỳ',
    }),
  );
  await f.db.transaction((tx) =>
    postMoves(tx, 'mgr', [
      {
        sku: '00123',
        warehouseId: 'ml-wh',
        qty: 10,
        kind: 'opening',
        refType: 'opening',
        refId: 'opening-ml',
      },
    ]),
  );
  const s = await f.open(f.other),
    a = await f.call(
      '/pos/checkout',
      f.other,
      'POST',
      f.cart(s.id, { saleFlow: 'prepaid', method: 'transfer', delivery }),
    );
  ok(a, 201);
  const ms = await f.call('/pos/shifts/open', f.emp, 'POST', {
    key: key(),
    registerId: ml.data.id,
    openingCash: 500000,
  });
  ok(ms, 201);
  const b = await f.call(
    '/pos/checkout',
    f.emp,
    'POST',
    f.cart(ms.data.id, {
      registerId: ml.data.id,
      saleFlow: 'prepaid',
      method: 'transfer',
      delivery,
    }),
  );
  ok(b, 201);
  // Former owners/customer sharing must never bypass a changed store assignment.
  await f.db
    .update(salesOrders)
    .set({ ownerId: 'emp' })
    .where(eq(salesOrders.id, a.data.id));
  await f.db
    .update(salesOrders)
    .set({ ownerId: 'cashier2' })
    .where(eq(salesOrders.id, b.data.id));
  await f.db
    .insert(positionPermissions)
    .values([
      { positionId: 'sales-lock', permission: 'page.packing' },
      { positionId: 'sales-ml', permission: 'page.packing' },
    ])
    .onConflictDoNothing();
  const packIds = new Map<string, string>();
  for (const o of [a.data.id, b.data.id]) {
    const id = key();
    packIds.set(o, id);
    await f.db.insert(packingSlips).values({
      id,
      slipNo: 'SCOPE-' + id,
      orderId: o,
      status: 'sent',
      createdBy: 'mgr',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  const ships = await f.db.select().from(deliveries);
  const intents = await f.db.select().from(posPaymentIntents);
  for (const [cookie, foreign, ownShift] of [
    [f.emp, a.data.id, ms.data.id],
    [f.other, b.data.id, s.id],
  ]) {
    for (const path of [
      '/orders/' + foreign,
      '/orders/' + foreign + '/packing',
      '/packing/' + packIds.get(foreign),
    ])
      ok(await f.call(path, cookie), 404);
    const ship = ships.find((d) => d.orderId === foreign)!;
    ok(
      await f.call('/deliveries/' + ship.id + '/status', cookie, 'PUT', {
        status: 'cancelled',
      }),
      404,
    );
    const generic = await f.call('/orders', cookie);
    ok(generic);
    assert.ok(!generic.data.orders.some((o: any) => o.id === foreign));
    const packing = await f.call('/packing?status=all', cookie);
    ok(packing);
    assert.ok(!packing.data.slips.some((p: any) => p.orderId === foreign));
    const holds = await f.call('/stock-holds', cookie);
    ok(holds);
    assert.ok(!holds.data.holds.some((h: any) => h.orderId === foreign));
    const i = intents.find((i) => i.orderId === foreign)!;
    ok(await f.call('/pos/order-flows/' + foreign, cookie), 403);
    for (const action of ['hold', 'collect', 'cancel'])
      ok(
        await f.call(
          '/pos/order-flows/' + foreign + '/' + action,
          cookie,
          'POST',
          {
            key: key(),
            shiftId: ownShift,
            amount: 1,
            method: 'cash',
            reason: 'Test scope',
            kind: 'return',
          },
        ),
        403,
      );
    ok(
      await f.call(
        '/pos/order-flow-intents/' + i.id + '/confirm',
        cookie,
        'POST',
        { shiftId: ownShift, confirmed: true, reference: 'FORBIDDEN' },
      ),
      403,
    );
    const list = await f.call('/pos/order-flows?shiftId=' + ownShift, cookie);
    ok(list);
    assert.ok(!list.data.orders.some((o: any) => o.order.id === foreign));
  }
  assert.equal((await f.db.select().from(customerPayments)).length, 0);
});
test('ship trả trước xuất khi bàn giao vận chuyển, giao xong không trừ lại; muốn thu hồi dùng phiếu trả', async () => {
  const f = await setup(),
    s = await f.open(),
    a = await f.call(
      '/pos/checkout',
      f.emp,
      'POST',
      f.cart(s.id, { saleFlow: 'prepaid', delivery }),
    );
  ok(a, 201);
  const [d] = await f.db.select().from(deliveries);
  ok(
    await f.call('/deliveries/' + d!.id + '/status', f.mgr, 'PUT', {
      status: 'in_transit',
    }),
  );
  assert.equal((await f.db.select().from(stockBalances))[0]!.qty, 8);
  assert.equal(
    (await reservedBySku(f.db, ['00123'], 'pos-wh')).get('00123') || 0,
    0,
  );
  ok(
    await f.call('/deliveries/' + d!.id + '/status', f.mgr, 'PUT', {
      status: 'cancelled',
    }),
    409,
  );
  ok(
    await f.call('/pos/order-flows/' + a.data.id + '/cancel', f.emp, 'POST', {
      key: key(),
      shiftId: s.id,
      reason: 'Khách đổi ý',
      kind: 'return',
    }),
    409,
  );
  ok(
    await f.call('/deliveries/' + d!.id + '/status', f.mgr, 'PUT', {
      status: 'planned',
    }),
  );
  ok(
    await f.call('/deliveries/' + d!.id + '/status', f.mgr, 'PUT', {
      status: 'in_transit',
    }),
  );
  assert.equal((await f.db.select().from(stockBalances))[0]!.qty, 8);
  ok(
    await f.call('/deliveries/' + d!.id + '/status', f.mgr, 'PUT', {
      status: 'delivered',
    }),
  );
  assert.equal((await f.db.select().from(stockBalances))[0]!.qty, 8);
  assert.equal(
    (await f.db.select().from(stockMoves)).filter(
      (m) => m.refType === 'pos_delivery',
    ).length,
    1,
  );
});
test('danh sách mặc định không để đơn nhận sau cũ bị chìm bởi hơn 100 đơn hoàn tất; tìm kiếm và phân trang server', async () => {
  const f = await setup(),
    s = await f.open(),
    a = await f.call(
      '/pos/checkout',
      f.emp,
      'POST',
      f.cart(s.id, { saleFlow: 'deposit' }),
    );
  ok(a, 201);
  const [o] = await f.db.select().from(salesOrders);
  await f.db
    .update(salesOrders)
    .set({ createdAt: '2020-01-01T00:00:00Z' })
    .where(eq(salesOrders.id, a.data.id));
  await f.db.insert(salesOrders).values(
    Array.from({ length: 105 }, (_, i) => ({
      ...o!,
      id: key(),
      checkoutKey: key(),
      orderNo: 'COMPLETED_' + i,
      status: 'delivered' as const,
      createdAt: '2026-10-20T00:00:00Z',
    })),
  );
  const open = await f.call('/pos/order-flows?shiftId=' + s.id, f.emp);
  ok(open);
  assert.equal(open.data.orders.length, 1);
  assert.equal(open.data.orders[0].order.id, a.data.id);
  const page1 = await f.call(
    '/pos/order-flows?shiftId=' + s.id + '&status=all',
    f.emp,
  );
  ok(page1);
  assert.equal(page1.data.orders.length, 100);
  assert.equal(page1.data.nextOffset, 100);
  const page2 = await f.call(
    '/pos/order-flows?shiftId=' + s.id + '&status=all&offset=100',
    f.emp,
  );
  ok(page2);
  assert.equal(page2.data.orders.length, 6);
  assert.equal(page2.data.nextOffset, null);
  assert.equal(
    new Set(
      [...page1.data.orders, ...page2.data.orders].map((a: any) => a.order.id),
    ).size,
    106,
  );
  const search = await f.call(
    '/pos/order-flows?shiftId=' + s.id + '&q=' + a.data.orderNo,
    f.emp,
  );
  ok(search);
  assert.equal(search.data.orders.length, 1);
});
