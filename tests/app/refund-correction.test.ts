import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { setupCrmReturns } from '../helpers/crm-return-fixture.ts';
import { createTestDb } from '../helpers/postgres.ts';
import { cashEntries } from '../../src/modules/sales/cash-schema.ts';
import { posRefunds, posRefundCorrections } from '../../src/modules/sales/return-schema.ts';
import { auditLogs } from '../../src/core/db/schema.ts';

async function refunded(method: 'cash' | 'transfer', paidBy: 'cash' | 'transfer' = method) {
  const f = await setupCrmReturns();
  await f.seed('fix', 2186125, 'emp', true, paidBy);
  const { data: r } = await f.create('fix', [{ orderLineId: 'fix-b', qty: 2, disposition: 'restock' }]);
  await f.receive('fix', r.id);
  const shift = await f.open(f.mgr);
  const refund = f.ok(await f.call(`/orders/fix/returns/${r.id}/refund`, f.mgr, 'POST', { key: crypto.randomUUID(), amount: 585241, method, reference: method === 'transfer' ? 'CK-1' : '', drawerId: 'store', confirmed: true, ...(method !== paidBy ? { overrideReason: 'Ghi theo lời khách tại quầy', overrideEvidence: 'Xác nhận miệng' } : {}) }), 201);
  return { f, r, refund, shift };
}
const expectedCash = async (f: any, shiftId: string) => f.ok(await f.call('/pos/shifts/' + shiftId, f.mgr)).expectedCash;
const correct = (f: any, id: string, body: Record<string, unknown>, who = f.mgr) => f.call(`/refunds/${id}/correct`, who, 'POST', { key: crypto.randomUUID(), ...body });

test('wrong cash refund corrected to transfer: drawer entry voided, one transfer refund, refunded total unchanged, replay safe', async () => {
  const { f, refund, shift } = await refunded('cash');
  const before = await expectedCash(f, shift.id);
  assert.equal((await correct(f, refund.id, { action: 'change_method', method: 'transfer', reason: 'ngắn' })).status, 400);
  assert.equal((await correct(f, refund.id, { action: 'change_method', method: 'transfer', reason: 'Nhân viên bấm nhầm tiền mặt' })).status, 400, 'transfer needs reference');
  assert.equal((await correct(f, refund.id, { action: 'change_method', method: 'transfer', reference: 'CK-9', reason: 'Nhân viên bấm nhầm tiền mặt' }, f.emp)).status, 403);
  const body = { key: crypto.randomUUID(), action: 'change_method', method: 'transfer', reference: 'CK-9', evidence: 'UNC VCB CK-9', reason: 'Nhân viên bấm nhầm tiền mặt, khách nhận chuyển khoản' };
  const done = f.ok(await f.call(`/refunds/${refund.id}/correct`, f.mgr, 'POST', body), 201);
  assert.equal(f.ok(await f.call(`/refunds/${refund.id}/correct`, f.mgr, 'POST', body), 201).replayed, true);
  assert.equal((await f.call(`/refunds/${refund.id}/correct`, f.mgr, 'POST', { ...body, reason: body.reason + ' khác' })).status, 409, 'same key, different content');
  assert.equal((await correct(f, refund.id, { action: 'void', reason: 'Huỷ thêm lần nữa để thử' })).data.code, 'REFUND_ALREADY_CORRECTED');
  const rows = await f.db.select().from(posRefunds);
  assert.equal(rows.length, 2);
  const old = rows.find((x) => x.id === refund.id)!, repl = rows.find((x) => x.id === done.replacementRefundId)!;
  assert.ok(old.voidedAt); assert.equal(old.replacedByRefundId, repl.id);
  assert.equal(repl.method, 'transfer'); assert.equal(repl.cashEntryId, null); assert.equal(repl.reference, 'CK-9'); assert.equal(repl.amount, 585241);
  assert.equal(repl.overrideBy, 'mgr', 'customer paid cash, so transfer is a recorded override');
  const entries = await f.db.select().from(cashEntries);
  assert.equal(entries.length, 1); assert.equal(entries[0]!.status, 'voided');
  assert.equal(await expectedCash(f, shift.id), before + 585241, 'drawer gets the wrongly deducted cash back');
  const view = f.ok(await f.call('/orders/fix/returns', f.mgr));
  assert.equal(view.account.refunded, 585241, 'counted once'); assert.equal(view.account.available, 0);
  const [log] = await f.db.select().from(posRefundCorrections);
  assert.equal(JSON.parse(log!.beforeSnapshot).method, 'cash');
  assert.ok((await f.db.select().from(auditLogs)).some((a) => a.action === 'correct-refund'));
  const book = JSON.stringify(f.ok(await f.call('/cashbook?from=2026-01-01&to=2026-12-31', f.mgr)));
  assert.ok(book.includes(repl.refundNo)); assert.ok(!book.includes(`"${old.refundNo}"`), 'voided refund leaves the cashbook');
});

test('wrong transfer refund corrected to cash: exactly one drawer entry in the open shift of the same drawer', async () => {
  const { f, refund, shift } = await refunded('transfer', 'cash');
  const before = await expectedCash(f, shift.id);
  const done = f.ok(await correct(f, refund.id, { action: 'change_method', method: 'cash', reason: 'Thực tế khách nhận tiền mặt tại quầy' }), 201);
  const repl = (await f.db.select().from(posRefunds).where(eq(posRefunds.id, done.replacementRefundId)))[0]!;
  assert.equal(repl.method, 'cash'); assert.equal(repl.shiftId, shift.id); assert.equal(repl.overrideBy, null, 'cash matches the original payment');
  const entries = await f.db.select().from(cashEntries);
  assert.equal(entries.length, 1); assert.equal(entries[0]!.kind, 'customer_refund'); assert.equal(entries[0]!.amount, 585241);
  assert.equal(await expectedCash(f, shift.id), before - 585241);
});

test('void only: refund and drawer entry undone, money becomes refundable again; manual void of refund entry stays blocked', async () => {
  const { f, r, refund, shift } = await refunded('cash');
  const entryId = refund.cashEntryId;
  assert.equal((await f.call(`/cash/entries/${entryId}/void`, f.mgr, 'POST', { reason: 'Huỷ tay' })).status, 409, 'no side door around the correction');
  const before = await expectedCash(f, shift.id);
  f.ok(await correct(f, refund.id, { action: 'void', reason: 'Lập nhầm phiếu, khách chưa nhận tiền' }), 201);
  assert.equal(await expectedCash(f, shift.id), before + 585241);
  const view = f.ok(await f.call('/orders/fix/returns', f.mgr));
  assert.equal(view.account.refunded, 0); assert.equal(view.account.available, 585241);
  assert.equal(view.refundMethods.remaining.cash, 2186125);
  f.ok(await f.call(`/orders/fix/returns/${r.id}/refund`, f.mgr, 'POST', { key: crypto.randomUUID(), amount: 585241, method: 'cash', drawerId: 'store', confirmed: true }), 201);
  assert.equal((await f.db.select().from(cashEntries)).filter((e) => e.status === 'posted').length, 1);
});

test('refund correction migration is repeatable and its read-only gate rejects missing parts', async () => {
  const { client } = await createTestDb();
  const migration = readFileSync(new URL('../../migrations/postgres/20261128100000_refund_corrections.sql', import.meta.url), 'utf8');
  const gate = readFileSync(new URL('../../scripts/sql/assert-refund-corrections.sql', import.meta.url), 'utf8');
  await client.exec(migration);
  await client.exec('BEGIN READ ONLY'); await client.exec(gate); await client.exec('ROLLBACK');
  for (const mutation of ['ALTER TABLE pos_refunds DROP COLUMN replaced_by_refund_id', 'DROP INDEX uq_refund_correction_refund', 'ALTER TABLE pos_refund_corrections DISABLE ROW LEVEL SECURITY']) {
    await client.exec('BEGIN'); await client.exec(mutation); await client.exec('SAVEPOINT gate');
    await assert.rejects(client.exec(gate));
    await client.exec('ROLLBACK TO SAVEPOINT gate'); await client.exec('ROLLBACK');
  }
});
