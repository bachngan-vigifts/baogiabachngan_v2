import{test}from'node:test';import assert from'node:assert/strict';import{eq}from'drizzle-orm';
import{setupWarehouseWork}from'../helpers/warehouse-work-fixture.ts';import{catalogueQuotes as quotes,catalogueQuoteCommands as commands}from'../../src/modules/catalog/catalogue-library-schema.ts';
// @ts-expect-error browser JS module is covered by integration tests
import{defaultState,validateProduct}from'../../trial-ui/catalogue/core.js';
const state=()=>{const s=defaultState();s.products=[validateProduct({id:'product-1',name:'Bộ trà',sku:'00123',brand:'Minh Long',category:'Bộ trà',regular:200000,discount:10,fee:15000,override:188888,qty:7}),validateProduct({id:'not-selected',name:'Không chia sẻ',brand:'Minh Long',category:'Bộ trà',regular:1,discount:0,fee:0})];s.selected=['product-1'];s.meta.customer='Khách hàng chung';s.products[0].sharedPendingFor='private-owner';s.products[0].crmStock={source:'crm',sku:'00123',available:99,checkedAt:new Date().toISOString(),updatedAt:null};s.pageText={cover:{'0:1':'Tiêu đề đã sửa'}};return s;};
test('shared quotation saves overwrite one document; retries survive later edits; snapshot excludes stock and unselected products',async()=>{
 const f=await setupWarehouseWork(),id=crypto.randomUUID(),body={id,clientKey:crypto.randomUUID(),state:state()},create=()=>f.call('/catalogue-quotes',f.cookies.emp,'POST',body);
 const a=await create();assert.equal(a.status,200,JSON.stringify(a.data));assert.equal((await create()).data.replayed,true);assert.equal((await f.db.select().from(quotes)).length,1);
 const list=await f.call('/catalogue-quotes',f.cookies.kt);assert.equal(list.data.quotes.length,1);assert.equal(list.data.quotes[0].state,undefined);assert.equal(list.data.quotes[0].canDelete,false);
 const detail=await f.call('/catalogue-quotes/'+id,f.cookies.kt);assert.equal(detail.data.state.products.length,1);const p=detail.data.state.products[0];assert.equal(p.qty,7);assert.equal(p.override,188888);assert.equal(p.sku,'00123');assert.equal(p.crmStock,undefined);assert.equal(p.sharedPendingFor,undefined);assert.equal(detail.data.state.pageText.cover['0:1'],'Tiêu đề đã sửa');
 const update={revision:1,clientKey:crypto.randomUUID(),state:{...detail.data.state,meta:{...detail.data.state.meta,title:'Kế toán sửa'}}};assert.equal((await f.call('/catalogue-quotes/'+id,f.cookies.kt,'PUT',update)).status,200);
 const replay=await create();assert.equal(replay.data.revision,1);assert.equal(replay.data.currentRevision,2);assert.equal((await f.db.select().from(quotes)).length,1);
 const stale=await f.call('/catalogue-quotes/'+id,f.cookies.emp,'PUT',{...update,clientKey:crypto.randomUUID()});assert.equal(stale.status,409);assert.equal((await f.db.select().from(commands)).length,2,'failed CAS rolls back command receipt');
 const wrong=await f.call('/catalogue-quotes',f.cookies.emp,'POST',{...body,state:{...body.state,meta:{...body.state.meta,title:'Khác'}}});assert.equal(wrong.status,409);assert.equal((await f.db.select().from(quotes).where(eq(quotes.id,id)))[0]!.revision,2);
 assert.equal((await f.call('/catalogue-quotes',undefined)).status,401);assert.equal((await f.call('/catalogue-quotes',f.cookies.ncc)).status,403);
 const archive={revision:2,clientKey:crypto.randomUUID()};assert.equal((await f.call('/catalogue-quotes/'+id+'/archive',f.cookies.kt,'POST',archive)).status,403);assert.equal((await f.call('/catalogue-quotes/'+id+'/archive',f.cookies.mgr,'POST',archive)).status,200);assert.equal((await f.call('/catalogue-quotes',f.cookies.emp)).data.total,0);assert.equal((await f.call('/catalogue-quotes/'+id,f.cookies.emp)).status,404);
});
test('saved quote filters cover every page, match a single product and use Vietnam calendar dates',async()=>{
 const f=await setupWarehouseWork();
 const seed=Array.from({length:32},(_,i)=>{const s=state();s.products=s.products.slice(0,1);s.products[0].brand=i===31?'Bát Tràng':'Minh Long';s.meta.employee=i===31?'Châu Yến':'An';const at=i===31?'2026-11-03T17:00:00.000Z':'2026-11-03T16:59:59.999Z';return{id:'filter-quote-'+String(i).padStart(2,'0'),quoteNo:'BG-'+i,title:'Bộ trà '+i,customer:'Khách',productCount:1,search:'bo tra khach',data:JSON.stringify(s),createdBy:'emp',updatedBy:'emp',createdAt:at,updatedAt:at};});
 await f.db.insert(quotes).values(seed);
 const list=(params:Record<string,string>)=>f.call('/catalogue-quotes?'+new URLSearchParams(params),f.cookies.emp);
 const page=await list({sort:'oldest'});assert.equal(page.data.total,32);assert.equal(page.data.quotes.length,30);
 const filtered=await list({brand:'Bát Tràng',category:'Bộ trà',employee:'Châu Yến',from:'2026-11-04',to:'2026-11-04',q:'bo tra',facets:'1'});assert.equal(filtered.status,200,JSON.stringify(filtered.data));assert.equal(filtered.data.total,1);assert.equal(filtered.data.quotes[0].id,'filter-quote-31');assert.equal(filtered.data.quotes[0].state,undefined);assert.equal(filtered.data.quotes[0].employee,'Châu Yến');assert.deepEqual(filtered.data.facets.brands,['Bát Tràng','Minh Long']);
 assert.equal((await list({from:'2026-11-03',to:'2026-11-03'})).data.total,31);
 assert.equal((await list({brand:'Minh Long',category:'Bộ trà',offset:'30'})).data.quotes.length,1);
 assert.equal((await list({brand:'Unknown'})).data.total,0);
 for(const params of [{from:'2026-02-30'},{from:'2026-11-05',to:'2026-11-04'},{sort:'bad'},{employee:'x'.repeat(501)}] as Record<string,string>[])assert.equal((await list(params)).status,400);
 const mixed=state();mixed.products=[{...mixed.products[0],brand:'Minh Long',category:'Bộ trà'},{...mixed.products[0],id:'second',brand:'Bát Tràng',category:'Bình hoa'}];mixed.selected=['product-1','second'];await f.db.update(quotes).set({data:JSON.stringify(mixed)}).where(eq(quotes.id,'filter-quote-31'));
 assert.equal((await list({brand:'Bát Tràng',category:'Bộ trà'})).data.total,0);
 await f.db.update(quotes).set({deletedAt:new Date().toISOString()}).where(eq(quotes.id,'filter-quote-31'));assert.equal((await list({facets:'1'})).data.facets.brands.includes('Bát Tràng'),false);
});
test('simultaneous saves claim one command and serialize conflicting revisions', {skip:!process.env.TEST_PG_URL},async()=>{
 const f=await setupWarehouseWork(),id=crypto.randomUUID(),body={id,clientKey:crypto.randomUUID(),state:state()};
 const create=()=>f.call('/catalogue-quotes',f.cookies.emp,'POST',body);const a=await Promise.all([create(),create()]);assert.deepEqual(a.map(r=>r.status),[200,200]);assert.equal(a.filter(r=>r.data.replayed).length,1);assert.equal((await f.db.select().from(quotes)).length,1);assert.equal((await f.db.select().from(commands)).length,1);
 const update=(cookie:string,title:string)=>f.call('/catalogue-quotes/'+id,cookie,'PUT',{revision:1,clientKey:crypto.randomUUID(),state:{...body.state,meta:{...body.state.meta,title}}});const b=await Promise.all([update(f.cookies.emp!,'A'),update(f.cookies.kt!,'B')]);assert.deepEqual(b.map(r=>r.status).sort(),[200,409]);assert.equal((await f.db.select().from(quotes))[0]!.revision,2);assert.equal((await f.db.select().from(commands)).length,2);
});
