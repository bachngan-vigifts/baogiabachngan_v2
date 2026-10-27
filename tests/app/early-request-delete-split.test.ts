import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setupEarly} from '../helpers/purchase-early-fixture.ts';
import {incomingShipments,supplierOrderEvents} from '../../src/modules/suppliers/schema.ts';
const body={clientKey:'group-file-test',groupBySupplierOrder:true,pickupDate:'2026-10-26',lines:[{sku:'031106000',quantity:16000},{sku:'01654020803',quantity:2}]};
test('file import persists one request per supplier/reference atomically; replay and old links retain children',async()=>{
 const f=await setupEarly(),c=f.cookies;
 for(const id of ['a1','a2','b1','excel'])await f.db.update(incomingShipments).set({supplierInternalOrderNumber:'000123'}).where(eq(incomingShipments.id,id));
 const first=await f.call('/purchase-early-requests',c.sa,'POST',body);assert.equal(first.status,201,JSON.stringify(first.data));
 assert.equal(first.data.requests.length,2);const saved=first.data.requests;
 assert.equal(saved[0].id===saved[1].id,false);
 for(const r of saved)assert.equal(new Set(r.lines.flatMap((l:any)=>l.allocations.map((a:any)=>a.supplierId))).size,1);
 const a=saved.find((r:any)=>r.lines[0].allocations[0].supplierId==='a'),b=saved.find((r:any)=>r.lines[0].allocations[0].supplierId==='b');
 assert.equal(a.lines[0].quantity,15000);assert.equal(b.lines.length,2);
 const repeat=await f.call('/purchase-early-requests',c.sa,'POST',body);assert.equal(repeat.status,200);assert.deepEqual(repeat.data.requestIds,first.data.requestIds);
 const list=await f.call('/purchase-early-requests',c.mgr);assert.equal(list.data.requests.length,2);
 assert.equal((await f.call('/purchase-early-requests?id='+first.data.id,c.mgr)).data.requests.length,2);
 for(const r of saved)assert.equal((await f.call('/purchase-early-requests/'+r.id+'/submit',c.sa,'POST',{revision:r.revision})).status,200);
 const portal=(await f.call('/supplier-portal/early-requests',c.ncc)).data.requests;assert.equal(portal.length,1);assert.equal(portal[0].id,a.id);
 assert.equal((await f.call('/purchase-early-requests/'+a.id,c.sa,'DELETE',{})).status,403);
 assert.equal((await f.call('/purchase-early-requests/'+a.id,c.mgr,'DELETE',{})).status,200);
 assert.equal((await f.call('/purchase-early-requests/'+a.id,c.mgr,'DELETE',{})).data.replayed,true);
 assert.equal((await f.call('/supplier-portal/early-requests',c.ncc)).data.requests.length,0);
 assert.equal((await f.call('/purchase-early-requests/'+a.id+'/submit',c.sa,'POST',{})).status,409);
 assert.equal((await f.call('/purchase-early-requests/'+a.id+'/receiving?orderId=a1',c.mgr)).status,404);
 const row=(await f.client.query<any>('select deleted_by,deleted_at from purchase_early_requests where id=$1',[a.id])).rows[0];assert.equal(row.deleted_by,'mgr');assert.ok(row.deleted_at);
 const audit=(await f.client.query<any>("select actor_id from audit_logs where entity_id=$1 and action='early-request-delete'",[a.id])).rows;assert.equal(audit.length,1);assert.equal(audit[0].actor_id,'mgr');
 assert.equal((await f.client.query<any>('select count(*)::int n from stock_moves')).rows[0].n,0);
});
test('split old submitted requests preserves responses; linked receipt blocks delete/split and deleted key cannot recreate',async()=>{
 const f=await setupEarly(),c=f.cookies;
 const make=await f.call('/purchase-early-requests',c.mgr,'POST',{...body,groupBySupplierOrder:false});const id=make.data.id;
 await f.call('/purchase-early-requests/'+id+'/submit',c.mgr,'POST',{revision:make.data.request.revision});
 const before=(await f.call('/purchase-early-requests?id='+id,c.mgr)).data.requests[0],line=before.lines.find((l:any)=>l.sku==='031106000');
 assert.equal((await f.call('/purchase-early-request-lines/'+line.id+'/manager-confirm',c.mgr,'POST',{supplierId:'a'})).status,200);
 assert.equal((await f.call('/purchase-early-requests/'+id+'/split',c.sa,'POST',{})).status,403);
 const split=await f.call('/purchase-early-requests/'+id+'/split',c.mgr,'POST',{});assert.equal(split.status,200);assert.equal(split.data.requests.length,4);
 const replay=await f.call('/purchase-early-requests/'+id+'/split',c.mgr,'POST',{});assert.deepEqual(replay.data.requests.map((r:any)=>r.id),split.data.requests.map((r:any)=>r.id));
 const accepted=split.data.requests.find((r:any)=>r.lines[0].allocations[0].supplierId==='a');assert.equal(accepted.lines[0].status,'accepted');
 const orderId=accepted.lines[0].allocations[0].orderId;
 // Same receive provenance as the receipt transaction, including damaged-only/cancelled receipt history.
 await f.db.insert(supplierOrderEvents).values({id:'linked-receive',shipmentId:orderId,actorId:'mgr',at:new Date().toISOString(),action:'receive',summary:'receive fixture',data:JSON.stringify({earlyRequestId:accepted.id,receiptId:'historical-receipt'})});
 assert.equal((await f.call('/purchase-early-requests/'+accepted.id,c.mgr,'DELETE',{})).status,409);
 assert.equal((await f.call('/purchase-early-requests/'+accepted.id+'/split',c.mgr,'POST',{})).status,409);
 const plain=await f.call('/purchase-early-requests',c.mgr,'POST',{clientKey:'delete-replay-test',lines:[{sku:'031106000',quantity:1}]});assert.equal(plain.status,201);
 await f.call('/purchase-early-requests/'+plain.data.id,c.mgr,'DELETE',{});
 assert.equal((await f.call('/purchase-early-requests',c.mgr,'POST',{clientKey:'delete-replay-test',lines:[{sku:'031106000',quantity:1}]})).status,409);
});

test('Manager cancels one accepted supplier slip atomically, preserving siblings and replaying safely',async()=>{
 const f=await setupEarly(),c=f.cookies;
 const made=await f.call('/purchase-early-requests',c.mgr,'POST',{...body,clientKey:'cancel-one-slip',groupBySupplierOrder:false});assert.equal(made.status,201);
 const id=made.data.id;assert.equal((await f.call('/purchase-early-requests/'+id+'/submit',c.mgr,'POST',{revision:made.data.request.revision})).status,200);
 const before=(await f.call('/purchase-early-requests?id='+id,c.mgr)).data.requests[0];
 const target=before.lines.flatMap((l:any)=>l.allocations).filter((a:any)=>a.orderId==='a1');
 for(const l of before.lines)if(l.allocations.some((a:any)=>a.supplierId==='a'))assert.equal((await f.call('/purchase-early-request-lines/'+l.id+'/manager-confirm',c.mgr,'POST',{supplierId:'a'})).status,200);
 const path='/purchase-early-requests/'+id+'/cancel-slip',payload={allocationIds:target.map((a:any)=>a.id)};
 for(const role of ['sa','kho','ncc'])assert.equal((await f.call(path,c[role],'POST',payload)).status,403);
 assert.equal((await f.call(path,c.mgr,'POST',{allocationIds:[...payload.allocationIds,'unknown']})).status,409);
 const result=await f.call(path,c.mgr,'POST',payload);assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.remainingRequestIds.length,3);
 const remaining=(await f.call('/purchase-early-requests?id='+id,c.mgr)).data.requests;
 const parts=remaining.flatMap((r:any)=>r.lines.flatMap((l:any)=>l.allocations));assert.equal(parts.some((a:any)=>a.orderId==='a1'),false);assert.equal(parts.find((a:any)=>a.orderId==='a2').quantity,7000);assert.equal(parts.find((a:any)=>a.orderId==='a2').status,'accepted');
 assert.equal((await f.call(path,c.mgr,'POST',payload)).data.replayed,true);
 assert.equal((await f.client.query<any>('select count(*)::int n from stock_moves')).rows[0].n,0);
});

test('receipt provenance blocks per-slip cancellation without partially splitting the parent',async()=>{
 const f=await setupEarly(),c=f.cookies;
 const made=await f.call('/purchase-early-requests',c.mgr,'POST',{...body,clientKey:'cancel-received-slip',groupBySupplierOrder:false});const id=made.data.id;
 await f.call('/purchase-early-requests/'+id+'/submit',c.mgr,'POST',{revision:made.data.request.revision});
 const request=(await f.call('/purchase-early-requests?id='+id,c.mgr)).data.requests[0],a=request.lines[0].allocations[0];
 await f.db.insert(supplierOrderEvents).values({id:'cancel-receipt',shipmentId:a.orderId,at:new Date().toISOString(),action:'receive',data:JSON.stringify({earlyRequestId:id})});
 assert.equal((await f.call('/purchase-early-requests/'+id+'/cancel-slip',c.mgr,'POST',{allocationIds:[a.id]})).status,409);
 assert.equal((await f.call('/purchase-early-requests?id='+id,c.mgr)).data.requests[0].id,id);
 assert.equal((await f.client.query<any>("select count(*)::int n from audit_logs where action='early-request-split' and entity_id=$1",[id])).rows[0].n,0);
});

test('per-slip cancellation requires every allocation sharing the supplier reference',async()=>{
 const f=await setupEarly(),c=f.cookies;
 for(const id of ['a1','a2'])await f.db.update(incomingShipments).set({supplierInternalOrderNumber:'NCC-SAME'}).where(eq(incomingShipments.id,id));
 const made=await f.call('/purchase-early-requests',c.mgr,'POST',{clientKey:'cancel-whole-supplier-slip',pickupDate:'2026-10-27',lines:[{sku:'031106000',quantity:16000}]});const id=made.data.id;
 await f.call('/purchase-early-requests/'+id+'/submit',c.mgr,'POST',{revision:made.data.request.revision});
 const parts=(await f.call('/purchase-early-requests?id='+id,c.mgr)).data.requests[0].lines[0].allocations,own=parts.filter((a:any)=>a.supplierId==='a');
 assert.equal(own.length,2);
 const path='/purchase-early-requests/'+id+'/cancel-slip';assert.equal((await f.call(path,c.mgr,'POST',{allocationIds:[own[0].id]})).status,400);
 assert.equal((await f.call(path,c.mgr,'POST',{allocationIds:[own[0].id,parts.find((a:any)=>a.supplierId==='b').id]})).status,409);
 assert.equal((await f.call('/purchase-early-requests?id='+id,c.mgr)).data.requests[0].id,id);
 assert.equal((await f.call(path,c.mgr,'POST',{allocationIds:own.map((a:any)=>a.id)})).status,200);
 const remaining=(await f.call('/purchase-early-requests?id='+id,c.mgr)).data.requests;assert.equal(remaining.length,1);assert.equal(remaining[0].lines[0].quantity,1000);assert.equal(remaining[0].lines[0].allocations[0].supplierId,'b');
});
