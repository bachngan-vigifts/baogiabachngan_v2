import {test} from 'node:test';
import assert from 'node:assert/strict';
import {and,eq} from 'drizzle-orm';
import {packingSlips,packingSlipLines,salesOrders,salesOrderLines,deliveries,deliveryLines,orderStockHolds} from '../../src/modules/sales/schema.ts';
import {stockMoves} from '../../src/modules/inventory/schema.ts';
import {auditLogs} from '../../src/core/db/schema.ts';
import {postMoves,reverseRef} from '../../src/modules/inventory/api/ledger.ts';
import {posReturns} from '../../src/modules/sales/return-schema.ts';
import {legacyOrderHoldsQuery} from '../../src/modules/sales/api/legacy-order-holds.ts';
import {crmStockFulfilment} from '../../src/modules/sales/api/crm-stock-lifecycle.ts';

import {adjustmentFixture} from '../helpers/packing-adjustment-fixture.ts';
test('Manager increases/decreases repeatedly: append ledger delta, preserve photos/packing identity, proof and exact cancellation reversal',async()=>{
 const f=await adjustmentFixture(),before=await f.read();
 for(const [qty,revision,balance]of [[12,3,38],[7,4,43],[9,5,41]]){
  const result=await f.adjust(f.payload(qty!,revision!));assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(await f.balance(),balance);
  const read=await f.read();assert.equal(read.slip.totalQty,qty);assert.equal(read.slip.totalWeight,Math.round(qty!*.5*10)/10);assert.equal(read.slip.status,'packed');assert.equal(read.slip.packedAt,before.slip.packedAt);assert.equal(read.slip.packedBy,before.slip.packedBy);assert.deepEqual(read.photos,before.photos);
  assert.equal((await crmStockFulfilment(f.db,['adjust-order'])).get('adjust-order')!.lines[0]!.issued,qty);
 }
 const audit=(await f.call('/audit?entityType=packing_slips&entityId=adjust-slip',f.mgr)).data.entries.filter((a:any)=>a.action==='adjust_packed_quantities');assert.equal(audit.length,3);assert.ok(audit.every((a:any)=>a.actorId==='mgr'&&a.data.reason&&a.data.before&&a.data.after));
 const [original]=await f.db.select().from(stockMoves).where(and(eq(stockMoves.refType,'packing_slip'),eq(stockMoves.refId,'adjust-slip')));assert.equal(original!.qty,-10,'original issue is immutable');
 const history=await f.call('/stock-moves?sku=PACK-ADJUST',f.mgr);assert.equal(history.status,200);assert.equal(history.data.moves.filter((m:any)=>m.kind==='adjust').length,3);assert.ok(history.data.moves.filter((m:any)=>m.kind==='adjust').every((m:any)=>m.link==='#/packing/adjust-slip'));
 await f.db.update(salesOrders).set({holdMode:'legacy',holdsStock:true}).where(eq(salesOrders.id,'adjust-order'));
 const holds=await legacyOrderHoldsQuery(f.db,['PACK-ADJUST'],'adjust-wh');assert.equal(holds.find(h=>h.orderId==='adjust-order')!.qty,11,'legacy reservations include all correction deltas');
 const cancelled=await f.call('/orders/adjust-order/status',f.mgr,'PUT',{status:'cancelled'});assert.equal(cancelled.status,200,JSON.stringify(cancelled.data));assert.equal(await f.balance(),50);await reverseRef(f.db,'mgr','packing_slip','adjust-slip','Retry cancellation');assert.equal(await f.balance(),50);
});
test('only Manager can adjust; endpoint rejects employees, other stores, suppliers and anonymous requests',async()=>{
 const f=await adjustmentFixture();assert.equal((await f.read()).canAdjustQuantities,true);
 for(const cookie of [f.emp,f.other,f.kho,f.ncc,'']){const r=await f.adjust(f.payload(11),cookie);assert.ok([401,403].includes(r.status),JSON.stringify(r));}
 assert.equal((await f.call('/packing/adjust-slip',f.emp)).data.canAdjustQuantities,false);assert.equal(await f.balance(),40);
});
test('same request replay is safe; reused key with different quantities and stale revisions are blocked',async()=>{
 const f=await adjustmentFixture(),p=f.payload(11);assert.equal((await f.adjust(p)).status,200);
 const retry=await f.adjust(p);assert.equal(retry.status,200);assert.equal(retry.data.replayed,true);assert.equal(await f.balance(),39);
 assert.equal((await f.adjust({...p,lines:[{id:'adjust-slip-line',qty:12}]})).status,409);
 assert.equal((await f.adjust(f.payload(12))).status,409);assert.equal(await f.balance(),39);
 assert.equal((await f.db.select().from(auditLogs).where(eq(auditLogs.action,'adjust_packed_quantities'))).length,1);
});
test('invalid inputs, line substitution, over-allocation and stock shortage roll back all changes',async()=>{
 const f=await adjustmentFixture();
 for(const qty of [0,-1,1.0001,21])assert.ok([400,409].includes((await f.adjust(f.payload(qty))).status));
 for(const patch of [{reason:'a'},{revision:undefined},{clientKey:''},{lines:[]},{lines:[{id:'foreign',qty:11}]},{lines:[{id:'adjust-slip-line',qty:11},{id:'adjust-slip-line',qty:1}]}])assert.equal((await f.adjust({...f.payload(11),...patch})).status,400);
 await f.db.update(salesOrderLines).set({qty:100}).where(eq(salesOrderLines.id,'adjust-line'));
 const short=await f.adjust(f.payload(60));assert.equal(short.status,409);assert.equal(short.data.code,'STOCK_SHORT');assert.equal(await f.balance(),40);assert.equal((await f.read()).slip.revision,3);
 await f.db.update(salesOrderLines).set({sku:'00123'}).where(eq(salesOrderLines.id,'adjust-line'));assert.equal((await f.adjust(f.payload(11))).status,409);assert.equal(await f.balance(),40);
});
test('concurrent Manager saves serialize on the order: one winner, no double issue',async()=>{
 const f=await adjustmentFixture();const results=await Promise.all([f.adjust(f.payload(11)),f.adjust(f.payload(12))]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 const read=await f.read();assert.equal(await f.balance(),50-read.slip.totalQty);assert.equal(read.slip.revision,4);
});
test('cannot reduce below dispatched quantities or silently change delivery/order amounts',async()=>{
 const f=await adjustmentFixture(),now=new Date().toISOString();
 await f.db.insert(deliveries).values({id:'adjust-delivery',orderId:'adjust-order',deliveryNo:'GH-ADJUST',plannedDate:'2030-01-01',status:'in_transit',createdBy:'mgr',createdAt:now,updatedAt:now});
 await f.db.insert(deliveryLines).values({deliveryId:'adjust-delivery',orderLineId:'adjust-line',qty:9});
 const r=await f.adjust(f.payload(8));assert.equal(r.status,409);assert.match(r.data.error||r.data.message,/bàn giao|giao khách/);assert.equal(await f.balance(),40);
 assert.equal((await f.adjust(f.payload(11))).status,200);const [line]=await f.db.select().from(salesOrderLines).where(eq(salesOrderLines.id,'adjust-line'));assert.equal(line!.deliveredQty,0);assert.equal(line!.qty,20);
 const [order]=await f.db.select().from(salesOrders).where(eq(salesOrders.id,'adjust-order'));assert.equal(order!.total,2160);assert.equal(order!.revision,1);
});
test('held stock, changed status and legacy/inconsistent issue proof are not bypassed by Manager',async()=>{
 const f=await adjustmentFixture(),now=new Date().toISOString();
 await f.db.insert(salesOrders).values({id:'held-order',orderNo:'DH-HELD',quoteType:'B2B',customerName:'Other fixture',ownerId:'emp',createdBy:'emp',warehouseId:'adjust-wh',orderDate:'2030-01-01',status:'confirmed',subtotal:1,total:1,createdAt:now,updatedAt:now,holdMode:'capped'});
 await f.db.insert(salesOrderLines).values({id:'held-line',orderId:'held-order',lineNo:1,sku:'PACK-ADJUST',name:'Held fixture',qty:35,unitPrice:1,amount:35});
 await f.db.insert(orderStockHolds).values({id:'held-stock',orderId:'held-order',orderLineId:'held-line',sku:'PACK-ADJUST',warehouseId:'adjust-wh',qty:35,source:'manual',expiresAt:'2099-01-01',createdAt:now,createdBy:'mgr'});
 const held=await f.adjust(f.payload(16));assert.equal(held.status,409);assert.equal(held.data.code,'HELD_FOR_OTHER_ORDER');assert.equal(await f.balance(),40);
 await f.db.update(packingSlips).set({status:'cancelled'}).where(eq(packingSlips.id,'adjust-slip'));assert.equal((await f.adjust(f.payload(11))).status,409);
 await f.db.update(packingSlips).set({status:'packed',stockWarehouseId:null}).where(eq(packingSlips.id,'adjust-slip'));assert.equal((await f.adjust(f.payload(11))).status,409);
});

test('legacy approval moves and inconsistent proof require reconciliation first',async()=>{
 const f=await adjustmentFixture();
 await postMoves(f.db,'mgr',[{sku:'PACK-ADJUST',warehouseId:'adjust-wh',qty:1,kind:'adjust',refType:'packing_slip',refId:'adjust-slip#corrupt-fixture'}]);
 let r=await f.adjust(f.payload(11));assert.equal(r.status,409);assert.match(r.data.message||r.data.error,/sổ kho/);assert.equal((await f.read()).slip.totalQty,10);
 await postMoves(f.db,'mgr',[{sku:'PACK-ADJUST',warehouseId:'adjust-wh',qty:-1,kind:'sale',refType:'sales_order',refId:'adjust-order'}]);
 r=await f.adjust(f.payload(11));assert.equal(r.status,409);assert.match(r.data.message||r.data.error,/Đơn cũ/);
});

test('return/credit dossiers block edits without changing existing return or packing history',async()=>{
 const f=await adjustmentFixture(),now=new Date().toISOString();
 await f.db.insert(posReturns).values({id:'adjust-return',returnNo:'RET-ADJUST',source:'crm',orderId:'adjust-order',warehouseId:'adjust-wh',kind:'return',status:'pending',reason:'Đối soát hàng trả',sourceSnapshot:'{}',requestKey:'adjust-return-key',createdBy:'mgr',createdAt:now,updatedAt:now});
 const r=await f.adjust(f.payload(11));assert.equal(r.status,409);assert.match(r.data.error||r.data.message,/trả\/đổi/);assert.equal(await f.balance(),40);assert.equal((await f.read()).slip.revision,3);
});
