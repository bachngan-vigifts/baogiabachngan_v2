import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setup} from '../helpers/pos-fixture.ts';
import {products,productPrices,productBarcodes} from '../../src/modules/catalog/schema.ts';
import {posRegisters} from '../../src/modules/sales/pos-schema.ts';
import {posCatalogFamily,posCatalogProductVisible} from '../../src/modules/sales/domain/pos-catalog-brand.ts';
test('register catalog families preserve common/unknown products and use explicit register names',()=>{
 assert.equal(posCatalogFamily('CỬA HÀNG LOCKNLOCK CẦN THƠ'),'lock');
 assert.equal(posCatalogFamily('Showroom Gốm Sứ Minh Long Cần Thơ'),'minh-long');
 assert.equal(posCatalogFamily('MINH LONG - LOCKNLOCK CẦN THƠ'),null);
 for(const brand of ['MINH LONG','LYS','Healthy Cook','HEALTHYCOOK'])assert.equal(posCatalogProductVisible('Quầy Lock',{brand}),false);
 for(const brand of ['LocknLock','Lock&Lock','Lock & Lock'])assert.equal(posCatalogProductVisible('Quầy Minh Long',{brand}),false);
 assert.equal(posCatalogProductVisible('Quầy thử',{brand:'LYS'}),true);
 assert.equal(posCatalogProductVisible('Quầy Lock',{name:'Túi giấy'}),true);
});
test('catalog scopes precede pagination and apply to barcode and local SKU hydration without changing stock or cart endpoints',async()=>{
 const f=await setup();
  await f.db.insert(products).values([['ML-A','MINH LONG'],['ML-B','LYS'],['ML-C','Healthy Cook'],['LOCK-A','Lock&Lock'],['LOCK-B','LocknLock']].map(([sku,brand])=>({sku:sku!,brand:brand!,name:sku!,updatedAt:new Date().toISOString()})));
  await f.db.insert(productPrices).values(['ML-A','ML-B','ML-C','LOCK-A','LOCK-B'].map(sku=>({sku,policyId:'retail-vat',price:10000})));
  await f.db.insert(productBarcodes).values({sku:'ML-A',barcode:'893123000001'});
  const path='/pos/catalog?registerId='+f.registerId+'&pricePolicyId=retail-vat';
  const lock=await f.call(path+'&limit=2',f.mgr);assert.equal(lock.status,200);assert.equal(lock.data.products.length,2);assert.ok(lock.data.products.every((p:any)=>!p.sku.startsWith('ML-')));
  const next=await f.call(path+'&limit=2&offset='+lock.data.nextOffset,f.mgr);assert.ok(next.data.products.every((p:any)=>!p.sku.startsWith('ML-')));
  const scan=await f.call(path+'&q=893123000001',f.mgr);assert.deepEqual(scan.data.products,[]);assert.equal(scan.data.exactSku,null);
  const hydrate=await f.call(path+'&skus=ML-A,LOCK-A',f.mgr);assert.deepEqual(hydrate.data.products.map((p:any)=>p.sku),['LOCK-A']);
  await f.db.update(posRegisters).set({name:'Showroom Gốm Sứ Minh Long Cần Thơ'}).where(eq(posRegisters.id,f.registerId));
  const ml=await f.call(path,f.mgr);assert.ok(ml.data.products.some((p:any)=>p.sku==='ML-B'));assert.ok(ml.data.products.every((p:any)=>!p.sku.startsWith('LOCK-')));
  const allowedScan=await f.call(path+'&q=893123000001',f.mgr);assert.equal(allowedScan.data.exactSku,'ML-A');

});
