import {test} from 'node:test';
import assert from 'node:assert/strict';
import {and,eq} from 'drizzle-orm';
import {setup} from '../helpers/pos-fixture.ts';
import {employees,positions} from '../../src/modules/staff/schema.ts';
import {provinceOptions} from '../../src/modules/customers/domain/province.ts';
import {customers,customerStaff} from '../../src/modules/customers/schema.ts';
import {customerCreateFixture} from '../helpers/customer-fixture.ts';
import {customerShareOptionsFixture as world} from '../helpers/customer-share-options-fixture.ts';
test('customer sharing choices exclude IT/design/warehouse while task recipients and customer ownership retain them',async()=>{
 const f=await world(),r=await f.call('/customers/staff-options',f.mgr);assert.equal(r.status,200);
 for(const id of ['it','thiet-ke','warehouse'])assert.equal(r.data.people.find((p:any)=>p.id==='share-'+id).canShare,false);
 assert.equal(r.data.people.find((p:any)=>p.id==='share-share-custom').canShare,true);assert.equal(r.data.people.find((p:any)=>p.id==='mgr').canShare,true);
 assert.ok(r.data.people.every((p:any)=>Object.keys(p).sort().join(',')==='canShare,id,name,role'));
 const tasks=await f.call('/tasks/people',f.mgr);assert.ok(tasks.data.people.some((p:any)=>p.id==='share-it'));
 const owner=await f.call('/customers/'+f.id+'/staff',f.mgr,'PUT',{ownerId:'share-it'});assert.equal(owner.status,200);assert.equal(owner.data.owner.id,'share-it');
 for(const cookie of ['',f.ncc])assert.ok([401,403].includes((await f.call('/customers/staff-options',cookie)).status));
});
test('new shares are denied on single-customer, creation and province APIs; eligible staff can still be shared',async()=>{
 const f=await world();
 const valid=await f.call('/customers/province-sharing/preview',f.mgr,'POST',{province:'79',memberIds:['share-share-custom']});assert.equal(valid.status,200,JSON.stringify(valid.data));
 for(const position of ['it','thiet-ke','warehouse']){
  const sharedIds=['share-'+position];
  assert.equal((await f.call('/customers/'+f.id+'/staff',f.mgr,'PUT',{sharedIds})).status,400);
  assert.equal((await f.call('/customers',f.mgr,'POST',customerCreateFixture({name:'Khách bị chặn '+position,sharedIds}))).status,400);
  const province=provinceOptions.find(p=>p.name==='Hồ Chí Minh')!.code;
  assert.equal((await f.call('/customers/province-sharing/preview',f.mgr,'POST',{province,memberIds:sharedIds})).status,400);
 }
 assert.equal((await f.call('/customers/'+f.id+'/staff',f.emp,'PUT',{sharedIds:['share-share-custom']})).status,200);
 const r=await f.call('/customers/'+f.id+'/staff',f.other,'PUT',{sharedIds:['mgr']});assert.equal(r.status,403);
});
test('existing excluded shares are retained without rewriting metadata, cannot be copied to another customer, and can be explicitly revoked',async()=>{
 const f=await world(),original={customerId:f.id,memberId:'share-it',role:'shared' as const,createdBy:'mgr',createdAt:'2026-01-01T00:00:00.000Z'};
 await f.db.insert(customerStaff).values(original);
 const r=await f.call('/customers/'+f.id+'/staff',f.mgr,'PUT',{sharedIds:['share-it','share-share-custom']});assert.equal(r.status,200);
 const [kept]=await f.db.select().from(customerStaff).where(and(eq(customerStaff.customerId,f.id),eq(customerStaff.memberId,'share-it')));assert.equal(kept!.createdAt,original.createdAt);assert.equal(kept!.createdBy,'mgr');
 const made=await f.call('/customers',f.mgr,'POST',customerCreateFixture({name:'Khách khác'}));assert.equal(made.status,201);
 assert.equal((await f.call('/customers/'+made.data.id+'/staff',f.mgr,'PUT',{sharedIds:['share-it']})).status,400);
 assert.equal((await f.call('/customers/'+f.id+'/staff',f.mgr,'PUT',{sharedIds:[]})).status,200);
 assert.equal((await f.db.select().from(customerStaff).where(and(eq(customerStaff.customerId,f.id),eq(customerStaff.role,'shared')))).length,0);
});
