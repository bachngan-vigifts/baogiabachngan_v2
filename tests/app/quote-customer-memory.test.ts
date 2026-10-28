import test from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setup} from '../helpers/pos-fixture.ts';
import {customers,customerStaff} from '../../src/modules/customers/schema.ts';
import {quotations} from '../../src/modules/quotes/schema.ts';
const fields=['customer','contact','phone','email','customerTaxCode','customerAddress'];
const data=(extra:object={})=>({type:'HRC',quoteNo:'BG-MEMORY-1',date:'2026-10-28',vat:8,customer:'Công ty kiểm thử',contact:'Ms Test',phone:'0909999001',email:'test@example.com',customerTaxCode:'0312345678',customerAddress:'Địa chỉ kiểm thử',rows:[{sku:'00123',name:'Ly sứ',qty:1,price:100000}],...extra});
test('quote save remembers customer atomically, reuses identity and only updates edited nonempty fields within ownership',async()=>{
 const f=await setup();{
  const post=await f.call('/quotes',f.emp,'POST',{...data(),rememberCustomer:true,customerFields:fields});assert.equal(post.status,201,JSON.stringify(post.data));assert.equal(post.data.customerMemory.status,'created');
  const id=post.data.data.customerId;assert.ok(id);let [profile]=await f.db.select().from(customers).where(eq(customers.id,id));assert.equal(profile?.email,'test@example.com');assert.equal(profile?.approvalStatus,'pending');assert.equal((await f.db.select().from(customerStaff).where(eq(customerStaff.customerId,id)))[0]?.memberId,'emp');
  // More recent directory details must survive unrelated edits to an older quote snapshot.
  await f.db.update(customers).set({phone:'0909999002',address:'Địa chỉ mới trong danh bạ'}).where(eq(customers.id,id));
  let current=post.data.data;
  const put=await f.call('/quotes/'+post.data.id,f.emp,'PUT',{revision:1,data:{...current,contact:'Ms Updated',customerAddress:''},rememberCustomer:true,customerFields:fields});assert.equal(put.status,200,JSON.stringify(put.data));
  [profile]=await f.db.select().from(customers).where(eq(customers.id,id));assert.equal(profile?.phone,'0909999002');assert.equal(profile?.address,'Địa chỉ mới trong danh bạ');assert.equal(profile?.contact,'Ms Updated');
  const stale=await f.call('/quotes/'+post.data.id,f.emp,'PUT',{revision:1,data:{...current,contact:'Không được ghi'},rememberCustomer:true});assert.equal(stale.status,409);assert.equal((await f.db.select().from(customers).where(eq(customers.id,id)))[0]?.contact,'Ms Updated');
  const duplicate=await f.call('/quotes',f.emp,'POST',{...data({quoteNo:'BG-MEMORY-2',phone:'0909999002'}),rememberCustomer:true,customerFields:fields});assert.equal(duplicate.status,201);assert.equal(duplicate.data.data.customerId,id);assert.equal((await f.db.select().from(customers).where(eq(customers.taxCode,'0312345678'))).length,1);
  // A quote author may use a selected customer without gaining permission to edit that customer's profile.
  const shared=await f.call('/quotes',f.other,'POST',{...data({quoteNo:'BG-MEMORY-3',customerId:id,contact:'Không phải người phụ trách'}),rememberCustomer:true,customerFields:fields});assert.equal(shared.status,201);assert.equal(shared.data.customerMemory.status,'skipped');assert.notEqual((await f.db.select().from(customers).where(eq(customers.id,id)))[0]?.contact,'Không phải người phụ trách');
  // Unsupported/ambiguous identity data leaves the quote saved and provides a visible directory warning.
  const noIdentity=await f.call('/quotes',f.mgr,'POST',{...data({quoteNo:'BG-MEMORY-4',phone:'',customerTaxCode:''}),rememberCustomer:true,customerFields:fields});assert.equal(noIdentity.status,201);assert.equal(noIdentity.data.customerMemory.status,'skipped');assert.equal(noIdentity.data.data.customerId,'');
  const invalid=await f.call('/quotes',f.mgr,'POST',{...data({quoteNo:'BG-MEMORY-5',phone:'0909999005',customerTaxCode:'',email:'email-sai'}),rememberCustomer:true,customerFields:fields});assert.equal(invalid.status,201);assert.equal(invalid.data.customerMemory.status,'skipped');assert.equal((await f.db.select().from(customers).where(eq(customers.phone,'0909999005'))).length,0);
  // Existing clients without the explicit memory flag retain their behaviour.
  const plain=await f.call('/quotes',f.mgr,'POST',data({quoteNo:'BG-MEMORY-6',phone:'0909999006',customerTaxCode:''}));assert.equal(plain.status,201);assert.equal(plain.data.customerMemory,undefined);assert.equal((await f.db.select().from(customers).where(eq(customers.phone,'0909999006'))).length,0);
  // Force the final quote INSERT to fail after a customer was created; transaction must roll it back too.
  await assert.rejects(f.db.transaction(async tx=>{const {rememberQuoteCustomer}=await import('../../src/app/quote-customer-memory.ts');const fresh=data({quoteNo:'rollback',phone:'0909999007',customerTaxCode:''});await rememberQuoteCustomer(tx,fresh,null,{id:'mgr',role:'manager'} as any,fields);throw Error('simulated quote failure');}),/simulated/);
  assert.equal((await f.db.select().from(customers).where(eq(customers.phone,'0909999007'))).length,0);
  assert.ok((await f.db.select().from(quotations).where(eq(quotations.id,post.data.id)))[0]);
 }
});
