import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setupSepay} from '../helpers/sepay-fixture.ts';
import {customerPayments,deliveries,salesOrders} from '../../src/modules/sales/schema.ts';
import {sepayTransactions} from '../../src/modules/integrations/schema.ts';
import {syncPosLockGhn} from '../../src/modules/sales/api/pos-ghn-sync.ts';
import {netReceivables} from '../../src/modules/sales/api/pos-return-credit.ts';
import {positionPermissions} from '../../src/modules/staff/schema.ts';
import {posGhnFeeHint} from '../../src/modules/sales/domain/pos-ghn-fee-hint.ts';

test('POS COD: actual bank +/-100 stays a GHN difference, never changes customer receipt; replay, undo and tracking guards',async()=>{
 const f=await setupSepay(),shift=await f.open();let code='';
 f.env.ghnToken='fixture';f.env.ghnFetch=async()=>Response.json({code:200,data:{order_code:code,total_fee:5000,status:'delivered'}});
 for(const amount of [95000,94900,95100,100000]){
  code='GHN'+amount;const fee=amount===100000?0:5000;
  const made=await f.call('/pos/checkout',f.emp,'POST',f.cart(shift.id,{pricePolicyId:'retail',rows:[{sku:'00123',qty:1,discountType:'percent',discountValue:0}],fulfillmentMode:'cod',delivery:{address:'123 Test',receiverName:'Test',receiverPhone:'0901234567',plannedDate:'2026-11-27',ghnProvinceId:202,ghnDistrictId:1442,ghnWardCode:'20101',ghnWeight:800}}));
  assert.equal(made.status,201,JSON.stringify(made.data));await syncPosLockGhn(f.env);
  const oid=made.data.id,[p]=await f.db.select().from(customerPayments).where(eq(customerPayments.orderId,oid));
  const [d]=await f.db.select().from(deliveries).where(eq(deliveries.orderId,oid));assert.equal(d!.shippingFee,0);
  const e=await f.incoming('GHN fixture',amount),path=`/sepay/transactions/${e.id}/allocations`;
  const candidate=async()=>(await f.call(`/sepay/transactions/${e.id}/allocation-candidates`,f.mgr)).data.candidates.find((c:any)=>c.targetId===oid);
  assert.equal((await candidate()).ghnFeeHint,5000);
  await f.db.update(deliveries).set({shippingFee:7000}).where(eq(deliveries.id,d!.id));assert.equal((await candidate()).ghnFeeHint,7000,'keep the positive fee recorded on the delivery');
  await f.db.update(deliveries).set({shippingFee:0}).where(eq(deliveries.id,d!.id));
  const body={clientKey:crypto.randomUUID(),expectedRevision:0,lines:[{targetId:oid,existingPaymentId:p!.id,amount,ghnFee:fee,expectedAmount:100000,differenceConfirmed:true}]};
  if(amount!==95000&&amount!==100000)assert.equal((await f.call(path,f.mgr,'POST',{...body,lines:[{...body.lines[0],differenceConfirmed:false}]})).status,400);
  await f.db.update(deliveries).set({trackingCode:'NEW'}).where(eq(deliveries.id,d!.id));assert.equal((await candidate()).ghnFeeHint,0);assert.equal((await f.call(path,f.mgr,'POST',body)).status,409);
  await f.db.update(deliveries).set({trackingCode:code,carrier:'Nhất Tín'}).where(eq(deliveries.id,d!.id));assert.equal((await candidate()).ghnFeeHint,0);assert.equal((await f.call(path,f.mgr,'POST',body)).status,409);
  await f.db.update(deliveries).set({carrier:'GHN',status:'cancelled'}).where(eq(deliveries.id,d!.id));assert.equal((await f.call(path,f.mgr,'POST',body)).status,409,'cancelled shipment cannot reconcile COD');
  await f.db.update(deliveries).set({status:'delivered'}).where(eq(deliveries.id,d!.id));
  if(amount===95000)await f.db.update(customerPayments).set({deliveryId:null}).where(eq(customerPayments.id,p!.id)); // Legacy receipt with matching reference remains valid.
  if(amount===94900){
   await f.db.delete(positionPermissions).where(eq(positionPermissions.positionId,'accounting'));
   await f.db.insert(positionPermissions).values(['page.sepay','sepay.reconcile-incoming'].map(permission=>({positionId:'accounting',permission})));
   assert.equal((await f.call(path,f.accountant,'POST',body)).status,403,'reconcile alone cannot approve GHN discrepancy');
   await f.db.insert(positionPermissions).values({positionId:'accounting',permission:'sepay.replace-mismatch-receipt'});
  }
  const bookPath='/cashbook?from=2026-11-01&to=2026-11-30';
  const bookBefore=(await f.call(bookPath,f.mgr)).data.totals;
  for(let i=0;i<2;i++){const r=await f.call(path,amount===94900?f.accountant:f.mgr,'POST',body);assert.equal(r.status,200,JSON.stringify(r.data));}
  assert.deepEqual((await f.call(bookPath,f.mgr)).data.totals,bookBefore,'linking GHN COD adds no receipt to cashbook');
  const s=(await f.call(path,f.mgr)).data;assert.equal(s.remaining,0);assert.equal(s.allocations.length,1);assert.equal(s.allocations[0].difference,amount+fee-100000);assert.equal(s.allocations[0].settlementKind,'ghn_cod');assert.equal(s.allocations[0].ghnCode,code);
  assert.equal(s.allocations[0].createdReceipt,false);assert.equal(s.allocations[0].feePaymentId,null);
  assert.equal((await netReceivables(f.db,[oid],'2026-11-27')).get(oid)!.balance,0);
  const receipts=await f.db.select().from(customerPayments).where(eq(customerPayments.orderId,oid));assert.equal(receipts.length,1);assert.equal(receipts[0]!.amount,100000);assert.equal(receipts[0]!.voidedAt,null);
  assert.equal((await f.db.select().from(sepayTransactions).where(eq(sepayTransactions.id,e.id)))[0]!.amount,amount);
  const second=await f.incoming('second payout',amount);assert.equal((await f.call(`/sepay/transactions/${second.id}/allocations`,f.mgr,'POST',{...body,clientKey:crypto.randomUUID()})).status,409);
  assert.equal((await f.call(path+'/'+s.allocations[0].id+'/void',f.mgr,'POST',{expectedRevision:s.revision,reason:'QA undo'})).status,200);
  const undone=(await f.call(path,f.mgr)).data;assert.equal(undone.remaining,amount);assert.ok(undone.allocations[0].voidedAt);assert.equal(undone.allocations[0].difference,amount+fee-100000);
  assert.equal((await netReceivables(f.db,[oid],'2026-11-27')).get(oid)!.balance,0);assert.equal((await f.db.select().from(customerPayments).where(eq(customerPayments.id,p!.id)))[0]!.voidedAt,null);
 }
});

test('POS fee hint is advisory and requires the same GHN code, including zero and manual carriers',()=>{
 const snapshot=(ghn:any,deliveryMethod?:any)=>JSON.stringify({ghn,deliveryMethod});
 assert.equal(posGhnFeeHint(snapshot({orderCode:'ABC',fee:5000}),'abc'),5000);
 for(const fee of [0,-1,1.5,'5000',null])assert.equal(posGhnFeeHint(snapshot({orderCode:'ABC',fee}),'ABC'),0);
 assert.equal(posGhnFeeHint(snapshot({orderCode:'OLD',fee:5000}),'NEW'),0);
 assert.equal(posGhnFeeHint(snapshot({orderCode:'ABC',fee:5000},{method:'nhat_tin'}),'ABC'),0);
 assert.equal(posGhnFeeHint('{bad','ABC'),0);
 assert.equal(posGhnFeeHint(null,'ABC',7000),7000);
 assert.equal(posGhnFeeHint(snapshot({orderCode:'ABC',fee:5000}),'ABC',7000),7000);
 assert.equal(posGhnFeeHint(JSON.stringify({fees:{shippingFee:9000}}),'ABC'),0,'customer shipping is never a carrier fee hint');
});
