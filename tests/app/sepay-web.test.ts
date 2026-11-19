import {test} from 'node:test';
import assert from 'node:assert/strict';
import {and,eq} from 'drizzle-orm';
import {setupSepay} from '../helpers/sepay-fixture.ts';
import {sepayTransactions as bank} from '../../src/modules/integrations/schema.ts';
import {customerPayments,salesOrders} from '../../src/modules/sales/schema.ts';
import {posRegisters,webStoreOrders as web} from '../../src/modules/sales/pos-schema.ts';
import {stockMoves} from '../../src/modules/inventory/schema.ts';
import {lockQrReferences,minhLongQrReferences,legacyWebOrderIds} from '../../src/modules/sales/api/sepay-web-store.ts';

async function fixture(){
 const f=await setupSepay();
 await f.db.update(posRegisters).set({name:'CỬA HÀNG LOCKNLOCK CẦN THƠ'}).where(eq(posRegisters.id,f.registerId));
 const payload=(id=21661,extra:Record<string,unknown>={})=>({id,number:String(id),status:'processing',total:'100000',currency:'VND',payment_method:'sepay',payment_method_title:'Chuyển khoản ngân hàng (Quét mã QR)',date_paid_gmt:'2026-11-08T03:00:00',billing:{first_name:'Khách web thử',phone:'0901'},line_items:[{sku:'00123',name:'Ly',quantity:1,total:'100000',subtotal:'100000',total_tax:'0',subtotal_tax:'0'}],...extra});
 const sync=async(id=21661,extra:Record<string,unknown>={})=>{
  const r=await f.call('/integrations/woocommerce/lock/order?token=test-lock-token','','POST',payload(id,extra));
  assert.equal(r.status,200,JSON.stringify(r.data));
  return (await f.db.select().from(web).where(eq(web.externalId,String(id))))[0]!;
 };
 return {...f,payload,sync};
}
test('Lock QR references stay atomic: DH21661 cannot match DH216610, prefix or suffix',()=>{
 assert.ok(lockQrReferences('Thanh toan DH21661. FT123').includes('DH21661'));
 assert.deepEqual(lockQrReferences('BANK.000.DH21661.CT TEST'),['DH21661']);
 for(const s of ['XDH21661','DH21661ABC','DH21661/ABC','PREFIX-DH21661'])assert.ok(!lockQrReferences(s).includes('DH21661'),s);
 assert.ok(!lockQrReferences('DH216610').includes('DH21661'));
});
test('Minh Long QR references stay atomic and do not treat the Sapo WEB_ML code as bank evidence',()=>{
 assert.deepEqual(minhLongQrReferences('ACB.ML33593.THANH TOAN'),['ML33593']);
 for(const s of ['XML33593','ML33593ABC','ML33593/ABC','WEB_ML_33593'])assert.ok(!minhLongQrReferences(s).includes('ML33593'),s);
 assert.ok(!minhLongQrReferences('ML335930').includes('ML33593'));
});
test('paid Minh Long QR ML{id} reconciles to WEB_ML_{id} source order without a CRM receipt',async()=>{
 const f=await setupSepay();
 await f.db.update(posRegisters).set({name:'Showroom Gốm Sứ Minh Long Cần Thơ'}).where(eq(posRegisters.id,f.registerId));
 const body={id:33593,number:'33593',status:'processing',total:'100000',currency:'VND',payment_method:'bacs',payment_method_title:'Chuyển khoản ngân hàng (Quét mã QR)',date_paid_gmt:'2026-11-08T03:00:00',billing:{first_name:'Khách Minh Long',phone:'0901'},line_items:[{sku:'00123',name:'Ly',quantity:1,total:'100000',subtotal:'100000',total_tax:'0',subtotal_tax:'0'}]};
 const sync=await f.call('/integrations/woocommerce/minhlong/order?token=test-ml-token','','POST',body);
 assert.equal(sync.status,200,JSON.stringify(sync.data));
 const [w]=await f.db.select().from(web).where(and(eq(web.source,'minhlong'),eq(web.externalId,'33593')));
 assert.ok(w);
 const before=(await f.db.select().from(customerPayments)).length;
 const e=await f.incoming('ACB.ML33593.THANH TOAN',100000,{id:'ml-paid'});
 assert.equal(e.status,'matched');assert.equal(e.webOrderId,w!.id);assert.equal(e.orderId,null);assert.equal(e.paymentId,null);
 assert.equal((await f.db.select().from(customerPayments)).length,before);
});
test('paid Lock QR auto reconciles to original web number without another CRM receipt, revenue or stock move',async()=>{
 const f=await fixture(),w=await f.sync();
 const before={orders:(await f.db.select().from(salesOrders)).length,receipts:(await f.db.select().from(customerPayments)).length,moves:(await f.db.select().from(stockMoves)).length};
 const e=await f.incoming('BANK.000.DH21661.CT TEST',100000,{id:'qr-paid'});
 assert.equal(e.status,'matched');assert.equal(e.webOrderId,w.id);assert.equal(e.orderId,null);assert.equal(e.paymentId,null);
 const repeat=await f.incoming('BANK.000.DH21661.CT TEST',100000,{id:'qr-paid'});assert.equal(repeat.id,e.id);
 assert.equal((await f.db.select().from(salesOrders)).length,before.orders);assert.equal((await f.db.select().from(customerPayments)).length,before.receipts);assert.equal((await f.db.select().from(stockMoves)).length,before.moves);
 assert.equal((await f.db.select().from(web))[0]!.financialSnapshot,w.financialSnapshot);
 const page=await f.call('/sepay/transactions?from=2026-11-08&to=2026-11-08',f.mgr);
 assert.equal(page.status,200);assert.equal(page.data.summary.postedCount,1);assert.equal(page.data.summary.issueCount,0);
 const row=page.data.transactions[0];assert.equal(row.webOrderId,w.id);assert.equal(row.webOrderNo,'21661');assert.equal(row.status,'matched');
 const detail=await f.call('/sepay/transactions/'+row.id,f.mgr);assert.equal(detail.data.capabilities.canConfirm,false);
 const webDoc=await f.call('/orders/web:'+w.id,f.mgr);assert.equal(webDoc.status,200);assert.equal(webDoc.data.document.paid,100000);
 await f.db.update(web).set({status:'refunded'}).where(eq(web.id,w.id));
 assert.equal((await f.call('/sepay/transactions?from=2026-11-08&to=2026-11-08',f.mgr)).data.summary.issueCount,1);
});
test('bank-first payment and later source-paid webhook converge; unpaid source never gets a fabricated paid timestamp',async()=>{
 const f=await fixture();
 const event=await f.incoming('DH21661',100000,{id:'bank-first'});assert.notEqual(event.status,'matched');
 const w=await f.sync(21661,{date_paid_gmt:null});
 let [stored]=await f.db.select().from(bank);assert.equal(stored!.webOrderId,w.id);assert.equal(stored!.status,'review');
 assert.equal(JSON.parse((await f.db.select().from(web))[0]!.financialSnapshot).payment.paidAt,null);
 await f.sync();[stored]=await f.db.select().from(bank);assert.equal(stored!.status,'matched');assert.equal(stored!.webOrderId,w.id);
 await f.sync();assert.equal((await f.db.select().from(bank)).length,1);assert.equal((await f.db.select().from(customerPayments)).length,0);
});
test('wrong account, amounts, cancelled/non-QR/conflicted orders and second full payment stay in review',async()=>{
 const f=await fixture();await f.sync();
 for(const [id,amount,extra] of [['wrong-account',100000,{accountNumber:'999999'}],['short',50000,{}],['over',100001,{}]] as const){
  const r=await f.incoming('DH21661',amount,{id,...extra});assert.equal(r.status,'review');
 }
 assert.equal((await f.incoming('POSABCDEF123456 DH21661',100000,{id:'mixed-pos-web'})).status,'review');
 assert.equal((await f.incoming('DH21661',100000,{id:'first-full'})).status,'matched');
 assert.equal((await f.incoming('DH21661',100000,{id:'second-full'})).status,'review');
 for(const [n,extra] of [[21662,{status:'cancelled'}],[21663,{payment_method_title:'Thanh toán khi nhận hàng'}],[21664,{currency:'USD'}]] as const){
  await f.sync(n,extra);assert.equal((await f.incoming('DH'+n,100000,{id:'blocked-'+n})).status,'review');
 }
 const conflict=await f.sync(21665);await f.db.update(web).set({crmEditSnapshot:JSON.stringify({sourceConflict:true})}).where(eq(web.id,conflict.id));
 assert.equal((await f.incoming('DH21665',100000,{id:'conflicted'})).status,'review');
 const cancelled=await f.sync(21666);await f.db.update(web).set({status:'wc-cancelled',ghnStatus:'delivered'}).where(eq(web.id,cancelled.id));
 assert.equal((await f.incoming('DH21666',100000,{id:'cancelled-but-delivered'})).status,'review');
 assert.equal((await f.db.select().from(customerPayments)).length,0);
});
test('QR ref matching web and CRM cannot pick either automatically; manual CRM reassignment cannot steal a web payment',async()=>{
 const f=await fixture(),w=await f.sync();
 const crm=await f.order('DH21661');
 assert.equal((await f.incoming('DH21661',100000,{id:'ambiguous'})).status,'review');
 assert.equal((await f.incoming('BANK.000.DH21661.CT TEST',100000,{id:'ambiguous-dotted'})).status,'review');
 assert.equal((await f.db.select().from(customerPayments)).length,0);
 const w2=await f.sync(21662);const e=await f.incoming('DH21662',99999,{id:'pending-web'});
 const [row]=await f.db.select().from(bank).where(eq(bank.providerId,'pending-web'));assert.equal(row!.webOrderId,w2.id);
 assert.equal((await f.confirm(row!.id,f.choice(crm.id))).status,409);
 assert.equal((await f.db.select().from(customerPayments)).length,0);
});
test('API pull upgrades an existing review to web matched and imports a second ID as review, without CRM receipts',async()=>{
 const f=await fixture(),w=await f.sync();f.env.nowSec=()=>Date.parse('2026-11-08T10:00:00+07:00')/1000;f.env.sepayApiToken='TEST_TOKEN_FOR_SEPAY_WEB_ONLY';
 await f.db.insert(bank).values({id:'already-pulled',providerId:'same',transferType:'in',amount:100000,accountNumber:'123456',content:'DH21661',transactionAt:'2026-11-08T03:00:00.000Z',payload:'{}',status:'review',reason:'Chờ đối soát',receivedAt:'2026-11-08T04:00:00Z'});
 const rows=['same','other'].map(id=>({id,account_number:'123456',amount_in:'100000.00',amount_out:'0.00',transaction_date:'2026-11-08 10:00:00',transaction_content:'DH21661'}));
 f.env.sepayApiFetch=async input=>Response.json(new URL(String(input)).pathname.endsWith('/count')?{status:200,count_transactions:2}:{status:200,transactions:rows});
 const r=await f.call('/sepay/pull-today',f.mgr,'POST',{});assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.imported,1);assert.equal(r.data.duplicate,1);
 const stored=await f.db.select().from(bank);assert.equal(stored.filter(x=>x.status==='matched').length,1);assert.equal(stored.find(x=>x.providerId==='same')!.webOrderId,w.id);assert.equal((await f.db.select().from(customerPayments)).length,0);
});

test('two provider IDs for one web order serialize to one match on PostgreSQL',{skip:!process.env.TEST_PG_URL},async()=>{
 const f=await fixture();await f.sync();
 const result=await Promise.all([f.incoming('DH21661',100000,{id:'parallel-web-a'}),f.incoming('DH21661',100000,{id:'parallel-web-b'})]);
 assert.equal(result.filter(x=>x.status==='matched').length,1);assert.equal(result.filter(x=>x.status==='review').length,1);
 assert.equal((await f.db.select().from(customerPayments)).length,0);
});

test('disjoint API batches visiting two web orders in opposite order do not deadlock or double-match',{skip:!process.env.TEST_PG_URL},async()=>{
 const f=await fixture();await f.sync();await f.sync(21662);
 const makeRows=(prefix:string,ids:number[])=>ids.map((id,i)=>({id:prefix+i,account_number:'123456',amount_in:'100000',amount_out:'0',transaction_date:'2026-11-08 10:00:00',transaction_content:'DH'+id}));
 const run=async(rows:Record<string,unknown>[])=>{
  const response=await f.router.handle(new Request('https://trial.test/api/staff/sepay/pull-today',{method:'POST',headers:{origin:'https://trial.test',cookie:f.mgr,'content-type':'application/json'},body:'{}'}),{...f.env,nowSec:()=>Date.parse('2026-11-08T10:00:00+07:00')/1000,sepayApiToken:'TEST_TOKEN_WEB_BATCH_CONCURRENCY',sepayApiFetch:async input=>Response.json(new URL(String(input)).pathname.endsWith('/count')?{status:200,count_transactions:rows.length}:{status:200,transactions:rows})});
  assert.equal(response.status,200,await response.text());
 };
 await Promise.all([run(makeRows('batch-a-',[21661,21662])),run(makeRows('batch-b-',[21662,21661]))]);
 const rows=await f.db.select().from(bank);assert.equal(rows.length,4);assert.equal(rows.filter(x=>x.status==='matched').length,2);assert.equal(rows.filter(x=>x.status==='review').length,2);
 assert.equal((await f.db.select().from(customerPayments)).length,0);
});

test('bank-first reserved Lock QR cannot attach to a coincident CRM number before the website order arrives',async()=>{
 const f=await fixture(),crm=await f.order('DH21661');
 const e=await f.incoming('DH21661',100000,{id:'reserved-before-web'});assert.equal(e.status,'review');assert.equal(e.orderId,null);
 const detail=await f.call('/sepay/transactions/'+e.id,f.mgr);assert.equal(detail.data.capabilities.canConfirm,true);assert.match(detail.data.blockReason,/chờ nguồn web/);
 assert.equal((await f.confirm(e.id,f.choice(crm.id))).status,409);assert.equal((await f.db.select().from(customerPayments)).length,0);
});

test('observed bank suffix is accepted while arbitrary suffixes and embedded codes stay rejected',()=>{
 assert.deepEqual(lockQrReferences('ACB;159063909;DH21832-GD-858609-181126-11:09:58'),['DH21832']);
 assert.deepEqual(minhLongQrReferences('ACB;579268;ML33590-GD-858609-181126-11:09:58'),['ML33590']);
 for(const s of ['DH21832-GD-ABC','DH21832-GD-858609-181126-25:00:00','DH21832-GD-858609-181126-11:09:58 EXTRA','DH21832-ABC','DH21832 / ABC','PREFIX-DH21832'])
  assert.deepEqual(lockQrReferences(s),[],s);
 assert.deepEqual(legacyWebOrderIds('QR - Thanh toan don hang web 33588 GD 6322ICBVC24EAUU9 181126-13:28:33'),['33588']);
 assert.deepEqual(legacyWebOrderIds('Thanh toán đơn hàng web 33590'),['33590']);
 for(const s of ['Thanh toan don hang web 33590 ML33591','Thanh toan don hang web 33590/ABC','Thanh toan don hang web 33590 1'])
  assert.deepEqual(legacyWebOrderIds(s),[],s);
});
test('bank suffix matches late full payment by reference, with duplicate and amount protections',async()=>{
 const f=await fixture(),w=await f.sync();
 const text='ACB;123456;DH21661-GD-858609-081126-11:09:58';
 const e=await f.incoming(text,100000,{id:'suffix-late',transactionDate:'2026-11-08 11:09:58'});
 assert.equal(e.status,'matched');assert.equal(e.webOrderId,w.id);
 assert.equal((await f.incoming(text,100000,{id:'suffix-late',transactionDate:'2026-11-08 11:09:58'})).id,e.id);
 assert.equal((await f.incoming(text,99999,{id:'suffix-short'})).status,'review');
 assert.equal((await f.incoming(text,100000,{id:'suffix-second'})).status,'review');
 assert.equal((await f.db.select().from(customerPayments)).length,0);
});
test('legacy bank-first reference waits for the correct source and then reconciles once paid',async()=>{
 const f=await fixture();
 const text='Thanh toan don hang web 21661';
 const e=await f.incoming(text,100000,{id:'legacy-before'});
 assert.equal(e.status,'review');
 const w=await f.sync(21661,{date_paid_gmt:null});
 let [row]=await f.db.select().from(bank).where(eq(bank.id,e.id));
 assert.equal(row!.webOrderId,w.id);assert.equal(row!.status,'review');
 assert.match(row!.reason,/Đã nhận tiền.*chờ web xác nhận/);
 await f.sync();[row]=await f.db.select().from(bank).where(eq(bank.id,e.id));
 assert.equal(row!.status,'matched');
 assert.equal((await f.db.select().from(customerPayments)).length,0);
});
test('unpaid canonical web payment stays pending even after the five-minute window',async()=>{
 const f=await fixture(),w=await f.sync(21661,{date_paid_gmt:null,date_created_gmt:'2026-11-08T03:00:00'});
 f.env.nowSec=()=>Date.parse('2026-11-08T04:00:00Z')/1000;
 const e=await f.incoming('DH21661',100000,{id:'pending-paid'});
 assert.equal(e.webOrderId,w.id);assert.equal(e.status,'review');assert.match(e.reason,/Đã nhận tiền.*chờ web xác nhận/);
 assert.equal(JSON.parse((await f.db.select().from(web))[0]!.financialSnapshot).payment.paidAt,null);
});
test('legacy references do not guess between websites sharing account and original order ID',async()=>{
 const f=await fixture(),w=await f.sync();
 await f.db.insert(web).values({...w,id:crypto.randomUUID(),source:'minhlong',crmOrderNo:'ML duplicate'});
 const e=await f.incoming('Thanh toan don hang web 21661',100000,{id:'legacy-ambiguous'});
 assert.equal(e.status,'review');assert.equal(e.webOrderId,null);
 assert.equal((await f.db.select().from(customerPayments)).length,0);
});


test('a mixed legacy description and another canonical reference never selects either order',async()=>{
 const f=await fixture();await f.sync();await f.sync(21662);
 for(const text of ['Thanh toan don hang web 21661 DH21662','Thanh toan don hang web 21661/ABC']){
  const e=await f.incoming(text);
  assert.equal(e.status,'review');assert.equal(e.webOrderId,null);assert.equal(e.paymentId,null);
 }
});
test('Minh Long nearby candidate validation uses ML rather than the Lock prefix',async()=>{
 const {nearbySepayTargets}=await import('../../src/modules/sales/api/sepay-proximity-store.ts');
 const f=await fixture(),w=await f.sync();
 await f.db.update(web).set({source:'minhlong',orderedAt:'2026-11-08T03:00:00.000Z',orderedAtVerified:true}).where(eq(web.id,w.id));
 const r=await nearbySepayTargets(f.db,{providerId:'ml-candidate',amount:100000,accountNumber:'123456',transactionAt:'2026-11-08T03:00:00.000Z',transferType:'in',content:'ML21661',payload:'{}'},'web:'+w.id);
 assert.equal(r.targets.length,1);assert.equal(r.targets[0]!.blocked,'');
});
