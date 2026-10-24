import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup} from '../helpers/pos-fixture.ts';
import {salesOrders,salesContracts,paymentSchedules,deliveries} from '../../src/modules/sales/schema.ts';

/** Bộ lọc chi tiết trang Công nợ và Lịch giao hàng: lọc ở máy chủ, kèm danh sách chọn nhân viên / chi nhánh / đơn vị giao. */
test('Công nợ + Lịch giao hàng: lọc theo nguồn, loại chứng từ, nhân viên, hoá đơn, giao hàng, ngày', async () => {
  const f = await setup(), now = '2026-10-23T03:00:00.000Z';
  const make = async (id: string, extra: Partial<typeof salesOrders.$inferInsert> = {}) => {
    await f.db.insert(salesOrders).values({id, orderNo: id, quoteType: 'HRC', customerName: 'Khách ' + id, ownerId: 'emp', createdBy: 'emp', orderDate: '2026-10-23', status: 'confirmed', createdAt: now, updatedAt: now, total: 1000, ...extra});
    await f.db.insert(paymentSchedules).values({id: id + '-s', orderId: id, kind: 'balance', amount: 1000, createdAt: now});
  };
  await make('CRM-1', {invoiceStatus: 'issued', invoiceNo: 'HD001'});
  await make('CRM-2', {ownerId: 'mgr', createdBy: 'mgr', invoiceStatus: 'requested'});
  await make('POS-1', {channel: 'pos', fulfillmentMode: 'cod'});
  await make('HDKT-1', {createdAt: '2026-10-01T03:00:00.000Z'});
  await f.db.insert(salesContracts).values({id: 'k1', contractNo: 'HD-1', orderId: 'HDKT-1', legalEntity: 'BN', value: 1000, status: 'signed', createdBy: 'emp', createdAt: now, updatedAt: now});
  const ship = (id: string, orderId: string, status: 'planned' | 'delivered', carrier: string) => ({id, deliveryNo: id, orderId, plannedDate: '2026-10-24', status, carrier, createdBy: 'mgr', createdAt: now, updatedAt: now});
  await f.db.insert(deliveries).values([ship('GH1', 'CRM-1', 'delivered', 'Tự giao'), ship('GH2', 'CRM-2', 'planned', 'Viettel Post'), ship('GH3', 'HDKT-1', 'planned', 'Tự giao')]);

  const rec = async (params: string) => { const r = await f.call('/receivables?' + params, f.mgr); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };
  const ids = (d: any) => d.receivables.map((r: any) => r.orderId).sort();
  const all = await rec('');
  assert.deepEqual(ids(all), ['CRM-1', 'CRM-2', 'HDKT-1', 'POS-1']);
  assert.equal(all.totals.balance, 4000);
  assert.deepEqual(all.filterOptions.branches[0], {id: 'crm', name: 'VIGIFTS / CRM'});
  assert.ok(all.filterOptions.owners.some((o: any) => o.id === 'mgr'));
  assert.deepEqual(ids(await rec('source=ghn')), ['POS-1']);
  assert.deepEqual(ids(await rec('source=crm')), ['CRM-1', 'CRM-2', 'HDKT-1']);
  assert.deepEqual(ids(await rec('kind=contract')), ['HDKT-1']);
  assert.deepEqual(ids(await rec('kind=order&source=crm')), ['CRM-1', 'CRM-2']);
  const mine = await rec('owner=mgr');
  assert.deepEqual(ids(mine), ['CRM-2']); assert.equal(mine.totals.balance, 1000, 'tổng chạy theo bộ lọc');
  assert.deepEqual(ids(await rec('invoice=issued')), ['CRM-1']);
  assert.deepEqual(ids(await rec('invoice=requested')), ['CRM-2']);
  assert.deepEqual(ids(await rec('delivery=delivered')), ['CRM-1']);
  assert.deepEqual(ids(await rec('delivery=planned')), ['CRM-2', 'HDKT-1']);
  assert.deepEqual(ids(await rec('delivery=none')), ['POS-1']);
  assert.deepEqual(ids(await rec('from=2026-10-20')), ['CRM-1', 'CRM-2', 'POS-1']);
  assert.deepEqual(ids(await rec('to=2026-10-02')), ['HDKT-1']);
  const row = all.receivables.find((r: any) => r.orderId === 'CRM-2');
  assert.deepEqual([row.deliveryStatus, row.deliveryCarrier, row.invoiceStatus], ['planned', 'Viettel Post', 'requested']);
  assert.equal((await f.call('/receivables?delivery=bogus', f.mgr)).status, 400);
  assert.equal((await f.call('/receivables?from=2026-10-25&to=2026-10-01', f.mgr)).status, 400);

  const del = async (params: string) => { const r = await f.call('/deliveries?from=2026-10-01&to=2026-10-31&' + params, f.mgr); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };
  const nos = (d: any) => d.deliveries.map((x: any) => x.deliveryNo).sort();
  const everything = await del('');
  assert.deepEqual(nos(everything), ['GH1', 'GH2', 'GH3']);
  assert.deepEqual(everything.filterOptions.carriers, ['Tự giao', 'Viettel Post']);
  assert.ok(everything.filterOptions.owners.some((o: any) => o.id === 'emp'));
  assert.deepEqual(nos(await del('owner=mgr')), ['GH2']);
  assert.deepEqual(nos(await del('kind=contract')), ['GH3']);
  assert.deepEqual(nos(await del('kind=order')), ['GH1', 'GH2']);
  assert.deepEqual(nos(await del('carrier=' + encodeURIComponent('Tự giao'))), ['GH1', 'GH3']);
  assert.deepEqual(nos(await del('invoice=issued')), ['GH1']);
  assert.deepEqual(nos(await del('status=planned&kind=order')), ['GH2']);
  const one = everything.deliveries.find((x: any) => x.deliveryNo === 'GH1');
  assert.deepEqual([one.ownerName.length > 0, one.invoiceNo], [true, 'HD001']);
});
