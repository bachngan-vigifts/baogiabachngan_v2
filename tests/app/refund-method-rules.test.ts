import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { setupCrmReturns } from '../helpers/crm-return-fixture.ts';
import { createTestDb } from '../helpers/postgres.ts';
import { customerPayments } from '../../src/modules/sales/schema.ts';
import { cashEntries } from '../../src/modules/sales/cash-schema.ts';
import { posRefunds } from '../../src/modules/sales/return-schema.ts';
import { paymentChannel, refundMethodBalance } from '../../src/modules/sales/domain/pos-return-money.ts';

const refundBody = (extra: Record<string, unknown> = {}) => ({ key: crypto.randomUUID(), amount: 585241, drawerId: 'store', confirmed: true, ...extra });

test('refund channel follows where the money is: drawer, bank, GHN, credit or non-cash offset', () => {
  assert.equal(paymentChannel({ method: 'cash', paymentSource: 'manual' }), 'cash');
  assert.equal(paymentChannel({ method: 'transfer', paymentSource: 'sepay_auto' }), 'transfer');
  assert.equal(paymentChannel({ method: 'other', paymentSource: 'ghn_cod' }), 'carrier', 'COD still at GHN');
  assert.equal(paymentChannel({ method: 'other', paymentSource: 'ghn_cod' }, true), 'transfer', 'GHN paid out to the bank');
  assert.equal(paymentChannel({ method: 'other', paymentSource: 'ghn_fee_offset' }), 'other');
  assert.equal(paymentChannel({ method: 'transfer', paymentSource: 'pos_exchange_credit' }), 'credit');
  const b = refundMethodBalance(
    [{ amount: 300000, channel: 'cash' }, { amount: 700000, channel: 'transfer' }, { amount: 50000, channel: 'carrier' }],
    [{ amount: 100000, method: 'cash' }],
  );
  assert.deepEqual(b.remaining, { cash: 200000, transfer: 700000 });
  assert.equal(b.paid.carrier, 50000);
  assert.equal(b.defaultMethod, 'transfer');
  assert.equal(refundMethodBalance([{ amount: 5, channel: 'cash' }], []).defaultMethod, 'cash');
  assert.equal(refundMethodBalance([{ amount: 5, channel: 'carrier' }], []).defaultMethod, null, 'nothing refundable from drawer or bank');
});

test('transfer-paid CRM order: transfer refund links the source receipt; cash needs Manager reason and evidence', async () => {
  const f = await setupCrmReturns();
  await f.seed('tr');
  const { data: r } = await f.create('tr', [{ orderLineId: 'tr-b', qty: 2, disposition: 'restock' }]);
  await f.receive('tr', r.id);
  const view = f.ok(await f.call('/orders/tr/returns', f.mgr));
  assert.equal(view.refundMethods.defaultMethod, 'transfer');
  assert.deepEqual(view.refundMethods.payments.map((p: any) => [p.id, p.channel]), [['paid-tr', 'transfer']]);
  assert.equal(view.account.total, 4372250);

  await f.open(f.mgr);
  const cash = await f.call(`/orders/tr/returns/${r.id}/refund`, f.mgr, 'POST', refundBody({ method: 'cash' }));
  assert.equal(cash.status, 400, JSON.stringify(cash.data));
  assert.equal(cash.data.code, 'REFUND_METHOD_OVERRIDE');
  assert.equal((await f.call(`/orders/tr/returns/${r.id}/refund`, f.mgr, 'POST', refundBody({ method: 'cash', overrideReason: 'ngắn', overrideEvidence: 'x' }))).status, 400, 'reason too short');
  assert.equal((await f.db.select().from(posRefunds)).length, 0);
  assert.equal((await f.db.select().from(cashEntries)).length, 0, 'no drawer movement from a rejected cross-channel refund');

  const ok = f.ok(await f.call(`/orders/tr/returns/${r.id}/refund`, f.mgr, 'POST', refundBody({ method: 'transfer', reference: 'CK-77' })), 201);
  assert.equal(ok.sourcePaymentId, 'paid-tr');
  assert.equal(ok.overrideBy, null);
  assert.equal(ok.cashEntryId, null);
  assert.equal((await f.db.select().from(cashEntries)).length, 0);
});

test('cash-paid CRM order: cash refund comes from the drawer once; a transfer refund is a recorded Manager override', async () => {
  const f = await setupCrmReturns();
  await f.seed('ca', 2186125, 'emp', true, 'cash');
  const { data: r } = await f.create('ca', [{ orderLineId: 'ca-b', qty: 2, disposition: 'restock' }]);
  await f.receive('ca', r.id);
  assert.equal(f.ok(await f.call('/orders/ca/returns', f.mgr)).refundMethods.defaultMethod, 'cash');
  const body = refundBody({ method: 'transfer', reference: 'CK-1', overrideReason: 'Khách xin nhận chuyển khoản vì ở xa', overrideEvidence: 'Tin nhắn Zalo 28/11' });
  const first = f.ok(await f.call(`/orders/ca/returns/${r.id}/refund`, f.mgr, 'POST', body), 201);
  assert.equal(first.overrideBy, 'mgr');
  assert.equal(first.overrideReason, 'Khách xin nhận chuyển khoản vì ở xa');
  assert.equal(first.sourcePaymentId, null);
  assert.equal(f.ok(await f.call(`/orders/ca/returns/${r.id}/refund`, f.mgr, 'POST', body), 201).replayed, true, 'retry creates no second refund');
  assert.equal((await f.db.select().from(posRefunds)).length, 1);
  assert.equal((await f.db.select().from(cashEntries)).length, 0, 'transfer never touches the drawer');
});

test('split payment: cash refund only up to the cash received; the rest goes back by transfer', async () => {
  const f = await setupCrmReturns();
  await f.seed('mix', 1886125, 'emp', true, 'transfer');
  await f.db.insert(customerPayments).values({ id: 'mix-cash', orderId: 'mix', amount: 300000, paidAt: '2026-10-14', method: 'cash', createdBy: 'mgr', createdAt: '2026-10-14T03:00:00.000Z' });
  const { data: r } = await f.create('mix', [{ orderLineId: 'mix-b', qty: 2, disposition: 'restock' }]);
  await f.receive('mix', r.id);
  const m = f.ok(await f.call('/orders/mix/returns', f.mgr)).refundMethods;
  assert.deepEqual(m.remaining, { cash: 300000, transfer: 1886125 });
  await f.open(f.mgr);
  assert.equal((await f.call(`/orders/mix/returns/${r.id}/refund`, f.mgr, 'POST', refundBody({ method: 'cash', amount: 300001 }))).status, 400, 'cash beyond cash received');
  const cash = f.ok(await f.call(`/orders/mix/returns/${r.id}/refund`, f.mgr, 'POST', refundBody({ method: 'cash', amount: 300000 })), 201);
  assert.equal(cash.sourcePaymentId, 'mix-cash');
  const [entry] = await f.db.select().from(cashEntries).where(eq(cashEntries.id, cash.cashEntryId));
  assert.equal(entry!.kind, 'customer_refund');
  assert.equal(entry!.amount, 300000);
  assert.equal((await f.call(`/orders/mix/returns/${r.id}/refund`, f.mgr, 'POST', refundBody({ method: 'cash', amount: 1 }))).status, 400, 'cash channel exhausted');
  const rest = f.ok(await f.call(`/orders/mix/returns/${r.id}/refund`, f.mgr, 'POST', refundBody({ method: 'transfer', amount: 285241, reference: 'CK-REST' })), 201);
  assert.equal(rest.sourcePaymentId, 'paid-mix');
  assert.equal((await f.call(`/orders/mix/returns/${r.id}/refund`, f.mgr, 'POST', refundBody({ method: 'transfer', amount: 1, reference: 'CK-X' }))).status, 409, 'order cap still applies');
  assert.equal((await f.db.select().from(cashEntries)).length, 1, 'exactly one drawer entry');
});

test('COD still held by GHN cannot be refunded from the drawer without a Manager override', async () => {
  const f = await setupCrmReturns();
  await f.seed('ghn', 0);
  await f.db.insert(customerPayments).values({ id: 'ghn-cod', orderId: 'ghn', amount: 2186125, paidAt: '2026-10-14', method: 'other', paymentSource: 'ghn_cod', createdBy: 'mgr', createdAt: '2026-10-14T03:00:00.000Z' });
  const { data: r } = await f.create('ghn', [{ orderLineId: 'ghn-b', qty: 2, disposition: 'restock' }]);
  await f.receive('ghn', r.id);
  const m = f.ok(await f.call('/orders/ghn/returns', f.mgr)).refundMethods;
  assert.equal(m.paid.carrier, 2186125);
  assert.equal(m.defaultMethod, null);
  await f.open(f.mgr);
  for (const method of ['cash', 'transfer']) {
    const res = await f.call(`/orders/ghn/returns/${r.id}/refund`, f.mgr, 'POST', refundBody({ method, reference: 'CK-G' }));
    assert.equal(res.status, 400, method);
    assert.match(res.data.error, /lý do/);
  }
  assert.equal((await f.db.select().from(cashEntries)).length, 0);
});

test('refund source migration is repeatable and its read-only gate rejects a missing column or check', async () => {
  const { client } = await createTestDb();
  const migration = readFileSync(new URL('../../migrations/postgres/20261128090000_refund_source_method.sql', import.meta.url), 'utf8');
  const gate = readFileSync(new URL('../../scripts/sql/assert-refund-source-method.sql', import.meta.url), 'utf8');
  await client.exec(migration);
  await client.exec('BEGIN READ ONLY'); await client.exec(gate); await client.exec('ROLLBACK');
  for (const mutation of ['ALTER TABLE pos_refunds DROP COLUMN override_evidence', 'ALTER TABLE pos_refunds DROP CONSTRAINT chk_pos_refund_override']) {
    await client.exec('BEGIN'); await client.exec(mutation); await client.exec('SAVEPOINT gate');
    await assert.rejects(client.exec(gate));
    await client.exec('ROLLBACK TO SAVEPOINT gate'); await client.exec('ROLLBACK');
  }
});
