import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup} from '../helpers/pos-fixture.ts';
import {salesOrders,deliveries} from '../../src/modules/sales/schema.ts';
// @ts-ignore browser pure renderer
import {ghnOrderSummary,ghnStatusLabel} from '../../trial-ui/ghn-order-summary.js';
test('order list returns stored GHN snapshots only within visible orders and preserves multiple tracking codes',async()=>{
 const f=await setup(),now=new Date().toISOString();
 for(const [id,owner] of [['mine','emp'],['secret','mgr']] as const){
  await f.db.insert(salesOrders).values({id,orderNo:id,quoteType:'HRC',customerName:id,ownerId:owner,createdBy:owner,orderDate:'2026-10-28',status:'confirmed',createdAt:now,updatedAt:now});
  await f.db.insert(deliveries).values({id:id+'-ghn',deliveryNo:id+'-GH',orderId:id,plannedDate:'2026-10-28',carrier:'GHN',trackingCode:id+'123',trackingStatus:'delivering',createdBy:owner,createdAt:now,updatedAt:now});
 }
 await f.db.insert(deliveries).values({id:'second',deliveryNo:'GH-2',orderId:'mine',plannedDate:'2026-10-28',carrier:'GHN',trackingCode:'SECOND',trackingStatus:'delivered',createdBy:'mgr',createdAt:now,updatedAt:now});
 await f.db.insert(deliveries).values({id:'other',deliveryNo:'OTHER',orderId:'mine',plannedDate:'2026-10-28',carrier:'Viettel Post',trackingCode:'OTHER',trackingStatus:'delivered',createdBy:'mgr',createdAt:now,updatedAt:now});
 const mine=await f.call('/orders',f.emp);assert.equal(mine.status,200,JSON.stringify(mine.data));assert.equal(mine.data.orders.length,1);assert.deepEqual(mine.data.orders[0].ghnShipments.map((s:any)=>s.trackingCode).sort(),['SECOND','mine123']);assert.equal(mine.data.orders[0].ghnShipments[0].trackingStatus,'delivering');
 const all=await f.call('/orders',f.mgr);assert.equal(all.data.orders.length,2);assert.equal((await f.call('/orders',f.ncc)).status,403);assert.equal(f.hooks.length,0);
});
test('tracking labels retain unknown values and encode links/text',()=>{
 assert.equal(ghnStatusLabel('delivered'),'Đã giao thành công');assert.equal(ghnStatusLabel('future_status'),'future_status');
 const html=ghnOrderSummary([{id:'a/b',trackingCode:'<script>',trackingStatus:'delivering'}],(s:string)=>String(s).replaceAll('<','&lt;').replaceAll('>','&gt;'));
 assert.ok(html.includes('deliveryId=a%2Fb'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('Đang giao hàng'));assert.equal(ghnOrderSummary(), '');
});
