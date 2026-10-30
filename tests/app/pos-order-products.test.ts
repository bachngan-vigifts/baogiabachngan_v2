import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { setup } from '../helpers/pos-fixture.ts';
import { products, productPrices } from '../../src/modules/catalog/schema.ts';
import { recordDispatch } from '../../src/modules/sales/api/cancellation-guards.ts';
import { postMoves } from '../../src/modules/inventory/api/ledger.ts';
import { stockBalances, stockMoves } from '../../src/modules/inventory/schema.ts';
import { deliveries, deliveryLines } from '../../src/modules/sales/schema.ts';
const keep = (l: any) => ({ id: l.id, qty: l.qty, price: l.listUnitPrice ?? l.unitPrice, discountType: l.discountType, discountValue: l.discountValue });
async function fixture(policy = 'retail-vat', extra: Record<string, unknown> = {}) {
  const f = await setup(), shift = await f.open();
  await f.db.insert(products).values({ sku: 'B', name: 'Bộ trà mới', unit: 'Bộ', updatedAt: new Date().toISOString() });
  await f.db.insert(productPrices).values([{ sku: 'B', policyId: 'retail-vat', price: 216000 }, { sku: 'B', policyId: 'retail', price: 200000 }]);
  await postMoves(f.db, 'mgr', [{ sku: 'B', warehouseId: 'pos-wh', qty: 5, kind: 'opening', refType: 'opening', refId: 'opening-b' }]);
  const sale = await f.call('/pos/checkout', f.emp, 'POST', f.cart(shift.id, { pricePolicyId: policy, fulfillmentMode: 'cod', delivery: { address: 'Kho khách', receiverName: 'Khách A', receiverPhone: '0900000000' }, ...extra }));
  assert.equal(sale.status, 201, JSON.stringify(sale.data));
  const read = async () => (await f.call('/orders/' + sale.data.id, f.mgr)).data;
  const initial = await read(), path = '/orders/' + sale.data.id + '/pos';
  const save = (d: any, lines: any[]) => f.call(path, f.mgr, 'PUT', { revision: d.order.revision, reason: 'Khách đổi sản phẩm', lines });
  return { ...f, read, initial, save };
}
test('add/remove SKU updates planned delivery, debt, snapshot and stable line IDs without posting stock', async () => {
  const f = await fixture();
    const old = f.initial.lines[0], beforeMoves = await f.db.select().from(stockMoves);
    const added = await f.save(f.initial, [keep(old), { sku: 'B', qty: 2, name: 'Không nhận tên giả', taxRate: 99, discountValue: 0, discountType: 'percent' }]);
    assert.equal(added.status, 200, JSON.stringify(added.data));
    const a = await f.read(), b = a.lines.find((l: any) => l.sku === 'B');
    assert.equal(a.lines.find((l: any) => l.sku === old.sku).id, old.id);
    assert.deepEqual([b.name, b.unit, b.listUnitPrice, b.taxRate], ['Bộ trà mới', 'Bộ', 216000, 8]);
    assert.equal(a.order.total, 626400); assert.equal(a.schedules[0].amount, 626400); assert.equal(a.deliveries[0].codAmount, 626400);
    const snap = JSON.parse(a.order.posSnapshot); assert.deepEqual(snap.lines.map((l: any) => l.sku), ['00123', 'B']);
    const links = await f.db.select().from(deliveryLines); assert.equal(links.length, 2); assert.equal(links.find(l => l.orderLineId === b.id)!.qty, 2);
    const removed = await f.save(a, [keep(b)]); assert.equal(removed.status, 200, JSON.stringify(removed.data));
    const final = await f.read(); assert.equal(final.lines.length, 1); assert.equal(final.lines[0].id, b.id); assert.equal(final.lines[0].lineNo, 1);
    assert.equal(final.order.total, 432000); assert.equal(final.schedules[0].amount, 432000); assert.equal(final.deliveries[0].codAmount, 432000);
    assert.deepEqual((await f.db.select().from(deliveryLines)).map(l => l.orderLineId), [b.id]);
    assert.deepEqual(await f.db.select().from(stockMoves), beforeMoves);
    assert.deepEqual((await f.db.select().from(stockBalances)).map(l => l.qty), [10, 5]);
    assert.equal((await f.save(a, [keep(b)])).status, 409, 'stale revision cannot repeat replacement');
});
test('invalid/foreign/duplicate lines, unknown products, insufficient stock and empty order roll back completely', async () => {
  const f = await fixture();
    const old = keep(f.initial.lines[0]);
    for (const [rows, expected] of [
      [[], 400], [[{ ...old, id: 'foreign' }], 400], [[{ ...old, sku: 'B' }], 400],
      [[old, { sku: '00123', qty: 1, price: 108000 }], 400], [[{ sku: 'UNKNOWN', qty: 1 }], 400],
      [[old, { sku: 'B', qty: 6 }], 409], [[old, { sku: 'B', qty: 1, price: -1 }], 400],
    ] as [any[], number][]) {
      const result = await f.save(f.initial, rows); assert.equal(result.status, expected, JSON.stringify(result.data));
      const d = await f.read(); assert.deepEqual(d.lines, f.initial.lines); assert.equal(d.order.revision, f.initial.order.revision); assert.equal(d.order.total, f.initial.order.total);
    }
    await f.db.update(products).set({ active: false }).where(eq(products.sku, 'B'));
    assert.equal((await f.save(f.initial, [{ sku: 'B', qty: 1 }])).status, 400);
});
test('new SKU follows original no-VAT policy', async () => {
  const f = await fixture('retail');
    const saved = await f.save(f.initial, [{ sku: 'B', qty: 2 }]); assert.equal(saved.status, 200, JSON.stringify(saved.data));
    const d = await f.read(); assert.deepEqual([d.lines[0].listUnitPrice, d.lines[0].taxRate, d.order.tax, d.order.total], [200000, 0, 0, 400000]);
});
test('GHN label and historical cancelled delivery prevent unsafe product replacement', async () => {
  const f = await fixture();
    const ship = f.initial.deliveries[0];
    await f.db.update(deliveries).set({ trackingCode: 'GHN-TEST' }).where(eq(deliveries.id, ship.id));
    assert.equal((await f.save(f.initial, [{ sku: 'B', qty: 1 }])).status, 409);
    await f.db.update(deliveries).set({ trackingCode: '' }).where(eq(deliveries.id, ship.id));
    await f.db.insert(deliveries).values({ ...ship, id: 'cancelled-history', deliveryNo: 'HISTORY', status: 'cancelled', trackingCode: '' });
    await f.db.insert(deliveryLines).values({ deliveryId: 'cancelled-history', orderLineId: f.initial.lines[0].id, qty: 2 });
    const result = await f.save(f.initial, [{ sku: 'B', qty: 1 }]); assert.equal(result.status, 409); assert.match(JSON.stringify(result.data), /lịch sử/);
    assert.deepEqual((await f.read()).lines, f.initial.lines);
    await recordDispatch(f.db, f.initial.order.id, ship.id, 'mgr', 'in_transit');
    const dispatched = await f.save(f.initial, [keep(f.initial.lines[0]), { sku: 'B', qty: 1 }]);
    assert.equal(dispatched.status, 409); assert.match(JSON.stringify(dispatched.data), /RETURN_REQUIRED/);
});

test('replacement reapportions percentage voucher and preserves shipping fees; oversized fixed voucher rolls back', async () => {
  const f = await fixture('retail-vat', { voucher: { code: 'TEN', type: 'percent', value: 10 }, shippingFee: 20000 });
  const saved = await f.save(f.initial, [{ sku: 'B', qty: 2 }]); assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const d = await f.read(), snap = JSON.parse(d.order.posSnapshot);
  assert.equal(snap.voucher.amount, 43200); assert.equal(d.order.posFees.shippingFee, 20000); assert.equal(d.order.total, 408800);
  assert.equal(d.schedules[0].amount, 408800); assert.equal(d.deliveries[0].codAmount, 408800);
  const g = await fixture('retail-vat', { voucher: { code: 'FIXED', type: 'amount', value: 150000 } });
  const failed = await g.save(g.initial, [{ sku: 'B', qty: 1, price: 100000 }]); assert.equal(failed.status, 400); assert.match(JSON.stringify(failed.data), /Voucher vượt/);
  assert.deepEqual((await g.read()).lines, g.initial.lines);
});
