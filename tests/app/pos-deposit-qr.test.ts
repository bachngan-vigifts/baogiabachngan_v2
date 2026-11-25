import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup} from '../helpers/pos-fixture.ts';
import {customerPayments,deliveries} from '../../src/modules/sales/schema.ts';
const delivery={address:'123 Test',receiverName:'Khách',receiverPhone:'0901234567',plannedDate:'2026-11-25',deliveryMethod:'nhat_tin'};
test('QR cọc: đúng số tiền, SePay xác nhận, COD ghi một phiếu thu và trừ số còn giao; retry không trùng',async()=>{
 const f=await setup(),shift=await f.open(),base=f.cart(shift.id),amount=58320;
 const qr=await f.call('/pos/qr',f.emp,'POST',{...base,depositAmount:amount});assert.equal(qr.status,200,JSON.stringify(qr.data));assert.equal(qr.data.amount,amount);
 assert.equal((await f.call('/pos/qr',f.emp,'POST',{...base,depositAmount:amount+1})).status,409);
 const checkout={...base,key:crypto.randomUUID(),fulfillmentMode:'cod',delivery,depositAmount:amount,method:'transfer',paymentRequestId:qr.data.id};
 assert.equal((await f.call('/pos/checkout',f.emp,'POST',checkout)).status,400,'unpaid QR cannot declare receipt');
 const hook=async(n:number)=>{const r=await f.router.handle(new Request('https://trial.test/api/staff/integrations/sepay/pos-payment',{method:'POST',headers:{authorization:'Apikey test-sepay-key','content-type':'application/json'},body:JSON.stringify({transferType:'in',transferAmount:n,accountNumber:'123456',content:qr.data.content})}),f.env);return r.status;};
 assert.equal(await hook(amount-1),409);assert.equal(await hook(amount),200);assert.equal(await hook(amount),200);
 assert.equal((await f.call('/pos/qr/'+qr.data.id+'/status',f.emp)).data.paid,true);
 assert.equal((await f.call('/pos/checkout',f.emp,'POST',{...checkout,depositAmount:amount+1})).status,409);
 assert.equal((await f.call('/pos/checkout',f.emp,'POST',{...checkout,fulfillmentMode:'counter',depositAmount:0,confirmed:true})).status,409);
 const a=await f.call('/pos/checkout',f.emp,'POST',checkout);assert.equal(a.status,201,JSON.stringify(a.data));assert.equal(a.data.depositAmount,amount);
 const b=await f.call('/pos/checkout',f.emp,'POST',checkout);assert.equal(b.data.id,a.data.id);
 const payments=await f.db.select().from(customerPayments);assert.equal(payments.length,1);assert.equal(payments[0]!.amount,amount);assert.equal(payments[0]!.method,'transfer');
 assert.equal((await f.db.select().from(deliveries))[0]!.codAmount,194400-amount);
 assert.equal((await f.call('/pos/qr/'+qr.data.id+'/status',f.emp)).data.consumed,true);
});
test('QR cọc 100% vẫn là QR cọc; xác nhận tay trước webhook không ghi thu hai lần',async()=>{
 const f=await setup(),shift=await f.open(),base=f.cart(shift.id);
 const q=await f.call('/pos/qr',f.emp,'POST',{...base,depositAmount:194400});assert.equal(q.status,200);
 assert.equal((await f.call('/pos/checkout',f.emp,'POST',{...base,method:'transfer',confirmed:true,paymentRequestId:q.data.id})).status,409);
 const body={...base,key:crypto.randomUUID(),fulfillmentMode:'cod',delivery,depositAmount:194400,method:'transfer',confirmed:true,paymentRequestId:q.data.id};
 const r=await f.call('/pos/checkout',f.emp,'POST',body);assert.equal(r.status,201,JSON.stringify(r.data));assert.equal(r.data.codAmount,0);
 assert.equal((await f.call('/pos/checkout',f.emp,'POST',body)).status,201);assert.equal((await f.db.select().from(customerPayments)).length,1);
 const late=await f.router.handle(new Request('https://trial.test/api/staff/integrations/sepay/pos-payment',{method:'POST',headers:{authorization:'Apikey test-sepay-key','content-type':'application/json'},body:JSON.stringify({transferType:'in',transferAmount:194400,accountNumber:'123456',content:q.data.content})}),f.env);assert.equal(late.status,200);assert.equal((await f.db.select().from(customerPayments)).length,1);

 for(const n of [0,-1,194401,1.5])assert.equal((await f.call('/pos/qr',f.emp,'POST',{...base,key:crypto.randomUUID(),depositAmount:n})).status,400);
});
