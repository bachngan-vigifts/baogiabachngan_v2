import {test} from 'node:test';
import assert from 'node:assert/strict';
import {and,eq} from 'drizzle-orm';
import {setup} from '../helpers/pos-fixture.ts';
import {customers,customerStaff} from '../../src/modules/customers/schema.ts';
import {catalogueQuotes} from '../../src/modules/catalog/catalogue-library-schema.ts';
import {mergeCustomers} from '../../src/modules/customer-hub/api/duplicates.ts';
import {catalogueCustomerLinks,reassignCatalogueCustomer} from '../../src/app/catalogue-customer-links.ts';
const {defaultState,validateProduct,restoreState}=await import(new URL('../../trial-ui/catalogue/core.js',import.meta.url).href);
function quote(customerId:string){const s=defaultState();s.meta.customerId=customerId;s.meta.customer='Client supplied name';s.products=[validateProduct({id:'product-1',name:'Ly sứ',sku:'00123',brand:'Minh Long',category:'Ly',regular:100000,discount:0,fee:0,qty:1})];s.selected=['product-1'];return s;}
test('backup restores the entire recipient group name',()=>{
 const state=quote('');state.meta.customerGroup='N'.repeat(200);assert.equal(restoreState(state).meta.customerGroup,state.meta.customerGroup);
});
test('recipient groups are scoped and validated; blank and group saves persist without creating customer links',async()=>{
 const f=await setup(),at=new Date().toISOString();
 await f.db.insert(customers).values([
  {id:'recipient-owned',name:'Khách thử nghiệm',customerType:'Doanh nghiệp',approvalStatus:'approved' as const},
  {id:'recipient-hidden',name:'Khách riêng',customerType:'Nhóm riêng',approvalStatus:'approved' as const},
  {id:'recipient-pending',name:'Khách chờ duyệt',customerType:'Nhóm chờ duyệt',approvalStatus:'pending' as const},
 ].map(row=>({contact:'',phone:'',email:'',address:'',search:'khach thu nghiem',sourceVersion:0,syncedAt:at,createdAt:at,...row})));
 await f.db.insert(customerStaff).values({customerId:'recipient-owned',memberId:'emp',role:'owner',createdAt:at});
 const groups=await f.call('/catalogue-customers?groups=1',f.emp);assert.equal(groups.status,200);assert.deepEqual(groups.data.groups,['Doanh nghiệp']);
 const state=quote('');state.meta.customerGroup='Doanh nghiệp';const id=crypto.randomUUID();
 const saved=await f.call('/catalogue-quotes',f.emp,'POST',{id,clientKey:crypto.randomUUID(),state});assert.equal(saved.status,200,JSON.stringify(saved.data));
 const snapshot=(await f.call('/catalogue-quotes/'+id,f.emp)).data.state;assert.equal(snapshot.meta.customerId,'');assert.equal(snapshot.meta.customerGroup,'Doanh nghiệp');assert.equal(snapshot.meta.customer,'Doanh nghiệp');
 const oldClient=structuredClone(snapshot);delete oldClient.meta.customerGroup;
 assert.equal((await f.call('/catalogue-quotes/'+id,f.emp,'PUT',{revision:1,clientKey:crypto.randomUUID(),state:oldClient})).status,200);
 assert.equal((await f.call('/catalogue-quotes/'+id,f.emp)).data.state.meta.customerGroup,'Doanh nghiệp');
 const invalid=quote('');invalid.meta.customerGroup='Nhóm riêng';assert.equal((await f.call('/catalogue-quotes',f.emp,'POST',{id:crypto.randomUUID(),clientKey:crypto.randomUUID(),state:invalid})).status,403);
 invalid.meta.customerId='recipient-owned';assert.equal((await f.call('/catalogue-quotes',f.emp,'POST',{id:crypto.randomUUID(),clientKey:crypto.randomUUID(),state:invalid})).status,400);
 assert.equal((await f.call('/catalogue-quotes',f.emp,'POST',{id:crypto.randomUUID(),clientKey:crypto.randomUUID(),state:quote('')})).status,200);
 const linked=crypto.randomUUID();assert.equal((await f.call('/catalogue-quotes',f.emp,'POST',{id:linked,clientKey:crypto.randomUUID(),state:quote('recipient-owned')})).status,200);
 assert.equal((await f.call('/catalogue-quotes/'+linked,f.other,'PUT',{revision:1,clientKey:crypto.randomUUID(),state:quote('')})).status,403);
 assert.equal((await f.call('/catalogue-quotes/'+linked,f.emp,'PUT',{revision:1,clientKey:crypto.randomUUID(),state:quote('')})).status,200);
 assert.equal((await f.call('/catalogue-quotes/'+linked,f.emp)).data.state.meta.customerId,'');
});
test('catalogue links the selected ID, validates access/approval and appears only in the corresponding customer profile',async()=>{
 const f=await setup(),at=new Date().toISOString();
 await f.db.insert(customers).values([
  {id:'catalogue-customer-a',name:'Công ty cùng tên',phone:'0901000001',search:'cong ty cung ten 0901000001',approvalStatus:'approved' as const,createdAt:at,updatedAt:at},
  {id:'catalogue-customer-b',name:'Công ty cùng tên',phone:'0901000002',search:'cong ty cung ten 0901000002',approvalStatus:'approved' as const,createdAt:at,updatedAt:at},
  {id:'catalogue-pending',name:'Khách chờ duyệt',search:'khach cho duyet',approvalStatus:'pending' as const,createdAt:at,updatedAt:at},
 ].map(row=>({contact:'',phone:'',email:'',address:'',sourceVersion:0,syncedAt:at,...row})));
 await f.db.insert(customerStaff).values({customerId:'catalogue-customer-a',memberId:'emp',role:'owner',createdBy:'mgr',createdAt:at});
 await f.db.insert(customerStaff).values({customerId:'catalogue-customer-b',memberId:'cashier2',role:'owner',createdBy:'mgr',createdAt:at});
 const pick=await f.call('/catalogue-customers?q=cong+ty',f.emp);assert.equal(pick.status,200);assert.deepEqual(pick.data.customers.map((x:{id:string})=>x.id),['catalogue-customer-a']);
 assert.equal((await f.call('/catalogue-customers?id=catalogue-customer-a',f.other)).status,403);
 assert.equal((await f.call('/catalogue-customers?id=catalogue-pending',f.mgr)).status,400);
 assert.equal((await f.call('/catalogue-customers',f.ncc)).status,403);
 const id=crypto.randomUUID(),body={id,clientKey:crypto.randomUUID(),state:quote('catalogue-customer-a')};
 assert.equal((await f.call('/catalogue-quotes',f.other,'POST',body)).status,403);
 const saved=await f.call('/catalogue-quotes',f.emp,'POST',body);assert.equal(saved.status,200,JSON.stringify(saved.data));
 assert.equal((await f.call('/catalogue-quotes',f.emp,'POST',body)).data.replayed,true);
 const snapshot=await f.call('/catalogue-quotes/'+id,f.emp);assert.equal(snapshot.data.state.meta.customerId,'catalogue-customer-a');assert.equal(snapshot.data.state.meta.customer,'Công ty cùng tên');
 const a=await f.call('/customers/catalogue-customer-a/overview',f.emp),b=await f.call('/customers/catalogue-customer-b/overview',f.mgr);
 assert.equal(a.status,200,JSON.stringify(a.data));assert.deepEqual(a.data.catalogueQuotes.map((q:{id:string})=>q.id),[id]);assert.equal(a.data.stats.revenue,0);assert.equal(b.data.catalogueQuotes.length,0,'same name never establishes a link');
 const hidden=await f.call('/customers/catalogue-customer-a/overview',f.other);assert.equal(hidden.data.catalogueQuotes.length,0);
 await f.db.insert(customerStaff).values({customerId:'catalogue-customer-a',memberId:'cashier2',role:'shared',createdBy:'mgr',createdAt:at});
 assert.equal((await f.call('/customers/catalogue-customer-a/overview',f.other)).data.catalogueQuotes.length,1);
 await f.db.delete(customerStaff).where(and(eq(customerStaff.customerId,'catalogue-customer-a'),eq(customerStaff.memberId,'cashier2')));
 // Unshared editors cannot move a shared catalogue document onto a customer they control.
 assert.equal((await f.call('/catalogue-quotes/'+id,f.other,'PUT',{revision:1,clientKey:crypto.randomUUID(),state:quote('catalogue-customer-b')})).status,403);
 const oldClient=structuredClone(snapshot.data.state);delete oldClient.meta.customerId;
 assert.equal((await f.call('/catalogue-quotes/'+id,f.emp,'PUT',{revision:1,clientKey:crypto.randomUUID(),state:oldClient})).status,200);
 assert.equal((await f.call('/catalogue-quotes/'+id,f.emp)).data.state.meta.customerId,'catalogue-customer-a','old clients cannot erase an existing link');
 await f.db.transaction(tx=>reassignCatalogueCustomer(tx,'catalogue-customer-b',['catalogue-customer-a']));
 assert.equal((await f.call('/customers/catalogue-customer-a/overview',f.mgr)).data.catalogueQuotes.length,0);
 assert.equal((await f.call('/customers/catalogue-customer-b/overview',f.mgr)).data.catalogueQuotes[0].id,id);
 const current=(await f.db.select().from(catalogueQuotes).where(eq(catalogueQuotes.id,id)))[0]!;
 assert.equal((await f.call('/catalogue-quotes/'+id+'/archive',f.mgr,'POST',{revision:current.revision,clientKey:crypto.randomUUID()})).status,200);
 assert.equal((await f.call('/customers/catalogue-customer-b/overview',f.mgr)).data.catalogueQuotes.length,0);
});

test('saving during customer merge never leaves a link to a deleted customer', {skip:!process.env.TEST_PG_URL}, async()=>{
 const f=await setup(),at=new Date().toISOString(),keep='catalogue-merge-keep',drop='catalogue-merge-drop',id=crypto.randomUUID();
 await f.db.insert(customers).values([keep,drop].map(id=>({id,name:'Khách đồng thời',contact:'',phone:'',email:'',address:'',search:'khach dong thoi',taxCode:'0101234567',sourceVersion:0,syncedAt:at,approvalStatus:'approved' as const,createdAt:at})));
 let release!:()=>void,reached!:()=>void;
 const gate=new Promise<void>(r=>release=r),selected=new Promise<void>(r=>reached=r),resolve=catalogueCustomerLinks.resolve;
 try{
  // Pause after validating the old customer, while the quote transaction is still open.
  catalogueCustomerLinks.resolve=async(db,actor,customerId)=>{const row=await resolve(db,actor,customerId);if(customerId===drop){reached();await gate;}return row;};
  const saving=f.call('/catalogue-quotes',f.mgr,'POST',{id,clientKey:crypto.randomUUID(),state:quote(drop)});
  await Promise.race([selected,saving.then(r=>{throw Error('Save ended before customer validation: '+JSON.stringify(r.data));})]);
  const merging=mergeCustomers(f.db,keep,[drop],'mgr');
  await new Promise(r=>setTimeout(r,150));release();
  const [saved]=await Promise.all([saving,merging]);assert.equal(saved.status,200,JSON.stringify(saved.data));
  const [row]=await f.db.select().from(catalogueQuotes).where(eq(catalogueQuotes.id,id));
  assert.equal(JSON.parse(row!.data).meta.customerId,keep);
  assert.equal((await f.db.select().from(customers).where(eq(customers.id,drop))).length,0);
 }finally{release();catalogueCustomerLinks.resolve=resolve;}
});
