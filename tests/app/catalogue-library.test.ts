import{test}from'node:test';import assert from'node:assert/strict';import{eq}from'drizzle-orm';
import{setupWarehouseWork}from'../helpers/warehouse-work-fixture.ts';
import{catalogueLibrary as lib}from'../../src/modules/catalog/catalogue-library-schema.ts';
import{catalogueLibraryHooks}from'../../src/modules/catalog/api/catalogue-stock.ts';
import{stockMoves}from'../../src/modules/inventory/schema.ts';
import{warehouses,productStock}from'../../src/modules/catalog/schema.ts';
import{auditLogs}from'../../src/core/db/schema.ts';
const product={name:'Bộ trà Sen trắng',sku:'031106000',brand:'Minh Long',category:'Bộ trà',collection:'Camellia',pattern:'Sen hồng',color:'Trắng',regular:100000,url:'https://minhlongonline.com/san-pham/bo-tra/',image:'',qty:99,discount:90,override:123,crmStock:{available:999999}};
test('library facets cascade through brand, category, collection and pattern',async()=>{
 const f=await setupWarehouseWork();const rows=[product,{...product,sku:'ML2',category:'Bình hoa',collection:'Hoa',pattern:'Sen',color:'Xanh'},{...product,sku:'ML3',collection:'Jasmine',pattern:'Trơn',color:'Đỏ'},{...product,sku:'BT1',brand:'Bát Tràng',category:'Khay mứt',collection:'Tết',pattern:'Đào',color:'Vàng'}];
 assert.equal((await f.call('/catalogue-library',f.cookies.emp,'POST',{products:rows.map((p,i)=>({clientId:'cascade-'+i,product:p}))})).status,200);
 const list=(params:Record<string,string>)=>f.call('/catalogue-library?'+new URLSearchParams({...params,includeStock:'0'}),f.cookies.emp);
 const bt=await list({brand:'Bát Tràng'});assert.deepEqual(bt.data.facets.category,['Khay mứt']);assert.deepEqual(bt.data.facets.collection,['Tết']);assert.equal(bt.data.facets.brand.length,2);
 const ml=await list({brand:'Minh Long',category:'Bộ trà',collection:'Camellia',pattern:'Sen hồng'});assert.equal(ml.data.facets.category.length,2);assert.deepEqual(ml.data.facets.collection.sort(),['Camellia','Jasmine']);assert.deepEqual(ml.data.facets.pattern,['Sen hồng']);assert.deepEqual(ml.data.facets.color,['Trắng']);assert.equal(ml.data.total,1);
 assert.deepEqual((await list({brand:'Unknown'})).data.facets.category,[]);
});
test('fast list skips stock and optional facets; unmatched SKUs never scan incoming stock',async()=>{
 const f=await setupWarehouseWork();await f.call('/catalogue-library',f.cookies.emp,'POST',{products:[{clientId:'a',product}]});
 const original=catalogueLibraryHooks.incoming;let calls=0;catalogueLibraryHooks.incoming=async()=>{calls++;return[];};
 try{
  const fast=await f.call('/catalogue-library?includeStock=0&facets=0',f.cookies.emp);assert.equal(fast.status,200,JSON.stringify(fast.data));assert.equal(fast.data.products.length,1);assert.equal(fast.data.facets,undefined);assert.equal(fast.data.stock,null);assert.equal(calls,0);
  const missing=await f.call('/catalogue-library/stock?skus=not-in-crm',f.cookies.emp);assert.equal(missing.status,200);assert.equal(missing.data.stock[0].known,false);assert.equal(missing.data.stock[0].available,null);assert.equal(calls,0);
  const actual=await f.call('/catalogue-library/stock?skus=031106000',f.cookies.emp);assert.equal(actual.status,200);assert.equal(calls,1);assert.equal(actual.data.stock[0].available,200);
 }finally{catalogueLibraryHooks.incoming=original;}
});
test('shared library authenticates, deduplicates simultaneous imports, shares between employees, filters all words without accents and strips quote/stock fields',async()=>{
 const f=await setupWarehouseWork();assert.equal((await f.call('/catalogue-library')).status,401);assert.equal((await f.call('/catalogue-library',f.cookies.ncc)).status,403);
 const post=(cookie:string|undefined,id:string)=>f.call('/catalogue-library',cookie,'POST',{products:[{clientId:id,product}]});
 const imported=process.env.TEST_PG_URL?await Promise.all([post(f.cookies.emp,'client-a'),post(f.cookies.sa,'client-b')]):[await post(f.cookies.emp,'client-a'),await post(f.cookies.sa,'client-b')];
 assert(imported.every(r=>r.status===200),JSON.stringify(imported));assert.equal(imported[0]!.data.products[0].id,imported[1]!.data.products[0].id);assert.equal((await f.db.select().from(lib)).length,1);
 const r=await f.call('/catalogue-library?q=TRANG%20sen&brand=Minh%20Long&category=B%E1%BB%99%20tr%C3%A0&collection=Camellia&pattern=Sen%20h%E1%BB%93ng&color=Tr%E1%BA%AFng',f.cookies.kt);assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.total,1);assert.equal(r.data.memberId,'kt');const p=r.data.products[0].product;
 for(const key of ['qty','discount','override','crmStock','customer','selected'])assert.equal(p[key],undefined,'quote-specific field must not be shared: '+key);
 assert.equal((await f.call('/catalogue-library?q=does-not-exist',f.cookies.emp)).data.total,0);assert.equal((await f.call('/catalogue-library?q=%25',f.cookies.emp)).data.total,0);assert.equal((await f.call('/catalogue-library?offset=-1',f.cookies.emp)).status,400);
 const partial=await f.call('/catalogue-library',f.cookies.emp,'POST',{products:[{clientId:'valid',product:{...product,sku:'different'}},{clientId:'bad',product:{...product,url:'https://user:pass@minhlongonline.com/a/'}}]});assert.equal(partial.status,200);assert.equal(partial.data.products.length,1);assert.equal(partial.data.errors[0].clientId,'bad');
});
test('every employee edits shared metadata with revision checks, lost-response replay and transactional audit',async()=>{
 const f=await setupWarehouseWork();const created=await f.call('/catalogue-library',f.cookies.emp,'POST',{products:[{clientId:'a',product}]});const row=created.data.products[0],body={revision:row.revision,clientKey:crypto.randomUUID(),product:{...row.product,name:'Bộ trà đã sửa',regular:200000}};
 const update=()=>f.call('/catalogue-library/'+row.id,f.cookies.kt,'PUT',body);assert.equal((await update()).status,200);assert.equal((await update()).data.revision,2);
 const conflict=await f.call('/catalogue-library/'+row.id,f.cookies.sa,'PUT',{...body,clientKey:crypto.randomUUID(),product:{...body.product,color:'Vàng'}});assert.equal(conflict.status,409);
 assert.equal((await f.call('/catalogue-library/'+row.id,f.cookies.kt,'PUT',{...body,product:{...body.product,regular:1}})).status,409);
 const logs=await f.db.select().from(auditLogs).where(eq(auditLogs.action,'catalogue-library-update'));assert.equal(logs.length,1);assert.equal(logs[0]!.actorId,'kt');assert.equal((await f.db.select().from(lib))[0]!.revision,2);
});
test('stock cards keep real available, incoming and supplier quantities separate, subtract holds, hide private warehouses and never write stock',async()=>{
 const f=await setupWarehouseWork(),at='2026-11-01T00:00:00Z';await f.db.insert(warehouses).values([{id:'supplier',name:'NCC nguồn',kind:'supplier'},{id:'fake-incoming',name:'Hàng chờ về',kind:'incoming'}]);await f.db.insert(productStock).values([{sku:'031106000',warehouseId:'supplier',quantity:500,updatedAt:at},{sku:'031106000',warehouseId:'fake-incoming',quantity:999999,updatedAt:at}]);
 const q=await f.call('/quotes',f.cookies.emp,'POST',{type:'B2B',quoteNo:'BG_LIBRARY_HOLD',customer:'Khách thử',vat:8,rows:[{name:'Bộ trà',sku:'031106000',unit:'Bộ',qty:30,price:1000}]});assert.equal(q.status,201,JSON.stringify(q.data));assert.equal((await f.call('/quotes/'+q.data.id+'/approve',f.cookies.mgr,'POST',{revision:1})).status,200);assert.equal((await f.call('/quotes/'+q.data.id+'/hold',f.cookies.emp,'POST',{})).status,201);
 const before=JSON.stringify(await f.db.select().from(stockMoves));const r=await f.call('/catalogue-library/stock?skus=031106000,missing',f.cookies.emp);assert.equal(r.status,200,JSON.stringify(r.data));const a=r.data.stock[0];assert.equal(a.available,170);assert.equal(a.supplier.qty,500);assert.equal(a.incoming.qty,20000);assert.equal(a.warehouses.length,2);assert(!JSON.stringify(r.data).includes('Kho riêng'));assert.equal(r.data.stock[1].available,null);assert.equal(JSON.stringify(await f.db.select().from(stockMoves)),before);
 const original=catalogueLibraryHooks.incoming;catalogueLibraryHooks.incoming=async()=>{throw Error('simulate incoming outage')};try{const unknown=(await f.call('/catalogue-library/stock?skus=031106000',f.cookies.emp)).data.stock[0];assert.equal(unknown.incoming,null);assert.equal(unknown.available,170);}finally{catalogueLibraryHooks.incoming=original;}
});
