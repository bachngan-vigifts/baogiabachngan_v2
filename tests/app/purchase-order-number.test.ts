import {sql} from 'drizzle-orm';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {readFileSync} from 'node:fs';
import {createTestDb} from '../helpers/postgres.ts';
import {seedStaff,PASSWORD} from '../helpers/staff-fixture.ts';
import {createAppRouter} from '../../src/app/router.ts';
import {suppliers,incomingShipments,supplierReceipts,supplierReceiptLines,supplierOrderEvents} from '../../src/modules/suppliers/schema.ts';
import {requiresSupplierOrderNumber,supplierOrderNumberProblem} from '../../src/modules/suppliers/domain/order-number.ts';
import {bundleSupplierOrderNumber,SUPPLIER_ORDER_NUMBER_OUT} from '../../scripts/build-trial-ui.ts';
test('Minh Long matching is supplier-only and browser policy matches backend',()=>{
 for(const name of ['Minh Long','CÔNG TY TNHH MINH LONG I','  minh   long  ','MINHLONG'])assert(requiresSupplierOrderNumber(name));
 for(const name of ['Lys Ceramics','CÔNG TY TNHH LOCK & LOCK HCM','Minh Longan','Healthy Cook','',null])assert(!requiresSupplierOrderNumber(name));
 assert.equal(supplierOrderNumberProblem('Minh Long','',false),'');
 assert.match(supplierOrderNumberProblem('Minh Long',' \n ',true),/Minh Long/);
 assert.equal(supplierOrderNumberProblem('Lys','',true),'');
 assert.equal(supplierOrderNumberProblem('Minh Long','00123',true),'');
 assert.match(supplierOrderNumberProblem('Minh Long',123,true),/văn bản/);
 assert.match(supplierOrderNumberProblem('Minh Long','a'.repeat(101)),/100/);
 assert.equal(readFileSync(SUPPLIER_ORDER_NUMBER_OUT,'utf8'),bundleSupplierOrderNumber());
});
async function fixture(){
 const f=await createTestDb();await seedStaff(f.d1);await f.db.execute(sql`update staff_members set position_id='sale-admin' where id='emp'`);const router=createAppRouter();
 const env={db:f.db,passwordIterations:1000,sapoOrderPush:'off' as const};
 const call=async(path:string,cookie='',method='GET',body?:unknown)=>{
  const r=await router.handle(new Request('https://trial.test/api/staff'+path,{method,headers:{origin:'https://trial.test',cookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),env);
  return{status:r.status,data:await r.json() as any,cookie:r.headers.get('set-cookie')?.split(';')[0]||''};
 };
 const mgr=(await call('/login','','POST',{email:'mgr@x.vn',password:PASSWORD})).cookie,emp=(await call('/login','','POST',{email:'emp@x.vn',password:PASSWORD})).cookie;
 const now=new Date().toISOString();
 await f.db.insert(suppliers).values([{id:'ml',name:'CÔNG TY TNHH MINH LONG I',nameKey:'minh long',saleAdminBrand:'minhlong',createdAt:now,updatedAt:now,createdBy:'mgr'},{id:'other',name:'Lys Ceramics',nameKey:'lys ceramics',saleAdminBrand:'locknlock',createdAt:now,updatedAt:now,createdBy:'mgr'}]);
 const order=(supplierId='ml',internalNo?:unknown)=>({supplierId,warehouse:'Kho kiểm thử',internalNo,lines:[{sku:'001',name:'Ly Minh Long',quantity:2}]});
 const get=async(id:string)=>(await call('/purchase-orders/'+id,mgr)).data;
 const create=async(supplierId='ml',internalNo?:unknown)=>{
  const r=await call('/purchase-orders',emp,'POST',{orders:[order(supplierId,internalNo)]});assert.equal(r.status,201,JSON.stringify(r.data));return get(r.data.ids[0]);
 };
 const approve=async(v:any,extra:object={},cookie=mgr)=>call('/purchase-orders/'+v.id+'/approve',cookie,'POST',{revision:v.revision,lines:v.lines.map((l:any)=>({lineId:l.id,price:100,taxRate:8})),...extra});
 return{...f,call,mgr,emp,order,get,create,approve};
}
test('employee drafts can omit/edit numbers; approval requires Minh Long number atomically with existing permissions/revision',async()=>{
 const f=await fixture();
  let v=await f.create();assert.equal(v.internalNo,'');
  const empty=await f.approve(v);assert.equal(empty.status,400);assert.match(empty.data.error||empty.data.message,/Minh Long/);
  let unchanged=await f.get(v.id);assert.equal(unchanged.revision,v.revision);assert.equal(unchanged.state,'draft');assert.equal(unchanged.lines[0].price,null);
  assert.equal((await f.approve(v,{internalNo:'   '})).status,400);
  assert.equal((await f.approve(v,{internalNo:'001'},f.emp)).status,403);
  const edit=await f.call('/purchase-orders/'+v.id,f.emp,'PUT',{revision:v.revision,...f.order('ml','  000123  ')});
  assert.equal(edit.status,200,JSON.stringify(edit.data));v=edit.data;assert.equal(v.internalNo,'000123');
  assert.equal((await f.approve(v,{revision:v.revision-1})).status,409);
  const ok=await f.approve(v);assert.equal(ok.status,200,JSON.stringify(ok.data));v=ok.data;assert.equal(v.internalNo,'000123');
  const reject=await f.call('/purchase-orders/'+v.id+'/confirm',f.mgr,'POST',{revision:v.revision,internalNo:' \n ',arrivalDate:'2027-01-01',lines:[{lineId:v.lines[0].id,promisedDate:'2027-02-01'}]});
  assert.equal(reject.status,400);
  unchanged=await f.get(v.id);assert.equal(unchanged.revision,v.revision);assert.equal(unchanged.confirmedAt,null);assert.notEqual(unchanged.lines[0].promisedDate,'2027-02-01');
  const confirmed=await f.call('/purchase-orders/'+v.id+'/confirm',f.mgr,'POST',{revision:v.revision});
  assert.equal(confirmed.status,200,JSON.stringify(confirmed.data));assert.equal(confirmed.data.internalNo,'000123');
  // Another supplier containing Minh Long products still has no compulsory supplier number.
  const other=await f.approve(await f.create('other'));assert.equal(other.status,200,JSON.stringify(other.data));
  assert.equal((await f.call('/purchase-orders/'+other.data.id+'/confirm',f.mgr,'POST',{revision:other.data.revision,internalNo:''})).status,200);

});
test('split drafts keep per-supplier numbers; switching supplier clears an omitted number; manager can provide it at approval',async()=>{
 const f=await fixture();
  const r=await f.call('/purchase-orders',f.emp,'POST',{orders:[f.order('ml','  000-A  '),f.order('other')]});assert.equal(r.status,201);
  let a=await f.get(r.data.ids[0]),b=await f.get(r.data.ids[1]);assert.equal(a.internalNo,'000-A');assert.equal(b.internalNo,'');
  const preserve=await f.call('/purchase-orders/'+a.id,f.emp,'PUT',{revision:a.revision,...f.order('ml')});assert.equal(preserve.data.internalNo,'000-A');
  const change=await f.call('/purchase-orders/'+a.id,f.emp,'PUT',{revision:preserve.data.revision,...f.order('other')});assert.equal(change.data.internalNo,'');
  const direct=await f.approve(await f.create(),{internalNo:'  001-ML  '});assert.equal(direct.status,200);assert.equal(direct.data.internalNo,'001-ML');
  const fresh=await f.create();const prices=await f.call('/purchase-orders/'+fresh.id+'/prices',f.mgr,'POST',{revision:fresh.revision,lines:[{lineId:fresh.lines[0].id,price:100}]});assert.equal(prices.status,200);assert.equal(prices.data.internalNo,'');
  // Legacy approved orders can still supply the missing number at the selected confirmation step.
  await f.db.update(incomingShipments).set({approvalStatus:'approved',approvedAt:new Date().toISOString(),approvedBy:'mgr'}).where(eq(incomingShipments.id,fresh.id));
  const legacy=await f.get(fresh.id);
  assert.equal((await f.call('/purchase-orders/'+legacy.id+'/confirm',f.mgr,'POST',{revision:legacy.revision})).status,400);
  const fixed=await f.call('/purchase-orders/'+legacy.id+'/confirm',f.mgr,'POST',{revision:legacy.revision,internalNo:'000-LEGACY'});
  assert.equal(fixed.status,200,JSON.stringify(fixed.data));assert.equal(fixed.data.internalNo,'000-LEGACY');
  const before=(await f.db.select().from(incomingShipments)).length;
  for(const invalid of [123,null,'X'.repeat(101)]){
   assert.equal((await f.call('/purchase-orders',f.emp,'POST',{orders:[f.order('other'),f.order('ml',invalid)]})).status,400);
   assert.equal((await f.db.select().from(incomingShipments)).length,before,'bad batch creates no partial orders');
  }

});


test('supplier reference can be supplemented after approval, confirmation, partial/full receipt without changing commercial or receipt state',async()=>{
 const f=await fixture();let v=await f.create(),now=new Date().toISOString();
 const update=(cookie:string,revision:unknown,internalNo:unknown,extra={})=>f.call('/purchase-orders/'+v.id+'/supplier-reference',cookie,'PUT',{revision,internalNo,...extra});
 assert.equal((await update(f.mgr,v.revision,'DRAFT')).status,409);
 await f.db.update(incomingShipments).set({approvalStatus:'approved',approvedAt:now,approvedBy:'mgr'}).where(eq(incomingShipments.id,v.id));
 for(const [i,state] of ['awaiting_confirmation','confirmed','partially_received','received'].entries()){
  if(i===1)await f.db.update(incomingShipments).set({supplierStatus:'confirmed',supplierConfirmedAt:now,supplierConfirmedBy:'mgr'}).where(eq(incomingShipments.id,v.id));
  if(i===2){await f.db.insert(supplierReceipts).values({id:'reference-receipt',receiptNo:'PNH-REF',shipmentId:v.id,receivedDate:'2026-11-19',receivedBy:'mgr',warehouse:'Kho kiểm thử',clientKey:'reference-only',createdAt:now});await f.db.insert(supplierReceiptLines).values({receiptId:'reference-receipt',lineId:v.lines[0].id,sku:v.lines[0].sku,goodQty:1});}
  if(i===3)await f.db.update(supplierReceiptLines).set({goodQty:2}).where(eq(supplierReceiptLines.receiptId,'reference-receipt'));
  v=await f.get(v.id);assert.equal(v.state,state);
  const before=v,result=await update(i%2?f.emp:f.mgr,v.revision,'  000-NCC-'+i+'  ',{lines:[],approvalStatus:'pending',supplierStatus:'pending'});
  assert.equal(result.status,200,JSON.stringify(result.data));v=await f.get(v.id);assert.equal(v.internalNo,'000-NCC-'+i);assert.equal(v.revision,before.revision+1);
  for(const key of ['state','approvedAt','confirmedAt','supplier','lines','receipts','progress','totals','schedules','payments'])assert.deepEqual(v[key],before[key],key);
  assert.equal((await update(f.mgr,before.revision,'STALE')).status,409);
  const repeat=await update(f.mgr,v.revision,v.internalNo);assert.equal(repeat.status,200);assert.equal(repeat.data.revision,v.revision);
 }
 for(const value of ['', '  ', null, 123, 'X'.repeat(101)])assert.equal((await update(f.mgr,v.revision,value)).status,400);
 assert.equal((await update(f.mgr,undefined,'NO-REVISION')).status,400);
 assert.equal((await update('',v.revision,'NO-SESSION')).status,401);
 await f.db.update(incomingShipments).set({createdBy:'mgr'}).where(eq(incomingShipments.id,v.id));
 await f.db.execute(sql`delete from staff_position_permissions where position_id='sale-admin' and permission='purchases.confirm'`);
 assert.equal((await update(f.emp,v.revision,'UNRELATED')).status,403);
 const events=await f.db.select().from(supplierOrderEvents).where(eq(supplierOrderEvents.shipmentId,v.id));
 assert.equal(events.filter(e=>e.action==='supplier-reference').length,4);
 assert.deepEqual(JSON.parse(events.filter(e=>e.action==='supplier-reference')[0]!.data),{before:'',after:'000-NCC-0'});
 await f.db.update(incomingShipments).set({cancelledAt:now}).where(eq(incomingShipments.id,v.id));
 assert.equal((await update(f.mgr,v.revision,'CANCELLED')).status,409);
});
