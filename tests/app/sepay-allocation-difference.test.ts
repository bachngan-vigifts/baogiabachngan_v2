import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setupSepay} from '../helpers/sepay-fixture.ts';
import {customerPayments} from '../../src/modules/sales/schema.ts';
import {sepayTransactions} from '../../src/modules/integrations/schema.ts';
for(const delta of [-200,200])test('manual reconciliation preserves bank and actual receipts; difference '+delta,async()=>{
 const f=await setupSepay(),a=await f.order('DIFF_A'),b=await f.order('DIFF_B'),e=await f.incoming('MANUAL_DIFFERENCE',200000+delta),path=`/sepay/transactions/${e.id}/allocations`;
 const payload={clientKey:crypto.randomUUID(),expectedRevision:0,lines:[{targetId:a.id,amount:100000},{targetId:b.id,amount:100000+Math.min(0,delta),expectedAmount:100000,differenceConfirmed:true}]};
 if(delta<0){assert.equal((await f.call(path,f.mgr,'POST',{...payload,lines:payload.lines.map(l=>({...l,differenceConfirmed:false}))})).status,400);assert.equal((await f.db.select().from(customerPayments)).length,0);}
 for(let i=0;i<2;i++){const r=await f.call(path,f.mgr,'POST',payload);assert.equal(r.status,200,JSON.stringify(r.data));}
 const detail=(await f.call(path,f.mgr)).data;assert.equal(detail.remaining,Math.max(0,delta));assert.equal(detail.allocations.reduce((n:number,a:any)=>n+a.difference,0),Math.min(0,delta));
 const receipts=await f.db.select().from(customerPayments);assert.equal(receipts.length,2);assert.equal(receipts.reduce((n,p)=>n+p.amount,0),200000+Math.min(0,delta));assert.equal((await f.db.select().from(sepayTransactions).where(eq(sepayTransactions.id,e.id)))[0]!.amount,200000+delta);
 const candidates=(await f.call(`/sepay/transactions/${e.id}/allocation-candidates?q=DIFF_B`,f.mgr)).data.candidates;
 if(delta<0)assert.equal(candidates[0].outstanding,200);
});
test('existing receipt can link a short bank amount with explicit difference; source receipt is never rewritten or duplicated',async()=>{
 const f=await setupSepay(),o=await f.order('DIFF_RECEIPT'),e=await f.incoming('SHORT_RECEIPT',99950),path=`/sepay/transactions/${e.id}/allocations`;
 await f.db.insert(customerPayments).values({id:'diff-receipt',orderId:o.id,amount:100000,method:'transfer',paidAt:'2026-11-08',paymentSource:'manual',createdBy:'mgr',createdAt:f.stamp});
 const before=await f.db.select().from(customerPayments),payload={clientKey:crypto.randomUUID(),expectedRevision:0,lines:[{targetId:o.id,amount:99950,expectedAmount:100000,differenceConfirmed:true,existingPaymentId:'diff-receipt'}]};
 assert.equal((await f.call(path,f.mgr,'POST',{...payload,lines:payload.lines.map(l=>({...l,expectedAmount:99950}))})).status,409);
 for(let i=0;i<2;i++){const r=await f.call(path,f.mgr,'POST',payload);assert.equal(r.status,200,JSON.stringify(r.data));}
 const d=(await f.call(path,f.mgr)).data;assert.equal(d.allocations[0].difference,-50);assert.equal(d.remaining,0);assert.deepEqual(await f.db.select().from(customerPayments),before);
 assert.equal((await f.call(path,f.mgr,'POST',{...payload,lines:payload.lines.map(l=>({...l,amount:99900}))})).status,409);
 assert.equal((await f.call(path+'/'+d.allocations[0].id+'/void',f.mgr,'POST',{expectedRevision:d.revision,reason:'Đối chiếu lại khoản thiếu'})).status,200);assert.deepEqual(await f.db.select().from(customerPayments),before);
});
