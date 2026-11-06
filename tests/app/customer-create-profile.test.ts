import { contractTest as test, assert } from '../TEST_TEMPLATE.ts';
import { setup } from '../helpers/pos-fixture.ts';
import { customerCreateFixture } from '../helpers/customer-fixture.ts';
import { customers, customerContacts, customerNotes, customerStaff } from '../../src/modules/customers/schema.ts';
import { eq } from 'drizzle-orm';

test('CRM creation requires name/contact/phone/tax/address on API; whitespace and omitted values never create partial rows',async()=>{
  const s=await setup(),complete=customerCreateFixture({name:'Khách đầy đủ'}),baseline=(await s.db.select().from(customers)).length;
  for(const key of ['name','contact','phone','taxCode','address'] as const){
    for(const missing of [undefined,'   ']){
      const body={...complete,[key]:missing};const r=await s.call('/customers',s.mgr,'POST',body);
      assert.equal(r.status,400,`${key}: ${JSON.stringify(r.data)}`);
    }
  }
  assert.equal((await s.db.select().from(customers)).length,baseline);
  const good=await s.call('/customers',s.mgr,'POST',complete);assert.equal(good.status,201);
  assert.equal((await s.call('/customers/'+good.data.id,s.mgr,'PUT',{name:'Sửa hồ sơ cũ'})).status,200,'legacy edits are not blocked by missing historical fields');
});
test('complete initial customer profile stores staff, notes and contacts atomically with correct approval and primary contact',async()=>{
  const s=await setup(),baseline=(await s.db.select().from(customers)).length;const body={...customerCreateFixture({name:'Khách hồ sơ',contact:'Anh A',customerType:'Nhà máy',establishedDate:'2010-02-03'}),ownerId:'emp',sharedIds:['mgr','other-missing'],notes:'Ghi chú nội bộ',contacts:[{name:'Anh A',title:'Giám đốc',phone:'0912345678',email:'a@example.test',note:'Ghi chú liên hệ',isPrimary:true},{name:'Chị B',title:'Kế toán'}]};
  assert.equal((await s.call('/customers',s.mgr,'POST',body)).status,400);assert.equal((await s.db.select().from(customers)).length,baseline);
  body.sharedIds=['mgr','emp','mgr'];const result=await s.call('/customers',s.mgr,'POST',body);assert.equal(result.status,201,JSON.stringify(result.data));
  const id=result.data.id,profile=await s.call('/customers/'+id,s.mgr);
  assert.equal(profile.data.owner.id,'emp');assert.deepEqual(profile.data.shared.map((x:any)=>x.id),['mgr']);
  assert.equal(profile.data.contacts.length,2);assert.equal(profile.data.contacts.filter((x:any)=>x.isPrimary).length,1);
  assert.equal(profile.data.customer.customerType,'Nhà máy');assert.equal(profile.data.customer.contact,'Anh A');assert.equal(profile.data.generalNote.text,'Ghi chú nội bộ');
  assert.equal(profile.data.customer.approvalStatus,'approved');
  const denied=await s.call('/customers',s.emp,'POST',{...customerCreateFixture({name:'Không đổi phụ trách'}),ownerId:'mgr'});assert.equal(denied.status,403);
  const employee=await s.call('/customers',s.emp,'POST',{...customerCreateFixture({name:'Nhân viên tạo'}),sharedIds:['mgr'],notes:'Ghi chú nhân viên'});assert.equal(employee.status,201);assert.equal(employee.data.approvalStatus,'pending');
  assert.equal((await s.call('/customers/'+employee.data.id,s.mgr)).data.owner.id,'emp');
  const before=(await s.db.select().from(customers)).length;
  for(const invalid of [{contacts:[{name:'',isPrimary:true}]},{contacts:[{name:'A',isPrimary:true},{name:'B',isPrimary:true}]},{notes:'x'.repeat(5001)},{ownerId:'missing'}])
    assert.equal((await s.call('/customers',s.mgr,'POST',{...customerCreateFixture({name:'Không được tạo dở'}),...invalid})).status,400);
  assert.equal((await s.db.select().from(customers)).length,before);
  // A write failure after the customer/staff/note steps rolls back every part of the profile.
  await s.client.exec("ALTER TABLE customer_contacts ADD CONSTRAINT fail_initial_contact CHECK (name <> 'FAIL-CONTACT')");
  const failed=await s.call('/customers',s.mgr,'POST',{...customerCreateFixture({name:'FAIL-CUSTOMER'}),notes:'FAIL-NOTE',contacts:[{name:'FAIL-CONTACT'}]});assert.equal(failed.status,500);
  assert.equal((await s.db.select().from(customers).where(eq(customers.name,'FAIL-CUSTOMER'))).length,0);
  assert.equal((await s.db.select().from(customerNotes).where(eq(customerNotes.text,'FAIL-NOTE'))).length,0);
});
test('POS is exempt from the CRM mandatory fields, including empty name, and reuses the consumer profile',async()=>{
  const s=await setup(),baseline=(await s.db.select().from(customers)).length;const blank=await s.call('/pos/customers',s.emp,'POST',{});assert.equal(blank.status,200,JSON.stringify(blank.data));assert.equal(blank.data.name,'Bán người tiêu dùng');
  const again=await s.call('/pos/customers',s.emp,'POST',{name:'',contact:'',phone:'',taxCode:'',address:''});assert.equal(again.status,200);assert.equal(again.data.id,blank.data.id);
  const phone=await s.call('/pos/customers',s.emp,'POST',{phone:'0977123123'});assert.equal(phone.status,201);assert.equal(phone.data.name,'Khách 0977123123');
  const tax=await s.call('/pos/customers',s.emp,'POST',{taxCode:'9901005000'});assert.equal(tax.status,201);assert.equal(tax.data.name,'Khách 9901005000');
  assert.equal((await s.db.select().from(customers)).length,baseline+3);
});

class Node {
  children:Node[]=[];parent:Node|null=null;attributes:Record<string,string>={};handlers:Record<string,Function[]>={};text='';value='';checked=false;disabled=false;hidden=false;required=false;type='';className='';
  constructor(readonly tag:string){}
  set textContent(v:string){this.text=v;this.children=[];}get textContent():string{return this.text+this.children.map(x=>x.textContent).join('');}
  append(...nodes:Node[]){for(const n of nodes){n.parent=this;this.children.push(n);}}
  replaceChildren(...nodes:Node[]){this.children=[];this.append(...nodes);}
  setAttribute(k:string,v:string){this.attributes[k]=v;}
  addEventListener(k:string,fn:Function){(this.handlers[k]||=[]).push(fn);}
  fire(k:string){for(const fn of this.handlers[k]||[])fn({target:this});}
  focus(){}remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);}
  all():Node[]{return this.children.flatMap(c=>[c,...c.all()]);}
  querySelectorAll(selector:string){return this.all().filter(n=>selector==='input:checked'&&n.tag==='input'&&n.checked);}
}
test('customer form marks exactly the five CRM required fields and no required fields for POS; additional contacts track one primary',async()=>{
  const previous=globalThis.document,doc={createElement:(tag:string)=>new Node(tag)};
  Object.assign(globalThis,{document:doc});
  try{
    const {customerFormFields}:any=await import(new URL('../../trial-ui/customer-form-fields.js',import.meta.url).href);
    const {customerCreateProfile}:any=await import(new URL('../../trial-ui/customer-create-profile.js',import.meta.url).href);
    const fields=customerFormFields({requireProfile:true});
    assert.deepEqual(Object.keys(fields.controls).filter(key=>fields.controls[key].required),['name','contact','phone','taxCode','address']);
    for(const key of ['name','contact','phone','taxCode','address']){const control=fields.controls[key] as Node;assert.ok(control.parent!.textContent.includes('*'));assert.equal(control.attributes['aria-required'],'true');}
    const pos=customerFormFields({requireName:false});assert.equal(Object.values(pos.controls).some((c:any)=>c.required),false);
    fields.setRequiredProfile(false);assert.deepEqual(Object.keys(fields.controls).filter(key=>fields.controls[key].required),['name']);
    const profile=customerCreateProfile({document:doc,mainContact:fields.controls.contact,api:async()=>({people:[{id:'mgr',name:'Manager',role:'manager'},{id:'emp',name:'Nhân viên',role:'employee'}]})});
    profile.reset({id:'mgr',name:'Manager',role:'manager'},true);await new Promise(r=>setTimeout(r,0));
    const add=profile.directory.all().find((n:Node)=>n.text==='＋ Thêm người liên hệ');assert.ok(add);
    const name=profile.directory.all().find((n:Node)=>n.attributes['aria-label']==='Tên người liên hệ');name.value='Anh A';name.fire('input');
    const primary=profile.directory.all().find((n:Node)=>n.className==='customer-primary-choice').children[0];primary.checked=true;primary.fire('change');assert.equal(fields.controls.contact.value,'Anh A');
    const value=profile.read();assert.equal(value.contacts[0].name,'Anh A');assert.equal(value.contacts[0].isPrimary,true);assert.equal(value.ownerId,'mgr');
    profile.reset({id:'emp',name:'Nhân viên',role:'employee'},false);assert.equal(profile.root.hidden,true);assert.equal(profile.read().contacts.length,0);
  }finally{Object.assign(globalThis,{document:previous});}
});
