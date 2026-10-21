import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { setup } from '../helpers/pos-fixture.ts';
import { cashEntries } from '../../src/modules/sales/cash-schema.ts';
import { posShifts } from '../../src/modules/sales/pos-schema.ts';
import { customerPayments } from '../../src/modules/sales/schema.ts';
const range = '?from=2026-01-01&to=2027-01-01';

test('cash ledger filters run before pagination/totals and retain cash-only default and staff scope', async () => {
  const f = await setup(), shift = await f.open();
  for (const method of ['cash', 'transfer']) {
    const result = await f.call('/pos/checkout', f.emp, 'POST', f.cart(shift.id, { method, confirmed: true }));
    assert.equal(result.status, 201, JSON.stringify(result.data));
  }
  const now = new Date().toISOString();
  await f.db.insert(cashEntries).values(Array.from({ length: 103 }, (_, i) => ({
    id: 'filter-' + i, entryNo: 'FILTER-' + i, drawerId: 'store', shiftId: shift.id,
    kind: i === 102 ? 'petty_expense' : 'other_income', direction: i === 102 ? 'out' : 'in', amount: 100,
    reason: 'Filter test', status: i === 101 ? 'pending' : 'posted', approvalThresholdSnapshot: 1000000,
    createdBy: 'emp', createdAt: now, updatedAt: now, requestKey: 'filter-' + i,
  })));
  const [originalShift] = await f.db.select().from(posShifts).where(eq(posShifts.id, shift.id));
  await f.db.insert(posShifts).values({ ...originalShift!, id: 'filter-other-shift', memberId: 'cashier2', closedAt: now, countedCash: 500000, expectedCash: 500000, cashDifference: 0, reportSnapshot: '{}', openKey: 'filter-other-open' });
  const [payment] = await f.db.select().from(customerPayments).where(eq(customerPayments.method, 'cash'));
  await f.db.insert(customerPayments).values({ ...payment!, id: 'filter-other-payment', requestKey: 'filter-other-payment', shiftId: 'filter-other-shift', createdBy: 'cashier2', amount: 500 });
  const balanceBefore = (await f.call('/cash', f.mgr)).data.balance;
  const first = await f.call('/cash/entries' + range + '&createdBy=emp&method=cash', f.mgr);
  assert.equal(first.status, 200); assert.equal(first.data.entries.length, 100); assert.ok(first.data.nextBefore);
  assert.ok(first.data.entries.every((e: any) => e.createdBy === 'emp' && e.method === 'cash'));
  assert.equal(first.data.totals.in, 10100 + payment!.amount); assert.equal(first.data.totals.out, 100);
  const second = await f.call('/cash/entries' + range + '&createdBy=emp&method=cash&before=' + encodeURIComponent(first.data.nextBefore), f.mgr);
  assert.deepEqual(second.data.totals, first.data.totals);
  const ids = [...first.data.entries, ...second.data.entries].map((e: any) => e.id); assert.equal(new Set(ids).size, 104);
  const transfers = await f.call('/cash/entries' + range + '&createdBy=emp&method=transfer', f.mgr);
  assert.equal(transfers.data.entries.length, 1); assert.equal(transfers.data.entries[0].method, 'transfer'); assert.equal(transfers.data.totals.out, 0);
  const outgoing = await f.call('/cash/entries' + range + '&createdBy=emp&direction=out&method=all', f.mgr);
  assert.equal(outgoing.data.entries.length, 1); assert.deepEqual(outgoing.data.totals, { in: 0, out: 100, net: -100 });
  assert.ok(first.data.employees.some((e: any) => e.id === 'cashier2'), 'staff options are not limited to current page or selected creator');
  const scoped = await f.call('/cash/entries' + range + '&method=all&createdBy=cashier2', f.emp);
  assert.equal(scoped.data.entries.length, 0); assert.ok(!scoped.data.employees.some((e: any) => e.id === 'cashier2'));
  const legacy = await f.call('/cash/entries' + range, f.mgr); assert.ok(legacy.data.entries.every((e: any) => e.method === 'cash'));
  assert.equal((await f.call('/cash/entries' + range + '&method=unknown', f.mgr)).status, 400);
  assert.equal((await f.call('/cash/entries' + range + '&direction=bad', f.mgr)).status, 400);
  assert.equal((await f.call('/cash/entries' + range + '&method=all', f.ncc)).status, 403);
  assert.equal((await f.call('/cash', f.mgr)).data.balance, balanceBefore, 'read filters never affect drawer balance');
});
