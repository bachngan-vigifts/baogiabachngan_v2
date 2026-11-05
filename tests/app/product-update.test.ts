import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setup} from '../helpers/pos-fixture.ts';
import {products,productPrices,productStock} from '../../src/modules/catalog/schema.ts';
import {employees} from '../../src/modules/staff/schema.ts';
import {auditLogs} from '../../src/core/db/schema.ts';

test('manual product creation rejects missing/zero retail and VAT prices before inserting; manager and staff still follow approval rules',async()=>{
 const f=await setup(),sku='REQUIRED-PRICES',base={sku,name:'Giá bắt buộc'};
 for(const prices of [undefined,{}, {retail:100000}, {'retail-vat':108000}, {retail:0,'retail-vat':108000}, {retail:100000,'retail-vat':0}, {retail:true,'retail-vat':108000}, {retail:0.4,'retail-vat':108000}]){
  const r=await f.call('/products',f.mgr,'POST',{...base,prices});assert.equal(r.status,400,JSON.stringify(r.data));
  assert.equal((await f.db.select().from(products).where(eq(products.sku,sku))).length,0);
  assert.equal((await f.db.select().from(productPrices).where(eq(productPrices.sku,sku))).length,0);
 }
 const prices={retail:100000,'retail-vat':108000};
 assert.equal((await f.call('/products',f.emp,'POST',{...base,prices})).data.approvalStatus,'pending');
 assert.equal((await f.call('/products',f.mgr,'POST',{...base,sku:sku+'-MGR',prices})).data.approvalStatus,'approved');
 const saved=await f.db.select().from(productPrices).where(eq(productPrices.sku,sku));
 assert.deepEqual(Object.fromEntries(saved.map(p=>[p.policyId,p.price])),prices);
});

test('Manager cập nhật sản phẩm/giá: giữ SKU, thuế, kho, trạng thái và ID Sapo; ghi audit, chặn ghi đè bản cũ',async()=>{
 const f=await setup();
 await f.db.update(products).set({sapoProductId:'sapo-123',taxable:true,taxIn:8,taxOut:10,taxBasis:'Chưa VAT',perCarton:12}).where(eq(products.sku,'00123'));
 const original=(await f.call('/products/00123',f.mgr)).data.product;
 const stocks=await f.db.select().from(productStock).where(eq(productStock.sku,'00123'));
 const body={sku:'00123',name:'Ly đã cập nhật',brand:'Minh Long',unit:'bộ',pattern:'Trắng',imageUrl:'https://example.com/ly.png',prices:{retail:123456,'retail-vat':0},expectedUpdatedAt:original.updatedAt};
 assert.equal((await f.call('/products/00123',f.ncc,'PUT',body)).status,403);
 assert.equal((await f.call('/products/00123','','PUT',body)).status,401);
 assert.equal((await f.call('/products/00123',f.mgr,'PUT',{...body,sku:'OTHER'})).status,400);
 assert.equal((await f.call('/products/00123',f.mgr,'PUT',{...body,prices:{retail:-1}})).status,400);
 assert.equal((await f.call('/products/00123',f.mgr,'PUT',{...body,prices:{unknown:1}})).status,400);
 assert.equal((await f.call('/products/00123',f.mgr,'PUT',{...body,expectedUpdatedAt:''})).status,400);
 assert.equal((await f.call('/products/00123',f.mgr)).data.product.name,original.name,'invalid inputs write nothing');
 const saved=await f.call('/products/00123',f.mgr,'PUT',body);assert.equal(saved.status,200,JSON.stringify(saved.data));
 const p=(await f.call('/products/00123',f.mgr)).data.product;
 for(const key of ['sku','taxable','taxIn','taxOut','taxBasis','perCarton','sapoProductId','approvalStatus','active','createdBy','approvedBy'])assert.equal(p[key],original[key],key);
 for(const key of ['name','brand','unit','pattern','imageUrl'] as const)assert.equal(p[key],body[key]);
 assert.equal(p.prices.find((v:any)=>v.policyId==='retail').price,123456);assert.equal(p.prices.find((v:any)=>v.policyId==='retail-vat').price,0);
 assert.deepEqual(await f.db.select().from(productStock).where(eq(productStock.sku,'00123')),stocks);
 const stale=await f.call('/products/00123',f.mgr,'PUT',{...body,name:'Ghi đè cũ'});assert.equal(stale.status,409);assert.equal(stale.data.code,'PRODUCT_CHANGED');
 const audits=await f.db.select().from(auditLogs).where(eq(auditLogs.entityId,'00123'));assert.equal(audits.filter(a=>a.action==='update').length,1);
 const clear=await f.call('/products/00123',f.mgr,'PUT',{...body,expectedUpdatedAt:p.updatedAt,prices:{retail:null}});assert.equal(clear.status,200);
 const prices=await f.db.select().from(productPrices).where(eq(productPrices.sku,'00123'));assert.equal(prices.find(v=>v.policyId==='retail')!.price,null);assert.equal(prices.find(v=>v.policyId==='retail-vat')!.price,0,'omitted policies unchanged');
 const pending=await f.call('/products',f.emp,'POST',{sku:'WAIT-UPDATE',name:'Chờ duyệt',prices:{retail:100000,'retail-vat':108000}});assert.equal(pending.status,201);
 const waiting=(await f.call('/products/WAIT-UPDATE',f.mgr)).data.product;
 assert.equal((await f.call('/products/WAIT-UPDATE',f.mgr,'PUT',{...body,sku:'WAIT-UPDATE',expectedUpdatedAt:waiting.updatedAt})).status,409);
 assert.equal((await f.call('/products/MISSING',f.mgr,'PUT',{...body,sku:'MISSING'})).status,404);
});


test('Nhân viên các vị trí cập nhật danh mục; kho không ghi đè giá bị ẩn',async()=>{
 const f=await setup();
 const stocks=await f.db.select().from(productStock);
 const prices=await f.db.select().from(productPrices);
 for(const positionId of ['sales-lock','sale-admin','accounting','warehouse']){
  await f.db.update(employees).set({positionId}).where(eq(employees.id,'emp'));
  const current=(await f.call('/products/00123',f.emp)).data.product;
  const body={sku:current.sku,name:`Ly ${positionId}`,brand:current.brand,unit:current.unit,pattern:current.pattern,imageUrl:current.imageUrl,prices:{},expectedUpdatedAt:current.updatedAt};
  const saved=await f.call('/products/00123',f.emp,'PUT',body);
  assert.equal(saved.status,200,JSON.stringify(saved.data));
  assert.equal((await f.call('/products/00123',f.mgr)).data.product.name,body.name);
  assert.equal((await f.call('/products/00123',f.emp,'PUT',body)).status,409);
  if(positionId==='warehouse'){
   assert.deepEqual(current.prices,[]);
   const latest=(await f.call('/products/00123',f.emp)).data.product;
   assert.equal((await f.call('/products/00123',f.emp,'PUT',{...body,expectedUpdatedAt:latest.updatedAt,prices:{retail:1}})).status,403);
  }
 }
 assert.deepEqual(await f.db.select().from(productPrices),prices);
 assert.deepEqual(await f.db.select().from(productStock),stocks);
 const audit=await f.db.select().from(auditLogs).where(eq(auditLogs.entityId,'00123'));
 assert.equal(audit.filter(a=>a.action==='update' && a.actorId==='emp').length,4);
 await f.db.update(employees).set({positionId:'sales-lock'}).where(eq(employees.id,'emp'));
 const latest=(await f.call('/products/00123',f.emp)).data.product;
 assert.equal((await f.call('/products/00123',f.emp,'PUT',{...latest,expectedUpdatedAt:latest.updatedAt,prices:{retail:120000}})).status,200);
 assert.equal((await f.call('/products/00123',f.mgr)).data.product.prices.find((p:any)=>p.policyId==='retail').price,120000);
});

test('carton dimensions/weight are editable and audited; omitted fields survive old clients, null clears, invalid quantities write nothing',async()=>{
 const f=await setup(),current=(await f.call('/products/00123',f.emp)).data.product;
 const body={...current,prices:{},expectedUpdatedAt:current.updatedAt,perCarton:12,cartonLength:40.8,cartonWidth:28.3,cartonHeight:23.6,cartonWeight:5.25};
 const stock=await f.db.select().from(productStock);
 for(const patch of [{perCarton:1.5},{cartonWeight:-1},{cartonLength:'abc'},{cartonHeight:1e9}])assert.equal((await f.call('/products/00123',f.emp,'PUT',{...body,...patch})).status,400);
 assert.equal((await f.call('/products/00123',f.emp,'PUT',body)).status,200);
 const next=(await f.call('/products/00123',f.emp)).data.product;
 for(const k of ['perCarton','cartonLength','cartonWidth','cartonHeight','cartonWeight'])assert.equal(next[k],(body as any)[k]);
 assert.deepEqual(await f.db.select().from(productStock),stock);
 const audit=await f.db.select().from(auditLogs).where(eq(auditLogs.entityId,'00123'));assert.ok(audit.some(a=>a.action==='update'&&JSON.parse(a.data).after.cartonWeight===5.25));
 assert.equal((await f.call('/products/00123',f.emp,'PUT',{...next,prices:{},expectedUpdatedAt:next.updatedAt,cartonWeight:null})).status,200);
 assert.equal((await f.call('/products/00123',f.emp)).data.product.cartonWeight,null);
});
