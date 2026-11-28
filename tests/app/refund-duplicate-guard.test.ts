import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { setupCrmReturns } from '../helpers/crm-return-fixture.ts';
import { cashEntries } from '../../src/modules/sales/cash-schema.ts';
import { auditLogs } from '../../src/core/db/schema.ts';

test('manual drawer entries cannot record an existing refund again; same-amount refund wording needs explicit confirmation', async () => {
  const f = await setupCrmReturns();
  await f.seed('dup', 2186125, 'emp', true, 'cash');
  const { data: r } = await f.create('dup', [{ orderLineId: 'dup-b', qty: 2, disposition: 'restock' }]);
  await f.receive('dup', r.id);
  await f.open(f.mgr);
  const refund = f.ok(await f.call(`/orders/dup/returns/${r.id}/refund`, f.mgr, 'POST', { key: crypto.randomUUID(), amount: 585241, method: 'cash', drawerId: 'store', confirmed: true }), 201);
  const post = (body: Record<string, unknown>) => f.call('/cash/entries?drawerId=store', f.mgr, 'POST', { key: crypto.randomUUID(), kind: 'petty_expense', amount: 585241, ...body });
  const before = (await f.db.select().from(cashEntries)).length;

  const byCode = await post({ reason: `Chi hoàn khách theo ${refund.refundNo.toLowerCase()}` });
  assert.equal(byCode.status, 409); assert.equal(byCode.data.code, 'CASH_ENTRY_DUPLICATES_REFUND');
  const byReturn = await post({ amount: 1000, reason: `Bù tiền phiếu ${r.returnNo}` });
  assert.equal(byReturn.status, 409); assert.equal(byReturn.data.code, 'CASH_ENTRY_DUPLICATES_REFUND');
  const similar = await post({ reason: 'Hoàn tiền khách trả hàng' });
  assert.equal(similar.status, 409); assert.equal(similar.data.code, 'CASH_ENTRY_SIMILAR_REFUND');
  assert.match(similar.data.error, new RegExp(refund.refundNo));
  assert.equal((await f.db.select().from(cashEntries)).length, before, 'blocked attempts write nothing');

  const confirmed = f.ok(await post({ reason: 'Hoàn tiền cọc khách khác (phiếu giấy 12)', notDuplicateRefund: true }), 201);
  const audit = (await f.db.select().from(auditLogs).where(eq(auditLogs.entityId, confirmed.id))).find((a) => a.action === 'create')!;
  assert.match(audit.data, new RegExp(refund.refundNo), 'override recorded with the refund it was compared to');

  f.ok(await post({ amount: 120000, reason: 'Hoàn tiền xăng xe giao hàng' }), 201);
  f.ok(await post({ reason: 'Mua văn phòng phẩm' }), 201);
  f.ok(await post({ kind: 'other_income', reason: `Thu khác ghi chú ${refund.refundNo}`.replace(refund.refundNo, 'HT-NOTEXIST') }), 201); // unknown codes are not duplicates
});
