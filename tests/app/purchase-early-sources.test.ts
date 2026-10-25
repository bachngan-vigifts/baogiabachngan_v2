import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setupEarly} from '../helpers/purchase-early-fixture.ts';
import {incomingShipmentLines,incomingShipments} from '../../src/modules/suppliers/schema.ts';

test('explicit order sources survive save/edit/submit, never reallocate to an earlier order',async()=>{
 const f=await setupEarly(),c=f.cookies;
 await f.db.update(incomingShipments).set({supplierInternalOrderNumber:'NCC-002'}).where(eq(incomingShipments.id,'a2'));
 const sources=[{orderNo:'PO-a2',supplierOrderNo:'NCC-002',quantity:5},{orderNo:'PO-b1',quantity:7}];
 const body={clientKey:'pin-file-orders-001',pickupDate:'2026-10-25',lines:[{sku:'031106000',quantity:12,sourceOrders:sources}]};
 const made=await f.call('/purchase-early-requests',c.mgr,'POST',body);assert.equal(made.status,201,JSON.stringify(made.data));
 const id=made.data.id;let draft=made.data.request;
 const allocations=(request:any)=>request.lines[0].allocations.map((a:any)=>[a.ticketNumber,a.quantity]).sort();
 assert.deepEqual(allocations(draft),[['PO-a2',5],['PO-b1',7]]);
 assert.equal(draft.lines[0].allocations.find((a:any)=>a.ticketNumber==='PO-a2').supplierOrderNo,'NCC-002');
 assert.equal((await f.call('/purchase-early-requests',c.mgr,'POST',body)).data.id,id);
 assert.equal((await f.call('/purchase-early-requests',c.mgr,'POST',{...body,lines:[{...body.lines[0],sourceOrders:[{orderNo:'PO-a1',quantity:12}]}]})).status,409,'same key, different source is a conflict');
 const update=await f.call('/purchase-early-requests/'+id,c.mgr,'PUT',{revision:draft.revision,pickupDate:body.pickupDate,lines:[{sku:'031106000',quantity:12}]});
 assert.equal(update.status,200,JSON.stringify(update.data));draft=update.data.request;assert.deepEqual(allocations(draft),[['PO-a2',5],['PO-b1',7]],'missing metadata on edit cannot discard pinned sources');
 const edited=await f.call('/purchase-early-requests/'+id,c.mgr,'PUT',{revision:draft.revision,pickupDate:body.pickupDate,lines:[{sku:'031106000',quantity:10,sourceOrders:[{...sources[0],quantity:3},sources[1]]}]});
 assert.equal(edited.status,200,JSON.stringify(edited.data));draft=edited.data.request;
 const sent=await f.call('/purchase-early-requests/'+id+'/submit',c.mgr,'POST',{revision:draft.revision});assert.equal(sent.status,200,JSON.stringify(sent.data));
 assert.deepEqual(allocations(sent.data.request),[['PO-a2',3],['PO-b1',7]],'submit revalidation remains pinned');
 for(const sourceOrders of [[{orderNo:'PO-a2',supplierOrderNo:'WRONG',quantity:1}],[{orderNo:'MISSING',quantity:1}]]){
  const bad=await f.call('/purchase-early-requests',c.mgr,'POST',{clientKey:crypto.randomUUID(),lines:[{sku:'031106000',quantity:1,sourceOrders}]});assert.equal(bad.status,409);assert.equal(bad.data.code,'EARLY_QUANTITY_EXCEEDED');
 }
 const otherSupplier=await f.call('/purchase-early-requests',c.mgr,'POST',{clientKey:crypto.randomUUID(),scope:{supplierId:'a'},lines:[{sku:'031106000',quantity:1,sourceOrders:[{orderNo:'PO-b1',quantity:1}]}]});assert.equal(otherSupplier.status,409);
});

test('source exhausted after preview/save blocks submission rather than taking from another order',async()=>{
 const f=await setupEarly(),c=f.cookies;
 const made=await f.call('/purchase-early-requests',c.sa,'POST',{clientKey:'pinned-exhaustion',pickupDate:'2026-10-25',lines:[{sku:'031106000',quantity:5,sourceOrders:[{orderNo:'PO-a2',quantity:5}]}]});
 assert.equal(made.status,201,JSON.stringify(made.data));
 await f.db.update(incomingShipmentLines).set({quantity:0}).where(eq(incomingShipmentLines.id,'line-a2'));
 const sent=await f.call('/purchase-early-requests/'+made.data.id+'/submit',c.sa,'POST',{revision:made.data.request.revision});assert.equal(sent.status,409);assert.equal(sent.data.code,'EARLY_QUANTITY_EXCEEDED');
 const current=(await f.call('/purchase-early-requests?id='+made.data.id,c.mgr)).data.requests[0];assert.equal(current.requestStatus,'draft');assert.equal(current.lines[0].allocations[0].ticketNumber,'PO-a2');
 for(const sourceOrders of [[{orderNo:'PO-a1',quantity:4}],[{orderNo:'PO-a1',quantity:2},{orderNo:'po-A1',quantity:3}]])assert.equal((await f.call('/purchase-early-requests',c.mgr,'POST',{clientKey:crypto.randomUUID(),lines:[{sku:'031106000',quantity:5,sourceOrders}]})).status,400);
});

test('supplier-only resolves and pins CRM order, retries remain idempotent and later ambiguity cannot redirect it',async()=>{
 const f=await setupEarly(),c=f.cookies;
 await f.db.update(incomingShipments).set({supplierInternalOrderNumber:'000123'}).where(eq(incomingShipments.id,'a2'));
 const body={clientKey:'supplier-reference-only',pickupDate:'2026-10-25',lines:[{sku:'031106000',quantity:4,sourceOrders:[{supplierOrderNo:'000123',quantity:4}]}]};
 const made=await f.call('/purchase-early-requests',c.mgr,'POST',body);assert.equal(made.status,201,JSON.stringify(made.data));
 assert.deepEqual(JSON.parse(made.data.request.scope.orderSources),{'031106000':[{orderNo:'PO-a2',supplierOrderNo:'000123',quantity:4}]});
 assert.equal((await f.call('/purchase-early-requests',c.mgr,'POST',body)).data.id,made.data.id);
 await f.db.update(incomingShipments).set({supplierInternalOrderNumber:'000123'}).where(eq(incomingShipments.id,'a1'));
 const sent=await f.call('/purchase-early-requests/'+made.data.id+'/submit',c.mgr,'POST',{revision:made.data.request.revision});
 assert.equal(sent.status,200,JSON.stringify(sent.data));assert.equal(sent.data.request.lines[0].allocations[0].ticketNumber,'PO-a2');
 const ambiguous=await f.call('/purchase-early-requests',c.mgr,'POST',{...body,clientKey:'ambiguous-reference'});
 assert.equal(ambiguous.status,409);assert.equal(ambiguous.data.code,'EARLY_SOURCE_AMBIGUOUS');
 assert.equal((await f.call('/purchase-early-requests',c.mgr)).data.requests.length,1,'failed resolution rolls the draft back');
});

test('supplier scope disambiguates references; blank references and mixed sources pin actual orders without double allocation',async()=>{
 const f=await setupEarly(),c=f.cookies;
 for(const id of ['a2','b1'])await f.db.update(incomingShipments).set({supplierInternalOrderNumber:'NCC-SHARED'}).where(eq(incomingShipments.id,id));
 const create=(sourceOrders:unknown[],quantity:number,scope={})=>f.call('/purchase-early-requests',c.mgr,'POST',{clientKey:crypto.randomUUID(),scope,lines:[{sku:'031106000',quantity,sourceOrders}]});
 const scoped=await create([{supplierOrderNo:'NCC-SHARED',quantity:2}],2,{supplierId:'b'});
 assert.equal(scoped.status,201,JSON.stringify(scoped.data));assert.equal(scoped.data.request.lines[0].allocations[0].ticketNumber,'PO-b1');
 const mixed=await create([{orderNo:'',quantity:5},{orderNo:'PO-a1',quantity:8000}],8005,{supplierId:'a'});
 assert.equal(mixed.status,201,JSON.stringify(mixed.data));
 assert.deepEqual(JSON.parse(mixed.data.request.scope.orderSources),{'031106000':[{orderNo:'PO-a1',supplierOrderNo:'',quantity:8000},{orderNo:'PO-a2',supplierOrderNo:'',quantity:5}]});
 const overbooked=await create([{orderNo:'PO-a1',quantity:7999},{supplierOrderNo:'NCC-SHARED',orderNo:'PO-a2',quantity:7000},{quantity:2}],15001,{supplierId:'a'});
 assert.equal(overbooked.status,409);assert.equal(overbooked.data.code,'EARLY_QUANTITY_EXCEEDED');
 const overlap=await create([{orderNo:'PO-a2',quantity:2},{supplierOrderNo:'NCC-SHARED',quantity:3}],5,{supplierId:'a'});
 assert.equal(overlap.status,201,JSON.stringify(overlap.data));assert.equal(overlap.data.request.lines[0].allocations.length,1);assert.equal(overlap.data.request.lines[0].allocations[0].quantity,5);
});
