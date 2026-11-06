import {contractTest as test,assert} from '../TEST_TEMPLATE.ts';
import {setup} from '../helpers/pos-fixture.ts';
import {customerCreateFixture} from '../helpers/customer-fixture.ts';
import {customers,customerContacts} from '../../src/modules/customers/schema.ts';
import {eq} from 'drizzle-orm';
async function fixture(extra:Record<string,unknown>={}){
 const f=await setup(),result=await f.call('/customers',f.mgr,'POST',customerCreateFixture({name:'Khách danh bạ kiểm thử',contact:'Anh Cũ',phone:'0900000021',email:'old@example.test',...extra}));assert.equal(result.status,201);
 const path='/customers/'+result.data.id,view=async()=>(await f.call(path,f.mgr)).data;
 const save=async(p:any,contacts=p.contactDirectory,patch:Record<string,unknown>={})=>f.call(path,f.mgr,'PUT',{...p.customer,contacts,contactDirectoryVersion:p.contactDirectoryVersion,...patch});
 return {...f,path,view,save,id:result.data.id};
}
test('legacy contact is copied into the editor without GET writes; save creates exactly one canonical contact and reopens without duplicates',async()=>{
 const f=await fixture(),p=await f.view();assert.equal(p.contacts.length,0);assert.equal(p.contactDirectory.length,1);
 assert.deepEqual([p.contactDirectory[0].name,p.contactDirectory[0].phone,p.contactDirectory[0].email,p.contactDirectory[0].isPrimary],['Anh Cũ','0900000021','old@example.test',true]);
 assert.equal((await f.db.select().from(customerContacts).where(eq(customerContacts.customerId,f.id))).length,0);
 assert.equal((await f.save(p)).status,200);const next=await f.view();assert.equal(next.contacts.length,1);assert.equal(next.contactDirectory.length,1);
 const id=next.contacts[0].id;next.contactDirectory[0].name='Anh Mới';assert.equal((await f.save(next)).status,200);
 const last=await f.view();assert.equal(last.customer.contact,'Anh Mới');assert.equal(last.contacts[0].id,id);assert.equal(last.contactDirectory.length,1);assert.equal((await f.call('/customers?q=Anh%20Mới',f.mgr)).data.customers[0].id,f.id);
});
test('directory edit preserves existing IDs and representative, copies unmatched legacy person and keeps all details',async()=>{
 const f=await fixture({contact:'Chị Chính',contacts:[{name:'Chị Chính',isPrimary:true,title:'Giám đốc',phone:'0901111111'},{name:'Anh Kế Toán',isRepresentative:true,email:'account@example.test',note:'Nhận hóa đơn'}]});
 await f.db.update(customers).set({contact:'Người cũ cần giữ'}).where(eq(customers.id,f.id));
 const p=await f.view();assert.equal(p.contactDirectory.length,3);const representative=p.customer.representativeContactId,main=p.contacts.find((r:any)=>r.isPrimary);
 p.contactDirectory.find((r:any)=>r.id===main.id).name='Chị Chính mới';assert.equal((await f.save(p)).status,200);
 const after=await f.view();assert.equal(after.customer.contact,'Chị Chính mới');assert.equal(after.customer.representativeContactId,representative);assert.equal(after.contacts.find((r:any)=>r.id===representative).note,'Nhận hóa đơn');assert.ok(after.contacts.some((r:any)=>r.name==='Người cũ cần giữ'));assert.equal(after.contactDirectory.length,3);
});
test('stale contact form cannot overwrite a newer contact, primary or representative change or partially save customer fields',async()=>{
 const f=await fixture(),before=await f.view();
 assert.equal((await f.call(f.path+'/contacts',f.mgr,'POST',{name:'Liên hệ mới',isPrimary:true})).status,201);
 const stale=await f.save(before,before.contactDirectory,{name:'KHÔNG ĐƯỢC GHI'});assert.equal(stale.status,409);assert.equal(stale.data.code,'CUSTOMER_CONTACT_CONFLICT');assert.equal((await f.view()).customer.name,before.customer.name);
 const current=await f.view();assert.equal((await f.call(f.path+'/representative',f.mgr,'PUT',{contactId:current.contacts[0].id})).status,200);assert.equal((await f.save(current)).status,409);
});
test('directory rejects missing versions, malformed contacts, repeated/foreign IDs and edits by a non-owner',async()=>{
 const f=await fixture();assert.equal((await f.save(await f.view())).status,200);const p=await f.view();
 const other=await f.call('/customers',f.mgr,'POST',customerCreateFixture({name:'Khách riêng khác',contact:'Người khác',contacts:[{name:'Người khác',isPrimary:true}]}));const otherContact=(await f.call('/customers/'+other.data.id,f.mgr)).data.contacts[0];
 for(const list of [null,{},[null],[{name:''}],[{name:'A',email:'invalid'}],[{...p.contactDirectory[0],id:otherContact.id}],[p.contactDirectory[0],p.contactDirectory[0]],Array.from({length:51},()=>({name:'A'}))])assert.equal((await f.save(p,list)).status,400,JSON.stringify(list));
 assert.equal((await f.save(p,p.contactDirectory,{contactDirectoryVersion:undefined})).status,400);
 assert.equal((await f.call(f.path,f.emp,'PUT',{...p.customer,contacts:p.contactDirectory,contactDirectoryVersion:p.contactDirectoryVersion})).status,403);
 assert.equal((await f.view()).contacts.length,1);
});
test('contact writes and customer details roll back together, including a removed representative',async()=>{
 const f=await fixture({contact:'Người một',contacts:[{name:'Người một',isPrimary:true,isRepresentative:true},{name:'Người hai'}]}),p=await f.view();
 await f.client.exec("ALTER TABLE customer_contacts ADD CONSTRAINT fail_directory_name CHECK (name <> 'FAIL-DIRECTORY')");
 const keep=p.contactDirectory.find((r:any)=>!r.isRepresentative);keep.name='FAIL-DIRECTORY';
 assert.equal((await f.save(p,[keep],{name:'KHÔNG ĐƯỢC GHI'})).status,500);
 const after=await f.view();assert.equal(after.customer.name,p.customer.name);assert.equal(after.customer.representativeContactId,p.customer.representativeContactId);assert.equal(after.contacts.length,2);assert.equal(after.contacts.find((r:any)=>r.id===keep.id).name,'Người hai');
});
test('existing contact actions keep primary summary synchronized and deleting all contacts does not resurrect old names',async()=>{
 const f=await fixture(),created=await f.call(f.path+'/contacts',f.mgr,'POST',{name:'Người mới',isPrimary:true});assert.equal(created.status,201);
 let p=await f.view();assert.equal(p.contacts.length,2);assert.equal(p.customer.contact,'Người mới');assert.ok(p.contacts.some((r:any)=>r.name==='Anh Cũ'));
 assert.equal((await f.call(f.path+'/contacts/'+created.data.id,f.mgr,'PUT',{name:'Người đã sửa',isPrimary:true})).status,200);assert.equal((await f.view()).customer.contact,'Người đã sửa');
 p=await f.view();assert.equal((await f.save(p,[])).status,200);p=await f.view();assert.equal(p.customer.contact,'');assert.equal(p.contacts.length,0);assert.equal(p.contactDirectory.length,0);
});
test('legacy names and emails up to the old customer limit are copied without truncation; matching names are not duplicated',async()=>{
 const name='Tên '.repeat(90).trim(),email='a'.repeat(240)+'@example.test',f=await fixture({contact:name,email}),p=await f.view();
 assert.equal(p.contactDirectory[0].name,name);assert.equal(p.contactDirectory[0].email,email);assert.equal((await f.save(p)).status,200);assert.equal((await f.view()).contacts[0].name,name);
 await f.db.update(customers).set({contact:name.toLocaleUpperCase('vi')}).where(eq(customers.id,f.id));assert.equal((await f.view()).contactDirectory.length,1);
});

test('legacy summary matching an existing secondary person selects that person when the old directory has no primary flag',async()=>{
 const f=await fixture({contact:'Chị Cũ',contacts:[{name:'Anh Khác'},{name:'  CHỊ CŨ  ',phone:'0900000022'}]}),p=await f.view();
 assert.equal(p.contactDirectory.length,2);assert.equal(p.contactDirectory.find((r:any)=>r.isPrimary).name,'CHỊ CŨ');
 assert.equal((await f.save(p)).status,200);assert.equal((await f.view()).customer.contact,'CHỊ CŨ');
});
