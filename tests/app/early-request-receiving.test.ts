import {test} from 'node:test';
import {memoryFileStore} from '../../src/core/storage/file-store.ts';
import assert from 'node:assert/strict';
import {and,eq} from 'drizzle-orm';
import {setupEarly} from '../helpers/purchase-early-fixture.ts';
import {products,warehouses} from '../../src/modules/catalog/schema.ts';
import {incomingShipments,incomingShipmentLines,supplierReceipts,receiptJobs} from '../../src/modules/suppliers/schema.ts';
import {stockBalances,stockMoves} from '../../src/modules/inventory/schema.ts';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';
const ok=(r:any,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};
async function fixture(quantity=10,withPhotos=false){
 const f=await setupEarly({files:withPhotos?memoryFileStore():undefined}),c=f.cookies;
 await f.db.insert(products).values({sku:'031106000',name:'Ly',unit:'Cái',updatedAt:'2026-10-01T00:00:00Z'});
 await f.db.insert(warehouses).values({id:'receive',name:'KHO NHẬN',kind:'stock'});
 await postMoves(f.db,'mgr',[{sku:'031106000',warehouseId:'receive',qty:1,kind:'opening',refType:'opening',refId:'opening'}]);
 const request=ok(await f.call('/purchase-early-requests',c.mgr,'POST',{clientKey:crypto.randomUUID(),pickupDate:'2026-10-24',scope:{supplierId:'a'},lines:[{sku:'031106000',quantity}]}),201);
 const id=request.id;
 const submitted=ok(await f.call('/purchase-early-requests/'+id+'/submit',c.mgr,'POST',{revision:request.request.revision}));
 const line=submitted.request.lines[0];
 const context=()=>f.call(`/purchase-early-requests/${id}/receiving?orderId=a1`,c.kho);
 const receive=(qty:number,key=crypto.randomUUID(),actor=c.kho)=>f.call('/purchase-orders/a1/receipts',actor,'POST',{
   clientKey:key,earlyRequestId:id,receivedDate:'2026-10-24',warehouse:'KHO NHẬN',lines:[{lineId:'line-a1',goodQty:qty,damagedQty:0}]});
 return {...f,id,line,context,receive,accept:()=>f.call('/purchase-early-request-lines/'+line.id+'/manager-confirm',c.mgr,'POST',{supplierId:'a'}),
   balance:async()=>(await f.db.select().from(stockBalances).where(and(eq(stockBalances.sku,'031106000'),eq(stockBalances.warehouseId,'receive'))))[0]!.qty};
}
test('accepted early request receives partial quantities through existing receipt route; replay does not add stock; full receipt removes receive action',async()=>{
 const f=await fixture();ok(await f.context(),409);ok(await f.accept());
 const initial=ok(await f.context());assert.equal(initial.lines[0].remaining,10);
 const waiting=ok(await f.call('/purchase-receiving-calendar?type=early',f.cookies.kho));
 assert.equal(waiting.canReceiveEarly,true);const waitingRow=waiting.rows.find((r:any)=>r.requestId===f.id);
 assert.equal(waitingRow.lines[0].receiptOptions[0].orderId,'a1');assert.equal(waitingRow.lines[0].receiptOptions[0].remaining,10);
 assert.equal(ok(await f.call('/purchase-receiving-calendar?type=early',f.cookies.emp)).canReceiveEarly,false);
 const key=crypto.randomUUID(),first=ok(await f.receive(4,key),201);assert.equal(await f.balance(),5);
 const repeat=ok(await f.receive(4,key));assert.equal(repeat.receiptId,first.receiptId);assert.equal(await f.balance(),5);
 assert.equal(ok(await f.context()).lines[0].remaining,6);
 ok(await f.call('/purchase-early-requests/'+f.id,f.cookies.mgr,'DELETE',{}),409);
 ok(await f.call('/purchase-early-requests/'+f.id+'/split',f.cookies.mgr,'POST',{}),409);
 ok(await f.receive(7),409);assert.equal(await f.balance(),5);
 ok(await f.receive(6),201);assert.equal(await f.balance(),11);ok(await f.context(),409);
 const listed=ok(await f.call('/purchase-early-requests?id='+f.id,f.cookies.kho));assert.equal(listed.canReceive,true);
 const allocation=listed.requests[0].lines[0].allocations[0];assert.equal(allocation.remainingToReceive,0);assert.equal(allocation.receivedQty,10);
 const calendar=ok(await f.call('/purchase-receiving-calendar?type=early',f.cookies.kho));assert.equal(calendar.rows.some((r:any)=>r.requestId===f.id),false);
 assert.equal((await f.db.select().from(supplierReceipts)).length,2);
 assert.equal((await f.db.select().from(stockMoves).where(eq(stockMoves.refType,'supplier_receipt'))).length,2);
});
test('CRM-only receipt skips outbox, preserves inventory/provenance and caps receipt to requested SKUs/quantities',async()=>{
 const f=await fixture();ok(await f.accept());const key=crypto.randomUUID();
 const body={clientKey:key,earlyRequestId:f.id,receivedDate:'2026-10-24',warehouse:'KHO NHẬN',createSapo:false,lines:[{lineId:'line-a1',goodQty:4,damagedQty:0}]};
 const first=ok(await f.call('/purchase-orders/a1/receipts',f.cookies.kho,'POST',body),201);
 assert.equal(await f.balance(),5);assert.equal((await f.db.select().from(receiptJobs)).length,0);
 const row=(await f.db.select().from(supplierReceipts).where(eq(supplierReceipts.id,first.receiptId)))[0]!;
 assert.equal(row.createSapo,false);assert.equal(row.sapoStatus,'not_needed');
 assert.equal(first.receipts.find((r:any)=>r.id===row.id).createSapo,false);
 ok(await f.call('/purchase-orders/a1/receipts',f.cookies.kho,'POST',body));assert.equal(await f.balance(),5);
 ok(await f.call('/purchase-orders/a1/receipts',f.cookies.kho,'POST',{...body,createSapo:true}),409);
 assert.equal(ok(await f.context()).lines[0].remaining,6);
 await f.db.insert(incomingShipmentLines).values({id:'outside-request',shipmentId:'a1',lineNo:2,sku:'OTHER',name:'Không xin',unit:'Cái',quantity:20});
 ok(await f.call('/purchase-orders/a1/receipts',f.cookies.kho,'POST',{...body,clientKey:crypto.randomUUID(),lines:[{lineId:'outside-request',goodQty:1,damagedQty:0}]}),409);
 ok(await f.call('/purchase-orders/a1/receipts',f.cookies.kho,'POST',{...body,clientKey:crypto.randomUUID(),lines:[{lineId:'line-a1',goodQty:7,damagedQty:0}]}),409);
 ok(await f.call('/purchase-orders/a1/receipts',f.cookies.kho,'POST',{...body,clientKey:crypto.randomUUID(),createSapo:'false'}),400);
 const yes=ok(await f.call('/purchase-orders/a1/receipts',f.cookies.kho,'POST',{...body,clientKey:crypto.randomUUID(),createSapo:true,lines:[{lineId:'line-a1',goodQty:1,damagedQty:0}]}),201);
 assert.equal((await f.db.select().from(receiptJobs).where(eq(receiptJobs.receiptId,yes.receiptId))).length,1);
 assert.equal(await f.balance(),6);
});
test('server enforces receipt permission, accepted allocation, parent order state and membership',async()=>{
 const f=await fixture();ok(await f.accept());
 ok(await f.receive(1,crypto.randomUUID(),f.cookies.emp),403);ok(await f.receive(1,crypto.randomUUID(),f.cookies.ncc),403);
 ok(await f.call(`/purchase-early-requests/${f.id}/receiving?orderId=a1`,f.cookies.emp),403);
 ok(await f.call(`/purchase-early-requests/${f.id}/receiving?orderId=b1`,f.cookies.mgr),409);
 ok(await f.call('/purchase-orders/a2/receipts',f.cookies.kho,'POST',{clientKey:crypto.randomUUID(),earlyRequestId:f.id,warehouse:'KHO NHẬN',lines:[{lineId:'line-a2',goodQty:1}]}),409);
 await f.db.update(incomingShipments).set({approvalStatus:'pending'}).where(eq(incomingShipments.id,'a1'));ok(await f.context(),409);ok(await f.receive(1,crypto.randomUUID(),f.cookies.mgr),409);
 await f.db.update(incomingShipments).set({approvalStatus:'approved',cancelledAt:'2026-10-24T01:00:00Z'}).where(eq(incomingShipments.id,'a1'));ok(await f.context(),409);ok(await f.receive(1,crypto.randomUUID(),f.cookies.mgr),409);
 assert.equal(await f.balance(),1);assert.equal((await f.db.select().from(supplierReceipts)).length,0);
});
test('cancel receipt restores early remaining; an ordinary receipt also caps the early request to purchase balance',async()=>{
 const f=await fixture();ok(await f.accept());const first=ok(await f.receive(3),201);
 ok(await f.call('/supplier-receipts/'+first.receiptId+'/cancel',f.cookies.mgr,'POST',{reason:'Nhập nhầm, nhận lại đúng phiếu'}));
 assert.equal(ok(await f.context()).lines[0].remaining,10);assert.equal(await f.balance(),1);
 ok(await f.call('/purchase-orders/a1/receipts',f.cookies.kho,'POST',{clientKey:crypto.randomUUID(),warehouse:'KHO NHẬN',lines:[{lineId:'line-a1',goodQty:7995}]}),201);
 assert.equal(ok(await f.context()).lines[0].remaining,5);
 ok(await f.receive(6),400);ok(await f.receive(5),201);assert.equal(await f.balance(),8001);
});

test('simultaneous retries of the same receipt key create exactly one receipt and one stock increment',async()=>{
 const f=await fixture();ok(await f.accept());const key=crypto.randomUUID();
 const results=await Promise.all([f.receive(4,key),f.receive(4,key)]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,201]);assert.equal(results[0].data.receiptId,results[1].data.receiptId);
 assert.equal(await f.balance(),5);assert.equal((await f.db.select().from(supplierReceipts)).length,1);
 assert.equal(ok(await f.context()).lines[0].remaining,6);
});

test('early receipt quality evidence: only good units enter stock; damaged/refused units stay due, with safe replay',async()=>{
 const f=await fixture(10,true);ok(await f.accept());
 const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
 const mixed={clientKey:crypto.randomUUID(),earlyRequestId:f.id,createSapo:false,receivedDate:'2026-10-24',warehouse:'KHO NHẬN',note:'Hàng lỗi khi giao',lines:[{lineId:'line-a1',goodQty:7,damagedQty:3,note:'Bể vỡ'}]};
 ok(await f.call('/purchase-orders/a1/receipts',f.cookies.kho,'POST',mixed),400);assert.equal(await f.balance(),1);assert.equal((await f.db.select().from(supplierReceipts)).length,0);
 const body={...mixed,photos:[photo]};ok(await f.call('/purchase-orders/a1/receipts',f.cookies.kho,'POST',body),201);assert.equal(await f.balance(),8);assert.equal(ok(await f.context()).lines[0].remaining,3);
 ok(await f.call('/purchase-orders/a1/receipts',f.cookies.kho,'POST',body));assert.equal(await f.balance(),8);
 const refused={...body,clientKey:crypto.randomUUID(),note:'Từ chối nhận / trả NCC: giao hàng bể vỡ',lines:[{lineId:'line-a1',goodQty:0,damagedQty:3,note:'NCC cần giao bù'}]};
 ok(await f.call('/purchase-orders/a1/receipts',f.cookies.kho,'POST',refused),201);ok(await f.call('/purchase-orders/a1/receipts',f.cookies.kho,'POST',refused));assert.equal(await f.balance(),8);assert.equal(ok(await f.context()).lines[0].remaining,3);assert.equal((await f.db.select().from(supplierReceipts)).length,2);assert.equal((await f.db.select().from(receiptJobs)).length,0);
});
