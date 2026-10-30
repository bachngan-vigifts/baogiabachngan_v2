import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup} from '../helpers/pos-fixture.ts';
test('void payment returns the scoped canonical order in the same confirmed response, including on replay',async()=>{
 const f=await setup();
  const shift=await f.open();
  const sale=await f.call('/pos/checkout',f.emp,'POST',f.cart(shift.id,{fulfillmentMode:'cod',depositAmount:50000,delivery:{address:'Kho khách',receiverName:'Khách',receiverPhone:'0900000000'}}));
  assert.equal(sale.status,201,JSON.stringify(sale.data));
  const path='/orders/'+sale.data.id,before=await f.call(path,f.mgr),payment=before.data.payments.find((p:any)=>!p.voidedAt);assert.ok(payment);
  const body={reason:'Sai khoản thu kiểm thử',returnDetail:true};
  const result=await f.call('/payments/'+payment.id+'/void',f.mgr,'POST',body);assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.detail.order.id,sale.data.id);
  const after=await f.call(path,f.mgr);assert.deepEqual(result.data.detail,after.data);
  const replay=await f.call('/payments/'+payment.id+'/void',f.mgr,'POST',body);assert.equal(replay.status,200);assert.equal(replay.data.alreadyApplied,true);assert.deepEqual(replay.data.detail,after.data);
  assert.equal((await f.call('/payments/'+payment.id+'/void',f.ncc,'POST',body)).status,403);
});
