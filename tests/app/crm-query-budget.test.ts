import{test}from'node:test';import assert from'node:assert/strict';import{drizzle}from'drizzle-orm/pglite';import{setup}from'../helpers/pos-fixture.ts';import * as schema from'../../src/db/schema.ts';import{products,productPrices}from'../../src/modules/catalog/schema.ts';
test('product lists and full POS stock preload keep a fixed query budget as result size grows',async()=>{
 const f=await setup(),items=Array.from({length:50},(_,i)=>({sku:'QUERY-'+i,name:'Sản phẩm chung '+i,brand:'LocknLock',updatedAt:new Date().toISOString()}));
 await f.db.insert(products).values(items);await f.db.insert(productPrices).values(items.map(x=>({sku:x.sku,policyId:'retail-vat',price:1000})));
 let queries=0;f.env.db=drizzle(f.client as any,{schema,logger:{logQuery(){queries++;}}}) as unknown as typeof f.db;
 await f.call('/me',f.emp);
 const measure=async(path:string)=>{queries=0;const r=await f.call(path,f.emp);assert.equal(r.status,200);return{queries,data:r.data};};
 const one=await measure('/products?limit=1'),many=await measure('/products?limit=50');assert.equal(one.data.products.length,1);assert.equal(many.data.products.length,50);assert.equal(many.queries,one.queries,'no query-per-product N+1');
 const a=await measure('/pos/stock-snapshot?registerId='+f.registerId),b=await measure('/pos/stock-snapshot?registerId='+f.registerId+'&metadata=2');assert.ok(a.data.rows.length>=50);assert.equal(b.data.rows.length,a.data.rows.length);assert.equal(a.queries,b.queries,'metadata uses the same authorized stock/price scan');assert.ok(a.queries<=40,'whole preload must remain bounded');
});
