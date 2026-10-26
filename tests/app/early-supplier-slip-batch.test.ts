import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {eq} from 'drizzle-orm';
import {setupEarly} from '../helpers/purchase-early-fixture.ts';
import {incomingShipments} from '../../src/modules/suppliers/schema.ts';
import {products} from '../../src/modules/catalog/schema.ts';
const context:any={};
const source=readFileSync(new URL('../../trial-ui/purchase-early-requests.js',import.meta.url),'utf8');
runInNewContext(source.slice(source.indexOf('function supplierSlips('),source.indexOf('export function initEarlyRequests'))+';this.group=supplierSlips;',context);

test('group supplier slips by supplier + exact reference; keep blank references separate by CRM order',()=>{
 const alloc=(id:string,supplierId:string,supplierOrderNo:string,orderId:string)=>({id,supplierId,supplierOrderNo,orderId,ticketNumber:orderId,supplierName:supplierId,quantity:2,status:'pending'});
 const request={id:'r',lines:[{id:'l1',sku:'SKU1',quantity:8,allocations:[alloc('1','a','000123','crm1'),alloc('2','a','000123','crm2'),alloc('3','b','000123','crm3'),alloc('4','a','','crm4')]},
 {id:'l2',sku:'SKU2',quantity:4,allocations:[alloc('5','a','000123','crm1'),alloc('6','a','','crm5')]}]};
 const groups=context.group(request);assert.equal(groups.length,4);
 assert.equal(groups[0].lines.length,2);assert.equal(groups[0].lines[0].quantity,4);
 assert.equal(groups[0].lines[0].allocations.length,2);assert.equal(groups[1].supplierName,'b');
 assert.equal(request.lines[0]!.quantity,8);assert.equal(request.lines[0]!.allocations.length,4);
});

test('batch confirms exact allocations atomically, records Manager and never receives stock; names use full catalog',async()=>{
 const f=await setupEarly(),c=f.cookies;
 await f.db.insert(products).values({sku:'031106000',name:'Bộ trà 0.7 L Jasmine Trắng Ngà (031106000) - L1',updatedAt:new Date().toISOString()});
 for(const id of ['a1','a2','b1'])await f.db.update(incomingShipments).set({supplierInternalOrderNumber:'000123'}).where(eq(incomingShipments.id,id));
 const draft=await f.call('/purchase-early-requests',c.mgr,'POST',{clientKey:'batch-test',pickupDate:'2026-10-26',lines:[{sku:'031106000',quantity:16000},{sku:'01654020803',quantity:2}]});
 assert.equal(draft.status,201,JSON.stringify(draft.data));const id=draft.data.id;
 const ids=draft.data.request.lines.flatMap((l:any)=>l.allocations.map((a:any)=>a.id));
 assert.equal((await f.call('/purchase-early-requests/manager-confirm-batch',c.mgr,'POST',{allocationIds:ids})).status,409);
 assert.equal((await f.call('/purchase-early-requests/'+id+'/submit',c.mgr,'POST',{revision:draft.data.request.revision})).status,200);
 const request=(await f.call('/purchase-early-requests?id='+id,c.mgr)).data.requests[0];
 const productLine=request.lines.find((l:any)=>l.sku==='031106000');assert.match(productLine.name,/Jasmine Trắng Ngà/);
 const rows=request.lines.flatMap((l:any)=>l.allocations),one=rows.find((a:any)=>a.orderId==='a1'),other=rows.find((a:any)=>a.orderId==='a2');
 for(const actor of ['sa','emp','ncc'])assert.equal((await f.call('/purchase-early-requests/manager-confirm-batch',c[actor],'POST',{allocationIds:[one.id]})).status,403);
 assert.equal((await f.call('/purchase-early-requests/manager-confirm-batch',c.mgr,'POST',{allocationIds:[one.id,'missing']})).status,404);
 const replies=await Promise.all([1,2].map(()=>f.call('/purchase-early-requests/manager-confirm-batch',c.mgr,'POST',{allocationIds:[one.id]})));
 assert.ok(replies.every(r=>r.status===200));assert.equal(replies.reduce((n,r)=>n+r.data.confirmed,0),1);
 const proof=(await f.client.query<any>('select * from purchase_early_request_allocations where id=$1',[one.id])).rows[0];
 assert.equal(proof.responded_by,'mgr');assert.ok(proof.responded_at);
 assert.equal((await f.client.query<any>('select status from purchase_early_request_allocations where id=$1',[other.id])).rows[0].status,'pending');
 const bLine=productLine;
 assert.equal((await f.call('/supplier-portal/early-requests/'+bLine.id+'/respond',c.ncc2,'POST',{status:'rejected'})).status,200);
 const rejected=rows.find((a:any)=>a.orderId==='b1');
 assert.equal((await f.call('/purchase-early-requests/manager-confirm-batch',c.mgr,'POST',{allocationIds:[other.id,rejected.id]})).status,409);
 assert.equal((await f.client.query<any>('select status from purchase_early_request_allocations where id=$1',[other.id])).rows[0].status,'pending');
 const counts=(await f.client.query<any>("select (select count(*)::int from supplier_receipts) receipts,(select count(*)::int from stock_moves) moves,(select count(*)::int from audit_logs where action='early-request-manager-confirm-batch') audits")).rows[0];
 assert.deepEqual([counts.receipts,counts.moves,counts.audits],[0,0,1]);
});
