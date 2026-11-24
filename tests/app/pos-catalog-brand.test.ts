import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setup} from '../helpers/pos-fixture.ts';
import {products,productPrices,productBarcodes} from '../../src/modules/catalog/schema.ts';
import {posRegisters} from '../../src/modules/sales/pos-schema.ts';
import {posCatalogFamily,posCatalogProductVisible} from '../../src/modules/sales/domain/pos-catalog-brand.ts';
test('register catalog only displays the store allowed brands, never common/unknown products',()=>{
 assert.equal(posCatalogFamily('CỬA HÀNG LOCKNLOCK CẦN THƠ'),'lock');
 assert.equal(posCatalogFamily('Showroom Gốm Sứ Minh Long Cần Thơ'),'minh-long');
 assert.equal(posCatalogFamily('MINH LONG - LOCKNLOCK CẦN THƠ'),null);
 for(const brand of ['MINH LONG','LYS','Healthy Cook','HEALTHYCOOK'])assert.equal(posCatalogProductVisible('Quầy Lock',{brand}),false);
 for(const brand of ['LocknLock','Lock&Lock','Lock & Lock'])assert.equal(posCatalogProductVisible('Quầy Minh Long',{brand}),false);
 assert.equal(posCatalogProductVisible('Quầy thử',{brand:'LYS'}),true);
 for(const brand of ['Bear','Sunhouse','Gốm Việt','',null])for(const register of ['Quầy Lock','Quầy Minh Long','Quầy thử'])assert.equal(posCatalogProductVisible(register,{brand,name:'Bình Lock Minh Long'}),false);
 for(const brand of ['Lock','LocknLock','Lock&Lock','LOCK & LOCK'])assert.equal(posCatalogProductVisible('Quầy Lock',{brand}),true);
 for(const brand of ['Minh Long','Minh Long I','Healthycook','Healthy Cook','LYS','Lys Horeca','HORECA'])assert.equal(posCatalogProductVisible('Quầy Minh Long',{brand}),true);
 assert.equal(posCatalogProductVisible('Quầy Lock',{name:'Túi giấy'}),false);
});
test('catalog scopes precede pagination and apply to barcode and local SKU hydration without changing stock or cart endpoints',async()=>{
 const f=await setup();
  await f.db.insert(products).values([['ML-A','MINH LONG'],['ML-B','LYS'],['ML-C','Healthy Cook'],['LOCK-A','Lock&Lock'],['LOCK-B','LocknLock'],['OTHER-A','Sunhouse'],['OTHER-B','Bear'],['OTHER-C','']].map(([sku,brand])=>({sku:sku!,brand:brand!,name:sku!,updatedAt:new Date().toISOString()})));
  await f.db.insert(productPrices).values(['ML-A','ML-B','ML-C','LOCK-A','LOCK-B','OTHER-A','OTHER-B','OTHER-C'].map(sku=>({sku,policyId:'retail-vat',price:10000})));
  await f.db.insert(productBarcodes).values({sku:'ML-A',barcode:'893123000001'});
  await f.db.insert(productBarcodes).values({sku:'OTHER-A',barcode:'893000000002'});
  const path='/pos/catalog?registerId='+f.registerId+'&pricePolicyId=retail-vat';
  const lock=await f.call(path+'&limit=2',f.mgr);assert.equal(lock.status,200);assert.equal(lock.data.products.length,2);assert.ok(lock.data.products.every((p:any)=>!p.sku.startsWith('ML-')));
  assert.ok(lock.data.products.every((p:any)=>p.sku.startsWith('LOCK-')||p.sku==='00123'));
  const other=await f.call(path+'&q=893000000002',f.mgr);assert.deepEqual(other.data.products,[]);assert.equal(other.data.exactSku,null);
  const snapshot=await f.call('/pos/stock-snapshot?registerId='+f.registerId+'&metadata=1',f.mgr);assert.ok(snapshot.data.catalog.every((p:any)=>p.sku.startsWith('LOCK-')||p.sku==='00123'));
  const next=await f.call(path+'&limit=2&offset='+lock.data.nextOffset,f.mgr);assert.ok(next.data.products.every((p:any)=>!p.sku.startsWith('ML-')));
  const scan=await f.call(path+'&q=893123000001',f.mgr);assert.deepEqual(scan.data.products,[]);assert.equal(scan.data.exactSku,null);
  const hydrate=await f.call(path+'&skus=ML-A,LOCK-A,OTHER-A',f.mgr);assert.deepEqual(hydrate.data.products.map((p:any)=>p.sku),['LOCK-A']);
  await f.db.update(posRegisters).set({name:'Showroom Gốm Sứ Minh Long Cần Thơ'}).where(eq(posRegisters.id,f.registerId));
  const ml=await f.call(path,f.mgr);assert.ok(ml.data.products.some((p:any)=>p.sku==='ML-B'));assert.ok(ml.data.products.every((p:any)=>p.sku.startsWith('ML-')));
  const allowedScan=await f.call(path+'&q=893123000001',f.mgr);assert.equal(allowedScan.data.exactSku,'ML-A');

});

test('paged SQL, preload and browser agree on brand-only matching, Unicode and misleading product names',async()=>{
 const {posBrandScope}=await import('../../src/modules/sales/api/pos-stock-snapshot.ts');
 const f=await setup();
 const cases=[['Minh Long','Chén'],['MINH','LONG Chén'],['','Bình Lock&Lock'],['Lock','nLock'],['Healthy','Cook'],['LÝS','Chén'],['LYS',''],['','Sứ dưỡng sinh'],['Gốm Việt','Chén chung'],['','Túi giấy'],['Minh Long Lock','Hỗn hợp'],['MINH LO\u0302NG','NFD'],['Minh Longx','Tên không trùng'],[null,'Lock & Lock'],['Horeca','Ly'],['Sunhouse','Bình Lock Minh Long'],['','']];
 await f.db.insert(products).values(cases.map(([brand,name],i)=>({sku:'EQ-'+i,brand:brand??'',name:name||'',updatedAt:''})));
 for(const register of ['Quầy Lock','Quầy Minh Long','Quầy chung','MINH LONG - LOCKNLOCK CẦN THƠ']){
  const old=await f.db.select({sku:products.sku}).from(products).where(posBrandScope(register)).orderBy(products.sku);
  const bulk=await f.db.select({sku:products.sku}).from(products).where(posBrandScope(register,{preload:true})).orderBy(products.sku);
  assert.deepEqual(bulk,old,register);
  const rows=await f.db.select({sku:products.sku,brand:products.brand,name:products.name}).from(products).orderBy(products.sku);
  assert.deepEqual(old.map(r=>r.sku),rows.filter(p=>posCatalogProductVisible(register,p)).map(p=>p.sku),'SQL and browser must agree: '+register);
 }
});
