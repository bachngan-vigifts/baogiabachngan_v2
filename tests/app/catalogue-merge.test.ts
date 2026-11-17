import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Pure browser state.
import {defaultState,validateProduct,restoreState,makeSlides,slideKey,quotePrice,moveQuotePage} from '../../trial-ui/catalogue/core.js';
// @ts-ignore Pure composition.
import {mergeQuoteSnapshots} from '../../trial-ui/catalogue/quote-merge.js';
import {cleanCatalogueQuote} from '../../src/modules/catalog/domain/catalogue-quote.ts';
const source=(brand:string,regular:number,n=3)=>{const s=defaultState();s.products=Array.from({length:n},(_,i)=>validateProduct({id:'p'+i,name:brand+' '+i,sku:'000'+i,category:'Bộ trà',brand,regular,discount:12,fee:25000,qty:i+1,override:i?null:regular+2}));s.selected=s.products.map((p:any)=>p.id);return s;};
const pages=(s:any)=>makeSlides(s).filter((p:any)=>p.type==='products');
test('merge copies offers without mutating sources or collapsing the same SKU; bundles and singleton pages survive',()=>{
 const a=source('A',100000,1),b=source('B',500000,5);a.settings.bundle10=true;a.settings.bundle10Ids=['p0'];
 const before=structuredClone([a,b]),s=mergeQuoteSnapshots([{state:a},{state:b}],{sort:'brand'});
 assert.deepEqual([a,b],before);assert.equal(s.cloudQuote,null);assert.equal(s.meta.customerId,'');assert.equal(s.meta.customer,'');assert.equal(s.products.length,6);assert.equal(new Set(s.selected).size,6);
 assert.equal(s.products[0].sku,s.products[1].sku);assert.equal(s.products[0].regular,100000);assert.equal(s.products[1].regular,500000);assert.equal(quotePrice(s.products[0],s),quotePrice(a.products[0],a));
 assert.equal(pages(s).flatMap((p:any)=>p.items).length,6);assert.equal(pages(s).filter((p:any)=>p.items.length===1).length,2);assert.equal(makeSlides(s).filter((p:any)=>p.type==='cover').length,1);
 assert.equal(makeSlides(s).filter((p:any)=>p.type==='closing').length,1);assert(!makeSlides(s).some((p:any)=>p.type==='divider'));
});
test('page ordering, manual moves and server validation share export numbering and persist on reopen',()=>{
 const s=mergeQuoteSnapshots([{state:source('Z',100000)},{state:source('A',500000)}],{sort:'brand'});
 assert.equal(pages(s)[0].brand,'A');s.settings.pageSort='price';assert.equal(pages(s)[0].brand,'Z');s.settings.pageSort='price-desc';assert.equal(pages(s)[0].brand,'A');
 const ordered=pages(s).map(slideKey);assert(moveQuotePage(s,ordered[0],ordered[1],true));assert.equal(s.settings.pageSort,'manual');assert.equal(pages(s)[0].brand,'Z');
 const saved=cleanCatalogueQuote(s),reopened=restoreState(saved);assert.deepEqual(makeSlides(reopened).map(slideKey),makeSlides(s).map(slideKey));
 assert(!moveQuotePage(s,'unknown',ordered[0]));assert(!moveQuotePage(s,ordered[0],ordered[0]));
 s.selected.pop();assert.equal(pages(s).flatMap((p:any)=>p.items).length,5,'stale page keys never hide products');
});
test('merge rejects oversized or malformed sources before touching the current document',()=>{
 const a=source('A',100000);assert.throws(()=>mergeQuoteSnapshots([{state:a}]));assert.throws(()=>mergeQuoteSnapshots(Array(21).fill({state:a})));
 assert.throws(()=>mergeQuoteSnapshots([{state:source('A',100000,600)},{state:source('B',100000,401)}]),/1.000/);
 assert.throws(()=>mergeQuoteSnapshots([{state:a},{state:{}}]));
});
