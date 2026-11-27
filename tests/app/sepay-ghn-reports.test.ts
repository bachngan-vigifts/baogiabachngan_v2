import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {eq} from 'drizzle-orm';
import {setupSepay} from '../helpers/sepay-fixture.ts';
import {customerPayments,deliveries,salesOrderLines} from '../../src/modules/sales/schema.ts';
import {quotations} from '../../src/modules/quotes/schema.ts';
import {salesLineCosts} from '../../src/modules/sales/line-cost-schema.ts';
import {netReceivables} from '../../src/modules/sales/api/pos-return-credit.ts';
const ok=(r:any)=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
const range='from=2026-11-08&to=2026-11-08';

test('GHN net payout: cashbook, cash drawer, finance, daily report and Excel exclude fee offsets; debt and undo retain them',async()=>{
 const f=await setupSepay(),shift=await f.open();
 for(const id of ['fee-quote','fee-quote-b']) await f.db.insert(quotations).values({id,creatorId:'mgr',quoteNo:id,quoteType:'HRC',customer:'Fixture',data:JSON.stringify({type:'HRC',shipping:{payer:'sender'},rows:[{sku:'00123',name:'Fixture',qty:1,price:100000,costPrice:40000}]}),createdAt:f.stamp,updatedAt:f.stamp});
 const a=await f.order('A',{quoteId:'fee-quote'}),b=await f.order('B',{quoteId:'fee-quote-b'});
 for(const o of [a,b]){
  await f.db.insert(salesOrderLines).values({id:'line-'+o.id,orderId:o.id,lineNo:1,sku:'00123',name:'Fixture',unit:'Cái',qty:1,unitPrice:100000,amount:100000});
  await f.db.insert(salesLineCosts).values({orderLineId:'line-'+o.id,orderId:o.id,sku:'00123',unitCost:40000,source:'manual',confidence:'confirmed',capturedAt:f.stamp});
 }
 for(const [order,fee,code] of [[a,5000,'GHNA'],[b,7000,'GHNB']] as const)await f.db.insert(deliveries).values({id:code,deliveryNo:code,orderId:order.id,plannedDate:'2026-11-08',status:'delivered',carrier:'GHN',trackingCode:code,shippingFee:fee,createdBy:'mgr',createdAt:f.stamp,updatedAt:f.stamp});
 const beforeProfit=ok(await f.call('/profit?'+range+'&refresh=1',f.mgr));
 assert.equal(beforeProfit.direct.shipping,12000);
 const e=await f.incoming('GHN payout',188000),path=`/sepay/transactions/${e.id}/allocations`;
 ok(await f.call(path,f.mgr,'POST',{clientKey:crypto.randomUUID(),expectedRevision:0,lines:[{targetId:a.id,amount:95000,ghnFee:5000,expectedAmount:100000},{targetId:b.id,amount:93000,ghnFee:7000,expectedAmount:100000}]}));
 const allocated=ok(await f.call(path,f.mgr));
 const read=async()=>({book:ok(await f.call('/cashbook?'+range,f.mgr)),daily:ok(await f.call('/tasks/accounting/daily?date=2026-11-08',f.mgr)),finance:ok(await f.call('/finance/cashflow?'+range+'&refresh=1',f.mgr)).flow});
 let r=await read();assert.equal(r.book.totals.in,188000);assert.equal(r.daily.customerReceipts.amount,188000);assert.equal(r.daily.customerReceipts.count,2);assert.equal(r.finance.in,188000);assert.equal(r.finance.otherReceipts,0);assert.equal(r.book.totals.out,0);
 const debts=await netReceivables(f.db,[a.id,b.id],'2026-11-08');assert.equal(debts.get(a.id)!.balance,0);assert.equal(debts.get(b.id)!.balance,0);
 assert.equal(allocated.allocations.reduce((n:number,x:any)=>n+x.ghnFee,0),12000);
 const afterProfit=ok(await f.call('/profit?'+range+'&refresh=1',f.mgr));assert.deepEqual(afterProfit.summary,beforeProfit.summary,'settlement is not a new profit expense');assert.equal(afterProfit.direct.shipping,12000);
 // Include shift-linked offsets to cover Sổ quỹ independently of today's CRM receipt placement.
 await f.db.update(customerPayments).set({shiftId:shift.id,createdAt:f.stamp});
 const cashPath='/cash/entries?'+range+'&method=all';
 assert.equal(ok(await f.call(cashPath,f.mgr)).totals.in,188000);
 const other=await f.order('VALID_OTHER');
 await f.db.insert(customerPayments).values({id:'valid-other',orderId:other.id,shiftId:shift.id,amount:3000,method:'other',paymentSource:'manual',paidAt:'2026-11-08',createdBy:'mgr',createdAt:f.stamp});
 r=await read();assert.equal(r.book.totals.in,191000);assert.equal(r.daily.customerReceipts.amount,191000);assert.equal(r.daily.customerReceipts.byMethod.other.amount,3000);assert.equal(r.finance.otherReceipts,3000);assert.equal(r.finance.in,188000,'finance keeps existing separate presentation for other receipts');assert.equal(ok(await f.call(cashPath,f.mgr)).totals.in,191000);
 // Execute the actual browser export handler with the API rows.
 const source=readFileSync(new URL('../../trial-ui/app.js',import.meta.url),'utf8');const start=source.indexOf("$('#cashbook-export').addEventListener"),end=source.indexOf("$('#due-repair-open')",start);
 let handler:any,exported:any;runInNewContext(source.slice(start,end),{$:()=>({addEventListener:(_:string,h:any)=>handler=h}),cashbookRows:()=>r.book.entries,PAY_METHOD:{},toast:()=>assert.fail('export failed'),downloadExcel:async(_:string,sheets:any)=>{exported=sheets;}});
 await handler({currentTarget:{disabled:false}});assert.equal(exported[0].rows.reduce((n:number,row:any[])=>n+row[6],0),191000);assert.equal(exported[0].rows.length,3);
 const allocation=allocated.allocations.find((x:any)=>x.orderId===a.id);
 ok(await f.call(path+'/'+allocation.id+'/void',f.mgr,'POST',{expectedRevision:allocated.revision,reason:'Fixture undo'}));
 r=await read();assert.equal(r.book.totals.in,96000);assert.equal(r.daily.customerReceipts.amount,96000);assert.equal(r.finance.in,93000);assert.equal(ok(await f.call(cashPath,f.mgr)).totals.in,96000);
 assert.equal((await netReceivables(f.db,[a.id],'2026-11-08')).get(a.id)!.balance,100000);
 const fee=(await f.db.select().from(customerPayments).where(eq(customerPayments.orderId,a.id))).find(p=>p.paymentSource==='ghn_fee_offset')!;assert.ok(fee.voidedAt);assert.equal(fee.amount,5000,'audit trail survives undo');
});

test('other carrier tracking cannot authorize GHN fee; mixed shipments use the GHN code and fee',async()=>{
 const f=await setupSepay(),o=await f.order('OTHER'),e=await f.incoming('PAYOUT',95000);
 const ship=async(id:string,carrier:string,day:string,fee:number)=>f.db.insert(deliveries).values({id,deliveryNo:id,orderId:o.id,plannedDate:day,status:'delivered',carrier,trackingCode:id,shippingFee:fee,createdBy:'mgr',createdAt:f.stamp,updatedAt:f.stamp});
 await ship('NT001','Nhất Tín','2026-11-09',9000);
 const candidates=async()=>ok(await f.call(`/sepay/transactions/${e.id}/allocation-candidates?source=ghn`,f.mgr)).candidates;
 assert.equal((await candidates()).length,0);
 const post=()=>f.call(`/sepay/transactions/${e.id}/allocations`,f.mgr,'POST',{clientKey:crypto.randomUUID(),expectedRevision:0,lines:[{targetId:o.id,amount:95000,ghnFee:5000,expectedAmount:100000}]});
 assert.equal((await post()).status,409);assert.equal((await f.db.select().from(customerPayments)).length,0);
 await ship('GHN001',' ghn ','2026-11-08',5000);
 const c=(await candidates())[0];assert.equal(c.ghnCode,'GHN001');assert.equal(c.ghnFeeHint,5000);ok(await post());
});

test('linking an existing COD receipt still checks the shipment carrier before offsetting GHN fees',async()=>{
 const f=await setupSepay(),shift=await f.open(),o=await f.order('POS_OTHER',{channel:'pos',fulfillmentMode:'cod',shiftId:shift.id});
 await f.db.insert(deliveries).values({id:'pos-other',deliveryNo:'POS-OTHER',orderId:o.id,plannedDate:'2026-11-08',status:'delivered',carrier:'Nhất Tín',trackingCode:'NT-POS',shippingFee:5000,createdBy:'mgr',createdAt:f.stamp,updatedAt:f.stamp});
 await f.db.insert(customerPayments).values({id:'legacy-cod',orderId:o.id,amount:100000,method:'other',paidAt:'2026-11-08',paymentSource:'ghn_cod',reference:'NT-POS',createdBy:'mgr',createdAt:f.stamp});
 const e=await f.incoming('POS carrier fixture',95000);
 assert.equal((await f.call(`/sepay/transactions/${e.id}/allocations`,f.mgr,'POST',{clientKey:crypto.randomUUID(),expectedRevision:0,lines:[{targetId:o.id,existingPaymentId:'legacy-cod',amount:95000,ghnFee:5000,expectedAmount:100000}]})).status,409);
 const detail=ok(await f.call(`/sepay/transactions/${e.id}/allocations`,f.mgr));assert.equal(detail.allocations.length,0);assert.equal(detail.remaining,95000);
});
