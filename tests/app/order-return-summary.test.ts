import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq,sql} from 'drizzle-orm';
import {setupCrmReturns} from '../helpers/crm-return-fixture.ts';
import {deliveries,deliveryLines,salesOrders} from '../../src/modules/sales/schema.ts';
import {posReturns} from '../../src/modules/sales/return-schema.ts';
import {stockMoves} from '../../src/modules/inventory/schema.ts';
import {assertCrmOrderCompletion} from '../../src/modules/sales/api/crm-stock-lifecycle.ts';

test('each SKU keeps 2 delivered, shows 1 received/restocked and 1 kept; GET/replay never posts stock',async()=>{
 const f=await setupCrmReturns(),id='partial-return';await f.seed(id,0);
 const made=await f.create(id,[{orderLineId:id+'-a',qty:1,disposition:'restock'},{orderLineId:id+'-b',qty:1,disposition:'restock'}]);
 let d=f.ok(await f.call('/orders/'+id,f.emp));assert.ok(d.lines.every((l:any)=>l.deliveredQty===2&&l.returnedQty===0&&l.pendingReturnQty===1&&l.customerKeptQty===2));assert.equal(d.returnSummary.receivedQty,0);
 await f.receive(id,made.data.id);
 const before=await f.db.select({n:sql<number>`count(*)`,qty:sql<number>`sum(${stockMoves.qty})`}).from(stockMoves);
 d=f.ok(await f.call('/orders/'+id,f.emp));assert.equal(d.order.status,'delivered');assert.deepEqual(d.lines.map((l:any)=>[l.sku,l.qty,l.deliveredQty,l.returnedQty,l.restockedQty,l.customerKeptQty]),[['09566',2,2,1,1,1],['22566',2,2,1,1,1]]);
 assert.equal(d.returnSummary.receivedQty,2);assert.equal(d.returnSummary.restockedQty,2);assert.equal(d.returnSummary.requests[0].returnNo,made.data.returnNo);assert.ok(d.returnSummary.requests[0].warehouseName);
 await f.call('/orders/'+id,f.mgr);f.ok(await f.call(`/orders/${id}/returns/${made.data.id}/receive`,f.emp,'POST',{confirmed:true}));
 assert.deepEqual(await f.db.select({n:sql<number>`count(*)`,qty:sql<number>`sum(${stockMoves.qty})`}).from(stockMoves),before);
 assert.equal((await f.call('/orders/'+id,f.ncc)).status,403);
});

test('damaged returns reduce customer-held goods without inventing sellable restock; cancelled requests do not count',async()=>{
 const f=await setupCrmReturns(),id='damaged-return';await f.seed(id,0);
 const made=await f.create(id,[{orderLineId:id+'-a',qty:1,disposition:'damaged'}]);await f.receive(id,made.data.id);
 const cancelled=await f.create(id,[{orderLineId:id+'-b',qty:1,disposition:'restock'}]);f.ok(await f.call(`/orders/${id}/returns/${cancelled.data.id}/cancel`,f.emp,'POST',{reason:'Không nhận lại hàng'}));
 const d=f.ok(await f.call('/orders/'+id,f.emp));assert.equal(d.lines[0].returnedQty,1);assert.equal(d.lines[0].restockedQty,0);assert.equal(d.lines[0].customerKeptQty,1);assert.equal(d.lines[1].pendingReturnQty,0);assert.equal(d.lines[1].returnedQty,0);
});

test('pre-opening return receipt is visible alongside unresolved stock proof; read projection never opens fulfilment gates',async()=>{
 const f=await setupCrmReturns(),id='historical-return';await f.seed(id,0,'emp',false);
 await f.db.update(salesOrders).set({createdAt:'2026-10-14T01:00:00Z'}).where(eq(salesOrders.id,id));
 await f.db.insert(deliveries).values({id:'historical-trip',deliveryNo:'GH-HISTORY',orderId:id,plannedDate:'2026-10-14',deliveredAt:'2026-10-15',status:'delivered',createdBy:'mgr',createdAt:'2026-10-14T01:00:00Z',updatedAt:'2026-10-15T01:00:00Z'});
 await f.db.insert(deliveryLines).values([{deliveryId:'historical-trip',orderLineId:id+'-a',qty:2},{deliveryId:'historical-trip',orderLineId:id+'-b',qty:2}]);
 for(const sku of ['09566','22566'])await f.db.insert(stockMoves).values({id:'opening-'+sku,sku,warehouseId:'pos-wh',qty:100,kind:'opening',refType:'opening',refId:'opening-'+sku,createdBy:'mgr',createdAt:'2026-10-18T15:43:50Z'});
 const made=await f.create(id,[{orderLineId:id+'-a',qty:1,disposition:'restock'},{orderLineId:id+'-b',qty:1,disposition:'restock'}]);
 f.ok(await f.call(`/orders/${id}/returns/${made.data.id}/approve`,f.mgr,'POST',{stockBasis:{kind:'pre_opening',note:'Đã giao trước khi chốt tồn ngày 18/10; hàng hoàn thực tế đã kiểm tra'}}));
 f.ok(await f.call(`/orders/${id}/returns/${made.data.id}/receive`,f.emp,'POST',{confirmed:true}));
 const d=f.ok(await f.call('/orders/'+id,f.emp));assert.equal(d.order.status,'delivered');assert.equal(d.progress.reconciliationRequired,true);assert.equal(d.progress.stages.find((s:any)=>s.key==='export').done,false);assert.equal(d.progress.stages.find((s:any)=>s.key==='delivered').done,false);
 assert.equal(d.returnSummary.requests[0].basisKind,'pre_opening');assert.ok(d.lines.every((l:any)=>l.deliveredQty===2&&l.returnedQty===1&&l.customerKeptQty===1));
 await assert.rejects(assertCrmOrderCompletion(f.db,id),/Chưa xác nhận xuất đủ/);
 assert.equal((await f.db.select().from(posReturns)).length,1);
});
