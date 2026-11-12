import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setupEarly} from '../helpers/purchase-early-fixture.ts';
import {incomingShipments,incomingShipmentLines,supplierReceipts,supplierReceiptLines} from '../../src/modules/suppliers/schema.ts';
import {supplierStockChecks,supplierStockCheckLines} from '../../src/modules/suppliers/workspace-schema.ts';

test('SKU quantities and paginated drill-down use only approved owned orders, valid receipts and per-code dates',async()=>{
 const{db,call,cookies:c}=await setupEarly();
 await db.update(incomingShipmentLines).set({quantity:2.5,promisedDate:'',price:100}).where(eq(incomingShipmentLines.id,'line-a1'));
 await db.update(incomingShipmentLines).set({promisedDate:'2026-12-01',price:100}).where(eq(incomingShipmentLines.id,'line-a2'));
 await db.insert(supplierReceipts).values([{id:'r1',receiptNo:'PN-ONE',shipmentId:'a1',receivedDate:'2026-11-01',receivedBy:'mgr',clientKey:'sku-receipt-1',createdAt:'2026-11-01T00:00:00Z'},{id:'r2',receiptNo:'PN-TWO',shipmentId:'a1',receivedDate:'2026-11-01',receivedBy:'mgr',clientKey:'sku-receipt-2',createdAt:'2026-11-01T00:00:00Z'},{id:'rv',receiptNo:'PN-VOID',shipmentId:'a1',receivedDate:'2026-11-01',receivedBy:'mgr',clientKey:'sku-receipt-v',createdAt:'2026-11-01T00:00:00Z',cancelledAt:'2026-11-02T00:00:00Z'}]);
 await db.insert(supplierReceiptLines).values([{receiptId:'r1',lineId:'line-a1',sku:'031106000',goodQty:1,damagedQty:1},{receiptId:'r2',lineId:'line-a1',sku:'031106000',goodQty:1,damagedQty:0},{receiptId:'rv',lineId:'line-a1',sku:'031106000',goodQty:1,damagedQty:0}]);
 const products=await call('/supplier-portal/workspace/products',c.ncc),p=products.data.items[0];assert.equal(products.status,200);assert.equal(p.orderedQuantity,7003);assert.equal(p.receivedQuantity,2);assert.equal(p.remainingQuantity,7001);assert.equal(p.orderCount,2);
 const path='/supplier-portal/workspace/products/031106000/orders',first=await call(path+'?limit=1',c.ncc);assert.equal(first.status,200,JSON.stringify(first.data));assert.equal(first.data.items.length,1);assert.equal(first.data.total,2);assert.equal(first.data.items[0].orderId,'a1');assert.equal(first.data.items[0].expected,'2026-10-20');assert.equal(first.data.orderedQuantity,p.orderedQuantity);assert.equal(first.data.remainingQuantity,p.remainingQuantity);assert.doesNotMatch(JSON.stringify(first.data),/price|discount|note|PO-b1/);
 const second=await call(path+'?limit=1&offset=1',c.ncc);assert.equal(second.data.items[0].orderId,'a2');assert.equal(second.data.items[0].expected,'2026-12-01');
 assert.equal((await call(path+'?supplierId=b',c.ncc)).status,404);assert.equal((await call(path+'?limit=101',c.ncc)).status,400);assert.equal((await call(path,c.emp)).status,403);assert.equal((await call('/supplier-portal/workspace/products/'+encodeURIComponent("' OR 1=1--")+'/orders',c.ncc)).status,404);
 await db.update(incomingShipments).set({cancelledAt:'2026-11-12T00:00:00Z'}).where(eq(incomingShipments.id,'a2'));
 const cancelled=await call(path,c.ncc);assert.equal(cancelled.data.total,1);assert.equal(cancelled.data.orderedQuantity,3);assert.equal(cancelled.data.remainingQuantity,1);
 await db.update(incomingShipments).set({approvalStatus:'pending'}).where(eq(incomingShipments.id,'a1'));
 assert.equal((await call(path,c.ncc)).status,404);
});

test('stock check is a separate idempotent Manager request; NCC responds to exact slip/SKU with revision and no ledger effects',async()=>{
 const{db,call,cookies:c,client}=await setupEarly(),base='/supplier-workspace-admin/stock-checks?supplierId=a';
 const body={clientKey:'check-first-0001',checkNo:'KT-0001',neededDate:'2026-12-01',note:'Kiểm hàng theo mã',lines:[{sku:'031106000',quantity:50}]};
 const count=async()=>(await client.query('select (select count(*)::int from stock_moves) moves,(select count(*)::int from supplier_receipts) receipts,(select count(*)::int from supplier_payments) payments,(select count(*)::int from supplier_published_stock) published')).rows[0];const before=await count();
 const created=await call(base,c.mgr,'POST',body);assert.equal(created.status,201,JSON.stringify(created.data));assert.equal((await call(base,c.mgr,'POST',body)).data.id,created.data.id);
 assert.equal((await call(base,c.mgr,'POST',{...body,note:'Different'})).status,409);assert.equal((await call(base,c.mgr,'POST',{...body,clientKey:'check-second-0001'})).status,409);
 assert.equal((await call(base,c.ncc,'POST',body)).status,403);assert.equal((await call(base,c.kt,'POST',body)).status,403);
 for(const lines of [[{sku:'FOREIGN',quantity:1}],[{sku:'031106000',quantity:-1}],[{sku:'031106000',quantity:1},{sku:'031106000',quantity:2}],[null]])assert.ok([400,404].includes((await call(base,c.mgr,'POST',{...body,clientKey:'bad-check-0001',checkNo:'BAD',lines})).status));
 const list=await call('/supplier-portal/workspace/stock',c.ncc);assert.equal(list.status,200,JSON.stringify(list.data));const row=list.data.items[0];assert.equal(row.no,'KT-0001');assert.equal(row.requestedQuantity,50);assert.equal(row.orderedQuantity,15000);assert.equal(row.remainingQuantity,15000);assert.equal(row.availableQuantity,null);assert.equal(row.status,'waiting_check');
 assert.equal((await call('/supplier-portal/workspace/stock',c.ncc2)).data.total,0);assert.equal((await call('/supplier-portal/workspace/stock/'+row.id,c.ncc2)).status,404);
 const response={revision:1,availableQuantity:30,promisedDate:'2026-12-02',note:'Có 30 cái theo lịch'};
 const route='/supplier-portal/workspace/stock/'+row.id+'/respond';
 assert.equal((await call(route,c.ncc2,'POST',response)).status,404);assert.equal((await call(route+'?supplierId=a',c.mgr,'POST',response)).status,403);
 for(const bad of [{availableQuantity:-1},{availableQuantity:1,promisedDate:''},{promisedDate:'2026-02-30'},{promisedDate:'2026-12-02junk'}])assert.equal((await call(route,c.ncc,'POST',{...response,...bad})).status,400);
 assert.equal((await call(route,c.ncc,'POST',response)).status,200);assert.equal((await call(route,c.ncc,'POST',response)).status,409,'stale revision cannot overwrite a response');
 const after=(await call('/supplier-portal/workspace/stock?min=20&max=40',c.ncc)).data;assert.equal(after.total,1);assert.equal(after.items[0].availableQuantity,30);assert.equal(after.items[0].expected,'2026-12-02');assert.equal(after.items[0].status,'partly_available');assert.equal(after.items[0].revision,2);
 assert.equal((await call('/supplier-portal/workspace/stock?dateField=neededDate&from=2026-12-01&to=2026-12-01',c.ncc)).data.total,1);
 const exportRows=await call('/supplier-portal/workspace/stock/export?q=KT-0001',c.ncc);assert.equal(exportRows.data.items[0].availableQuantity,30);
 assert.deepEqual(await count(),before);assert.equal((await db.select().from(incomingShipmentLines).where(eq(incomingShipmentLines.id,'line-a1')))[0]!.promisedDate,'2026-10-20');
 assert.ok((await db.select().from(supplierStockChecks))[0]!.respondedAt);assert.equal((await db.select().from(supplierStockCheckLines)).length,1);
});

test('multi-code checks retain separate responses and complete only after every code responds',async()=>{
 const{db,call,cookies:c}=await setupEarly();
 await db.insert(incomingShipmentLines).values({id:'extra-a2',shipmentId:'a2',lineNo:2,sku:'EXTRA',name:'Mã thứ hai',unit:'Bộ',quantity:8});
 const made=await call('/supplier-workspace-admin/stock-checks?supplierId=a',c.mgr,'POST',{clientKey:'multi-code-check-001',checkNo:'KT-MULTI',lines:[{sku:'031106000',quantity:5},{sku:'EXTRA',quantity:8}]});assert.equal(made.status,201);
 const rows=(await call('/supplier-portal/workspace/stock?q=KT-MULTI',c.ncc)).data.items;assert.equal(rows.length,2);const one=rows.find((r:any)=>r.sku==='031106000'),two=rows.find((r:any)=>r.sku==='EXTRA');assert.equal(two.orderedQuantity,8);
 assert.equal((await call('/supplier-portal/workspace/stock/'+one.id+'/respond',c.ncc,'POST',{revision:1,availableQuantity:5,promisedDate:'2026-12-01'})).status,200);
 assert.equal((await db.select().from(supplierStockChecks).where(eq(supplierStockChecks.id,made.data.id)))[0]!.respondedAt,null);
 assert.equal((await call('/supplier-portal/workspace/stock/'+two.id+'/respond',c.ncc,'POST',{revision:1,availableQuantity:0})).status,409);
 assert.equal((await call('/supplier-portal/workspace/stock/'+two.id+'/respond',c.ncc,'POST',{revision:2,availableQuantity:0})).status,200);
 const check=(await db.select().from(supplierStockChecks).where(eq(supplierStockChecks.id,made.data.id)))[0]!;assert.ok(check.respondedAt);assert.equal(check.revision,3);
 const updated=(await call('/supplier-portal/workspace/stock?q=KT-MULTI',c.ncc)).data.items;assert.equal(updated.find((r:any)=>r.id===two.id).status,'unavailable');assert.equal(updated.find((r:any)=>r.id===one.id).availableQuantity,5);
});
