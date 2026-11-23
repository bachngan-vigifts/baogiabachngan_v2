import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup} from '../helpers/pos-fixture.ts';
import {products,productPrices,productStock,warehouses} from '../../src/modules/catalog/schema.ts';
const {fetchCatalogSnapshot}=await import(new URL('../../trial-ui/catalog-snapshot-loader.js',import.meta.url).href);

test('catalog pages preserve the complete legacy ordering/values; page version and visibility are checked',async()=>{
 const f=await setup();
 await f.db.insert(warehouses).values([{id:'paged-visible',name:'Kho hiển thị'},{id:'paged-private',name:'Kho riêng',stockPrivate:true}]);
 const skus=Array.from({length:1001},(_,i)=>'PAGE'+String(i).padStart(4,'0'));
 await f.db.insert(products).values(skus.map(sku=>({sku,name:'Sản phẩm '+sku,active:true,updatedAt:'2026-11-01T00:00:00Z'})));
 await f.db.insert(productPrices).values(skus.map(sku=>({sku,policyId:'retail-vat',price:12345})));
 await f.db.insert(productStock).values(skus.flatMap(sku=>[{sku,warehouseId:'paged-visible',quantity:4,updatedAt:'2026-11-01T00:00:00Z'},{sku,warehouseId:'paged-private',quantity:999,updatedAt:'2026-11-01T00:00:00Z'}]));
 const legacy=await f.call('/catalog-snapshot',f.emp);assert.equal(legacy.status,200);
 const first=await f.call('/catalog-snapshot?pageSize=500',f.emp);assert.equal(first.data.products.length,500);assert.equal(first.data.pagination.total,1002);
 assert(!first.data.warehouses.some((w:any)=>w.id==='paged-private'));
 const combined=await fetchCatalogSnapshot(async(path:string)=>{const r=await f.call(path,f.emp);if(r.status!==200)throw Object.assign(Error(r.data.error),{code:r.data.code});return r.data;});
 assert.deepEqual(combined,legacy.data);
 assert.equal((await f.call('/catalog-snapshot?pageSize=501',f.emp)).status,400);
 assert.equal((await f.call('/catalog-snapshot?pageSize=500&offset=500',f.emp)).status,400);
 const changed=await f.call('/catalog-snapshot?pageSize=500&offset=500&expectedVersion=old',f.emp);assert.equal(changed.status,409);assert.equal(changed.data.code,'CATALOG_SNAPSHOT_CHANGED');
 assert.equal((await f.call('/catalog-snapshot?pageSize=500',f.ncc)).status,403);
});

test('browser catalog loader caps concurrency at two and never returns a mixed/partial snapshot',async()=>{
 let active=0,peak=0,initial=0;const meta={policies:[],warehouses:[],columns:['sku']};
 const api=async(path:string)=>{const u=new URL(path,'https://example.test'),offset=Number(u.searchParams.get('offset')||0);active++;peak=Math.max(peak,active);
  try{await new Promise(r=>setTimeout(r,offset===500?5:1));if(offset===0)initial++;return{...meta,version:'v1',pagination:{total:1501,nextOffset:offset+500<1501?offset+500:null},products:Array.from({length:Math.min(500,1501-offset)},(_,i)=>[offset+i])};}finally{active--;}};
 const result=await fetchCatalogSnapshot(api);assert.equal(peak,2);assert.equal(result.products.length,1501);assert.deepEqual(result.products.map((r:number[])=>r[0]),Array.from({length:1501},(_,i)=>i));assert.equal(initial,1);
 let calls=0;
 await assert.rejects(fetchCatalogSnapshot(async(path:string)=>{calls++;const offset=Number(new URL(path,'https://example.test').searchParams.get('offset')||0);if(offset)throw Object.assign(Error('changed'),{code:'CATALOG_SNAPSHOT_CHANGED'});return{...meta,version:'v1',pagination:{total:501,nextOffset:500},products:Array(500).fill(['x'])};}),/changed/);assert.equal(calls,6);
 const unchanged={version:'v1',unchanged:true};assert.deepEqual(await fetchCatalogSnapshot(async()=>unchanged,'v1'),unchanged);
 const old={...meta,version:'legacy',products:[['x']]};assert.deepEqual(await fetchCatalogSnapshot(async()=>old),old);
 let denied=0;await assert.rejects(fetchCatalogSnapshot(async()=>{denied++;throw Object.assign(Error('denied'),{code:'FORBIDDEN'});}),/denied/);assert.equal(denied,1);
});

test('catalog retry drains its failed batch before starting a new version attempt',async()=>{
 let active=0,peak=0;
 await assert.rejects(fetchCatalogSnapshot(async(path:string)=>{
  const offset=Number(new URL(path,'https://example.test').searchParams.get('offset')||0);active++;peak=Math.max(peak,active);
  try{
   if(offset===500){await new Promise(r=>setTimeout(r,1));throw Object.assign(Error('changed'),{code:'CATALOG_SNAPSHOT_CHANGED'});}
   if(offset)await new Promise(r=>setTimeout(r,5));
   return{version:'v',columns:['sku'],policies:[],warehouses:[],pagination:{total:1501,nextOffset:500},products:Array(500).fill(['x'])};
  }finally{active--;}
 }),/changed/);
 assert.equal(peak,2);assert.equal(active,0);
});
