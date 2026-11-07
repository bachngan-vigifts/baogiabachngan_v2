import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { setup } from '../helpers/pos-fixture.ts';
import { employees } from '../../src/modules/staff/schema.ts';
import { salesOrders, salesOrderLines, deliveries, deliveryLines } from '../../src/modules/sales/schema.ts';

test('lịch bắt đầu thứ Hai, qua năm/nhuận; quá hạn chỉ tính chuyến chưa hoàn tất', async () => {
  const ui = await import(new URL('../../trial-ui/delivery-calendar.js', import.meta.url).href);
  const days = ui.deliveryCalendarDays('2026-11-07');
  assert.equal(days.length, 42); assert.equal(days[0], '2026-10-26'); assert.equal(days.at(-1), '2026-12-06');
  assert.deepEqual(ui.deliveryCalendarDays('2027-01-01', 'week'), ['2026-12-28','2026-12-29','2026-12-30','2026-12-31','2027-01-01','2027-01-02','2027-01-03']);
  assert.deepEqual(ui.deliveryCalendarDays('2024-02-29', 'day'), ['2024-02-29']);
  assert.equal(ui.deliveryDay('2024-02-28', 1), '2024-02-29');
  for (const status of ['planned','in_transit','failed']) assert.equal(ui.deliveryIsOverdue({status,plannedDate:'2026-11-06'}, '2026-11-07'), true);
  for (const status of ['delivered','cancelled']) assert.equal(ui.deliveryIsOverdue({status,plannedDate:'2026-11-06'}, '2026-11-07'), false);
  assert.equal(ui.deliveryIsOverdue({status:'planned',plannedDate:'2026-11-07'}, '2026-11-07'), false);
});

test('lọc lịch trên server trước giới hạn; batch sản phẩm đúng chuyến và giữ phạm vi/quyền giá', async () => {
  const f = await setup(), now = '2026-11-01T00:00:00.000Z';
    await f.db.insert(salesOrders).values([
      {id:'cal-own',orderNo:'CAL-OWN',quoteType:'HRC',ownerId:'emp',createdBy:'emp',customerName:'Công ty lịch thử',contact:'Liên hệ',phone:'0900000000',address:'Cần Thơ',orderDate:'2026-11-01',status:'confirmed',createdAt:now,updatedAt:now},
      {id:'cal-private',orderNo:'CAL-PRIVATE',quoteType:'HRC',ownerId:'mgr',createdBy:'mgr',customerName:'Khách riêng',orderDate:'2026-11-01',status:'confirmed',createdAt:now,updatedAt:now},
    ]);
    await f.db.insert(salesOrderLines).values({id:'cal-line',orderId:'cal-own',lineNo:1,sku:'CAL-SKU',name:'Ly kiểm thử',unit:'Cái',qty:10,unitPrice:1000,taxRate:8,amount:10000});
    await f.db.insert(deliveries).values([
      {id:'cal-a',deliveryNo:'CAL-A',orderId:'cal-own',plannedDate:'2026-11-03',receiverName:'Người nhận thử',receiverPhone:'0911111111',address:'Sóc Trăng',trackingCode:'CAL-TRACK',assigneeId:'mgr',note:'kiện dễ vỡ',createdBy:'emp',createdAt:now,updatedAt:now},
      {id:'cal-b',deliveryNo:'CAL-B',orderId:'cal-private',plannedDate:'2026-11-04',createdBy:'mgr',createdAt:now,updatedAt:now},
    ]);
    await f.db.insert(deliveryLines).values({deliveryId:'cal-a',orderLineId:'cal-line',qty:3});
    const read = async (params: string, who = f.mgr) => { const r = await f.call('/deliveries?from=2026-11-01&to=2026-11-30&'+params, who); assert.equal(r.status,200,JSON.stringify(r.data)); return r.data; };
    for (const query of ['product=CAL-SKU','product='+encodeURIComponent('Ly kiểm thử'),'customer='+encodeURIComponent('lịch thử'),'receiver=091111','address='+encodeURIComponent('Sóc Trăng'),'assignee=mgr','tracking=yes','confirmation=no&q=CAL-TRACK','q='+encodeURIComponent('dễ vỡ')])
      assert.deepEqual((await read(query)).deliveries.map((d:any)=>d.id),['cal-a'],query);
    assert.equal((await read('product=missing')).deliveries.length,0);
    assert.deepEqual((await read('sort=date_asc')).deliveries.map((d:any)=>d.id),['cal-a','cal-b']);
    assert.deepEqual((await read('sort=date_desc')).deliveries.map((d:any)=>d.id),['cal-b','cal-a']);
    assert.equal((await read('product=%25')).deliveries.length,0,'ký tự % là nội dung tìm kiếm, không phải wildcard');
    assert.equal((await read('q='+encodeURIComponent("' OR 1=1 --"))).deliveries.length,0);
    const data = await read('product=CAL-SKU'), product = data.deliveries[0].products[0];
    assert.deepEqual([product.qty,product.unitPrice,product.amount,product.total],[3,1000,3000,3240]);
    assert.ok(data.filterOptions.assignees.some((p:any)=>p.id==='mgr'));
    assert.equal((await read('',f.emp)).deliveries.some((d:any)=>d.id==='cal-b'),false,'không lộ chuyến của người khác');
    await f.db.update(employees).set({positionId:'warehouse'}).where(eq(employees.id,'cashier2'));
    const warehouse = await read('product=CAL-SKU',f.other);
    assert.equal(warehouse.deliveries[0].shippingFee,null);
    assert.equal('unitPrice' in warehouse.deliveries[0].products[0],false,'kho không nhận giá bán');
    for (const query of ['due=bad','tracking=bad','confirmation=bad','status=bad','kind=bad','invoice=bad','sort=bad','to=2026-10-01','q='+'a'.repeat(201)])
      assert.equal((await f.call('/deliveries?from=2026-11-01&'+query,f.mgr)).status,400,query);
    await f.db.insert(deliveries).values(Array.from({length:501},(_,i)=>({id:'bulk-'+i,deliveryNo:i===0?'TARGET-OLDEST':'BULK-'+i,orderId:'cal-own',plannedDate:'2028-01-01',createdBy:'emp',createdAt:now,updatedAt:now})));
    const all = await f.call('/deliveries?from=2028-01-01&to=2028-01-01',f.mgr);
    assert.equal(all.data.deliveries.length,500); assert.equal(all.data.truncated,true);
    const target = await f.call('/deliveries?from=2028-01-01&to=2028-01-01&q=TARGET-OLDEST',f.mgr);
    assert.equal(target.data.deliveries.length,1); assert.equal(target.data.truncated,false);
    assert.equal((await read('due=no-time&tracking=yes')).deliveries[0].id,'cal-a');
});
