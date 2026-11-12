import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setupEarly} from '../helpers/purchase-early-fixture.ts';
import {suppliers} from '../../src/modules/suppliers/schema.ts';
import {employees} from '../../src/modules/staff/schema.ts';

test('supplier portal rejects foreign IDs and revoked access; response replay never writes money or stock',async()=>{
 const f=await setupEarly(),{call,cookies:c,db,client}=f;

  const made=await call('/purchase-early-requests',c.mgr,'POST',{clientKey:'boundary-review-001',scope:{supplierId:'a'},pickupDate:'2026-11-12',lines:[{sku:'031106000',quantity:1000}]});assert.equal(made.status,201);
  const sent=await call('/purchase-early-requests/'+made.data.id+'/submit',c.mgr,'POST',{revision:1});assert.equal(sent.status,200);
  const own=await call('/supplier-portal/early-requests?id='+made.data.id,c.ncc);assert.equal(own.status,200);assert.equal(own.data.requests.length,1);
  assert.equal((await call('/supplier-portal/early-requests?id='+made.data.id,c.ncc2)).status,404);
  const spoof=await call('/supplier-portal/early-requests?supplierId=b',c.ncc);assert.equal(spoof.status,200);assert.ok(spoof.data.requests.every((r:any)=>r.lines.every((l:any)=>l.allocations.every((a:any)=>a.supplierId==='a'))));
  for(const url of ['/products?q=a','/purchase-orders/a1','/purchase-orders/b1','/orders','/admin/members'])assert.equal((await call(url,c.ncc)).status,403,url);
  const line=own.data.requests[0].lines[0].id,path='/supplier-portal/early-requests/'+line+'/respond';
  assert.equal((await call(path,c.ncc2,'POST',{status:'accepted',supplierId:'a'})).status,404);
  assert.equal((await call(path,'','POST',{status:'accepted'})).status,401);
  for(const actor of ['mgr','emp','kt'])assert.equal((await call(path,c[actor],'POST',{status:'accepted'})).status,403);
  const counts=async()=>(await client.query('select (select count(*)::int from supplier_payments) as payments,(select count(*)::int from supplier_receipts) as receipts,(select count(*)::int from stock_moves) as moves')).rows[0];
  const before=await counts();const first=await call(path,c.ncc,'POST',{status:'accepted',note:'Xác nhận theo phiếu'});assert.equal(first.status,200);
  const repeat=await call(path,c.ncc,'POST',{status:'accepted',note:'Xác nhận theo phiếu'});assert.equal(repeat.status,200);assert.equal(repeat.data.replayed,true);
  assert.equal((await call(path,c.ncc,'POST',{status:'rejected'})).status,409);assert.deepEqual(await counts(),before);
  await db.update(suppliers).set({active:false}).where(eq(suppliers.id,'a'));
  assert.equal((await call('/supplier-portal/early-requests',c.ncc)).status,403);assert.equal((await call(path,c.ncc,'POST',{status:'accepted'})).status,403);
  await db.update(suppliers).set({active:true}).where(eq(suppliers.id,'a'));
  await db.update(employees).set({role:'manager',positionId:'supplier'}).where(eq(employees.id,'ncc'));
  assert.equal((await call('/products?q=a',c.ncc)).status,403,'supplier position remains scoped even with manager role');
  assert.equal((await call('/supplier-portal/early-requests',c.ncc)).status,200);
  await db.update(employees).set({active:false}).where(eq(employees.id,'ncc'));
  assert.equal((await call('/supplier-portal/early-requests',c.ncc)).status,401);assert.equal((await call(path,c.ncc,'POST',{status:'accepted'})).status,401);

});
