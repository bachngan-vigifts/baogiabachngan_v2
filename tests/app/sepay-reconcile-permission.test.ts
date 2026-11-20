import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setupSepay} from '../helpers/sepay-fixture.ts';
import {employees,positionPermissions} from '../../src/modules/staff/schema.ts';
import {posRegisters,webStoreOrders} from '../../src/modules/sales/pos-schema.ts';
import {warehouses} from '../../src/modules/catalog/schema.ts';
import {customerPayments} from '../../src/modules/sales/schema.ts';
import {sepayTransactions as bank} from '../../src/modules/integrations/schema.ts';
import {canReconcileSepay,canViewSepayDebits} from '../../src/modules/sales/domain/sepay-page.ts';

async function grant(f:Awaited<ReturnType<typeof setupSepay>>,positionId:string){
 await f.db.insert(positionPermissions).values(['page.sepay','sepay.reconcile-incoming'].map(permission=>({positionId,permission}))).onConflictDoNothing();
}
const list='/sepay/transactions?from=2026-11-08&to=2026-11-08';

test('reconcile permission is independent of viewing bank debits and external roles never acquire it',()=>{
 for(const positionId of ['sales-lock','sales-ml','sale-admin','accounting']){
  const m={role:'employee',positionId,perms:['page.sepay','sepay.reconcile-incoming']};
  assert.equal(canReconcileSepay(m),true);assert.equal(canViewSepayDebits(m),positionId==='accounting');
 }
 assert.equal(canReconcileSepay({role:'employee',perms:['page.sepay']}),false);
 assert.equal(canReconcileSepay({role:'employee',perms:['sepay.reconcile-incoming']}),false);
 for(const role of ['supplier','customer'])assert.equal(canReconcileSepay({role,perms:['page.sepay','sepay.reconcile-incoming']}),false);
});

test('NVBH reconciles an allowed order once; search, preview and forged confirmation block other owners; revocation is immediate',async()=>{
 const f=await setupSepay();await grant(f,'sales-lock');
 const mine=await f.order('STAFF_MY_ORDER'),other=await f.order('STAFF_OTHER_ORDER',{ownerId:'off',createdBy:'off',customerId:null});
 const e=await f.incoming('BANK_STAFF_PROOF');
 assert.equal((await f.call(list,f.emp)).data.capabilities.canConfirm,true);
 const found=await f.call('/sepay/orders?q=STAFF_',f.emp);assert.equal(found.status,200,JSON.stringify(found.data));
 assert.ok(found.data.orders.some((o:any)=>o.id===mine.id));assert.ok(!found.data.orders.some((o:any)=>o.id===other.id));
 assert.equal((await f.call('/sepay/orders/'+other.id+'?transactionId='+e.id,f.emp)).status,404);
 assert.equal((await f.confirm(e.id,f.choice(other.id),f.emp)).status,404);
 assert.equal((await f.db.select().from(customerPayments)).length,0);
 const preview=await f.call('/sepay/orders/'+mine.id+'?transactionId='+e.id,f.emp);assert.equal(preview.status,200,JSON.stringify(preview.data));assert.equal(preview.data.canCreate,true);
 const replies=await Promise.all([1,2].map(()=>f.confirm(e.id,f.choice(mine.id),f.emp)));
 assert.ok(replies.every(r=>r.status===200),JSON.stringify(replies));
 const receipts=await f.db.select().from(customerPayments);assert.equal(receipts.length,1);assert.equal(receipts[0]!.createdBy,'emp');
 await f.db.delete(positionPermissions).where(eq(positionPermissions.permission,'sepay.reconcile-incoming'));
 assert.equal((await f.call(list,f.emp)).data.capabilities.canConfirm,false);
 assert.equal((await f.call('/sepay/orders?q=STAFF',f.emp)).status,403);
 assert.equal((await f.confirm(e.id,f.choice(mine.id),f.emp)).status,403);
});

test('Sale Admin and Accounting reconcile incoming without obtaining void/admin privileges; staff cannot probe debit IDs',async()=>{
 const f=await setupSepay();
 for(const positionId of ['sale-admin','accounting']){
  await f.db.update(employees).set({positionId}).where(eq(employees.id,'emp'));await grant(f,positionId);
  const o=await f.order('STAFF_'+positionId,{ownerId:'off',createdBy:'off',customerId:null}),e=await f.incoming('BANK_'+positionId);
  const r=await f.confirm(e.id,f.choice(o.id),f.emp);assert.equal(r.status,200,JSON.stringify(r.data));
 }
 await f.db.update(employees).set({positionId:'sales-lock'}).where(eq(employees.id,'emp'));await grant(f,'sales-lock');
 const o=await f.order('STAFF_FOR_DEBIT');
 await f.db.insert(bank).values({id:'staff-private-debit',providerId:'staff-private-debit',transferType:'out',amount:777777,accountNumber:'123456',transactionAt:f.stamp,content:'PRIVATE DEBIT',status:'review',payload:'{}',receivedAt:f.stamp});
 const missing=await f.confirm('missing',f.choice(o.id),f.emp),hidden=await f.confirm('staff-private-debit',f.choice(o.id),f.emp);
 assert.equal(hidden.status,404);assert.deepEqual(hidden.data,missing.data);
 assert.equal((await f.call('/sepay/orders/'+o.id+'?transactionId=staff-private-debit',f.emp)).status,404);
 assert.equal((await f.call(list+'&direction=out',f.emp)).status,403);
 assert.equal((await f.call('/admin/sepay-transactions',f.emp)).status,403);
 assert.equal((await f.call('/admin/sepay-transactions/staff-private-debit/reconcile',f.emp,'POST',{})).status,403);
 assert.equal((await f.db.select().from(customerPayments)).length,2);
});


test('NVBH cannot search, preview or confirm a web order belonging to the other store',async()=>{
 const f=await setupSepay();await grant(f,'sales-lock');
 await f.db.update(warehouses).set({name:'Cửa hàng LocknLock'}).where(eq(warehouses.id,'pos-wh'));
 await f.db.insert(warehouses).values({id:'staff-ml-wh',name:'Showroom Minh Long',kind:'stock'});
 const register=(await f.db.select().from(posRegisters).where(eq(posRegisters.id,f.registerId)))[0]!;
 await f.db.insert(posRegisters).values({...register,id:'staff-ml-register',name:'Showroom Minh Long',warehouseId:'staff-ml-wh'});
 await f.db.insert(webStoreOrders).values([
  {id:'staff-web-lock',source:'lock',externalId:'101',orderNo:'SCOPE_WEB_LOCK',registerId:f.registerId,status:'processing',total:100000,orderedAt:f.stamp,updatedAt:f.stamp},
  {id:'staff-web-ml',source:'minhlong',externalId:'202',orderNo:'SCOPE_WEB_ML',registerId:'staff-ml-register',status:'processing',total:100000,orderedAt:f.stamp,updatedAt:f.stamp},
 ]);
 const found=await f.call('/sepay/orders?source=web&q=SCOPE_WEB',f.emp);assert.equal(found.status,200,JSON.stringify(found.data));
 assert.deepEqual(found.data.orders.map((o:any)=>o.id),['web:staff-web-lock']);
 const e=await f.incoming('BANK_WEB_SCOPE');
 assert.equal((await f.call('/sepay/orders/web:staff-web-ml?transactionId='+e.id,f.emp)).status,404);
 assert.equal((await f.confirm(e.id,f.choice('web:staff-web-ml'),f.emp)).status,404);
 assert.equal((await f.db.select().from(customerPayments)).length,0);
 const supervisor=await f.call('/sepay/orders?source=web&q=SCOPE_WEB',f.mgr);assert.equal(supervisor.data.orders.length,2);
});
