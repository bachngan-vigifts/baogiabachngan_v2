import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setupSepay} from '../helpers/sepay-fixture.ts';
import {posRegisters,webStoreOrders as web} from '../../src/modules/sales/pos-schema.ts';
import {customerPayments} from '../../src/modules/sales/schema.ts';
import {stockMoves} from '../../src/modules/inventory/schema.ts';
import {webOrderPayment} from '../../src/modules/sales/domain/web-order-payment.ts';

for(const source of ['lock','minhlong'])test(`${source}: Woo date is a claim, bank proof alone marks paid consistently in POS/detail/summary`,async()=>{
 const f=await setupSepay();
 await f.db.update(posRegisters).set({name:source==='lock'?'CỬA HÀNG LOCKNLOCK CẦN THƠ':'Showroom Gốm Sứ Minh Long Cần Thơ'}).where(eq(posRegisters.id,f.registerId));
 const id=770001,path=`/integrations/woocommerce/${source}/order?token=${source==='lock'?'test-lock-token':'test-ml-token'}`;
 const sync=async(extra:object)=>{const r=await f.call(path,'','POST',{id,...extra});assert.equal(r.status,200,JSON.stringify(r.data));};
 await sync({number:String(id),status:'processing',total:'100000',currency:'VND',date_created_gmt:'2026-11-08T02:00:00',payment_method:'bacs',payment_method_title:'Chuyển khoản ngân hàng (Quét mã QR)',date_paid_gmt:'2026-11-08T03:00:00',line_items:[{sku:'00123',name:'Hàng thử',quantity:1,total:'100000'}]});
 const [order]=await f.db.select().from(web);assert.ok(order);
 const before={snapshot:order!.financialSnapshot,receipts:(await f.db.select().from(customerPayments)).length,moves:(await f.db.select().from(stockMoves)).length};
 const board=async(q='')=>{const r=await f.call(`/pos/orders?registerId=${f.registerId}&source=web&${q}`,f.mgr);assert.equal(r.status,200);return r.data;};
 const detail=async()=>{const r=await f.call('/orders/web:'+order!.id,f.mgr);assert.equal(r.status,200);return r.data.document;};
 let b=await board(),d=await detail();
 for(const o of [b.orders[0],d]){assert.equal(o.paymentStatus,'unknown');assert.equal(o.paymentEvidence,'website');assert.equal(o.paymentReviewRequired,true);assert.match(o.paymentStatusLabel,/Chờ đối soát/);assert.equal(o.paid,null);assert.equal(o.outstanding,null);}
 assert.equal((await board('payment=paid')).orders.length,0);assert.equal((await board('payment=debt')).orders.length,0);assert.equal((await board('payment=unknown')).orders.length,1);
 assert.deepEqual([b.totals[0].paid,b.totals[0].outstanding,b.totals[0].unknownPayment],[0,0,1]);
 let list=(await f.call('/orders?source=web',f.mgr)).data;assert.deepEqual([list.summary.paid,list.summary.remaining,(list.summary.unknownPaymentCount??0)],[0,0,1]);assert.equal(d.receivable,null);
 await sync({status:'completed'});assert.equal((await detail()).paymentStatus,'unknown','delivery is not payment');
 await sync({status:'processing'});
 assert.equal((await f.incoming(source==='lock'?'DH770001':'ML770001',50000,{id:'short-'+source})).status,'review');assert.equal((await detail()).paymentStatus,'unknown');
 const bank=await f.incoming(source==='lock'?'DH770001':'ML770001',100000,{id:'full-'+source});assert.equal(bank.status,'matched');
 b=await board();d=await detail();for(const o of [b.orders[0],d]){assert.equal(o.paymentStatus,'paid');assert.equal(o.paymentEvidence,'bank');assert.equal(o.paymentReviewRequired,false);assert.equal(o.paid,100000);assert.equal(o.outstanding,0);}
 list=(await f.call('/orders?source=web',f.mgr)).data;assert.deepEqual([list.summary.paid,list.summary.remaining,(list.summary.unknownPaymentCount??0)],[100000,0,0]);
 assert.equal((await board('payment=paid')).orders.length,1);
 assert.equal((await f.db.select().from(web))[0]!.financialSnapshot,before.snapshot);assert.equal((await f.db.select().from(customerPayments)).length,before.receipts);assert.equal((await f.db.select().from(stockMoves)).length,before.moves);
 // A stale bank link cannot override a source conflict, in either projection or summary.
 await f.db.update(web).set({crmEditSnapshot:JSON.stringify({sourceConflict:true})}).where(eq(web.id,order!.id));
 assert.equal((await board()).orders[0].paymentStatus,'unknown');assert.equal((await detail()).paymentStatus,'unknown');
 list=(await f.call('/orders?source=web',f.mgr)).data;assert.deepEqual([list.summary.paid,list.summary.remaining,(list.summary.unknownPaymentCount??0)],[0,0,1]);
});

test('explicit unpaid, legacy unknown and zero-value claims do not fabricate money',()=>{
 const snapshot=(paidAt:string|null)=>JSON.stringify({version:1,coupons:[],fees:[],shipping:[],payment:{paidAt}});
 const order={total:100,financialSnapshot:'{}',crmEditSnapshot:'{}'};
 assert.equal(webOrderPayment(order).paymentStatus,'unknown');
 assert.equal(webOrderPayment({...order,financialSnapshot:snapshot(null)}).paymentStatus,'debt');
 assert.equal(webOrderPayment({...order,financialSnapshot:snapshot(null)},'bank-date').paymentStatus,'paid');
 assert.equal(webOrderPayment({...order,total:0,financialSnapshot:snapshot('2026-11-08')}).paymentStatus,'unknown');
 assert.equal(webOrderPayment({...order,financialSnapshot:snapshot('2026-11-08')}).outstanding,null);
});
