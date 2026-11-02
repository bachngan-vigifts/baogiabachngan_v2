import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { setup } from '../helpers/pos-fixture.ts';
import { salesOrders, customerPayments } from '../../src/modules/sales/schema.ts';
const ok = (r:any,status=200) => { assert.equal(r.status,status,JSON.stringify(r.data)); return r.data; };
async function draft(contract=false) {
  const f=await setup();
  const q=ok(await f.call('/quotes',f.emp,'POST',{type:'HRC',quoteNo:'EARLY-RECEIPT-'+crypto.randomUUID(),customer:'Khách ghi thu trước duyệt',customerTaxCode:'1800000000',vat:8,rows:[{sku:'00123',name:'Ly sứ',unit:'cái',qty:2,price:1000}]}),201);
  ok(await f.call('/quotes/'+q.id+'/approve',f.mgr,'POST',{revision:1}));
  const doc=ok(await f.call(contract?'/contracts':'/orders',f.emp,'POST',{quoteId:q.id,legalEntity:'BN',depositRate:30,paymentDays:15,pushSapo:false}),201);
  const id=contract?doc.orderId:doc.id;
  return {...f,id,contractId:contract?doc.id:null};
}
for(const contract of [false,true])test(`${contract?'HĐKT':'đơn hàng'} nháp: nhân viên ghi thu ngay, không tự duyệt, replay không thu hai lần; duyệt sau vẫn giữ phiếu`,async()=>{
  const f=await draft(contract),key=crypto.randomUUID();
  const before=ok(await f.call('/orders/'+f.id,f.emp));assert.equal(before.order.status,'draft');
  const body={orderId:f.id,key,amount:1000,method:'transfer',reference:'Ngân hàng đã báo có'};
  const r=ok(await f.call('/payments',f.emp,'POST',body),201);
  assert.equal(ok(await f.call('/payments',f.emp,'POST',body),201).id,r.id);
  const d=ok(await f.call('/orders/'+f.id,f.emp));assert.equal(d.order.status,'draft');assert.equal(d.payments.length,1);assert.equal(d.receivable.paid,1000);assert.equal(d.receivable.balance,d.receivable.due-1000);
  if(contract)assert.equal(d.contract.status,'draft');
  ok(await f.call('/orders/'+f.id+'/status',f.mgr,'PUT',{status:'confirmed',verified:true,costWarningsReviewed:true}));
  const approved=ok(await f.call('/orders/'+f.id,f.emp));assert.equal(approved.order.status,'confirmed');assert.equal(approved.payments[0].id,r.id);assert.equal(approved.receivable.paid,1000);
});
test('thu trước duyệt: chặn vượt dư nợ, ngoài phạm vi và đơn đã huỷ; không tạo phiếu',async()=>{
  const f=await draft(),body={orderId:f.id,key:crypto.randomUUID(),amount:99999999,method:'transfer'};
  ok(await f.call('/payments',f.emp,'POST',body),400);
  // NCC không được gọi API nghiệp vụ; endpoint phải chặn trước handler.
  const login=await f.call('/login','','POST',{email:'ncc@x.vn',password:'mat-khau-12345'});
  ok(await f.call('/payments',login.cookie,'POST',{...body,amount:100}),403);
  await f.db.update(salesOrders).set({status:'cancelled'}).where(eq(salesOrders.id,f.id));
  ok(await f.call('/payments',f.emp,'POST',{...body,amount:100}),409);
  assert.equal((await f.db.select().from(customerPayments)).length,0);
});
test('HĐKT đã nhận tiền trước duyệt: không huỷ đơn hoặc hợp đồng để bỏ khoản thu; void đúng quyền trả lại số phải thu',async()=>{
  const f=await draft(true),p=ok(await f.call('/payments',f.emp,'POST',{orderId:f.id,key:crypto.randomUUID(),amount:1000,method:'transfer'}),201);
  ok(await f.call('/orders/'+f.id+'/status',f.emp,'PUT',{status:'cancelled'}),409);
  ok(await f.call('/contracts/'+f.contractId,f.mgr,'PUT',{status:'cancelled'}),409);
  const d=ok(await f.call('/orders/'+f.id,f.emp));assert.equal(d.contract.status,'draft');assert.equal(d.receivable.paid,1000);
  ok(await f.call('/payments/'+p.id+'/void',f.emp,'POST',{reason:'Ghi nhầm phiếu thu'}),403);
  ok(await f.call('/payments/'+p.id+'/void',f.mgr,'POST',{reason:'Ghi nhầm phiếu thu'}));
  assert.equal(ok(await f.call('/orders/'+f.id,f.emp)).receivable.paid,0);
});
test('thu tiền mặt trước duyệt chờ Manager dù đã mở ca; yêu cầu đã đọc trước khi đơn bị huỷ phải bị từ chối',async()=>{
  const f=await draft();await f.open();
  const p=ok(await f.call('/payments',f.emp,'POST',{orderId:f.id,key:crypto.randomUUID(),amount:500,method:'cash'}),201);
  assert.equal(p.status,'held');assert.equal((await f.db.select().from(customerPayments)).length,0);
  ok(await f.call('/payments/cash-collections/'+p.id+'/confirm',f.mgr,'POST',{confirmed:true}));
  const [row]=await f.db.select().from(customerPayments).where(eq(customerPayments.id,p.id));assert.equal(row!.shiftId,null);
  // Interleaving đã commit: huỷ xảy ra sau lần đọc order nhưng trước transaction ghi thu.
  const db=f.db;let injected=false;
  f.env.db=new Proxy(db,{get(target,prop){if(prop==='transaction')return async(fn:any,...rest:any[])=>{if(!injected){injected=true;await db.update(salesOrders).set({status:'cancelled'}).where(eq(salesOrders.id,f.id));}return (target.transaction as any)(fn,...rest);};const value=(target as any)[prop];return typeof value==='function'?value.bind(target):value;}});
  ok(await f.call('/payments',f.emp,'POST',{orderId:f.id,key:crypto.randomUUID(),amount:100,method:'transfer'}),409);
  assert.equal((await db.select().from(customerPayments)).length,1);
});
