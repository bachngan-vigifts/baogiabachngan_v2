import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eq } from 'drizzle-orm';
import { setupEarly } from '../helpers/purchase-early-fixture.ts';
import { paymentDaysOfTerm } from '../../src/modules/sales/domain/contract-quote-terms.ts';
import { orderPaymentDays, setBalanceDueOnDelivery } from '../../src/modules/sales/api/payment-terms.ts';
import { contractSchedules } from '../../src/modules/sales/domain/sales.ts';
import { deliveries, paymentSchedules, salesContracts, salesOrders } from '../../src/modules/sales/schema.ts';
import { auditLogs } from '../../src/core/db/schema.ts';

const ok = (r: any, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.data)); return r.data; };

test('số ngày thanh toán đọc được cả dạng số lẫn câu chữ; điều kiện không có số ngày thì không đoán', () => {
  assert.equal(paymentDaysOfTerm('30'), 30);
  assert.equal(paymentDaysOfTerm('30 ngày'), 30);
  assert.equal(paymentDaysOfTerm('Trong vòng 30 ngày kể từ ngày giao hàng'), 30);
  assert.equal(paymentDaysOfTerm('Thanh toán 70% còn lại sau 45 ngày'), 45);
  assert.equal(paymentDaysOfTerm('Thanh toán trước khi giao hàng'), undefined);
  assert.equal(paymentDaysOfTerm(''), undefined);
});

test('đơn không HĐKT: báo giá → điều khoản khách → 0; điều kiện bằng chữ của báo giá không bị điều khoản khách thay', () => {
  assert.equal(orderPaymentDays({ paymentTerms: { depositRate: 0, balanceTerm: '30' } }, '5'), 30);
  assert.equal(orderPaymentDays(JSON.stringify({ paymentTerms: { depositRate: 0, balanceTerm: 'Trong vòng 30 ngày kể từ ngày giao hàng' } })), 30);
  assert.equal(orderPaymentDays({ paymentTerms: { depositRate: 0, balanceTerm: 'Thanh toán trước khi giao hàng' } }, '15'), 0);
  assert.equal(orderPaymentDays({}, '15'), 15);
  assert.equal(orderPaymentDays({}, null), 0);
  assert.equal(orderPaymentDays(null, 'Theo thoả thuận'), 0);
});

test('cọc HĐKT đến hạn sau ngày ký 3 ngày', () => {
  assert.deepEqual(contractSchedules(1000, 30, '2026-10-30').map(s => [s.kind, s.dueDate]), [['deposit', '2026-11-02'], ['balance', null]]);
});

async function quote(f: Awaited<ReturnType<typeof setupEarly>>, paymentTerms: { depositRate: number; balanceTerm: string }) {
  const q = ok(await f.call('/quotes', f.cookies.emp!, 'POST', { type: 'B2B', quoteNo: 'BG-' + crypto.randomUUID(), customer: 'Công ty Hạn Nợ', customerTaxCode: '0312345678', vat: 8,
    paymentTerms, rows: [{ sku: '', name: 'Quà tặng', unit: 'Cái', qty: 2, price: 500000 }] }), 201);
  ok(await f.call('/quotes/' + q.id + '/approve', f.cookies.mgr!, 'POST', { revision: 1 }));
  return q.id as string;
}

test('đơn từ báo giá 30 ngày: giao xong mới đến hạn sau 30 ngày; Manager rà và sửa hạn cũ có xem trước, chống ghi đè, ghi nhật ký', async () => {
  const f = await setupEarly();
  const order = ok(await f.call('/orders', f.cookies.emp!, 'POST', { quoteId: await quote(f, { depositRate: 0, balanceTerm: '30' }) }), 201);
  const [o] = await f.db.select().from(salesOrders).where(eq(salesOrders.id, order.id));
  await f.db.transaction(tx => setBalanceDueOnDelivery(tx, o!, '2026-10-20'));
  const [s] = await f.db.select().from(paymentSchedules).where(eq(paymentSchedules.orderId, order.id));
  assert.equal(s!.dueDate, '2026-11-19');

  // Dữ liệu cũ bị lỗi: hạn = ngày giao (0 ngày).
  await f.db.update(paymentSchedules).set({ dueDate: '2026-10-20' }).where(eq(paymentSchedules.id, s!.id));
  await f.db.update(salesOrders).set({ status: 'delivered' }).where(eq(salesOrders.id, order.id));
  await f.db.insert(deliveries).values({ id: 'trip-due', deliveryNo: 'GH-DUE', orderId: order.id, plannedDate: '2026-10-20', status: 'delivered', deliveredAt: '2026-10-20', createdBy: 'emp', createdAt: '2026-10-20T01:00:00Z', updatedAt: '2026-10-20T01:00:00Z' });

  assert.equal((await f.call('/payment-due-repairs', f.cookies.emp!)).status, 403);
  const preview = ok(await f.call('/payment-due-repairs', f.cookies.mgr!)).items;
  assert.equal(preview.length, 1);
  assert.deepEqual([preview[0].id, preview[0].kind, preview[0].from, preview[0].to], [s!.id, 'balance', '2026-10-20', '2026-11-19']);
  assert.match(preview[0].reason, /\+ 30 ngày/);

  assert.equal((await f.call('/payment-due-repairs', f.cookies.emp!, 'POST', { items: [{ id: s!.id, from: '2026-10-20', to: '2026-11-19' }] })).status, 403);
  const stale = ok(await f.call('/payment-due-repairs', f.cookies.mgr!, 'POST', { items: [{ id: s!.id, from: '2026-10-19', to: '2026-11-19' }] }));
  assert.deepEqual(stale, { applied: 0, skipped: 1 });
  assert.equal((await f.db.select().from(paymentSchedules).where(eq(paymentSchedules.id, s!.id)))[0]!.dueDate, '2026-10-20');

  const applied = ok(await f.call('/payment-due-repairs', f.cookies.mgr!, 'POST', { items: [{ id: s!.id, from: '2026-10-20', to: '2026-11-19' }] }));
  assert.deepEqual(applied, { applied: 1, skipped: 0 });
  assert.equal((await f.db.select().from(paymentSchedules).where(eq(paymentSchedules.id, s!.id)))[0]!.dueDate, '2026-11-19');
  const [log] = await f.db.select().from(auditLogs).where(eq(auditLogs.entityId, s!.id));
  assert.equal(log!.action, 'payment-due-repair'); assert.equal(log!.actorId, 'mgr');
  assert.deepEqual(ok(await f.call('/payment-due-repairs', f.cookies.mgr!)).items, []);
  // Áp lại cùng lựa chọn: không đổi gì nữa.
  assert.deepEqual(ok(await f.call('/payment-due-repairs', f.cookies.mgr!, 'POST', { items: [{ id: s!.id, from: '2026-10-20', to: '2026-11-19' }] })), { applied: 0, skipped: 1 });
});

test('lập HĐKT không gửi cọc / số ngày: lấy theo báo giá (không còn mặc định 15 ngày hay 0)', async () => {
  const f = await setupEarly();
  const quoteId = await quote(f, { depositRate: 30, balanceTerm: 'Trong vòng 30 ngày kể từ ngày giao hàng' });
  const preview = ok(await f.call(`/contracts/next-no?quoteId=${quoteId}&legalEntity=BN`, f.cookies.emp!));
  assert.deepEqual(preview.terms, { depositRate: 30, paymentDays: 30 });
  const r = await f.call('/contracts', f.cookies.emp!, 'POST', { quoteId, legalEntity: 'BN', signedDate: '2026-10-30' });
  const created = ok(r, r.status === 201 ? 201 : 200);
  const [k] = await f.db.select().from(salesContracts).where(eq(salesContracts.contractNo, created.contractNo));
  assert.equal(k!.paymentDays, 30); assert.equal(k!.depositRate, 30);
  const deposit = (await f.db.select().from(paymentSchedules).where(eq(paymentSchedules.orderId, k!.orderId))).find(s => s.kind === 'deposit');
  assert.equal(deposit!.dueDate, '2026-11-02');
});
