import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { setup } from '../helpers/pos-fixture.ts';
import { products, productPrices } from '../../src/modules/catalog/schema.ts';
import { salesOrders, deliveries } from '../../src/modules/sales/schema.ts';
import { stockMoves, stockBalances } from '../../src/modules/inventory/schema.ts';
import { postMoves } from '../../src/modules/inventory/api/ledger.ts';
import { reservedBySku } from '../../src/modules/sales/api/pos-store.ts';
import { applyGhnStatus } from '../../src/modules/sales/api/pos-ghn-sync.ts';
import { editPosOrderWithGhn } from '../../src/modules/sales/api/pos-ghn-edit.ts';
import { pendingGhnEdit } from '../../src/modules/sales/domain/pos-ghn-edit.ts';
import { assertPosFlowFulfillable } from '../../src/modules/sales/api/pos-order-flow-guards.ts';
async function fixture() {
  const f = await setup(), shift = await f.open();
  await f.db.insert(products).values({ sku: 'B', name: 'Bộ trà mới', unit: 'Bộ', updatedAt: new Date().toISOString() });
  await f.db.insert(productPrices).values({ sku: 'B', policyId: 'retail-vat', price: 216000 });
  await postMoves(f.db, 'mgr', [{ sku: 'B', warehouseId: 'pos-wh', qty: 5, kind: 'opening', refType: 'opening', refId: 'B-opening' }]);
  const sale = await f.call('/pos/checkout', f.emp, 'POST', f.cart(shift.id, { fulfillmentMode: 'cod', delivery: { address: 'Kho khách', receiverName: 'Khách A', receiverPhone: '0900000000' } }));
  assert.equal(sale.status, 201, JSON.stringify(sale.data));
  const orderId = sale.data.id, read = async () => (await f.call('/orders/' + orderId, f.mgr)).data;
  let d = await read(), snap = JSON.parse(d.order.posSnapshot); snap.register.name = 'Lock Cần Thơ';
  await f.db.update(salesOrders).set({ posSnapshot: JSON.stringify(snap) }).where(eq(salesOrders.id, orderId));
  const deliveryId = d.deliveries[0].id;
  await f.db.update(deliveries).set({ carrier: 'GHN', trackingCode: 'GHN-EDIT', trackingStatus: 'picking' }).where(eq(deliveries.id, deliveryId));
  d = await read();
  const remote: any = { order_code: 'GHN-EDIT', client_order_code: d.order.orderNo, shop_id: 6096731, status: 'picking', cod_amount: d.order.total, items: [{ code: '00123', name: 'Ly sứ', quantity: 2, price: 97200 }], content: 'Ly sứ' };
  const calls: { endpoint: string; body: any }[] = [];
  const hooks: { onUpdate?: () => Promise<void>; rejectCod?: boolean; dropResponse?: boolean; failRead?: boolean } = {};
  f.env.ghnToken = 'test-only-credential';
  f.env.ghnFetch = (async (url: any, init: any) => {
    const endpoint = String(url).split('/').pop()!, body = JSON.parse(init.body); calls.push({ endpoint, body });
    if (endpoint === 'detail') { if (hooks.failRead) throw Error('offline'); return Response.json({ code: 200, data: structuredClone(remote) }); }
    if (endpoint === 'update') { remote.items = body.items; remote.content = body.content; await hooks.onUpdate?.(); if (hooks.dropResponse) throw Error('response lost'); return Response.json({ code: 200, data: null }); }
    if (endpoint === 'updateCOD') { assert.deepEqual(Object.keys(body).sort(), ['cod_amount','order_code']); if (hooks.rejectCod) return Response.json({ code: 400 }, { status: 400 }); remote.cod_amount = body.cod_amount; return Response.json({ code: 200, data: null }); }
    throw Error('Unexpected carrier endpoint');
  }) as typeof fetch;
  const request = { revision: d.order.revision, requestKey: crypto.randomUUID(), reason: 'Khách đổi bộ trà', lines: [{ sku: 'B', qty: 2, discountType: 'percent', discountValue: 0 }] };
  const path = '/orders/' + orderId + '/pos';
  const save = (body: any = request) => f.call(path, f.mgr, 'PUT', body);
  return { ...f, orderId, deliveryId, initial: d, read, remote, calls, hooks, request, path, save };
}
test('GHN picking: edit items and COD before CRM, hold both SKU sets, then dispatch only the new SKU once', async () => {
  const f = await fixture();
  const hookErrors: unknown[] = [];
  f.hooks.onUpdate = async () => {
    try {
    const pending = await f.read(); assert.equal(pending.lines[0].sku, '00123'); assert.equal(pending.order.total, 194400);
    const held = await reservedBySku(f.db, ['00123','B'], 'pos-wh'); assert.equal(held.get('00123'), 2); assert.equal(held.get('B'), 2);
    const competing = await f.call('/pos/checkout', f.emp, 'POST', f.cart((JSON.parse(pending.order.posSnapshot)).shiftId || pending.order.shiftId, { rows: [{ sku: 'B', qty: 4 }], tendered: 1000000 }));
    assert.equal(competing.status, 409, JSON.stringify(competing.data));
    const duplicate = await f.save(); assert.equal(duplicate.status, 409); assert.match(JSON.stringify(duplicate.data), /GHN_EDIT_BUSY/);
    await assert.rejects(assertPosFlowFulfillable(f.db, f.orderId), (e: any) => e.code === 'GHN_EDIT_PENDING');
    assert.equal((await f.call('/payments', f.mgr, 'POST', { orderId: f.orderId, amount: 1 })).status, 409);
    const packing = await f.call('/orders/' + f.orderId + '/packing', f.mgr, 'POST', { allocations: [{ orderLineId: f.initial.lines[0].id, qty: 2, source: 'warehouse' }] });
    assert.equal(packing.status, 409); assert.match(JSON.stringify(packing.data), /GHN_EDIT_PENDING/);
    const sync = await applyGhnStatus(f.env, f.deliveryId, 'picked', new Date().toISOString()); assert.equal(sync, false);
    assert.equal((await f.db.select().from(stockMoves)).length, 2);
    } catch (e) { hookErrors.push(e); }
  };
  const result = await f.save(); assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.deepEqual(hookErrors, []);
  const d = await f.read(); assert.deepEqual([d.lines[0].sku, d.lines[0].qty, d.order.total, d.schedules[0].amount, d.deliveries[0].codAmount], ['B',2,432000,432000,432000]);
  assert.equal(pendingGhnEdit(d.order.posSnapshot), null); assert.equal(f.remote.cod_amount, 432000);
  assert.equal(f.calls.filter(c => c.endpoint === 'update').length, 1); assert.equal(f.calls.filter(c => c.endpoint === 'updateCOD').length, 1);
  assert.equal((await f.db.select().from(stockMoves)).length, 2);
  const before = f.calls.length; assert.equal((await f.save()).status, 200); assert.equal(f.calls.length, before, 'replay returns committed result without re-sending carrier updates');
  await applyGhnStatus(f.env, f.deliveryId, 'picked', new Date().toISOString());
  const moves = await f.db.select().from(stockMoves); assert.equal(moves.length, 3); assert.deepEqual(moves.filter(m => m.kind === 'issue').map(m => [m.sku,m.qty]), [['B',-2]]);
  await applyGhnStatus(f.env, f.deliveryId, 'picked', new Date().toISOString()); assert.equal((await f.db.select().from(stockMoves)).length, 3);
});
test('partial failure keeps original CRM and union holds; resume after reload sends only the missing COD update', async () => {
  const f = await fixture(); f.hooks.rejectCod = true;
  const first = await f.save(); assert.equal(first.status, 502, JSON.stringify(first.data));
  const pending = await f.read(), edit = pendingGhnEdit(pending.order.posSnapshot)!;
  assert.equal(pending.lines[0].sku, '00123'); assert.equal(pending.schedules[0].amount, 194400); assert.equal(edit.leaseUntil, 0); assert.equal(edit.key, f.request.requestKey);
  assert.equal((await reservedBySku(f.db, ['B'], 'pos-wh')).get('B'), 2);
  assert.equal((await f.save({ requestKey: edit.key, cancelGhnEdit: true })).status, 409, 'cannot discard when carrier has already accepted different goods');
  f.hooks.rejectCod = false;
  const retry = await f.save({ requestKey: edit.key, resumeGhnEdit: true }); assert.equal(retry.status, 200, JSON.stringify(retry.data));
  assert.equal((await f.read()).lines[0].sku, 'B'); assert.equal(f.calls.filter(c => c.endpoint === 'update').length, 1);
});
test('GHN took goods before editing: no carrier writes; abandon unchanged draft and release extra reservation', async () => {
  const f = await fixture(); f.remote.status = 'picked';
  const blocked = await f.save(); assert.equal(blocked.status, 409, JSON.stringify(blocked.data));
  assert.equal(f.calls.some(c => c.endpoint !== 'detail'), false);
  const before = await f.read(); assert.equal(before.lines[0].sku, '00123');
  const abandoned = await f.save({ requestKey: f.request.requestKey, cancelGhnEdit: true }); assert.equal(abandoned.status, 200, JSON.stringify(abandoned.data));
  assert.equal((await f.save()).status, 409, 'an abandoned key cannot replay as a successful edit');
  assert.equal(pendingGhnEdit((await f.read()).order.posSnapshot), null); assert.equal((await reservedBySku(f.db, ['B'], 'pos-wh')).get('B') || 0, 0);
});
test('lost update response is reconciled by readback; failed CRM commit can resume without sending carrier updates twice', async () => {
  const f = await fixture(); f.hooks.dropResponse = true;
  const actor = (await f.call('/me', f.mgr)).data.user;
  await assert.rejects(editPosOrderWithGhn(f.env, f.orderId, actor, f.request, async () => { throw Error('commit interrupted'); }));
  assert.equal((await f.read()).lines[0].sku, '00123'); assert.equal(f.remote.items[0].code, 'B'); assert.equal(f.remote.cod_amount, 432000);
  f.remote.status = 'picked';
  const resumed = await f.save({ requestKey: f.request.requestKey, resumeGhnEdit: true }); assert.equal(resumed.status, 200, JSON.stringify(resumed.data));
  assert.equal(f.calls.filter(c => c.endpoint === 'update').length, 1); assert.equal(f.calls.filter(c => c.endpoint === 'updateCOD').length, 1);
  assert.equal((await f.read()).lines[0].sku, 'B');
});
test('validation fails before remote writes; read failure can safely abandon before any carrier mutation', async () => {
  const f = await fixture();
  assert.equal((await f.save({ ...f.request, lines: [{ sku: 'B', qty: 6 }] })).status, 409); assert.equal(f.calls.length, 0);
  assert.equal((await f.save({ ...f.request, requestKey: undefined })).status, 409); assert.equal(f.calls.length, 0);
  f.hooks.failRead = true;
  assert.equal((await f.save({ ...f.request, otp: 'NEVER-PERSIST', accessToken: 'NEVER-PERSIST' })).status, 502);
  const edit = pendingGhnEdit((await f.read()).order.posSnapshot)!;
  assert.doesNotMatch(JSON.stringify(edit), /NEVER-PERSIST|test-only-credential/);
  const cancelled = await f.save({ requestKey: f.request.requestKey, cancelGhnEdit: true }); assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data));
  assert.equal((await f.db.select().from(stockBalances)).find(r => r.sku === 'B')!.qty, 5);
  f.hooks.failRead = false;
  const fresh = await f.read();
  const sameCod = await f.save({ ...f.request, revision: fresh.order.revision, requestKey: crypto.randomUUID(), lines: [{ sku: 'B', qty: 1, price: 194400 }] });
  assert.equal(sameCod.status, 200, JSON.stringify(sameCod.data));
  assert.equal(f.calls.filter(c => c.endpoint === 'updateCOD').length, 0, 'unchanged COD is never sent again');
});
