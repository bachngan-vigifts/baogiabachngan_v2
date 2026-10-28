import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setupEarly} from '../helpers/purchase-early-fixture.ts';
import {eq} from 'drizzle-orm';
import {incomingShipments} from '../../src/modules/suppliers/schema.ts';
// @ts-ignore browser parser is shared, DOM independent
import {parseEarlyRequestSheet,earlyFileRequestGroups,EARLY_FILE_HEADER} from '../../trial-ui/purchase-early-file.js';

test('PXK keeps leading zeroes; same PXK groups different PO/NCC references, same SKU in different PXK remains distinct',()=>{
 const p=parseEarlyRequestSheet([EARLY_FILE_HEADER,['031106000',3,'PO-a1','NCC-1','00012'],['031106000',4,'PO-a2','NCC-2','00012'],['031106000',5,'PO-a1','NCC-1','00013']]);
 assert.deepEqual(p.errors,[]);const groups=earlyFileRequestGroups(p.lines);
 assert.equal(groups.length,2);assert.equal(groups[0].pxkNo,'00012');assert.equal(groups[0].lines[0].quantity,7);assert.equal(groups[0].lines[0].sourceOrders.length,2);assert.equal(groups[1].lines[0].quantity,5);
 assert.ok(parseEarlyRequestSheet([EARLY_FILE_HEADER,['031106000',3,'PO-a1','','X'],['031106000',2,'PO-a1','','x']]).errors.length);
});
test('one atomic file save creates/replays PXK drafts without supplier grouping or inventory writes; joint source cap rolls back all groups',async()=>{
 const f=await setupEarly(),call=(body:unknown,actor=f.cookies.sa)=>f.call('/purchase-early-requests/file',actor,'POST',body as any);
 await f.db.update(incomingShipments).set({supplierInternalOrderNumber:'NCC-ONE'}).where(eq(incomingShipments.id,'a1'));
 await f.db.update(incomingShipments).set({supplierInternalOrderNumber:'NCC-TWO'}).where(eq(incomingShipments.id,'a2'));
 const line=(quantity:number,orderNo='PO-a1')=>({sku:'031106000',quantity,sourceOrders:[{orderNo,supplierOrderNo:'',quantity}]});
 const body={clientKey:'pxk-workbook-key',pickupDate:'2026-10-28',scope:{supplierId:'a'},groups:[{pxkNo:'0001',lines:[{sku:'031106000',quantity:7,sourceOrders:[{orderNo:'PO-a1',quantity:3},{orderNo:'PO-a2',quantity:4}]}]},{pxkNo:'0002',lines:[line(5)]}]};
 const saved=await call(body);assert.equal(saved.status,201,JSON.stringify(saved.data));assert.equal(saved.data.requests.length,2);
 const one=saved.data.requests.find((r:any)=>r.pxkNo==='0001');assert.equal(one.lines[0].quantity,7);assert.equal(one.lines[0].allocations.length,2);assert.ok(saved.data.requests.every((r:any)=>r.requestStatus==='draft'));
 const replay=await call(body);assert.equal(replay.status,200);assert.equal(replay.data.replayed,true);assert.deepEqual(replay.data.requestIds,saved.data.requestIds);
 assert.equal((await call({...body,pickupDate:'2026-10-29'})).status,409);assert.equal((await call(body,f.cookies.emp)).status,403);
 const old=await f.call('/purchase-early-requests',f.cookies.sa,'POST',{clientKey:'legacy-manual-key',lines:[line(1)],scope:{supplierId:'a'}});assert.equal(old.status,201);assert.equal(Object.hasOwn(old.data.request.scope,'pxkNo'),false,'legacy draft payload/hash shape remains unchanged');
 const before=(await f.client.query<{n:number}>('select count(*)::int n from purchase_early_requests')).rows[0]!.n;
 const rejected=await call({...body,clientKey:'too-much-pxk-key',groups:[{pxkNo:'A',lines:[line(5000)]},{pxkNo:'B',lines:[line(5000)]}]});assert.equal(rejected.status,409);
 assert.equal((await f.client.query<{n:number}>('select count(*)::int n from purchase_early_requests')).rows[0]!.n,before);
 const visible=await f.call('/purchase-early-requests?q=0001',f.cookies.sa);assert.equal(visible.data.requests.length,1);
 assert.equal((await f.call('/supplier-portal/early-requests',f.cookies.ncc)).data.requests.length,0);
 for(const table of ['supplier_receipts','stock_moves','supplier_receipt_jobs'])assert.equal((await f.client.query<{n:number}>('select count(*)::int n from '+table)).rows[0]!.n,0);

});
