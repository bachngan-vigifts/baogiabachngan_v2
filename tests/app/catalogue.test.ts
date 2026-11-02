import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Browser module intentionally has no dependency on CRM/domain databases.
import {defaultState,validateProduct,price,quotePrice,quoteBudget,isBundle,makeSlides,restoreState} from '../../trial-ui/catalogue/core.js';
// @ts-ignore Pages-only read adapter.
import {sourceUrl,handleApi} from '../../catalogue-server/api.mjs';
const item=(brand:string,category:string,regular:number)=>validateProduct({name:category,brand,category,regular,discount:brand==='LocknLock'?40:10,fee:15000});
test('catalogue starts empty, applies each brand discount, 15k fee and optional ten-unit set before budget',()=>{
 const s=defaultState(),l=item('LocknLock','Bình giữ nhiệt',522000),m=item('Minh Long','Chén cơm',33480);
 assert.equal(s.products.length,0);assert.equal(price(l),328200);assert.equal(price(m),45132);
 s.settings.bundle10=true;s.settings.bundle10Ids=[l.id,m.id];assert.equal(quotePrice(l,s),3282000);assert.equal(quotePrice(m,s),451320);assert.equal(quoteBudget(l,s),4);assert.equal(quoteBudget(m,s),1);
 s.settings.bundle10=false;assert.equal(quotePrice(l,s),328200);assert.equal(price({...l,override:310000}),310000);
});
test('catalogue applies x10 only to chosen page items and retains scope after regrouping/reordering',()=>{
 const s=defaultState();s.settings.cover=false;s.settings.closing=false;s.settings.dividers=false;
 s.products=Array.from({length:8},(_,i)=>item('Minh Long','Chén cơm',40000+i*1000));s.selected=s.products.map((p:any)=>p.id);
 const original=makeSlides(s);assert.equal(original.length,2);const chosen=original[1].items.map((p:any)=>p.id);
 s.settings.bundle10=true;s.settings.bundle10Ids=chosen;
 assert(s.products.slice(0,4).every((p:any)=>quotePrice(p,s)===price(p)));
 assert(s.products.slice(4).every((p:any)=>quotePrice(p,s)===price(p)*10));
 const pages=makeSlides(s);assert(pages.every((p:any)=>new Set(p.items.map((i:any)=>isBundle(i,s))).size===1));
 s.selected.reverse();s.settings.sortPrice=false;
 assert.deepEqual(new Set(makeSlides(s).flatMap((p:any)=>p.items.filter((i:any)=>isBundle(i,s)).map((i:any)=>i.id))),new Set(chosen));
 const saved=restoreState(s);assert.deepEqual(saved.settings.bundle10Ids,chosen);
 s.settings.bundle10=false;assert(s.products.every((p:any)=>quotePrice(p,s)===price(p)));
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
// @ts-ignore Standalone catalogue assistant, no CRM database dependency.
import {parseIntent,matchingProduct,assistantTypes,interpretIntent} from '../../catalogue-server/assistant.mjs';
test('assistant understands Vietnamese budget, uses final price and excludes sold out items',async()=>{
 const c=parseIntent('muốn tạo báo giá bộ trà giá từ 2tr trở lại');assert.equal(c.brand,'Minh Long');assert.equal(c.type,'bo-tra');assert.equal(c.max,2000000);assert.equal(c.min,0);assert.equal(c.packSize,1);
 const pricing={lockDiscount:40,minhDiscount:10,fee:15000};const p={name:'Bộ trà 0.8L',is_in_stock:true,prices:{currency_code:'VND',regular_price:'2200000',currency_minor_unit:0}};
 assert(matchingProduct(p,c,assistantTypes[0],'Minh Long',pricing));p.is_in_stock=false;assert(!matchingProduct(p,c,assistantTypes[0],'Minh Long',pricing));p.is_in_stock=true;p.prices.regular_price='2210000';assert(!matchingProduct(p,c,assistantTypes[0],'Minh Long',pricing));
 const fallback=await interpretIntent('bộ trà dưới 2tr',{},new Request('https://example.com'));assert.equal(fallback.engine,'criteria');assert(fallback.warning);
});
