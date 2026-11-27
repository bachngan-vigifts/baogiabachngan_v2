import {test} from 'node:test';
import assert from 'node:assert/strict';
import {and,eq} from 'drizzle-orm';
import {setupSepay} from '../helpers/sepay-fixture.ts';
import {customerPayments} from '../../src/modules/sales/schema.ts';
import {positionPermissions} from '../../src/modules/staff/schema.ts';
import {netReceivables} from '../../src/modules/sales/api/pos-return-credit.ts';
import {PERMISSIONS} from '../../src/modules/staff/domain/permissions.ts';
import {canReplaceSepayReceipt} from '../../src/modules/sales/api/sepay-reconcile-access.ts';

const grant=async(f:any,perms:string[])=>{
 await f.db.delete(positionPermissions).where(eq(positionPermissions.positionId,'accounting'));
 await f.db.insert(positionPermissions).values(perms.map(permission=>({positionId:'accounting',permission}))).onConflictDoNothing();
};

test('narrow SePay grant replaces a mis-keyed receipt without the general void right',async()=>{
 const f=await setupSepay(),o=await f.order('REPLACE_NARROW',{id:'0-narrow'}),e=await f.incoming('SHORT_NARROW',99950),path=`/sepay/transactions/${e.id}/allocations`;
 await f.db.insert(customerPayments).values({id:'narrow-receipt',orderId:o.id,amount:100000,method:'transfer',paidAt:'2026-11-08',paymentSource:'manual',createdBy:'mgr',createdAt:f.stamp});
 const payload={clientKey:crypto.randomUUID(),expectedRevision:0,lines:[{targetId:o.id,amount:99950,expectedAmount:100000,differenceConfirmed:true,existingPaymentId:'narrow-receipt'}]};
 const before=await f.db.select().from(customerPayments);

 await grant(f,['page.sepay','sepay.reconcile-incoming']);
 const summary=(await f.call(path,f.accountant)).data;
 assert.equal(summary.canReplaceReceipt,false);assert.equal(summary.canVoid,false);
 const denied=await f.call(path,f.accountant,'POST',payload);
 assert.equal(denied.status,403,JSON.stringify(denied.data));
 assert.deepEqual(await f.db.select().from(customerPayments),before,'denied request writes nothing');

 await grant(f,['page.sepay','sepay.reconcile-incoming','sepay.replace-mismatch-receipt']);
 const allowed=(await f.call(path,f.accountant)).data;
 assert.equal(allowed.canReplaceReceipt,true);assert.equal(allowed.canVoid,false,'narrow grant does not expose unallocate');
 for(let i=0;i<2;i++){const r=await f.call(path,f.accountant,'POST',payload);assert.equal(r.status,200,JSON.stringify(r.data));}
 const rows=await f.db.select().from(customerPayments);
 assert.equal(rows.length,2,'replay creates no second replacement');
 assert.ok(rows.find(p=>p.id==='narrow-receipt')!.voidedAt,'original receipt kept as voided history');
 assert.equal(rows.find(p=>!p.voidedAt)!.amount,99950);
 assert.equal((await netReceivables(f.db,[o.id],'2026-11-08')).get(o.id)!.balance,50,'shortfall stays as debt');

 const d=(await f.call(path,f.accountant)).data;
 const unallocate=await f.call(path+'/'+d.allocations[0].id+'/void',f.accountant,'POST',{expectedRevision:d.revision,reason:'Thử gỡ'});
 assert.equal(unallocate.status,403,'narrow grant cannot remove allocations');
 assert.equal((await f.db.select().from(customerPayments).where(and(eq(customerPayments.orderId,o.id)))).filter(p=>!p.voidedAt).length,1);
});

test('narrow grant needs SePay reconcile access and has no default cohort',()=>{
 assert.deepEqual(PERMISSIONS.find(p=>p.key==='sepay.replace-mismatch-receipt')!.defaults,[]);
 assert.equal(canReplaceSepayReceipt({role:'employee',positionId:'sale',perms:['sepay.replace-mismatch-receipt']} as any),false);
 assert.equal(canReplaceSepayReceipt({role:'employee',positionId:'sale',perms:['page.sepay','sepay.reconcile-incoming','sepay.replace-mismatch-receipt']} as any),true);
 assert.equal(canReplaceSepayReceipt({role:'employee',positionId:'sale',perms:['payments.void']} as any),true);
 for(const role of ['supplier','customer'])assert.equal(canReplaceSepayReceipt({role,perms:['page.sepay','sepay.reconcile-incoming','sepay.replace-mismatch-receipt']} as any),false);
});
