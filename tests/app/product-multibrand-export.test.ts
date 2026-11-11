import {test} from 'node:test';
import assert from 'node:assert/strict';
import {multiBrandFixture} from '../helpers/product-multibrand-fixture.ts';
const ok=(r:any,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};
const skus=(r:any)=>r.products.map((p:any)=>p.sku).sort();
const query=(names:string[])=>new URLSearchParams(names.map(n=>['brand',n])).toString();
test('multi-brand list and export use OR within brands, AND with other filters; export includes later pages once',async()=>{
 const f=await multiBrandFixture(),c=f.cookies.emp!,q=query(f.brands.slice(0,2));
 const first=ok(await f.call('/products?'+q+'&limit=50',c)),second=ok(await f.call('/products?'+q+'&limit=50&offset=50',c)),exp=ok(await f.call('/products-export?'+q,c));
 assert.equal(first.total,58);assert.equal(first.products.length,50);assert.equal(second.products.length,8);assert.equal(exp.products.length,58);assert.equal(new Set(skus(exp)).size,58);assert.deepEqual(skus(exp),[...skus(first),...skus(second)].sort());assert.ok(exp.products.every((p:any)=>f.brands.slice(0,2).includes(p.brand)));
 assert.equal(ok(await f.call('/products?'+q+'&q=bo%20qua',c)).total,0);
 assert.equal(ok(await f.call('/products-export?'+q+'&policy=retail&min=100000',c)).products[0].sku,'B0');
 assert.equal(ok(await f.call('/products-export?'+query([f.brands[0]!])+'&q=B0',c)).products.length,0);
});
test('legacy single/all filters, duplicate names, unknown names and punctuation do not broaden or duplicate export',async()=>{
 const f=await multiBrandFixture(),c=f.cookies.emp!;
 assert.equal(ok(await f.call('/products-export',c)).products.length,63);
 assert.equal(ok(await f.call('/products-export?'+query([f.brands[0]!,f.brands[0]!]),c)).products.length,31);
 assert.deepEqual(skus(ok(await f.call('/products-export?'+query([f.brands[2]!]),c))),['C0','C1','C2']);
 assert.deepEqual(skus(ok(await f.call('/products-export?'+query(["x') OR 1=1 --"]),c))),[]);
 assert.equal(ok(await f.call('/products-export?brand=&'+query([f.brands[1]!]),c)).products.length,27);
 ok(await f.call('/products-export?'+query(Array.from({length:101},(_,i)=>'brand-'+i)),c),400);
});
test('filtered export reuses stock threshold and warehouse visibility; private stocks and sale prices stay protected',async()=>{
 const f=await multiBrandFixture(),q=query(f.brands.slice(0,2));
 const list=ok(await f.call('/products?'+q+'&minStock=10',f.cookies.emp)),exp=ok(await f.call('/products-export?'+q+'&minStock=10',f.cookies.emp));assert.deepEqual(skus(list),['A0']);assert.deepEqual(skus(exp),skus(list));assert.equal(exp.products[0].stock.public,12);assert.equal('private' in exp.products[0].stock,false);assert.ok(exp.warehouses.every((w:any)=>w.id!=='private'));
 ok(await f.call('/products-export?'+q+'&minStock=1&stockWarehouse=private',f.cookies.emp),400);
 assert.deepEqual(skus(ok(await f.call('/products-export?'+q+'&minStock=100',f.cookies.mgr))),['A0','B0']);
 const hidden=ok(await f.call('/products-export?'+q,f.cookies.wh));assert.equal(hidden.priced,false);assert.deepEqual(hidden.policies,[]);assert.ok(hidden.products.every((p:any)=>Object.keys(p.prices).length===0&&!('private' in p.stock)));
 ok(await f.call('/products-export?'+q),401);ok(await f.call('/products-export?'+q,f.cookies.ncc),403);
});
test('selected-SKU scope remains explicit and does not accidentally intersect brand filters',async()=>{
 const f=await multiBrandFixture(),r=ok(await f.call('/products-export?skus=C0,B0,OLD&brand=Minh+Long&minStock=1000000',f.cookies.emp));assert.deepEqual(skus(r),['B0','C0']);
 const state=await f.client.query<{total:number}>('select count(*)::int as total from products');assert.equal(state.rows[0]!.total,64,'read-only export must not change catalog rows');
});
