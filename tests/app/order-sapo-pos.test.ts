import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { setup } from '../helpers/pos-fixture.ts';
import { salesOrders, salesOrderLines, customerPayments } from '../../src/modules/sales/schema.ts';
import { stockMoves, stockBalances } from '../../src/modules/inventory/schema.ts';
import { employees } from '../../src/modules/staff/schema.ts';

test('POS salesperson can retry Sapo through the original POS webhook without re-running stock or payment writes', async () => {
  const f = await setup({ viaClaw: true }), shift = await f.open();
  const made = await f.call('/pos/checkout', f.emp, 'POST', f.cart(shift.id));
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const id = made.data.id, path = '/orders/' + id;
  const snapshot = async () => ({
    orders: await f.db.select().from(salesOrders), lines: await f.db.select().from(salesOrderLines),
    payments: await f.db.select().from(customerPayments), moves: await f.db.select().from(stockMoves), balances: await f.db.select().from(stockBalances),
  });
  const before = await snapshot(), original = f.hooks[0]!;
  const detail = await f.call(path, f.emp);
  assert.equal(detail.status, 200);
  assert.equal(detail.data.order.canCreateSapo, true);
  assert.equal(detail.data.order.canEdit, false);
  const preview = await f.call('/sapo/preview?orderId=' + id, f.emp);
  assert.equal(preview.status, 200);
  assert.equal(preview.data.viaClaw, true);
  assert.equal(preview.data.code, made.data.orderNo);
  assert.deepEqual(preview.data.locations, []);
  assert.equal((await f.call(path + '/sapo', f.emp, 'POST', {})).data.code, 'SAPO_PUSH_DISABLED');
  f.env.sapoOrderPush = undefined;
  for (let i = 0; i < 2; i++) {
    const retry = await f.call(path + '/sapo', f.emp, 'POST', {});
    assert.equal(retry.status, 200, JSON.stringify(retry.data));
    assert.equal(retry.data.sapo.status, 'updating');
    assert.deepEqual(f.hooks.at(-1), original, 'same POS endpoint, idempotency key, branch and payload as checkout');
  }
  assert.deepEqual(await snapshot(), before, 'manual export does not change CRM order, stock or payments');
  await f.db.update(employees).set({ positionId: 'sales-ml' }).where(eq(employees.id, 'emp'));
  const scopedCount = f.hooks.length;
  assert.equal((await f.call(path, f.emp)).status, 404, 'store permissions still hide the other store POS order');
  assert.equal((await f.call(path + '/sapo', f.emp, 'POST', {})).status, 404);
  assert.equal(f.hooks.length, scopedCount);
  await f.db.update(employees).set({ positionId: 'sales-lock' }).where(eq(employees.id, 'emp'));
  await f.db.update(salesOrders).set({ status: 'cancelled' }).where(eq(salesOrders.id, id));
  assert.equal((await f.call(path, f.emp)).data.order.canCreateSapo, false);
  const count = f.hooks.length;
  assert.equal((await f.call(path + '/sapo', f.emp, 'POST', {})).data.code, 'ORDER_CANCELLED');
  assert.equal(f.hooks.length, count);
});
