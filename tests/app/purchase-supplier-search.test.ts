import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setupEarly} from '../helpers/purchase-early-fixture.ts';
import {suppliers,supplierContacts} from '../../src/modules/suppliers/schema.ts';
const ok=(r:any)=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
test('purchasing supplier lookup searches accentless names, tax IDs, formatted phones and contact names without directory editing rights',async()=>{
 const f=await setupEarly(),now=new Date().toISOString();
 await f.db.update(suppliers).set({name:'CÔNG TY MỸ NGHỆ ĐẠI THÀNH',nameKey:'dai thanh',taxCode:'0101234567-001',phone:'0901.222.333'}).where(eq(suppliers.id,'a'));
 await f.db.insert(supplierContacts).values([{id:'contact-a',supplierId:'a',name:'Nguyễn Thị Ánh',phone:'0988 765 432',email:'contact@example.test',createdAt:now},{id:'contact-a2',supplierId:'a',name:'Nguyễn Hải',phone:'',email:'other@example.test',createdAt:now}]);
 await f.db.update(suppliers).set({name:'Đại Thành cũ',active:false}).where(eq(suppliers.id,'b'));
 for(const term of ['dai thanh','0101234567001','0901222333','anh nguyen','0988765432','dai 0988','nguyen hai']){
  const d=ok(await f.call('/purchase-options/suppliers?q='+encodeURIComponent(term),f.cookies.sa));assert.equal(d.suppliers.length,1,term);assert.equal(d.suppliers[0].id,'a');assert.equal(d.suppliers[0].contacts.length,2);assert.equal(d.suppliers[0].taxCode,'0101234567-001');
  assert.ok(!JSON.stringify(d).includes('contact@example.test'));assert.equal(d.suppliers[0].note,undefined);
 }
 assert.equal(ok(await f.call('/purchase-options/suppliers?q='+encodeURIComponent("' OR 1=1--"),f.cookies.sa)).suppliers.length,0);
 assert.equal(ok(await f.call('/purchase-options/suppliers?q=%25',f.cookies.sa)).suppliers.length,0);
 assert.equal((await f.call('/suppliers',f.cookies.emp)).status,403,'purchase lookup must not grant directory editing permission');
 assert.equal((await f.call('/purchase-options/suppliers?q=dai',f.cookies.ncc)).status,403);assert.equal((await f.call('/purchase-options/suppliers?q=dai')).status,401);
});
test('lookup is bounded and paginated without duplicate suppliers from multiple contacts; invalid paging is rejected',async()=>{
 const f=await setupEarly(),now=new Date().toISOString();await f.db.insert(suppliers).values(Array.from({length:25},(_,i)=>({id:'search-'+i,name:'NCC '+String(i).padStart(3,'0'),nameKey:'ncc-search-'+i,saleAdminBrand:'minhlong' as const,createdAt:now,createdBy:'mgr',updatedAt:now})));
 const first=ok(await f.call('/purchase-options/suppliers',f.cookies.sa)),second=ok(await f.call('/purchase-options/suppliers?offset='+first.nextOffset,f.cookies.sa));assert.equal(first.suppliers.length,12);assert.equal(first.nextOffset,12);assert.equal(second.suppliers.length,12);assert.equal(new Set([...first.suppliers,...second.suppliers].map(r=>r.id)).size,24);
 for(const offset of ['-1','0.5','NaN','10001'])assert.equal((await f.call('/purchase-options/suppliers?offset='+offset,f.cookies.sa)).status,400);
 const before=await f.db.select().from(suppliers);ok(await f.call('/purchase-options/suppliers?q=ncc',f.cookies.sa));assert.deepEqual(await f.db.select().from(suppliers),before);
});
