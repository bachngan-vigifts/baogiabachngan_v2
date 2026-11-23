import {warehouseSellers} from '../../src/modules/inventory/schema.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setupEarly} from '../helpers/purchase-early-fixture.ts';
import {incomingShipments} from '../../src/modules/suppliers/schema.ts';
import {products,warehouses} from '../../src/modules/catalog/schema.ts';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';
const ok=(r:any,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};
async function fixture(){
 const f=await setupEarly(),c=f.cookies;
 for(const id of ['a1','a2'])await f.db.update(incomingShipments).set({supplierInternalOrderNumber:'NCC-A'}).where(eq(incomingShipments.id,id));
 for(const id of ['b1','excel'])await f.db.update(incomingShipments).set({supplierInternalOrderNumber:'NCC-B'}).where(eq(incomingShipments.id,id));
 await f.db.insert(products).values({sku:'031106000',name:'Ly',unit:'Cái',updatedAt:new Date().toISOString()});await f.db.insert(warehouses).values({id:'receive',name:'KHO NHẬN',kind:'stock'});
 await f.db.insert(warehouseSellers).values({warehouseId:'receive',positionId:'warehouse'});await f.db.update(incomingShipments).set({warehouse:'KHO NHẬN'});
 await postMoves(f.db,'mgr',[{sku:'031106000',warehouseId:'receive',qty:1,kind:'opening',refType:'opening',refId:'opening'}]);
 const made=ok(await f.call('/purchase-early-requests',c.mgr,'POST',{clientKey:crypto.randomUUID(),pickupDate:'2026-10-27',lines:[{sku:'031106000',quantity:16000},{sku:'01654020803',quantity:2}]}),201),id=made.id;
 const submitted=ok(await f.call('/purchase-early-requests/'+id+'/submit',c.mgr,'POST',{revision:made.request.revision}));
 for(const line of submitted.request.lines)for(const supplierId of [...new Set(line.allocations.map((a:any)=>a.supplierId))])ok(await f.call('/purchase-early-request-lines/'+line.id+'/manager-confirm',c.mgr,'POST',{supplierId}));
 const receipt=ok(await f.call('/purchase-orders/a1/receipts',c.kho,'POST',{clientKey:crypto.randomUUID(),earlyRequestId:id,createSapo:false,receivedDate:'2026-10-27',warehouse:'KHO NHẬN',lines:[{lineId:'line-a1',goodQty:4000,damagedQty:0}]}),201);
 const read=async()=>ok(await f.call('/purchase-early-requests?id='+id,c.mgr)).requests;
 const snapshot=async()=>({stock:(await f.client.query('select * from stock_moves order by id')).rows,receipts:(await f.client.query('select * from supplier_receipts order by id')).rows,events:(await f.client.query("select * from supplier_order_events where action='receive' order by id")).rows});
 return {...f,id,receipt,read,snapshot};
}

test('split mixed received/unreceived groups keeps original receipt ownership and stock, and only extracts untouched supplier slips',async()=>{
 const f=await fixture(),c=f.cookies,before=await f.snapshot(),original=(await f.read())[0],receivedLine=original.lines.find((l:any)=>l.sku==='031106000'),unreceived=original.lines.flatMap((l:any)=>l.allocations).filter((a:any)=>a.supplierId==='b');
 assert.equal((await f.call('/purchase-early-requests/'+f.id+'/split',c.sa,'POST',{})).status,403);
 const split=ok(await f.call('/purchase-early-requests/'+f.id+'/split',c.mgr,'POST',{}));assert.equal(split.requests.length,2);
 const kept=split.requests.find((r:any)=>r.id===f.id),child=split.requests.find((r:any)=>r.id!==f.id);assert.ok(kept);assert.equal(kept.lines.length,1);assert.equal(kept.lines[0].id,receivedLine.id);assert.equal(kept.lines[0].quantity,15000);
 assert.deepEqual(child.lines.flatMap((l:any)=>l.allocations.map((a:any)=>a.id)).sort(),unreceived.map((a:any)=>a.id).sort());
 const listed=await f.read(),allocation=listed.find((r:any)=>r.id===f.id).lines[0].allocations.find((a:any)=>a.orderId==='a1');assert.equal(allocation.receivedQty,4000);assert.equal(allocation.remainingToReceive,4000);
 const remaining=ok(await f.call('/purchase-early-requests/'+f.id+'/receiving?orderId=a1',c.kho));assert.equal(remaining.lines[0].remaining,4000);
 const childReceipt=ok(await f.call('/purchase-early-requests/'+child.id+'/receiving?orderId=b1',c.kho));assert.equal(childReceipt.lines[0].remaining,1000);
 const retry=ok(await f.call('/purchase-early-requests/'+f.id+'/split',c.mgr,'POST',{}));assert.deepEqual(retry.requests.map((r:any)=>r.id).sort(),split.requests.map((r:any)=>r.id).sort());
 assert.equal((await f.call('/purchase-early-requests/'+f.id,c.mgr,'DELETE',{})).status,409);assert.deepEqual(await f.snapshot(),before);
});

test('cancel untouched slip directly when its sibling is received; received slip and receipt replay remain protected',async()=>{
 const f=await fixture(),c=f.cookies,before=await f.snapshot(),original=(await f.read())[0],parts=original.lines.flatMap((l:any)=>l.allocations),target=parts.filter((a:any)=>a.supplierId==='b').map((a:any)=>a.id),received=parts.filter((a:any)=>a.supplierId==='a').map((a:any)=>a.id);
 const path='/purchase-early-requests/'+f.id+'/cancel-slip';assert.equal((await f.call(path,c.mgr,'POST',{allocationIds:received})).status,409);
 const result=ok(await f.call(path,c.mgr,'POST',{allocationIds:target}));assert.deepEqual(result.remainingRequestIds,[f.id]);
 const remaining=await f.read();assert.equal(remaining.length,1);assert.equal(remaining[0].id,f.id);assert.equal(remaining[0].lines[0].quantity,15000);assert.equal(remaining[0].lines[0].allocations.find((a:any)=>a.orderId==='a1').receivedQty,4000);
 assert.equal(ok(await f.call(path,c.mgr,'POST',{allocationIds:target})).replayed,true);assert.deepEqual(await f.snapshot(),before);
 assert.equal((await f.call('/purchase-early-requests/'+result.cancelledRequestId+'/receiving?orderId=b1',c.kho)).status,404);
 assert.equal((await f.call('/purchase-early-requests/'+f.id+'/cancel-slip',c.mgr,'POST',{allocationIds:received})).status,409);
});

test('same SKU on different requests never shares own received quantity; shared purchase balance is explicit',async()=>{
 const f=await fixture(),c=f.cookies;
 const create=async(supplierId:string)=>{
  const made=ok(await f.call('/purchase-early-requests',c.mgr,'POST',{clientKey:crypto.randomUUID(),pickupDate:'2026-10-27',scope:{supplierId},lines:[{sku:'031106000',quantity:5}]}),201);
  const submitted=ok(await f.call('/purchase-early-requests/'+made.id+'/submit',c.mgr,'POST',{revision:made.request.revision}));
  ok(await f.call('/purchase-early-request-lines/'+submitted.request.lines[0].id+'/manager-confirm',c.mgr,'POST',{supplierId}));return made.id;
 };
 const a=await create('a'),b=await create('b');
 const part=async(id:string)=>ok(await f.call('/purchase-early-requests?id='+id,c.mgr)).requests[0].lines[0].allocations[0];
 const pa=await part(a),pb=await part(b);assert.equal(pa.receivedQty,0);assert.equal(pb.receivedQty,0);assert.equal(pa.remainingToReceive,5);assert.equal(pb.remainingToReceive,5);
 ok(await f.call('/purchase-orders/a1/receipts',c.kho,'POST',{clientKey:crypto.randomUUID(),earlyRequestId:a,createSapo:false,receivedDate:'2026-10-27',warehouse:'KHO NHẬN',lines:[{lineId:'line-a1',goodQty:5,damagedQty:0}]}),201);
 assert.equal((await part(a)).receivedQty,5);assert.equal((await part(b)).receivedQty,0);assert.equal((await part(b)).remainingToReceive,5);
 const secondA=await create('a');assert.equal((await part(secondA)).receivedQty,0);assert.equal((await part(secondA)).remainingToReceive,5);
 ok(await f.call('/purchase-orders/a1/receipts',c.kho,'POST',{clientKey:crypto.randomUUID(),createSapo:false,warehouse:'KHO NHẬN',lines:[{lineId:'line-a1',goodQty:3995,damagedQty:0}]}),201);
 const blocked=await part(secondA);assert.equal(blocked.receivedQty,0);assert.equal(blocked.purchaseRemaining,0);assert.equal(blocked.remainingToReceive,0);assert.equal(blocked.receivedElsewhere,8000);
 assert.equal((await part(b)).remainingToReceive,5);
});

test('after an incorrect receipt is explicitly cancelled, cancelling the supplier slip does not reverse stock a second time',async()=>{
 const f=await fixture(),c=f.cookies;
 ok(await f.call('/supplier-receipts/'+f.receipt.receiptId+'/cancel',c.mgr,'POST',{reason:'Phiếu nhận ghi nhầm, hàng chưa về thực tế'}));
 const afterReversal=await f.snapshot(),original=(await f.read())[0],ids=original.lines.flatMap((l:any)=>l.allocations).filter((a:any)=>a.supplierId==='a').map((a:any)=>a.id);
 const result=ok(await f.call('/purchase-early-requests/'+f.id+'/cancel-slip',c.mgr,'POST',{allocationIds:ids}));assert.equal(result.remainingRequestIds.length,1);
 assert.deepEqual(await f.snapshot(),afterReversal);
 const live=ok(await f.call('/purchase-early-requests?id='+f.id,c.mgr)).requests;assert.equal(live.length,1);assert.ok(live[0].lines.every((l:any)=>l.allocations.every((a:any)=>a.supplierId==='b')));
});
