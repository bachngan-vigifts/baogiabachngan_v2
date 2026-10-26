import {test} from 'node:test';
import assert from 'node:assert/strict';
import {and,eq} from 'drizzle-orm';
import {setupWarehouseOps,makeCrm} from '../helpers/warehouse-approval-fixture.ts';
import {deliveries,salesOrderLines} from '../../src/modules/sales/schema.ts';
import {auditLogs} from '../../src/core/db/schema.ts';

test('owner and Sale Admin confirm real delivery with durable actor/time; broad readers cannot; export dependency remains enforced',async()=>{
 const f=await setupWarehouseOps(),d=await makeCrm(f,'DELIVERY_ACTOR',2,'00123','pos-wh',true),orderId=d.order.id,lineId=d.lines[0].id;
 const made=await f.call('/deliveries',f.emp,'POST',{orderId,plannedDate:'2026-10-26',lines:[{orderLineId:lineId,qty:2}]});assert.equal(made.status,201,JSON.stringify(made.data));const id=made.data.id;
 assert.equal((await f.call('/deliveries/'+id+'/status',f.other,'PUT',{status:'in_transit'})).status,403,'read scope alone does not grant confirmation');
 const blocked=await f.call('/deliveries/'+id+'/status',f.emp,'PUT',{status:'delivered'});assert.equal(blocked.status,409);assert.equal(blocked.data.code,'STOCK_NOT_PACKED');
 assert.equal((await f.db.select().from(deliveries).where(eq(deliveries.id,id)))[0]!.confirmedBy,null);
 for(const stage of ['approve','export','delivered','all'])assert.equal((await f.call('/orders/'+orderId+'/progress',f.sa,'POST',{stage})).status,403,stage);
 assert.equal((await f.call('/orders/'+orderId+'/progress',f.sa,'POST',{stage:'sample'})).status,409,'printing shortcut cannot bypass actual stock issue');
 const pack=await f.call('/orders/'+orderId+'/packing',f.mgr,'POST',{sendToWarehouse:true,allocations:[{orderLineId:lineId,qty:2,source:'warehouse'}]});assert.equal(pack.status,201,JSON.stringify(pack.data));
 const confirmed=await f.call('/packing/'+pack.data.slips[0].id+'/confirm',f.mgr,'POST',{warehouseId:'pos-wh',photos:['data:image/jpeg;base64,YW5o']});assert.equal(confirmed.status,200,JSON.stringify(confirmed.data));
 assert.equal((await f.call('/orders/'+orderId+'/progress',f.sa,'POST',{stage:'sample'})).status,200);
 const production=await f.call('/orders/'+orderId+'/progress',f.sa,'POST',{stage:'production'});assert.equal(production.status,200);assert.equal(production.data.progress.stages.find((s:any)=>s.key==='production').byName,'Sale Admin kiểm thử');
 const sent=await f.call('/deliveries/'+id+'/status',f.emp,'PUT',{status:'in_transit',confirmedBy:'mgr',confirmedAt:'2000-01-01'});assert.equal(sent.status,200,JSON.stringify(sent.data));
 let row=(await f.db.select().from(deliveries).where(eq(deliveries.id,id)))[0]!;assert.equal(row.confirmedBy,'emp');assert.equal(row.confirmedStatus,'in_transit');assert.ok(row.confirmedAt&&!row.confirmedAt.startsWith('2000'));
 const completed=await f.call('/deliveries/'+id+'/status',f.sa,'PUT',{status:'delivered'});assert.equal(completed.status,200,JSON.stringify(completed.data));
 row=(await f.db.select().from(deliveries).where(eq(deliveries.id,id)))[0]!;assert.equal(row.confirmedBy,'ops-admin');assert.equal(row.confirmedStatus,'delivered');
 const listed=await f.call('/deliveries?id='+id,f.emp);assert.equal(listed.status,200);assert.equal(listed.data.deliveries[0].confirmedByName,'Sale Admin kiểm thử');assert.equal(listed.data.deliveries[0].confirmedBy,'ops-admin');
 const detail=await f.call('/orders/'+orderId,f.emp);assert.equal(detail.data.deliveries[0].confirmedByName,'Sale Admin kiểm thử');
 assert.equal((await f.call('/deliveries/'+id+'/status',f.emp,'PUT',{status:'delivered'})).status,409);
 assert.equal((await f.db.select().from(salesOrderLines).where(eq(salesOrderLines.id,lineId)))[0]!.deliveredQty,2);
 const history=await f.db.select().from(auditLogs).where(and(eq(auditLogs.entityId,id),eq(auditLogs.action,'delivery-status-confirm')));assert.equal(history.length,2);assert.deepEqual(new Set(history.map(r=>r.actorId)),new Set(['emp','ops-admin']));
 // Legacy rows only inherit identity from committed dispatch evidence, never from created_by.
 await f.db.update(deliveries).set({confirmedBy:null,confirmedAt:null,confirmedStatus:null}).where(eq(deliveries.id,id));
 assert.equal((await f.call('/deliveries?id='+id,f.emp)).data.deliveries[0].confirmedBy,'ops-admin');
});
