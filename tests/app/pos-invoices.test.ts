import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore browser-only draft bookkeeping, no database side effects
import { createPosInvoiceBook } from '../../trial-ui/pos-invoices.js';
const scope={userId:'test-user',registerId:'test-register',shiftId:'test-shift'};
function memory(){const data=new Map<string,string>();return{data,getItem:(k:string)=>data.get(k)||null,setItem:(k:string,v:string)=>data.set(k,v)};}
const draft=(sku:string,qty=1)=>({cart:[{sku,qty,discountType:'percent',discountValue:10}],customerId:'fixture-'+sku,note:'note-'+sku,policy:'retail-vat'});

test('invoice drafts migrate legacy and isolate rows/customer/note across tabs and reload',()=>{
 const storage=memory(),book=createPosInvoiceBook(storage,scope,draft('A')),first=book.current().id;
 const second=book.add();book.select(second);book.save(draft('B',4));book.select(first);
 assert.deepEqual(book.current().draft,draft('A'));assert.equal(book.hasOtherDrafts(),true);
 const restored=createPosInvoiceBook(storage,scope);assert.equal(restored.current().id,first);restored.select(second);assert.deepEqual(restored.current().draft,draft('B',4));
 const snapshot=restored.current();snapshot.draft.cart[0].qty=999;assert.equal(restored.current().draft.cart[0].qty,4,'callers cannot mutate another draft by reference');
});
test('invoice drafts never cross cashier/register/shift scope',()=>{
 const storage=memory(),book=createPosInvoiceBook(storage,scope);book.save(draft('A'));
 for(const change of [{userId:'other'},{registerId:'other'},{shiftId:'other'}])assert.equal(createPosInvoiceBook(storage,{...scope,...change}).current().draft,null);
 assert.deepEqual(createPosInvoiceBook(storage,scope).current().draft,draft('A'));
});
test('clearing/closing one invoice preserves others, last close creates one empty invoice, numbers stay unique',()=>{
 const book=createPosInvoiceBook(memory(),scope,draft('A')),first=book.current().id,second=book.add();book.select(second);book.save(draft('B'));book.save(null);
 book.close(second);assert.equal(book.current().id,first);assert.deepEqual(book.current().draft,draft('A'));
 const third=book.add();assert.equal(book.entries().find((e:any)=>e.id===third).number,3);
 book.close(first);book.close(third);assert.equal(book.entries().length,1);assert.equal(book.current().draft,null);
});
test('corrupt persisted invoices are not silently discarded or overwritten',()=>{
 for(const value of ['broken','{}',JSON.stringify({version:1,activeId:'missing',entries:[{id:'a',number:1,draft:null}]})]){
  const storage=memory();storage.setItem('bn-pos-invoices:v1:'+JSON.stringify(Object.values(scope)),value);
  assert.throws(()=>createPosInvoiceBook(storage,scope));assert.equal([...storage.data.values()][0],value);
 }
});
test('storage failures cannot switch or delete an invoice in memory',()=>{
 const storage=memory(),book=createPosInvoiceBook(storage,scope,draft('A')),first=book.current().id,second=book.add();
 storage.setItem=()=>{throw Error('quota');};
 assert.throws(()=>book.select(second),/quota/);assert.equal(book.current().id,first);
 assert.throws(()=>book.close(first),/quota/);assert.equal(book.current().id,first);assert.deepEqual(book.current().draft,draft('A'));
 assert.throws(()=>book.save(draft('wrong')),/quota/);assert.deepEqual(book.current().draft,draft('A'));
});
