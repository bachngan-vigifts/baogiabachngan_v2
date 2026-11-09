import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setupSepay} from '../helpers/sepay-fixture.ts';
import {sepayTransactions} from '../../src/modules/integrations/schema.ts';
import {netReceivables} from '../../src/modules/sales/api/pos-return-credit.ts';
import {customerPayments} from '../../src/modules/sales/schema.ts';
import {readSepayDay, SEPAY_READ_LIMIT} from '../../src/modules/integrations/api/sepay-read.ts';

const token='TEST_SEPAY_READ_TOKEN_ONLY',day='2026-11-09';
const row=(id='123456789',extra:Record<string,unknown>={})=>({id,account_number:'123456',transaction_date:day+' 00:30:00',amount_in:'100000.00',amount_out:'0.00',transaction_content:'CRM_READ_001',...extra});
function provider(rows:Record<string,unknown>[],seen:string[]=[]):typeof fetch {
 return async(input,init)=>{const u=new URL(String(input));seen.push(u.href);
  assert.equal(u.origin,'https://my.sepay.vn');assert.ok(['/userapi/transactions/list','/userapi/transactions/count'].includes(u.pathname));
  assert.equal(u.searchParams.get('transaction_date_min'),day);assert.equal(u.searchParams.get('transaction_date_max'),day);
  assert.equal(u.searchParams.get('limit'),String(SEPAY_READ_LIMIT));assert.equal(init?.method,'GET');assert.equal(init?.redirect,'error');
  assert.equal(new Headers(init?.headers).get('authorization'),'Bearer '+token);assert.equal(new Headers(init?.headers).get('cookie'),null);
  return Response.json(u.pathname.endsWith('/count')?{status:200,count_transactions:String(rows.length)}:{status:200,transactions:rows});
 };
}
test('today pull checks permissions, uses VN day and imports pending once without changing receipts/debt',async()=>{
 const f=await setupSepay(),calls:string[]=[];f.env.nowSec=()=>Date.parse(day+'T00:00:00+07:00')/1000;f.env.sepayApiToken=token;
 const order=await f.order('CRM_READ_001');const beforeDebt=await netReceivables(f.db,[order.id],day);f.env.sepayApiFetch=provider([row(),row('123456790',{amount_in:'0.00',amount_out:'5000.00'})],calls);
 for(const session of [f.emp,f.ncc,''])assert.ok([401,403].includes((await f.call('/sepay/pull-today',session,'POST',{})).status));
 assert.equal(calls.length,0);
 assert.equal((await f.call('/sepay/pull-today',f.mgr,'POST',{date:'2020-01-01'})).status,400);assert.equal(calls.length,0);
 const first=await f.call('/sepay/pull-today',f.mgr,'POST',{});assert.equal(first.status,200,JSON.stringify(first.data));
 assert.deepEqual(first.data,{day,read:2,outgoing:1,imported:1,duplicate:0,receiptsCreated:0});
 const [stored]=await f.db.select().from(sepayTransactions);assert.equal(stored!.status,'review');assert.equal(stored!.transactionAt,'2026-11-08T17:30:00.000Z');assert.equal(stored!.paymentId,null);
 const repeat=await f.call('/sepay/pull-today',f.other,'POST',{});assert.equal(repeat.status,200,JSON.stringify(repeat.data));assert.equal(repeat.data.imported,0);assert.equal(repeat.data.duplicate,1);
 assert.equal((await f.db.select().from(sepayTransactions)).length,1);assert.equal((await f.db.select().from(customerPayments)).length,0);
 assert.deepEqual(await netReceivables(f.db,[order.id],day),beforeDebt,'a read/import must leave all receivable fields unchanged');
 const list=await f.call('/sepay/transactions?from='+day+'&to='+day,f.other);assert.equal(list.data.summary.pendingAmount,100000);assert.equal(list.data.capabilities.canPull,true);assert.ok(!JSON.stringify(list.data).includes(token));
 // An entire batch rolls back on conflicting ID; an earlier pending import stays unchanged.
 f.env.sepayApiFetch=provider([row('fresh'),row('123456789',{amount_in:'200000'})]);
 assert.equal((await f.call('/sepay/pull-today',f.mgr,'POST',{})).status,409);assert.equal((await f.db.select().from(sepayTransactions)).length,1);
 delete f.env.sepayApiToken;assert.equal((await f.call('/sepay/pull-today',f.mgr,'POST',{})).status,503);
 // Existing Manager confirmation can consume the normalized API proof; import itself did not post it.
 assert.equal((await f.confirm(stored!.id,f.choice(order.id),f.other)).status,403);
 assert.equal((await f.confirm(stored!.id,f.choice(order.id))).status,200);
 assert.equal((await f.db.select().from(customerPayments)).length,1);
 f.env.sepayApiToken=token;f.env.sepayApiFetch=provider([row()]);
 assert.equal((await f.call('/sepay/pull-today',f.mgr,'POST',{})).data.duplicate,1);
 assert.equal((await f.db.select().from(customerPayments)).length,1);
 assert.equal((await f.db.select().from(sepayTransactions))[0]!.status,'matched');
});
test('pull preserves matched/voided existing receipts and rejects conflicting payloads',async()=>{
 const f=await setupSepay();f.env.nowSec=()=>Date.parse(day+'T00:00:00Z')/1000;f.env.sepayApiToken=token;
 await f.order('CRM_READ_001');const event=await f.incoming('CRM_READ_001',100000,{id:'same-id',transactionDate:day+' 00:30:00'});
 f.env.sepayApiFetch=provider([row('same-id')]);
 assert.equal((await f.call('/sepay/pull-today',f.mgr,'POST',{})).data.duplicate,1);
 const before=(await f.db.select().from(sepayTransactions))[0]!;assert.equal(before.status,'matched');
 await f.db.update(customerPayments).set({voidedAt:new Date().toISOString(),voidedBy:'mgr',voidReason:'Void test'}).where(eq(customerPayments.id,before.paymentId!));
 assert.equal((await f.call('/sepay/pull-today',f.mgr,'POST',{})).data.duplicate,1);
 assert.equal((await f.db.select().from(customerPayments)).length,1);assert.equal((await f.db.select().from(sepayTransactions))[0]!.paymentId,event.paymentId);
});
test('provider errors, malformed/oversized/truncated results never become successful empty imports or leak a token',async()=>{
 await assert.rejects(readSepayDay('',day,provider([])),/Chưa cấu hình/);
 for(const status of [401,403,429,500])await assert.rejects(readSepayDay(token,day,async()=>new Response(token,{status})),e=>e instanceof Error&&!e.message.includes(token));
 await assert.rejects(readSepayDay(token,day,async()=>new Response('x'.repeat(3_000_001))),/quá lớn/);
 await assert.rejects(readSepayDay(token,day,async()=>{throw Error(token);}),e=>e instanceof Error&&!e.message.includes(token));
 for(const value of [{status:200},{status:200,count_transactions:1000},{status:200,count_transactions:-1},{status:401,error:token}])await assert.rejects(readSepayDay(token,day,async()=>Response.json(value)));
 const malformed=[row('wrong-day',{transaction_date:'2026-11-08 23:59:59'}),row('bad',{amount_in:'1.5'}),row('bad',{amount_out:'1'}),row('bad',{transaction_content:''})];
 for(const r of malformed)await assert.rejects(readSepayDay(token,day,provider([r])),/sai định dạng/);
 await assert.rejects(readSepayDay(token,day,async url=>Response.json(new URL(String(url)).pathname.endsWith('/count')?{status:200,count_transactions:2}:{status:200,transactions:[]})));
 const empty=await readSepayDay(token,day,provider([]));assert.equal(empty.read,0);
});
test('simultaneous pulls and webhook share the same ID without overwriting a receipt',{skip:!process.env.TEST_PG_URL},async()=>{
 const f=await setupSepay();f.env.nowSec=()=>Date.parse(day+'T00:00:00Z')/1000;f.env.sepayApiToken=token;f.env.sepayApiFetch=provider([row('parallel-id')]);
 await f.order('CRM_READ_001');
 const responses=await Promise.all([f.call('/sepay/pull-today',f.mgr,'POST',{}),f.call('/sepay/pull-today',f.other,'POST',{}),f.incoming('CRM_READ_001',100000,{id:'parallel-id',transactionDate:day+' 00:30:00'})]);
 for(const r of responses.slice(0,2))assert.equal((r as {status:number}).status,200);
 assert.equal((await f.db.select().from(sepayTransactions)).length,1);assert.equal((await f.db.select().from(customerPayments)).length,1);
});
