import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Browser module intentionally has no dependency on CRM/domain databases.
import {defaultState,validateProduct,price,quotePrice,quoteBudget,makeSlides,restoreState} from '../../trial-ui/catalogue/core.js';
// @ts-ignore Pages-only read adapter.
import {sourceUrl,handleApi} from '../../catalogue-server/api.mjs';
const item=(brand:string,category:string,regular:number)=>validateProduct({name:category,brand,category,regular,discount:brand==='LocknLock'?40:10,fee:15000});
test('catalogue starts empty, applies each brand discount, 15k fee and optional ten-unit set before budget',()=>{
 const s=defaultState(),l=item('LocknLock','Bình giữ nhiệt',522000),m=item('Minh Long','Chén cơm',33480);
 assert.equal(s.products.length,0);assert.equal(price(l),328200);assert.equal(price(m),45132);
 s.settings.bundle10=true;assert.equal(quotePrice(l,s),3282000);assert.equal(quotePrice(m,s),451320);assert.equal(quoteBudget(l,s),4);assert.equal(quoteBudget(m,s),1);
 s.settings.bundle10=false;assert.equal(quotePrice(l,s),328200);assert.equal(price({...l,override:310000}),310000);
});
test('catalogue pages keep budget, brand and category separate without losing items',()=>{
 const s=defaultState();s.products=[...Array.from({length:5},()=>item('LocknLock','Bình giữ nhiệt',300000)),item('LocknLock','Ly',100000),item('Minh Long','Chén',50000),item('Minh Long','Bình hoa',3000000)];s.selected=s.products.map((p:any)=>p.id);
 const pages=makeSlides(s).filter((p:any)=>p.type==='products');assert.equal(pages.flatMap((p:any)=>p.items).length,8);
 for(const p of pages){assert(p.items.length<=4);assert.equal(new Set(p.items.map((i:any)=>i.brand)).size,1);assert.equal(new Set(p.items.map((i:any)=>i.category)).size,1);assert(p.items.every((i:any)=>quoteBudget(i,s)===p.band));}
 assert.throws(()=>restoreState({version:1,products:[{name:'bad'}]}));
});
test('catalogue read proxy rejects arbitrary hosts, credentials, paths and writes',async()=>{
 for(const u of ['https://127.0.0.1/','https://minhlongonline.com.evil.test/','https://u:p@minhlongonline.com/','https://minhlongonline.com:444/'])assert.throws(()=>sourceUrl(u));
 const bad=await handleApi(new Request('https://crm.minhlongonline.com/catalogue/api/product?url='+encodeURIComponent('https://127.0.0.1/')));assert.equal(bad.status,400);
 const write=await handleApi(new Request('https://crm.minhlongonline.com/catalogue/api/product',{method:'POST'}));assert.equal(write.status,405);
});
