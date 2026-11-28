import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { setupCrmReturns } from '../helpers/crm-return-fixture.ts';
import { cashEntries } from '../../src/modules/sales/cash-schema.ts';
import { posRefunds } from '../../src/modules/sales/return-schema.ts';

async function shiftWithRefund(refund = true) {
  const f = await setupCrmReturns();
  await f.seed('sh', 2186125, 'emp', true, 'cash');
  const { data: r } = await f.create('sh', [{ orderLineId: 'sh-b', qty: 2, disposition: 'restock' }]);
  const shift = await f.open(f.mgr);
  await f.receive('sh', r.id);
  const paid = refund ? f.ok(await f.call(`/orders/sh/returns/${r.id}/refund`, f.mgr, 'POST', { key: crypto.randomUUID(), amount: 100000, method: 'cash', drawerId: 'store', confirmed: true }), 201) : null;
  const report = async () => f.ok(await f.call('/pos/shifts/' + shift.id, f.mgr));
  const close = async () => { const d = await report(); return f.call('/pos/shifts/' + shift.id + '/close', f.mgr, 'POST', { countedCash: d.expectedCash }); };
  return { f, r, shift, paid, report, close };
}

test('clean shift: refund breakdown shown, no checks, close succeeds', async () => {
  const { report, close } = await shiftWithRefund();
  const d = await report();
  assert.equal(d.returns.refundedCash, 100000);
  assert.equal(d.returns.refundedTransfer, 0);
  assert.deepEqual(d.returns.checks, []);
  assert.deepEqual(d.returns.pendingRefunds, { count: 0, amount: 0 });
  const res = await close();
  assert.equal(res.status, 200, JSON.stringify(res.data));
});

test('cash refund whose drawer entry is not posted in this shift blocks closing', async () => {
  const { f, paid, report, close } = await shiftWithRefund();
  await f.db.update(cashEntries).set({ status: 'voided', voidedAt: new Date().toISOString(), voidedBy: 'mgr', voidReason: 'mô phỏng dữ liệu lệch' }).where(eq(cashEntries.id, paid.cashEntryId));
  const d = await report();
  assert.deepEqual(d.returns.checks.map((c: any) => [c.level, c.code, c.refs]), [['block', 'cash_refund_off_drawer', [paid.refundNo]]]);
  const res = await close();
  assert.equal(res.status, 409); assert.equal(res.data.code, 'SHIFT_REFUND_CHECK'); assert.match(res.data.error, new RegExp(paid.refundNo));
});

test('drawer refund entry left without an active refund, and refunds above receipts, block closing', async () => {
  const { f, paid, report, close } = await shiftWithRefund();
  await f.db.update(posRefunds).set({ voidedAt: new Date(Date.now() - 1000).toISOString(), voidedBy: 'mgr', voidReason: 'mô phỏng huỷ thiếu phiếu chi' }).where(eq(posRefunds.id, paid.id));
  let codes = (await report()).returns.checks.map((c: any) => c.code);
  assert.ok(codes.includes('refund_entry_without_refund'), JSON.stringify(codes));
  assert.equal((await close()).data.code, 'SHIFT_REFUND_CHECK');
  await f.db.update(posRefunds).set({ voidedAt: null, voidedBy: null, voidReason: '' }).where(eq(posRefunds.id, paid.id));
  await f.db.update(posRefunds).set({ amount: 3000000 }).where(eq(posRefunds.id, paid.id));
  await f.db.update(cashEntries).set({ amount: 3000000 }).where(eq(cashEntries.id, paid.cashEntryId));
  codes = (await report()).returns.checks.map((c: any) => c.code);
  assert.deepEqual(codes, ['refunded_over_paid']);
});

test('manual expense mirroring a cash refund is a warning, not a block; the warning stays in the closed snapshot', async () => {
  const { f, report, close } = await shiftWithRefund(false);
  let d = await report();
  // CRM returns are not tied to a POS shift: only POS returns received in this shift count as pending here.
  assert.deepEqual(d.returns.pendingRefunds, { count: 0, amount: 0 });
  const { r } = { r: (await f.call('/orders/sh/returns', f.mgr)).data.returns[0] };
  f.ok(await f.call(`/orders/sh/returns/${r.id}/refund`, f.mgr, 'POST', { key: crypto.randomUUID(), amount: 100000, method: 'cash', drawerId: 'store', confirmed: true }), 201);
  f.ok(await f.call('/cash/entries?drawerId=store', f.mgr, 'POST', { key: crypto.randomUUID(), kind: 'petty_expense', amount: 100000, reason: 'Hoàn tiền khách lẻ khác', notDuplicateRefund: true }), 201);
  d = await report();
  assert.deepEqual(d.returns.checks.map((c: any) => [c.level, c.code]), [['warn', 'suspected_duplicate_refund']]);
  const res = await close();
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.returns.checks[0].code, 'suspected_duplicate_refund', 'warning kept in the closed snapshot');
});
