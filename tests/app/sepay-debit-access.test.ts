import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setupSepay} from '../helpers/sepay-fixture.ts';
import {sepayTransactions as bank} from '../../src/modules/integrations/schema.ts';
import {customerPayments} from '../../src/modules/sales/schema.ts';
import {canViewSepayDebits} from '../../src/modules/sales/domain/sepay-page.ts';
import {sepayEntityMap} from '../../src/modules/sales/domain/sepay-entities.ts';
import {parseSepayBankTransaction,parseSepayPayment} from '../../src/modules/integrations/domain/sepay-payment.ts';
import {retryNearbySepay} from '../../src/modules/sales/api/sepay-nearby-retry.ts';

test('debit access is hard limited to Manager and actual Accounting with page access; company configuration conflicts fail closed',()=>{
 assert.equal(canViewSepayDebits({role:'manager'}),true);
 assert.equal(canViewSepayDebits({role:'employee',positionId:'accounting'}),true);
 for(const m of [{role:'employee',positionId:'sale-admin',perms:['page.sepay']},{role:'employee',positionId:'custom',perms:['page.sepay']},{role:'employee',positionId:'accounting',perms:[]},{role:'supplier',perms:['page.sepay']},{role:'customer',perms:['page.sepay']}])assert.equal(canViewSepayDebits(m),false);
 const map=sepayEntityMap([{accountNumber:'123',accountName:'CÔNG TY TNHH SX TM BÁCH NGÂN'},{accountNumber:'123',accountName:'VIGIFTS'},{accountNumber:'123',accountName:'BACH NGAN'},{accountNumber:'OTHER',accountName:'Nội dung chuyển VIGIFTS'}]);
 const fee={id:'fee',transferType:'out',transferAmount:1000,accountNumber:'123456',content:'',transactionDate:'2026-11-08 10:00:00'};assert.equal(parseSepayBankTransaction(fee).transferType,'out');assert.throws(()=>parseSepayPayment(fee));
 assert.equal(map.get('123'),'unassigned');assert.equal(map.has('OTHER'),false);assert.equal(map.get('159063909'),'vigifts');
});
test('entity list/summary/detail enforce debit privacy, prevent inference/search and block every receipt path',async()=>{
 const f=await setupSepay();
 const user=(await f.call('/me',f.emp)).data.user,catalog=(await f.call('/permissions',f.mgr)).data,position=catalog.positions.find((p:any)=>p.id===user.positionId);
 assert.equal((await f.call('/permissions/positions/'+position.id,f.mgr,'PUT',{perms:[...new Set([...position.perms,'page.sepay'])]})).status,200);
 const incoming=await f.incoming('BN INCOMING',100000);
 await f.incoming('VG INCOMING',200000,{accountNumber:'159063909'});
 const debit=(id:string,accountNumber:string,amount:number)=>({id,providerId:'provider-'+id,transferType:'out',amount,accountNumber,transactionAt:f.stamp,content:'PRIVATE_DEBIT_'+id,status:'review' as const,payload:JSON.stringify({transferType:'out'}),receivedAt:f.stamp});
 await f.db.insert(bank).values([debit('bn-out','123456',888888),debit('vg-out','159063909',777777),{...debit('unknown','7777777',123),transferType:'in',content:'UNMAPPED INCOMING',transactionAt:'2026-11-08T02:00:00Z'}]);
 const base='/sepay/transactions?from=2026-11-08&to=2026-11-08';
 for(const cookie of [f.mgr,f.accountant]){
  const bn=await f.call(base+'&entity=bach-ngan&direction=all',cookie);assert.equal(bn.status,200);assert.equal(bn.data.summary.count,2);assert.equal(bn.data.summary.amount,100000);assert.equal(bn.data.summary.outgoingAmount,888888);assert.equal(bn.data.capabilities.canViewDebits,true);
  const vg=await f.call(base+'&entity=vigifts&direction=out',cookie);assert.equal(vg.data.transactions.length,1);assert.equal(vg.data.transactions[0].id,'vg-out');assert.equal(vg.data.summary.outgoingAmount,777777);
  const detail=await f.call('/sepay/transactions/bn-out',cookie);assert.equal(detail.status,200);assert.equal(detail.data.transaction.status,'debit');assert.equal(detail.data.capabilities.canConfirm,false);
 }
 const visible=await f.call(base,f.emp);assert.equal(visible.status,200);assert.equal(visible.data.summary.count,3);assert.ok(!JSON.stringify(visible.data).includes('PRIVATE_DEBIT'));assert.equal('outgoingAmount' in visible.data.summary,false);assert.equal('outgoingCount' in visible.data.summary,false);
 for(const direction of ['out','all'])assert.equal((await f.call(base+'&direction='+direction,f.emp)).status,403);
 const guessed=await f.call('/sepay/transactions/bn-out',f.emp),missing=await f.call('/sepay/transactions/not-existing',f.emp);assert.equal(guessed.status,404);assert.deepEqual(guessed.data,missing.data);
 const probe=await f.call(base+'&q=PRIVATE_DEBIT&account=123456&min=888888&max=888888',f.emp);assert.equal(probe.data.pagination.total,0);assert.equal(probe.data.summary.amount,0);
 const unknown=await f.call(base+'&entity=unassigned',f.mgr);assert.deepEqual(unknown.data.transactions.map((r:any)=>r.id),['unknown']);
 assert.equal((await f.call(base+'&entity=vigifts&account=123456',f.mgr)).data.pagination.total,0);
 assert.equal((await f.call(base+'&entity=bad',f.mgr)).status,400);
 const order=await f.order('NO_DEBIT_RECEIPT');
 assert.equal((await f.confirm('bn-out',f.choice(order.id))).status,409);
 assert.equal((await f.call('/sepay/orders/'+order.id+'?transactionId=bn-out',f.mgr)).status,409);
 assert.equal((await f.call('/admin/sepay-transactions/bn-out/reconcile',f.mgr,'POST',{})).status,400);
 assert.equal((await f.db.select().from(customerPayments)).length,0);
 // Debit metadata must never enter the incoming retry worker, even with an invalid receipt payload.
 f.env.nowSec=()=>Date.parse('2026-11-08T03:10:00Z')/1000;
 await retryNearbySepay(f.env);
 assert.equal((await f.db.select().from(bank).where(eq(bank.id,incoming.id))).length,1);
});
test('pull imports outgoing as read-only bank evidence, deduplicates it, hides counts from delegated viewers and rolls back conflicts',async()=>{
 const f=await setupSepay();f.env.nowSec=()=>Date.parse('2026-11-09T00:00:00Z')/1000;f.env.sepayApiToken='TEST_SEPAY_DEBIT_ONLY_TOKEN';
 const raw={id:'debit-provider-id',account_number:'123456',transaction_date:'2026-11-09 10:00:00',amount_in:'0.00',amount_out:'5000.00',transaction_content:'Trả tiền NCC'};
 f.env.sepayApiFetch=async input=>Response.json(String(input).includes('/count')?{status:200,count_transactions:1}:{status:200,transactions:[raw]});
 const disabled=await f.call('/sepay/pull-today',f.mgr,'POST',{});assert.equal(disabled.status,200);assert.equal((await f.db.select().from(bank)).length,0,'default-off rollout does not expose new debit rows to older API workers');
 f.env.sepayDebitImportEnabled=true;
 const concurrent=await Promise.all([f.call('/sepay/pull-today',f.mgr,'POST',{}),f.call('/sepay/pull-today',f.mgr,'POST',{})]);assert.ok(concurrent.every(r=>r.status===200));
 const records=await f.db.select().from(bank);assert.equal(records.length,1);assert.equal(records[0]!.transferType,'out');assert.equal(records[0]!.orderId,null);assert.equal(records[0]!.paymentId,null);assert.equal((await f.db.select().from(customerPayments)).length,0);
 const user=(await f.call('/me',f.emp)).data.user,catalog=(await f.call('/permissions',f.mgr)).data,position=catalog.positions.find((p:any)=>p.id===user.positionId);
 await f.call('/permissions/positions/'+position.id,f.mgr,'PUT',{perms:[...new Set([...position.perms,'page.sepay'])]});
 const delegated=await f.call('/sepay/pull-today',f.emp,'POST',{});assert.equal(delegated.status,200);assert.equal('outgoing' in delegated.data,false);assert.equal(delegated.data.read,0);
 raw.amount_out='7000.00';assert.equal((await f.call('/sepay/pull-today',f.mgr,'POST',{})).status,409);assert.equal((await f.db.select().from(bank))[0]!.amount,5000);
});
