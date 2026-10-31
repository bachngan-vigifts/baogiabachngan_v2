import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq,sql} from 'drizzle-orm';
import {setupLiquidation,proofPhoto} from '../helpers/liquidation-fixture.ts';
import {salesOrders,salesContracts,salesOrderLines,customerPayments,deliveries} from '../../src/modules/sales/schema.ts';
import {contractLiquidations} from '../../src/modules/sales/liquidation-schema.ts';

test('scoped original-photo request stays pending; only Manager reviews, audit and manager approval queue, replay never duplicates',async()=>{
 const f=await setupLiquidation(),view=await f.call(f.path,f.emp);assert.equal(view.status,200);assert.equal(view.data.proof.ready,true);
 assert.equal((await f.call(f.path,f.other)).status,404);assert.equal((await f.call(f.path,f.ncc)).status,403);
 for(const overrides of [{photos:[]},{photos:[proofPhoto,proofPhoto]},{photos:['data:image/png;base64,AAAA']},{originalsReceived:false},{servicesCompleted:false}])assert.equal((await f.request(crypto.randomUUID(),f.emp,overrides)).status,400);
 const key=crypto.randomUUID(),body={clientKey:key,originalsReceived:true,servicesCompleted:true,photos:[proofPhoto],expectedHash:view.data.proof.hash};
 const raced=await Promise.all([1,2].map(()=>f.call(f.path,f.emp,'POST',body)));assert.ok(raced.every(r=>[200,201].includes(r.status)),JSON.stringify(raced));assert.equal(new Set(raced.map(r=>r.data.id)).size,1);assert.equal((await f.db.select().from(contractLiquidations)).length,1);assert.equal(f.files.files.size,1);
 assert.equal((await f.call(f.path,f.emp,'POST',{...body,photos:[proofPhoto.replace('iVBOR','iVBOQ')]})).status,400);
 assert.equal((await f.call(f.path,f.emp,'POST',{...body,expectedHash:'different'})).status,409);
 const pending=(await f.call(f.path,f.mgr)).data;assert.equal(pending.state,'pending');assert.ok(pending.current.photoUrl);assert.equal(pending.current.photoFileKey,undefined);assert.equal(pending.canReview,true);
 const queue=(await f.call('/approvals',f.mgr)).data;assert.ok(queue.items.some((r:any)=>r.title==='Duyệt thanh lý HDKT-DEMO'));assert.equal(queue.counts.contract,1);
 const review=f.path+'/'+pending.current.id+'/review',approval={decision:'approved',revision:1,expectedHash:pending.proof.hash,confirmOriginals:true};
 assert.equal((await f.call(review,f.emp,'POST',approval)).status,403);
 assert.equal((await f.call(review,f.mgr,'POST',{...approval,confirmOriginals:false})).status,400);
 assert.equal((await f.call(review,f.mgr,'POST',approval)).status,200);
 assert.equal((await f.call(review,f.mgr,'POST',approval)).data.replayed,true);
 assert.equal((await f.call(f.path,f.emp)).data.state,'approved');assert.equal((await f.call('/approvals?summary=1',f.mgr)).data.counts.contract,0);
 const audits=(await f.client.query<any>("select action from audit_logs where entity_type='contract-liquidation'")).rows;assert.equal(audits.filter((r:any)=>r.action==='contract-liquidation-request').length,1);assert.equal(audits.filter((r:any)=>r.action==='contract-liquidation-approved').length,1);
});

test('each obligation blocks sending; changed money blocks approval and invalidates an earlier green badge',async()=>{
 const f=await setupLiquidation();
 const signed=()=>f.db.update(salesContracts).set({status:'signed'}).where(eq(salesContracts.id,'liq-contract'));
 await f.db.update(salesContracts).set({status:'draft'}).where(eq(salesContracts.id,'liq-contract'));assert.equal((await f.request()).status,409);await signed();
 await f.db.update(customerPayments).set({voidedAt:f.stamp}).where(eq(customerPayments.id,'liq-paid'));assert.equal((await f.request()).status,409);await f.db.update(customerPayments).set({voidedAt:null}).where(eq(customerPayments.id,'liq-paid'));
 await f.db.update(salesOrders).set({invoiceStatus:'requested'}).where(eq(salesOrders.id,'liq-order'));assert.equal((await f.request()).status,409);await f.db.update(salesOrders).set({invoiceStatus:'issued',invoiceNo:'HD001',invoiceMode:'draft'}).where(eq(salesOrders.id,'liq-order'));assert.equal((await f.request()).status,409);await f.db.update(salesOrders).set({invoiceMode:'issue'}).where(eq(salesOrders.id,'liq-order'));
 await f.db.update(salesOrderLines).set({sku:'SKU',deliveredQty:0}).where(eq(salesOrderLines.id,'liq-service'));assert.equal((await f.request()).status,409);await f.db.update(salesOrderLines).set({sku:''}).where(eq(salesOrderLines.id,'liq-service'));
 const made=await f.request();assert.equal(made.status,201,JSON.stringify(made.data));const before=(await f.call(f.path,f.mgr)).data,review=f.path+'/'+made.data.id+'/review',body={decision:'approved',revision:1,expectedHash:before.proof.hash,confirmOriginals:true};
 await f.db.update(customerPayments).set({amount:90}).where(eq(customerPayments.id,'liq-paid'));assert.equal((await f.call(review,f.mgr,'POST',body)).status,409);
 await f.db.update(customerPayments).set({amount:100}).where(eq(customerPayments.id,'liq-paid'));assert.equal((await f.call(review,f.mgr,'POST',body)).status,200);
 await f.db.update(salesContracts).set({revision:2}).where(eq(salesContracts.id,'liq-contract'));assert.equal((await f.call(f.path,f.emp)).data.state,'review_required');
 const fresh=await f.request();assert.equal(fresh.status,201);assert.equal((await f.db.select().from(contractLiquidations).where(eq(contractLiquidations.id,made.data.id)))[0]!.status,'superseded');
});

test('reject with reason permits a new evidence request; unrelated assigned approvers cannot approve',async()=>{
 const f=await setupLiquidation(),made=await f.request(),review=f.path+'/'+made.data.id+'/review';
 assert.equal((await f.call(review,f.mgr,'POST',{decision:'rejected',revision:1,note:''})).status,400);
 assert.equal((await f.call(review,f.mgr,'POST',{decision:'rejected',revision:1,note:'Ảnh chưa đủ rõ hồ sơ gốc'})).status,200);
 assert.equal((await f.call(f.path,f.emp)).data.state,'rejected');assert.equal((await f.request()).status,201);
 await f.client.query("update staff_members set can_approve=true where id='new'");
 const queue=(await f.call('/approvals',f.other)).data;assert.ok(!queue.items.some((r:any)=>r.title.startsWith('Duyệt thanh lý')));
});

test('physical stock and finished trips are required; harmless tracking refresh does not invalidate proof',async()=>{
 const f=await setupLiquidation();
 await f.client.query("insert into warehouses(id,name,kind) values('liq-wh','Kho kiểm thử','stock')");
 await f.db.update(salesOrders).set({warehouseId:'liq-wh'}).where(eq(salesOrders.id,'liq-order'));
 await f.db.update(salesOrderLines).set({sku:'SKU',deliveredQty:1}).where(eq(salesOrderLines.id,'liq-service'));
 let proof=(await f.call(f.path,f.emp)).data.proof;assert.equal(proof.checks.find((x:any)=>x.id==='delivery').ok,true);assert.equal(proof.checks.find((x:any)=>x.id==='stock').ok,false);
 await f.client.query("insert into stock_moves(id,sku,warehouse_id,qty,kind,ref_type,ref_id,created_by,created_at) values('liq-issue','SKU','liq-wh',-1,'issue','sales_order','liq-order','mgr','2026-10-31T01:00:00Z')");
 await f.db.insert(deliveries).values({id:'liq-trip',deliveryNo:'GH-DEMO',orderId:'liq-order',plannedDate:'2026-10-31',status:'in_transit',createdBy:'mgr',createdAt:f.stamp,updatedAt:f.stamp});
 assert.equal((await f.request()).status,409);
 await f.db.update(deliveries).set({status:'delivered',deliveredAt:f.stamp}).where(eq(deliveries.id,'liq-trip'));
 proof=(await f.call(f.path,f.emp)).data.proof;assert.equal(proof.ready,true);
 await f.db.update(deliveries).set({updatedAt:'2026-10-31T02:00:00Z',trackingUpdatedAt:'2026-10-31T02:00:00Z'}).where(eq(deliveries.id,'liq-trip'));
 assert.equal((await f.call(f.path,f.emp)).data.proof.hash,proof.hash);
 assert.equal((await f.request()).status,201);
 await f.db.update(salesOrders).set({status:'cancelled'}).where(eq(salesOrders.id,'liq-order'));
 const deleted=await f.call('/orders/liq-order',f.mgr,'DELETE');assert.equal(deleted.status,409);assert.equal(deleted.data.code,'CONTRACT_LIQUIDATION_HISTORY');
 const rls=await f.client.query<any>("select relrowsecurity from pg_class where relname='contract_liquidation_requests'");assert.equal(rls.rows[0].relrowsecurity,true);
});

test('lost database commit acknowledgement keeps original proof and retries without another request',async()=>{
 const f=await setupLiquidation(),proof=(await f.call(f.path,f.emp)).data.proof;
 const body={clientKey:crypto.randomUUID(),originalsReceived:true,servicesCompleted:true,photos:[proofPhoto],expectedHash:proof.hash};
 const original=f.db.transaction.bind(f.db);let throwOnce=true;
 f.db.transaction=(async(...args:any[])=>{const result=await (original as any)(...args);if(throwOnce){throwOnce=false;throw new Error('Synthetic lost commit reply');}return result;}) as typeof f.db.transaction;
 const first=await f.call(f.path,f.emp,'POST',body);assert.equal(first.status,500);assert.equal(f.files.files.size,1,'never delete committed evidence after unknown transaction outcome');
 const retry=await f.call(f.path,f.emp,'POST',body);assert.equal(retry.status,200);assert.equal(retry.data.replayed,true);assert.equal((await f.db.select().from(contractLiquidations)).length,1);assert.equal(f.files.files.size,1);
 f.db.transaction=original;
});

test('storage failure never records an evidence request; successful retry uses the same intent',async()=>{
 const f=await setupLiquidation(),put=f.files.put.bind(f.files);let fail=true;
 f.files.put=async(...args)=>{await put(...args);if(fail)throw new Error('Synthetic storage write failure');};
 const key=crypto.randomUUID();assert.equal((await f.request(key)).status,500);assert.equal((await f.db.select().from(contractLiquidations)).length,0);assert.equal(f.files.files.size,0);
 fail=false;assert.equal((await f.request(key)).status,201);assert.equal(f.files.files.size,1);
});

test('before manual migration, existing approvals remain usable and liquidation reports unavailable',async()=>{
 const f=await setupLiquidation();await f.client.query('drop table contract_liquidation_requests');
 const view=await f.call(f.path,f.emp);assert.equal(view.status,503);assert.equal(view.data.code,'LIQUIDATION_NOT_READY');
 assert.equal((await f.call('/approvals',f.mgr)).status,200);assert.equal((await f.call('/approvals?summary=1',f.mgr)).status,200);
});
