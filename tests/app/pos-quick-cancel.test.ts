import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, sql } from 'drizzle-orm';
import { setup } from '../helpers/pos-fixture.ts';
import {
  salesOrders,
  customerPayments,
} from '../../src/modules/sales/schema.ts';
import {
  posReturns,
  posRefunds,
  posReturnLines,
} from '../../src/modules/sales/return-schema.ts';
import {
  stockBalances,
  stockMoves,
} from '../../src/modules/inventory/schema.ts';
import { cashEntries } from '../../src/modules/sales/cash-schema.ts';
import { returnAccount } from '../../src/modules/sales/api/pos-return-credit.ts';
import { shiftReport } from '../../src/modules/sales/api/pos-store.ts';
import { posShifts } from '../../src/modules/sales/pos-schema.ts';
const ok = (r: any, status = 200) => {
  assert.equal(r.status, status, JSON.stringify(r.data));
  return r.data;
};
async function fixture(extra = {}) {
  const f = await setup(),
    s = await f.open(),
    o = ok(
      await f.call('/pos/checkout', f.emp, 'POST', f.cart(s.id, extra)),
      201,
    );
  const path = '/pos/orders/' + o.id + '/quick-cancel';
  const preview = ok(await f.call(path, f.mgr));
  const body = {
    key: crypto.randomUUID(),
    revision: preview.revision,
    shiftId: s.id,
    reason: 'Bill ghi nhầm, đã nhận lại đủ hàng và trả tiền',
    confirmed: true,
    reference: '',
  };
  return { ...f, s, o, path, preview, body };
}
test('Manager quick cancellation atomically returns stock, refunds once and preserves gross payment/history', async () => {
  const f = await fixture({ shippingFee: 10000, tendered: 300000 });
  const historicalAt = new Date().toISOString();
  await new Promise((r) => setTimeout(r, 5));
  const beforePayments = await f.db.select().from(customerPayments),
    beforeStock = await f.db.select().from(stockBalances);
  const simultaneous = await Promise.all([
    f.call(f.path, f.mgr, 'POST', f.body),
    f.call(f.path, f.mgr, 'POST', f.body),
  ]);
  const r = ok(simultaneous[0]);
  ok(simultaneous[1]);
  assert.equal(simultaneous.filter((x) => x.data.replayed).length, 1);
  assert.ok(r.returnId);
  assert.ok(r.refundId);
  const [o] = await f.db
    .select()
    .from(salesOrders)
    .where(eq(salesOrders.id, f.o.id));
  assert.equal(o!.status, 'cancelled');
  assert.equal(o!.sapoOrderId, null);
  assert.deepEqual(
    await f.db.select().from(customerPayments),
    beforePayments,
    'receipt history is retained',
  );
  const stock = await f.db.select().from(stockBalances);
  assert.equal(stock[0]!.qty, beforeStock[0]!.qty + 2);
  assert.equal((await f.db.select().from(posReturnLines))[0]!.restockQty, 2);
  assert.equal((await f.db.select().from(posRefunds))[0]!.amount, f.o.total);
  assert.equal(
    (await f.db.select().from(cashEntries)).filter(
      (x) => x.kind === 'customer_refund',
    ).length,
    1,
  );
  const account = await returnAccount(f.db, f.o.id);
  assert.equal(account.netDue, 0);
  assert.equal(account.netPaid, 0);
  const [s] = await f.db
    .select()
    .from(posShifts)
    .where(eq(posShifts.id, f.s.id));
  const report = await shiftReport(f.db, s!);
  assert.equal(report.bills.revenue, f.o.total);
  assert.equal(report.returns.credit, f.o.total);
  const historical = await shiftReport(f.db, s!, historicalAt);
  assert.equal(historical.bills.revenue, f.o.total);
  assert.equal(historical.returns.credit, 0);
  assert.equal(historical.returns.refundedCash, 0);
  assert.equal(ok(await f.call(f.path, f.mgr, 'POST', f.body)).replayed, true);
  assert.equal(
    (
      await f.call(f.path, f.mgr, 'POST', {
        ...f.body,
        key: crypto.randomUUID(),
      })
    ).status,
    409,
  );
  assert.equal((await f.db.select().from(posRefunds)).length, 1);
  assert.equal((await f.db.select().from(posReturns)).length, 1);
});
test('A failure after stock posting rolls the whole operation back; the same request can then succeed', async () => {
  const f = await fixture();
  const before = await f.db.select().from(stockBalances);
  await f.db.execute(
    sql`create function reject_quick_refund() returns trigger language plpgsql as $$ begin if NEW.kind='customer_refund' then raise exception 'test injected refund failure'; end if; return NEW; end $$`,
  );
  await f.db.execute(
    sql`create trigger reject_quick_refund before insert on cash_entries for each row execute function reject_quick_refund()`,
  );
  assert.equal((await f.call(f.path, f.mgr, 'POST', f.body)).status, 500);
  assert.deepEqual(await f.db.select().from(stockBalances), before);
  assert.equal((await f.db.select().from(posReturns)).length, 0);
  assert.equal((await f.db.select().from(posRefunds)).length, 0);
  assert.equal(
    (
      await f.db.select().from(salesOrders).where(eq(salesOrders.id, f.o.id))
    )[0]!.status,
    'delivered',
  );
  await f.db.execute(sql`drop trigger reject_quick_refund on cash_entries`);
  ok(await f.call(f.path, f.mgr, 'POST', f.body));
});
test('Manager-only, confirmed real custody/refund, revision and transfer reference are enforced without writes', async () => {
  const f = await fixture({ method: 'transfer', confirmed: true });
  for (const [cookie, body, status] of [
    [f.emp, f.body, 403],
    [f.mgr, { ...f.body, confirmed: false }, 400],
    [f.mgr, { ...f.body, revision: -1 }, 409],
    [f.mgr, f.body, 400],
  ] as const) {
    assert.equal((await f.call(f.path, cookie, 'POST', body)).status, status);
    assert.equal((await f.db.select().from(posReturns)).length, 0);
  }
  ok(
    await f.call(f.path, f.mgr, 'POST', {
      ...f.body,
      reference: 'BANK-REFUND-001',
    }),
  );
  assert.equal(
    (await f.db.select().from(cashEntries)).filter(
      (x) => x.kind === 'customer_refund',
    ).length,
    0,
    'bank refunds do not debit cash',
  );
  assert.equal(
    (await f.db.select().from(posRefunds))[0]!.reference,
    'BANK-REFUND-001',
  );
});
test('A prior return, invoice or inconsistent issue blocks the whole quick operation', async () => {
  const f = await fixture();
  await f.db
    .update(salesOrders)
    .set({ invoiceNo: 'HD-1' })
    .where(eq(salesOrders.id, f.o.id));
  assert.equal((await f.call(f.path, f.mgr, 'POST', f.body)).status, 409);
  assert.equal((await f.db.select().from(posRefunds)).length, 0);
  await f.db
    .update(salesOrders)
    .set({ invoiceNo: '' })
    .where(eq(salesOrders.id, f.o.id));
  const old = ok(
    await f.call('/pos/returns', f.emp, 'POST', {
      key: crypto.randomUUID(),
      orderId: f.o.id,
      shiftId: f.s.id,
      reason: 'Trả một phần',
      lines: [
        {
          orderLineId: (await f.call('/orders/' + f.o.id, f.mgr)).data.lines[0]
            .id,
          qty: 1,
          disposition: 'restock',
        },
      ],
    }),
    201,
  );
  assert.ok(old.id);
  assert.equal((await f.call(f.path, f.mgr, 'POST', f.body)).status, 409);
  assert.equal((await f.db.select().from(posRefunds)).length, 0);
});

test('Missing orders and unauthorized previews fail without creating documents', async () => {
  const f = await fixture();
  assert.equal((await f.call(f.path, f.emp)).status, 403);
  for (const method of ['GET', 'POST']) {
    const missing = await f.call(
      '/pos/orders/missing/quick-cancel',
      f.mgr,
      method,
      method === 'POST' ? f.body : undefined,
    );
    assert.equal(missing.status, 404);
  }
  assert.equal((await f.db.select().from(posReturns)).length, 0);
});

test('Malformed cancellation requests are rejected without stock or money writes', async () => {
  const f = await fixture(),
    before = await f.db.select().from(stockBalances);
  for (const invalid of [
    { key: 'x'.repeat(101) },
    { reason: 'x'.repeat(2001) },
    { reference: 'x'.repeat(201) },
    { shiftId: '' },
    { confirmed: 'true' },
  ]) {
    assert.equal(
      (await f.call(f.path, f.mgr, 'POST', { ...f.body, ...invalid })).status,
      400,
    );
  }
  assert.deepEqual(await f.db.select().from(stockBalances), before);
  assert.equal((await f.db.select().from(posRefunds)).length, 0);
});

test('A closed refund shift blocks cancellation; opening the correct shift permits it', async () => {
  const f = await fixture();
  ok(
    await f.call('/pos/shifts/' + f.s.id + '/close', f.emp, 'POST', {
      countedCash: 500000 + f.o.total,
    }),
  );
  assert.equal(ok(await f.call(f.path, f.mgr)).shifts.length, 0);
  assert.equal((await f.call(f.path, f.mgr, 'POST', f.body)).status, 409);
  assert.equal((await f.db.select().from(posReturns)).length, 0);
  const next = await f.open();
  ok(await f.call(f.path, f.mgr, 'POST', { ...f.body, shiftId: next.id }));
});

test('A stock issue mismatch blocks cancellation rather than guessing quantities', async () => {
  const f = await fixture();
  await f.db
    .update(stockMoves)
    .set({ qty: -1 })
    .where(eq(stockMoves.refId, f.o.id));
  assert.equal((await f.call(f.path, f.mgr)).status, 409);
  assert.equal((await f.call(f.path, f.mgr, 'POST', f.body)).status, 409);
  assert.equal((await f.db.select().from(posReturns)).length, 0);
});

test('One request key cannot cancel two different bills', async () => {
  const f = await fixture();
  const second = ok(
    await f.call('/pos/checkout', f.emp, 'POST', f.cart(f.s.id)),
    201,
  );
  ok(await f.call(f.path, f.mgr, 'POST', f.body));
  const otherPath = '/pos/orders/' + second.id + '/quick-cancel';
  const preview = ok(await f.call(otherPath, f.mgr));
  assert.equal(
    (
      await f.call(otherPath, f.mgr, 'POST', {
        ...f.body,
        revision: preview.revision,
      })
    ).status,
    409,
  );
  assert.equal((await f.db.select().from(posReturns)).length, 1);
  assert.equal((await f.db.select().from(posRefunds)).length, 1);
  assert.equal(
    (
      await f.db.select().from(salesOrders).where(eq(salesOrders.id, second.id))
    )[0]!.status,
    'delivered',
  );
});

test('Changing the confirmed reason after cancellation is a conflict without another posting', async () => {
  const f = await fixture();
  ok(await f.call(f.path, f.mgr, 'POST', f.body));
  const stock = await f.db.select().from(stockBalances);
  assert.equal(
    (await f.call(f.path, f.mgr, 'POST', { ...f.body, reason: 'Lý do khác' }))
      .status,
    409,
  );
  assert.deepEqual(await f.db.select().from(stockBalances), stock);
  assert.equal((await f.db.select().from(posRefunds)).length, 1);
});

test('The full Vietnamese reason allowed by the form fits the JSON request limit', async () => {
  const f = await fixture();
  const reason = 'ệ'.repeat(2000);
  ok(await f.call(f.path, f.mgr, 'POST', { ...f.body, reason }));
  const [saved] = await f.db.select().from(posReturns);
  assert.equal(saved!.reason, reason);
});
