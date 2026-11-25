import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {eq} from 'drizzle-orm';
import {setupSepay} from '../helpers/sepay-fixture.ts';
import {customerPayments} from '../../src/modules/sales/schema.ts';
import {netReceivables} from '../../src/modules/sales/api/pos-return-credit.ts';
import {webStoreOrders} from '../../src/modules/sales/pos-schema.ts';
import {sepayTransactions} from '../../src/modules/integrations/schema.ts';
for(const delta of [-200,200,1500])test('manual reconciliation preserves bank and actual receipts; difference '+delta,async()=>{
 const f=await setupSepay(),a=await f.order('DIFF_A'),b=await f.order('DIFF_B'),e=await f.incoming('MANUAL_DIFFERENCE',200000+delta),path=`/sepay/transactions/${e.id}/allocations`;
 const payload={clientKey:crypto.randomUUID(),expectedRevision:0,lines:[{targetId:a.id,amount:100000},{targetId:b.id,amount:100000+delta,expectedAmount:100000,differenceConfirmed:true}]};
 if(delta!==0){assert.equal((await f.call(path,f.mgr,'POST',{...payload,lines:payload.lines.map(l=>({...l,differenceConfirmed:false}))})).status,400);assert.equal((await f.db.select().from(customerPayments)).length,0);}
 for(let i=0;i<2;i++){const r=await f.call(path,f.mgr,'POST',payload);assert.equal(r.status,200,JSON.stringify(r.data));}
 const detail=(await f.call(path,f.mgr)).data;assert.equal(detail.remaining,0);assert.equal(detail.allocations.reduce((n:number,a:any)=>n+a.difference,0),delta);
 const receipts=await f.db.select().from(customerPayments);assert.equal(receipts.length,2);assert.equal(receipts.reduce((n,p)=>n+p.amount,0),200000+delta);assert.equal((await f.db.select().from(sepayTransactions).where(eq(sepayTransactions.id,e.id)))[0]!.amount,200000+delta);
 if(delta===200){
  const before=(await f.call(path,f.mgr)).data,receiptsBefore=await f.db.select().from(customerPayments);
  await f.client.exec(readFileSync(new URL('../../migrations/postgres/20261125113000_sepay_allocation_overpayment.sql',import.meta.url),'utf8'));
  await f.client.exec('BEGIN READ ONLY');await f.client.exec(readFileSync(new URL('../../scripts/sql/assert-sepay-overpayment.sql',import.meta.url),'utf8'));await f.client.exec('ROLLBACK');
  assert.deepEqual((await f.call(path,f.mgr)).data,before,'rerunning migration preserves overpayment history');
  // Fixture only: demonstrate why code rollback must retain the expanded constraint.
  await f.client.exec('BEGIN; ALTER TABLE sepay_payment_allocations DROP CONSTRAINT chk_sepay_allocation_amount;');
  await assert.rejects(f.client.exec('ALTER TABLE sepay_payment_allocations ADD CONSTRAINT chk_sepay_allocation_amount CHECK (amount>0 AND target_total>=amount);'));
  await f.client.exec('ROLLBACK');
  assert.deepEqual((await f.call(path,f.mgr)).data,before);
  assert.deepEqual(await f.db.select().from(customerPayments),receiptsBefore);
 }
 const debt=(await netReceivables(f.db,[b.id],'2026-11-08')).get(b.id)!;assert.equal(debt.balance,-delta);
});
test('existing receipt correction preserves original history, records actual debt and replays once',async()=>{
 const f=await setupSepay(),o=await f.order('DIFF_RECEIPT',{id:'0-receipt-order'}),e=await f.incoming('SHORT_RECEIPT',99950),path=`/sepay/transactions/${e.id}/allocations`;
 await f.db.insert(customerPayments).values({id:'diff-receipt',orderId:o.id,amount:100000,method:'transfer',paidAt:'2026-11-08',paymentSource:'manual',createdBy:'mgr',createdAt:f.stamp});
 const before=await f.db.select().from(customerPayments),payload={clientKey:crypto.randomUUID(),expectedRevision:0,lines:[{targetId:o.id,amount:99950,expectedAmount:100000,differenceConfirmed:true,existingPaymentId:'diff-receipt'}]};
 assert.equal((await f.call(path,f.mgr,'POST',{...payload,lines:payload.lines.map(l=>({...l,expectedAmount:99950}))})).status,409);
 const invalid=await f.order('DIFF_INVALID',{id:'z-invalid'});
 assert.equal((await f.call(path,f.mgr,'POST',{...payload,lines:[{...payload.lines[0],amount:99949},{targetId:invalid.id,amount:1,expectedAmount:300000,differenceConfirmed:true}]})).status,409);
 assert.deepEqual(await f.db.select().from(customerPayments),before,'failed later row rolls back original receipt void/replacement');
 assert.equal((await f.call(path,f.accountant,'POST',payload)).status,403);
 assert.deepEqual(await f.db.select().from(customerPayments),before);
 for(let i=0;i<2;i++){const r=await f.call(path,f.mgr,'POST',payload);assert.equal(r.status,200,JSON.stringify(r.data));}
 const d=(await f.call(path,f.mgr)).data;assert.equal(d.allocations[0].difference,-50);assert.equal(d.remaining,0);const corrected=await f.db.select().from(customerPayments);assert.equal(corrected.length,2);assert.equal(corrected.find(p=>p.id==='diff-receipt')!.amount,100000);assert.ok(corrected.find(p=>p.id==='diff-receipt')!.voidedAt);assert.equal(corrected.find(p=>!p.voidedAt)!.amount,99950);assert.equal((await netReceivables(f.db,[o.id],'2026-11-08')).get(o.id)!.balance,50);
 assert.equal((await f.call(path,f.mgr,'POST',{...payload,lines:payload.lines.map(l=>({...l,amount:99900}))})).status,409);
 assert.equal((await f.call(path+'/'+d.allocations[0].id+'/void',f.mgr,'POST',{expectedRevision:d.revision,reason:'Đối chiếu lại khoản thiếu'})).status,200);assert.equal((await netReceivables(f.db,[o.id],'2026-11-08')).get(o.id)!.balance,100000);
});

for(const delta of [-200,200])test('website debt and credit retain actual bank amount '+delta,async()=>{
 const f=await setupSepay(),id='web-difference';
 await f.db.insert(webStoreOrders).values({id,source:'lock',externalId:id,orderNo:'WEB_DIFF',registerId:f.registerId,status:'on-hold',total:100000,currency:'VND',orderedAt:f.stamp,updatedAt:f.stamp});
 const e=await f.incoming('WEB_CREDIT_BANK',100000+delta),path=`/sepay/transactions/${e.id}/allocations`;
 const r=await f.call(path,f.mgr,'POST',{clientKey:crypto.randomUUID(),expectedRevision:0,lines:[{targetId:'web:'+id,amount:100000+delta,expectedAmount:100000,differenceConfirmed:true,paymentReviewed:true}]});assert.equal(r.status,200,JSON.stringify(r.data));
 const d=(await f.call('/orders/web:'+id,f.mgr)).data.document;assert.equal(d.paid,100000+delta);assert.equal(d.receivable.balance,-delta);assert.equal(d.overpaid,Math.max(0,delta));assert.equal(d.outstanding,Math.max(0,-delta));assert.equal((await f.db.select().from(customerPayments)).length,0);
});
