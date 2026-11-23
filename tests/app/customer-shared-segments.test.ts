import {test} from 'node:test';
import assert from 'node:assert/strict';
import {and,eq} from 'drizzle-orm';
import {setup} from '../helpers/pos-fixture.ts';
import {customers,customerStaff} from '../../src/modules/customers/schema.ts';
import {employees} from '../../src/modules/staff/schema.ts';

test('Sale finds owned/shared retail and B2B customers in directory and quote pickers; revocation hides retail again',async()=>{
 const f=await setup(),at=new Date().toISOString();
 await f.db.update(employees).set({positionId:'sale'}).where(eq(employees.id,'emp'));
 const ids=['scope-retail-shared','scope-retail-owner','scope-retail-hidden','scope-business-shared','scope-pending'];
 await f.db.insert(customers).values(ids.map(id=>({id,name:id,contact:'',phone:'',email:'',address:'',search:id.replaceAll('-',' '),sourceVersion:0,syncedAt:at,isRetail:!id.includes('business'),customerType:'scope group',approvalStatus:id==='scope-pending'?'pending' as const:'approved' as const})));
 await f.db.insert(customerStaff).values(ids.filter(id=>id!=='scope-retail-hidden').map(id=>({customerId:id,memberId:'emp',role:id==='scope-retail-owner'?'owner' as const:'shared' as const,createdBy:'mgr',createdAt:at})));
 const idsOf=(r:any)=>r.data.customers.map((c:any)=>c.id).sort();
 const expected=['scope-business-shared','scope-retail-owner','scope-retail-shared'];
 for(const path of ['/customers?mine=1&usable=1&q=scope','/customers?usable=1&limit=8&q=scope','/catalogue-customers?q=scope']){
  const r=await f.call(path,f.emp);assert.equal(r.status,200,JSON.stringify(r.data));assert.deepEqual(idsOf(r),expected,path);
 }
 const retail=await f.call('/customers?mine=1&kind=retail&usable=1&q=scope',f.emp);
 assert.deepEqual(idsOf(retail),['scope-retail-owner','scope-retail-shared']);assert.equal(retail.data.canListRetail,false,'does not grant the general retail directory');
 assert.deepEqual(idsOf(await f.call('/customers?mine=1&kind=business&usable=1&q=scope',f.emp)),['scope-business-shared']);
 assert.deepEqual(idsOf(await f.call('/pos/customers?q=scope',f.emp)),expected);
 assert.deepEqual(idsOf(await f.call('/pos/customers?q=scope&kind=retail',f.emp)),expected);
 assert.equal((await f.call('/catalogue-customers?id=scope-retail-shared',f.emp)).status,200);
 assert.equal((await f.call('/catalogue-customers?id=scope-retail-hidden',f.emp)).status,404);
 assert.equal((await f.call('/catalogue-customers?id=scope-pending',f.emp)).status,400);
 assert.ok((await f.call('/customers/types',f.emp)).data.types.includes('scope group'));
 await f.db.delete(customerStaff).where(and(eq(customerStaff.customerId,'scope-retail-shared'),eq(customerStaff.memberId,'emp')));
 assert.deepEqual(idsOf(await f.call('/customers?mine=1&usable=1&q=scope',f.emp)),['scope-business-shared','scope-retail-owner']);
 assert.equal((await f.call('/catalogue-customers?id=scope-retail-shared',f.emp)).status,404);
 assert.ok(!idsOf(await f.call('/pos/customers?q=scope',f.emp)).includes('scope-retail-shared'));
 assert.ok(!idsOf(await f.call('/customers?usable=1&limit=8&q=scope',f.emp)).includes('scope-retail-shared'));
 assert.ok(idsOf(await f.call('/customers?kind=retail&q=scope',f.mgr)).includes('scope-retail-hidden'));
});
