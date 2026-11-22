// REPORT ONLY: documents current broad scope; no permission policy change. Await Anh Thái's decision.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setupSepay} from '../helpers/sepay-fixture.ts';
import {employees,positionPermissions} from '../../src/modules/staff/schema.ts';
import {posRegisters,webStoreOrders} from '../../src/modules/sales/pos-schema.ts';
import {sepayTransactions} from '../../src/modules/integrations/schema.ts';
import {warehouses} from '../../src/modules/catalog/schema.ts';
import {PERMISSIONS} from '../../src/modules/staff/domain/permissions.ts';
import {canReconcileSepay} from '../../src/modules/sales/domain/sepay-page.ts';
test('audit E1: employee without store assignment and with explicit reconcile grant can search/confirm both stores today',async()=>{
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
 const result=await f.call('/sepay/orders?source=web&q=AUDIT_SCOPE',f.emp);assert.equal(result.status,200,JSON.stringify(result.data));
 assert.deepEqual(result.data.orders.map((o:any)=>o.id).sort(),['web:audit-lock','web:audit-ml']);
 for(const id of ['audit-lock','audit-ml']){
  const incoming=await f.incoming('AUDIT_BANK_'+id);
  assert.equal((await f.call('/sepay/orders/web:'+id+'?transactionId='+incoming.id,f.emp)).status,200);
  const confirm=await f.confirm(incoming.id,f.choice('web:'+id),f.emp);assert.equal(confirm.status,200,JSON.stringify(confirm.data));
  const [saved]=await f.db.select().from(sepayTransactions).where(eq(sepayTransactions.id,incoming.id));assert.equal(saved!.status,'matched');assert.equal(saved!.webOrderId,id,'thực sự gán giao dịch đúng đơn ngoài phạm vi cửa hàng');
 }
 assert.deepEqual(PERMISSIONS.find(p=>p.key==='sepay.reconcile-incoming')!.defaults,[],'no default employee cohort');
 assert.equal(canReconcileSepay({role:'manager'}),true);
 for(const positionId of ['sale-admin','accounting','sales-lock','sales-ml'])assert.equal(canReconcileSepay({role:'employee',positionId}),false,'requires explicit grant: '+positionId);
});
