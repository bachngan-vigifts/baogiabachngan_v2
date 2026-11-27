import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {eq} from 'drizzle-orm';
import {setupSepay} from '../helpers/sepay-fixture.ts';
import {createTestDb} from '../helpers/postgres.ts';
import {customerPayments,deliveries} from '../../src/modules/sales/schema.ts';
import {webStoreOrders} from '../../src/modules/sales/pos-schema.ts';
import {sepayTransactions} from '../../src/modules/integrations/schema.ts';
import {netReceivables} from '../../src/modules/sales/api/pos-return-credit.ts';

const ship=(f:any,orderId:string,code:string,extra:Record<string,unknown>={})=>f.db.insert(deliveries).values({id:crypto.randomUUID(),deliveryNo:'GH-'+code,orderId,plannedDate:'2026-11-05',status:'delivered',carrier:'GHN',trackingCode:code,shippingFee:5000,createdBy:'mgr',createdAt:f.stamp,updatedAt:f.stamp,...extra});
const post=(f:any,id:string,lines:unknown[])=>f.call(`/sepay/transactions/${id}/allocations`,f.mgr,'POST',{clientKey:crypto.randomUUID(),expectedRevision:0,lines});

test('GHN payout settles several CRM orders in full: bank keeps net amount, withheld fees close the debt',async()=>{
 const f=await setupSepay(),a=await f.order('GHN_A',{id:'0-ghn-a'}),b=await f.order('GHN_B',{id:'1-ghn-b'});
 await ship(f,a.id,'GHNA1');await ship(f,b.id,'GHNB1');
 const e=await f.incoming('GHN COD PAYOUT',188000),path=`/sepay/transactions/${e.id}/allocations`;
 const candidates=(await f.call(`/sepay/transactions/${e.id}/allocation-candidates?source=ghn`,f.mgr)).data.candidates;
 assert.deepEqual(candidates.map((c:any)=>[c.orderNo,c.ghnCode,c.ghnFeeHint]).sort(),[['GHN_A','GHNA1',5000],['GHN_B','GHNB1',5000]]);
 assert.equal((await f.call(`/sepay/transactions/${e.id}/allocation-candidates?q=GHNB1`,f.mgr)).data.candidates.length,1,'search by GHN code');
 const payload={clientKey:crypto.randomUUID(),expectedRevision:0,lines:[{targetId:a.id,amount:95000,ghnFee:5000,expectedAmount:100000},{targetId:b.id,amount:93000,ghnFee:7000,expectedAmount:100000}]};
 for(let i=0;i<2;i++){const r=await f.call(path,f.mgr,'POST',payload);assert.equal(r.status,200,JSON.stringify(r.data));}
 const receipts=await f.db.select().from(customerPayments);
 assert.equal(receipts.length,4,'replay writes nothing twice');
 assert.deepEqual(receipts.filter(p=>p.method==='transfer').map(p=>p.amount).sort(),[93000,95000]);
 assert.deepEqual(receipts.filter(p=>p.paymentSource==='ghn_fee_offset').map(p=>[p.method,p.amount,p.reference]).sort(),[['other',5000,'GHN GHNA1'],['other',7000,'GHN GHNB1']]);
 const debts=await netReceivables(f.db,[a.id,b.id],'2026-11-08');
 assert.equal(debts.get(a.id)!.balance,0);assert.equal(debts.get(b.id)!.balance,0);
 assert.equal((await f.db.select().from(sepayTransactions).where(eq(sepayTransactions.id,e.id)))[0]!.amount,188000,'bank amount unchanged');
 const d=(await f.call(path,f.mgr)).data;
 assert.equal(d.remaining,0);assert.deepEqual(d.allocations.map((x:any)=>[x.ghnFee,x.difference]).sort(),[[5000,0],[7000,0]]);
 const va=d.allocations.find((x:any)=>x.orderId===a.id);
 const feeReceipt=receipts.find(p=>p.orderId===a.id&&p.paymentSource==='ghn_fee_offset')!;
 assert.equal((await f.call('/payments/'+feeReceipt.id+'/void',f.mgr,'POST',{reason:'Huỷ riêng phiếu phí'})).status,409,'fee offset is only undone with its allocation');
 assert.equal((await f.call(path+'/'+va.id+'/void',f.mgr,'POST',{expectedRevision:d.revision,reason:'Nhập sai phí GHN'})).status,200);
 assert.equal((await netReceivables(f.db,[a.id],'2026-11-08')).get(a.id)!.balance,100000,'unallocating voids the fee offset too');
 assert.equal((await f.db.select().from(customerPayments).where(eq(customerPayments.orderId,a.id))).filter(p=>!p.voidedAt).length,0);
});

test('GHN fee needs a GHN shipment, an integer fee and cannot exceed the debt',async()=>{
 const f=await setupSepay(),o=await f.order('NO_GHN',{id:'0-no-ghn'}),e=await f.incoming('NOT GHN',95000);
 assert.equal((await post(f,e.id,[{targetId:o.id,amount:95000,ghnFee:5000,expectedAmount:100000}])).status,409);
 await ship(f,o.id,'GHNX1');
 assert.equal((await post(f,e.id,[{targetId:o.id,amount:95000,ghnFee:5000.5,expectedAmount:100000}])).status,400);
 assert.equal((await post(f,e.id,[{targetId:o.id,amount:95000,ghnFee:-1}])).status,400);
 assert.equal((await post(f,e.id,[{targetId:o.id,amount:95000,ghnFee:10000,expectedAmount:105000,differenceConfirmed:true}])).status,409,'settled amount above the debt');
 assert.equal((await post(f,e.id,[{targetId:o.id,amount:95000,ghnFee:6000,expectedAmount:100000,differenceConfirmed:true}])).status,400,'a fee never creates customer credit');
 assert.equal((await post(f,e.id,[{targetId:o.id,amount:95000,ghnFee:4000,expectedAmount:100000}])).status,400,'difference must be confirmed');
 assert.equal((await f.db.select().from(customerPayments)).length,0,'rejected batches write nothing');
 const ok=await post(f,e.id,[{targetId:o.id,amount:95000,ghnFee:4000,expectedAmount:100000,differenceConfirmed:true}]);
 assert.equal(ok.status,200,JSON.stringify(ok.data));
 assert.equal((await netReceivables(f.db,[o.id],'2026-11-08')).get(o.id)!.balance,1000,'unexplained shortfall stays as debt');
});

test('GHN payout of a website COD order counts the withheld fee as paid',async()=>{
 const f=await setupSepay(),id='web-ghn';
 await f.db.insert(webStoreOrders).values({id,source:'lock',externalId:id,orderNo:'WEB_GHN',registerId:f.registerId,status:'completed',total:100000,currency:'VND',ghnOrderCode:'GHNW1',ghnFee:6000,orderedAt:f.stamp,updatedAt:f.stamp});
 const e=await f.incoming('GHN WEB PAYOUT',94000);
 const c=(await f.call(`/sepay/transactions/${e.id}/allocation-candidates?source=ghn`,f.mgr)).data.candidates;
 assert.deepEqual(c.map((x:any)=>[x.targetId,x.ghnCode,x.ghnFeeHint]),[['web:'+id,'GHNW1',6000]]);
 const r=await post(f,e.id,[{targetId:'web:'+id,amount:94000,ghnFee:6000,expectedAmount:100000,paymentReviewed:true}]);
 assert.equal(r.status,200,JSON.stringify(r.data));
 const doc=(await f.call('/orders/web:'+id,f.mgr)).data.document;
 assert.equal(doc.paid,100000);assert.equal(doc.outstanding,0);
 assert.equal((await f.db.select().from(customerPayments)).length,0,'web orders keep evidence on the allocation only');
});

test('GHN payout links a POS COD order to its "GHN collected" receipt without a second receipt',async()=>{
 const f=await setupSepay(),shift=await f.open(),o=await f.order('POS_GHN',{id:'0-pos-ghn',channel:'pos',fulfillmentMode:'cod',shiftId:shift.id});
 await ship(f,o.id,'GHNP1',{codAmount:100000});
 await f.db.insert(customerPayments).values({id:'ghn-cod-receipt',orderId:o.id,amount:100000,method:'other',paidAt:'2026-11-05',paymentSource:'ghn_cod',reference:'GHNP1',createdBy:'mgr',createdAt:f.stamp});
 const e=await f.incoming('GHN POS PAYOUT',96000);
 const c=(await f.call(`/sepay/transactions/${e.id}/allocation-candidates?source=ghn`,f.mgr)).data.candidates.find((x:any)=>x.targetId===o.id);
 assert.deepEqual(c.existingPayments.map((p:any)=>[p.id,p.source]),[['ghn-cod-receipt','ghn_cod']]);
 assert.equal((await post(f,e.id,[{targetId:o.id,amount:96000,ghnFee:3000,expectedAmount:100000,differenceConfirmed:true,existingPaymentId:'ghn-cod-receipt'}])).status,409,'net + fee must equal the COD');
 assert.equal((await post(f,e.id,[{targetId:o.id,amount:96000,existingPaymentId:'ghn-cod-receipt',expectedAmount:96000}])).status,409,'cannot shrink a GHN receipt');
 const r=await post(f,e.id,[{targetId:o.id,amount:96000,ghnFee:4000,expectedAmount:100000,existingPaymentId:'ghn-cod-receipt'}]);
 assert.equal(r.status,200,JSON.stringify(r.data));
 const receipts=await f.db.select().from(customerPayments);
 assert.equal(receipts.length,1);assert.equal(receipts[0]!.voidedAt,null);assert.equal(receipts[0]!.amount,100000);
 assert.equal((await netReceivables(f.db,[o.id],'2026-11-08')).get(o.id)!.balance,0);
 const other=await f.incoming('GHN POS PAYOUT AGAIN',96000);
 assert.equal((await post(f,other.id,[{targetId:o.id,amount:96000,ghnFee:4000,expectedAmount:100000,existingPaymentId:'ghn-cod-receipt'}])).status,409,'one GHN receipt, one payout');
});

test('GHN fee migration is repeatable and its read-only gate rejects a missing column',async()=>{
 const {client}=await createTestDb(),migration=readFileSync(new URL('../../migrations/postgres/20261127090000_sepay_allocation_ghn_fee.sql',import.meta.url),'utf8'),gate=readFileSync(new URL('../../scripts/sql/assert-sepay-ghn-fee.sql',import.meta.url),'utf8');
 await client.exec(migration);await client.exec('BEGIN READ ONLY');await client.exec(gate);await client.exec('ROLLBACK');
 for(const mutation of ['ALTER TABLE sepay_payment_allocations DROP COLUMN fee_payment_id','ALTER TABLE sepay_payment_allocations DROP CONSTRAINT chk_sepay_allocation_ghn_fee','DROP INDEX uq_sepay_allocation_fee_receipt']){
  await client.exec('BEGIN');await client.exec(mutation);await client.exec('SAVEPOINT gate');await assert.rejects(client.exec(gate));await client.exec('ROLLBACK TO SAVEPOINT gate');await client.exec('ROLLBACK');
 }
});

test('allocation form counts net bank money against the transaction and net + GHN fee against the debt',async()=>{
 // @ts-ignore plain browser module
 const {allocationTotals}=await import('../../trial-ui/sepay-allocations.js');
 const summary={remaining:95000,canReplaceReceipt:false},line={targetId:'a',cap:100000,expectedAmount:100000,amount:95000,ghnFee:5000,ghnCode:'GHN1'};
 assert.deepEqual(allocationTotals(summary,[line]),{amount:95000,remaining:0,valid:true});
 assert.equal(allocationTotals(summary,[{...line,ghnCode:''}]).valid,false,'fee needs a GHN shipment');
 assert.equal(allocationTotals(summary,[{...line,ghnFee:6000}]).valid,false,'net + fee above the debt');
 assert.equal(allocationTotals(summary,[{...line,ghnFee:5000.5}]).valid,false);
 const ghn={...line,existingPaymentId:'r',existingPayments:[{id:'r',amount:100000,source:'ghn_cod'}]};
 assert.equal(allocationTotals(summary,[ghn]).valid,true,'GHN collected receipt: net + fee equals the COD');
 assert.equal(allocationTotals(summary,[{...ghn,ghnFee:4000}]).valid,false);
 assert.equal(allocationTotals({...summary,canReplaceReceipt:true},[{...ghn,ghnFee:0}]).valid,false,'a GHN receipt is never replaced');
});
