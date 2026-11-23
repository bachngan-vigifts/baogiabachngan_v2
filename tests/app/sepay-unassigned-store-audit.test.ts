// E1: unassigned staff must receive an explicit all-stores grant before accessing web orders.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {and,eq} from 'drizzle-orm';
import {setupSepay} from '../helpers/sepay-fixture.ts';
import {employees,positionPermissions} from '../../src/modules/staff/schema.ts';
import {posRegisters,webStoreOrders} from '../../src/modules/sales/pos-schema.ts';
import {sepayTransactions} from '../../src/modules/integrations/schema.ts';
import {warehouses} from '../../src/modules/catalog/schema.ts';
import {PERMISSIONS} from '../../src/modules/staff/domain/permissions.ts';
import {canReconcileSepay} from '../../src/modules/sales/domain/sepay-page.ts';
async function scopeFixture(){
 const f=await setupSepay();await f.db.update(employees).set({positionId:'sale-admin'}).where(eq(employees.id,'emp'));
 await f.db.insert(positionPermissions).values(['page.sepay','sepay.reconcile-incoming'].map(permission=>({positionId:'sale-admin',permission}))).onConflictDoNothing();
 await f.db.update(warehouses).set({name:'Cửa hàng LocknLock'}).where(eq(warehouses.id,'pos-wh'));
 await f.db.insert(warehouses).values({id:'audit-ml',name:'Showroom Minh Long',kind:'stock'});
 const [register]=await f.db.select().from(posRegisters).where(eq(posRegisters.id,f.registerId));
 await f.db.insert(posRegisters).values({...register!,id:'audit-ml-register',name:'Showroom Minh Long',warehouseId:'audit-ml'});
 await f.db.insert(webStoreOrders).values([
  {id:'audit-lock',source:'lock',externalId:'111',orderNo:'AUDIT_SCOPE_LOCK',registerId:f.registerId,status:'processing',paymentMethod:'QR',total:100000,orderedAt:f.stamp,updatedAt:f.stamp},
  {id:'audit-ml',source:'minhlong',externalId:'222',orderNo:'AUDIT_SCOPE_ML',registerId:'audit-ml-register',status:'processing',paymentMethod:'QR',total:100000,orderedAt:f.stamp,updatedAt:f.stamp},
 ]);
 return f;
}
test('E1: unassigned staff cannot search, preview or confirm web orders; CRM scope stays unchanged',async()=>{
 const f=await scopeFixture();
 const result=await f.call('/sepay/orders?source=web&q=AUDIT_SCOPE',f.emp);assert.equal(result.status,200,JSON.stringify(result.data));
 assert.deepEqual(result.data.orders,[]);
 assert.equal(result.data.webOrderScope,'unassigned');assert.match(result.data.webOrderScopeMessage,/Chưa được phân cửa hàng/);
 for(const id of ['audit-lock','audit-ml']){
  const incoming=await f.incoming('AUDIT_BANK_'+id);
  const hidden=await f.call('/sepay/orders/web:'+id+'?transactionId='+incoming.id,f.emp),missing=await f.call('/sepay/orders/web:missing?transactionId='+incoming.id,f.emp);
  assert.equal(hidden.status,404);assert.deepEqual(hidden.data,missing.data);
  assert.equal((await f.confirm(incoming.id,f.choice('web:'+id),f.emp)).status,404);
  const [saved]=await f.db.select().from(sepayTransactions).where(eq(sepayTransactions.id,incoming.id));assert.notEqual(saved!.status,'matched');assert.equal(saved!.webOrderId,null);
 }
 const crm=await f.order('E1_CRM_UNCHANGED'),incoming=await f.incoming('E1_CRM_PROOF');
 assert.equal((await f.call('/sepay/orders/'+crm.id+'?transactionId='+incoming.id,f.emp)).status,200);
 assert.equal((await f.confirm(incoming.id,f.choice(crm.id),f.emp)).status,200);
 assert.deepEqual(PERMISSIONS.find(p=>p.key==='sepay.reconcile-incoming')!.defaults,[],'no default employee cohort');
 assert.equal(canReconcileSepay({role:'manager'}),true);
 for(const positionId of ['sale-admin','accounting','sales-lock','sales-ml'])assert.equal(canReconcileSepay({role:'employee',positionId}),false,'requires explicit grant: '+positionId);
});
test('E1: explicit all-stores permission grants both stores; revocation blocks the next request including replay',async()=>{
 const f=await scopeFixture();await f.db.insert(positionPermissions).values({positionId:'sale-admin',permission:'sepay.reconcile-all-stores'});
 const result=await f.call('/sepay/orders?source=web&q=AUDIT_SCOPE',f.emp);assert.equal(result.status,200,JSON.stringify(result.data));assert.deepEqual(result.data.orders.map((o:any)=>o.id).sort(),['web:audit-lock','web:audit-ml']);
 const events=[];
 for(const id of ['audit-lock','audit-ml']){const incoming=await f.incoming('E1_ALL_'+id);events.push(incoming);
  assert.equal((await f.call('/sepay/orders/web:'+id+'?transactionId='+incoming.id,f.emp)).status,200);
  assert.equal((await f.confirm(incoming.id,f.choice('web:'+id),f.emp)).status,200);
 }
 await f.db.delete(positionPermissions).where(and(eq(positionPermissions.positionId,'sale-admin'),eq(positionPermissions.permission,'sepay.reconcile-all-stores')));
 assert.deepEqual((await f.call('/sepay/orders?source=web&q=AUDIT_SCOPE',f.emp)).data.orders,[]);
 assert.equal((await f.call('/sepay/orders/web:audit-lock?transactionId='+events[0]!.id,f.emp)).status,404);
 assert.equal((await f.confirm(events[0]!.id,f.choice('web:audit-lock'),f.emp)).status,404);
 for(const e of events)assert.equal((await f.call('/sepay/transactions/'+e.id,f.emp)).status,404);
 const crm=await f.order('E1_NO_PROBE');assert.equal((await f.confirm(events[0]!.id,f.choice(crm.id),f.emp)).status,404,'ID giao dịch đã gắn đơn web ngoài phạm vi cũng bị ẩn');
 const list=await f.call('/sepay/transactions?from=2026-11-08&to=2026-11-08',f.emp);assert.equal(list.status,200);assert.equal(list.data.transactions.length,0);assert.equal(list.data.summary.count,0);
});
test('E1: Lock/ML staff see only their store, Manager sees all; forged IDs and linked bank detail are hidden',async()=>{
 const f=await scopeFixture();const ml=await f.incoming('E1_LINKED_ML');assert.equal((await f.confirm(ml.id,f.choice('web:audit-ml'))).status,200);
 for(const [positionId,allowed,denied]of [['sales-lock','audit-lock','audit-ml'],['sales-ml','audit-ml','audit-lock']]){
  await f.db.update(employees).set({positionId}).where(eq(employees.id,'emp'));
  await f.db.insert(positionPermissions).values(['page.sepay','sepay.reconcile-incoming'].map(permission=>({positionId:positionId!,permission}))).onConflictDoNothing();
  const found=await f.call('/sepay/orders?source=web&q=AUDIT_SCOPE',f.emp);assert.deepEqual(found.data.orders.map((o:any)=>o.id),['web:'+allowed]);
  const e=await f.incoming('E1_FORGED_'+positionId);
  assert.equal((await f.call('/sepay/orders/web:'+denied+'?transactionId='+e.id,f.emp)).status,404);assert.equal((await f.confirm(e.id,f.choice('web:'+denied),f.emp)).status,404);
  assert.equal((await f.call('/sepay/transactions/'+ml.id,f.emp)).status,positionId==='sales-ml'?200:404);
 }
 assert.equal((await f.call('/sepay/orders?source=web&q=AUDIT_SCOPE',f.mgr)).data.orders.length,2);
 assert.equal((await f.call('/sepay/transactions/'+ml.id,f.mgr)).status,200);
 const permissions=(await f.call('/permissions',f.mgr)).data;
 const definition=PERMISSIONS.find(p=>p.key==='sepay.reconcile-all-stores');assert.ok(definition);assert.deepEqual(definition.defaults,[]);
 assert.ok(JSON.stringify(permissions).includes('Đối soát thu toàn công ty (mọi cửa hàng)'));
});
