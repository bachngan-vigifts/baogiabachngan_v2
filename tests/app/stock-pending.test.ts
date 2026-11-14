import {quotations} from '../../src/modules/quotes/schema.ts';
import {Router} from '../../src/core/http/router.ts';
import type {StaffEnv} from '../../src/modules/staff/api/auth-routes.ts';
import {registerStockHistoryRoutes} from '../../src/modules/inventory/api/history-routes.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {projectStockPending,stockPendingOf} from '../../src/app/stock-pending.ts';
import {setup as setupPos} from '../helpers/pos-fixture.ts';
import {products} from '../../src/modules/catalog/schema.ts';
import {salesOrders,salesOrderLines,packingSlips,packingSlipLines,deliveries,deliveryLines,stockHolds} from '../../src/modules/sales/schema.ts';
import {stockMoves} from '../../src/modules/inventory/schema.ts';
import {eq} from 'drizzle-orm';
const t1='2026-11-01T01:00:00Z',t2='2026-11-02T01:00:00Z',t3='2026-11-03T01:00:00Z',t4='2026-11-04T01:00:00Z';
const pack=(extra={})=>({lineId:'l',orderId:'o',sku:'S',warehouseId:'a',qty:10,at:t1,delivered:0,orderStatus:'delivering',...extra});
const ret=(extra={})=>({lineId:'l',orderId:'o',sku:'S',warehouseId:'a',context:'after_issue',qty:4,receivedQty:0,receivedAt:null as string|null,status:'approved',...extra});
const hold=(qty:number,extra={})=>({orderId:'o',sku:'S',warehouseId:'a',qty,...extra});
const issue=(qty:number)=>({orderId:'o',sku:'S',warehouseId:'a',qty});
const back=(extra={})=>({lineId:'l',orderId:'o',sku:'S',warehouseId:'a',qty:4,...extra});
const row=(rows:ReturnType<typeof projectStockPending>,wh='a')=>rows.find(r=>r.sku==='S'&&r.warehouseId===wh)!;
test('partial delivery leaves only unfulfilled packed units; separate unissued reservations stay distinct',()=>{
 const r=row(projectStockPending([pack({delivered:4})],[{lineId:'l',qty:4,at:t2}],[],[],[hold(3)],[issue(10)],['a']));
 assert.equal(r.packed,6);assert.equal(r.held,3);
 const timezone=row(projectStockPending([pack({at:'2026-11-01T08:00:00+07:00'})],[{lineId:'l',qty:4,at:'2026-11-01T01:00:00.000Z'}],[],[],[],[issue(10)],['a']));assert.equal(timezone.packed,6);assert.equal(r.uncertain,false);
 const legacy=row(projectStockPending([pack({qty:5})],[],[],[],[hold(10)],[],['a']));assert.equal(legacy.packed,5);assert.equal(legacy.held,5,'same unissued packed units are not held twice');
 const modern=row(projectStockPending([pack({qty:5})],[],[],[],[hold(10)],[issue(5)],['a']));assert.equal(modern.held,10,'hold covers other units after packing debit');
});
test('GHN returned and after-issue request overlap once; receipt clears the awaiting-receipt bucket',()=>{
 const r=row(projectStockPending([pack()],[],[ret()],[back()],[],[issue(10)],['a']));assert.equal(r.packed,6);assert.equal(r.returning,4);
 const done=row(projectStockPending([pack()],[],[ret({status:'completed',receivedQty:4,receivedAt:t3})],[back()],[],[issue(10)],['a']));assert.equal(done.packed,6);assert.equal(done.returning,0);
 const cross=projectStockPending([pack()],[],[ret({warehouseId:'b'})],[],[hold(10)],[],['a','b']);assert.equal(row(cross).held,0);assert.equal(row(cross).packed,6);assert.equal(row(cross,'b').returning,4,'different return-to warehouse does not duplicate a source hold');
 const direct=row(projectStockPending([],[],[],[back()],[],[issue(4)],['a']));assert.equal(direct.returning,4,'GHN returns count even without a packing slip');
});
test('returns of delivered goods add awaiting receipt without subtracting unrelated new packing; redelivery consumes only earlier packs',()=>{
 const success=[{lineId:'l',qty:10,at:t2}];
 const r=row(projectStockPending([pack({delivered:10})],success,[ret({context:'after_delivery'})],[],[],[issue(10)],['a']));assert.equal(r.packed,0);assert.equal(r.returning,4);
 const returned=ret({context:'after_delivery',receivedAt:t3,receivedQty:4,status:'completed'});
 const resend=row(projectStockPending([pack({delivered:6}),pack({qty:4,at:t4,delivered:6})],success,[returned],[],[],[issue(14)],['a']));assert.equal(resend.packed,4);assert.equal(resend.returning,0);
 const complete=row(projectStockPending([pack({delivered:10}),pack({qty:4,at:t4,delivered:10})],[...success,{lineId:'l',qty:4,at:'2026-11-05T01:00:00Z'}],[returned],[],[],[issue(14)],['a']));assert.equal(complete.packed,0);
});
test('same SKU on separate order lines is not deduplicated as one return; private warehouses and unknown holds are not allocated',()=>{
 const r=row(projectStockPending([pack(),pack({lineId:'l2'})],[],[ret()],[back({lineId:'l2'})],[],[issue(20)],['a']));assert.equal(r.returning,8);assert.equal(r.packed,12);
 const result=projectStockPending([pack(),pack({lineId:'secret',warehouseId:'private'})],[],[ret({lineId:'secret',warehouseId:'private'})],[],[hold(7,{orderId:'other',warehouseId:null}),hold(5,{warehouseId:'private'})],[issue(10)],['a']);
 assert.ok(result.every(r=>['a',''].includes(r.warehouseId)));assert.equal(row(result).unassignedHeld,7);assert.equal(row(result).held,0);
});
test('incomplete legacy or multi-warehouse delivery provenance is explicit, never a guessed allocation',()=>{
 const legacy=row(projectStockPending([pack({delivered:4})],[],[],[],[],[issue(10)],['a']));assert.equal(legacy.uncertain,true);assert.equal(legacy.packed,0);
 const ready=projectStockPending([pack({warehouseId:'a',qty:6}),pack({warehouseId:'b',qty:4})],[],[],[],[],[],['a','b']);assert.deepEqual(ready.map(r=>[r.warehouseId,r.packed,r.uncertain]),[['a',6,false],['b',4,false]]);
 const mixed=projectStockPending([pack({warehouseId:'a',qty:6}),pack({warehouseId:'b',qty:4})],[{lineId:'l',qty:3,at:t2}],[],[],[],[],['a','b']);assert.ok(mixed.every(r=>r.uncertain));
 const done=projectStockPending([pack({orderStatus:'delivered',delivered:10})],[],[],[],[],[],['a']);assert.ok(done.every(r=>r.packed===0&&!r.uncertain));
});
test('stock-moves API returns current quantities on every historical row, keeps balance unchanged and supports Excel payload',async()=>{
 const f=await setupPos();
 await f.db.insert(products).values({sku:'S-PENDING',name:'Hàng đang treo thử',unit:'cái',updatedAt:t1});
 await f.db.insert(salesOrders).values({id:'pending-order',orderNo:'DH-PENDING',quoteType:'HRC',customerName:'Khách kiểm thử',ownerId:'emp',createdBy:'emp',orderDate:'2026-11-01',warehouseId:'pos-wh',holdsStock:false,status:'delivering',createdAt:t1,updatedAt:t2});
 await f.db.insert(salesOrderLines).values({id:'pending-line',orderId:'pending-order',lineNo:1,sku:'S-PENDING',name:'Hàng thử',qty:10,deliveredQty:4});
 await f.db.insert(packingSlips).values({id:'pending-pack',slipNo:'DG-PENDING',orderId:'pending-order',status:'packed',stockWarehouseId:'pos-wh',packedBy:'mgr',packedAt:t1,createdBy:'mgr',createdAt:t1,updatedAt:t1});
 await f.db.insert(packingSlipLines).values({id:'pending-packed-line',slipId:'pending-pack',orderLineId:'pending-line',sku:'S-PENDING',name:'Hàng thử',qty:10});
 await f.db.insert(deliveries).values({id:'pending-delivery',deliveryNo:'GH-PENDING',orderId:'pending-order',plannedDate:'2026-11-02',status:'delivered',confirmedAt:t2,createdBy:'mgr',createdAt:t2,updatedAt:t2});
 await f.db.insert(deliveryLines).values({deliveryId:'pending-delivery',orderLineId:'pending-line',qty:4});
 await f.db.insert(stockMoves).values([{id:'pending-opening',sku:'S-PENDING',warehouseId:'pos-wh',qty:50,kind:'opening',refType:'opening',refId:'pending-opening',refNo:'OPEN',createdBy:'mgr',createdAt:'2026-10-01T01:00:00Z'},{id:'pending-issue',sku:'S-PENDING',warehouseId:'pos-wh',qty:-10,kind:'issue',refType:'packing_slip',refId:'pending-pack',refNo:'DG-PENDING',createdBy:'mgr',createdAt:t1}]);
 await f.db.insert(quotations).values(['active','expired','converted'].map(id=>({id:'pending-quote-'+id,creatorId:'emp',quoteNo:'BG-PENDING-'+id,quoteType:'HRC' as const,customer:'Khách thử',data:'{}',createdAt:t1,updatedAt:t1})));
 await f.db.insert(stockHolds).values(['active','expired','converted'].map(id=>({id:'pending-hold-'+id,quoteId:'pending-quote-'+id,sku:'S-PENDING',qty:id==='active'?3:50,status:'active' as const,expiresAt:id==='expired'?'2000-01-01T00:00:00Z':'2099-01-01T00:00:00Z',createdBy:'emp',createdAt:t1})));
 await f.db.update(salesOrders).set({quoteId:'pending-quote-converted'}).where(eq(salesOrders.id,'pending-order'));
 const path='/stock-moves?sku=S-PENDING';const r=await f.call(path,f.mgr);assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.moves.length,2);assert.equal(r.data.pendingAvailable,true);assert.equal(r.data.moves[0].pending.unassignedHeld,3,'expired or converted quotes never add holds');
 assert.deepEqual(r.data.moves.map((m:any)=>[m.balanceAfter,m.pendingQty]),[[40,6],[50,6]]);
 const historical=await f.call(path+'&to=2026-10-02',f.mgr);assert.equal(historical.data.moves[0].balanceAfter,50);assert.equal(historical.data.moves[0].pendingQty,6,'pending is current even on an old transaction');
 assert.equal((await f.call(path+'&export=1',f.mgr)).data.moves[0].pendingQty,6);
 await f.db.update(packingSlips).set({status:'cancelled'}).where(eq(packingSlips.id,'pending-pack'));
 assert.equal((await f.call(path,f.mgr)).data.moves[0].pendingQty,0);
 assert.deepEqual(await stockPendingOf(f.db,[],['pos-wh'],t4),[]);
 const router=new Router<StaffEnv>({authorize:async c=>{c.state.session={member:{id:'mgr',role:'manager',positionId:'manager',active:true}};}});
 registerStockHistoryRoutes(router,{pendingOf:async()=>{throw Error('Fixture source unavailable');}});
 const failed=await router.handle(new Request('https://trial.test'+path),f.env);const data=await failed.json() as any;
 assert.equal(failed.status,200);assert.equal(data.pendingAvailable,false);assert.equal(data.moves[0].balanceAfter,40);assert.equal(data.moves[0].pendingQty,null);

});
