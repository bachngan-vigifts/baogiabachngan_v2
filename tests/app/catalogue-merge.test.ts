import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Pure browser state.
import {defaultState,validateProduct,restoreState,makeSlides,slideKey,quotePrice,moveQuotePage} from '../../trial-ui/catalogue/core.js';
// @ts-ignore Pure composition.
import {mergeQuoteSnapshots} from '../../trial-ui/catalogue/quote-merge.js';
import {cleanCatalogueQuote} from '../../src/modules/catalog/domain/catalogue-quote.ts';
const source=(brand:string,regular:number,n=3)=>{const s=defaultState();s.products=Array.from({length:n},(_,i)=>validateProduct({id:'p'+i,name:brand+' '+i,sku:'000'+i,category:'Bộ trà',brand,regular,discount:12,fee:25000,qty:i+1,override:null}));s.selected=s.products.map((p:any)=>p.id);s.meta.note='Ghi chú '+brand;s.meta.employee='Tư vấn '+brand;s.meta.phone='0900000000';return s;};
const bare=(p:any)=>{const {compositionId,sourceState,...slide}=p;return slide;};
test('composition preserves every source page, positions, covers/dividers/closing and source settings',()=>{
 const a=source('A',100000,9),b=source('B',500000,7);a.settings.productsPerPage=8;b.settings.productsPerPage=6;a.settings.regular=false;b.settings.proposedPrice=false;b.settings.bundle10=true;b.settings.bundle10Ids=['p0','p1','p2','p3','p4','p5'];
 a.pageText.cover={'78:225':'Tiêu đề bìa đã sửa'};const original=[...makeSlides(a),...makeSlides(b)],before=structuredClone([a,b]);
 const merged=mergeQuoteSnapshots([{state:a},{state:b}]),actual=makeSlides(merged);assert.deepEqual([a,b],before);
 assert.deepEqual(actual.map(bare),original);assert.equal(actual.filter((s:any)=>s.type==='cover').length,2);assert.equal(actual.filter((s:any)=>s.type==='closing').length,2);
 assert.equal(actual[0].sourceState.settings.productsPerPage,8);assert.equal(actual.at(-1).sourceState.settings.productsPerPage,6);assert.equal(actual[0].sourceState.pageText.cover['78:225'],'Tiêu đề bìa đã sửa');
 assert.equal(actual.at(-1).sourceState.meta.note,'Ghi chú B');assert.equal(actual.at(-1).sourceState.settings.proposedPrice,false);
 for(const slide of actual.filter((s:any)=>s.type==='products'))for(const p of slide.items){const originalState=slide.brand==='A'?a:b;assert.equal(quotePrice(p,slide.sourceState),quotePrice(p,originalState));}
});
test('sorting and dragging only move complete pages; save/reopen and nested composition retain snapshots',()=>{
 const a=source('Z',100000),b=source('A',500000),s=mergeQuoteSnapshots([{state:a},{state:b}]);
 const original=new Map(makeSlides(s).map((p:any)=>[slideKey(p),bare(p)]));
 for(const mode of ['brand','category','name','price','price-desc']){s.settings.pageSort=mode;for(const p of makeSlides(s))assert.deepEqual(bare(p),original.get(slideKey(p)));}
 const refs=makeSlides(s).map(slideKey);assert(moveQuotePage(s,refs[0],refs.at(-1),true));assert.equal(makeSlides(s).at(-1).type,'cover');
 const reopened=restoreState(cleanCatalogueQuote(s));assert.deepEqual(makeSlides(reopened).map(slideKey),makeSlides(s).map(slideKey));assert.deepEqual(makeSlides(reopened).map(bare),makeSlides(s).map(bare));
 const nested=mergeQuoteSnapshots([{state:reopened},{state:a}]);assert.deepEqual(makeSlides(nested).map(bare),[...makeSlides(reopened).map(bare),...makeSlides(a)]);assert(nested.pageComposition.sources.every((p:any)=>!p.state.pageComposition));
 reopened.meta.note='Changed parent';reopened.settings.productsPerPage=4;reopened.products[0].regular=1;assert.deepEqual(makeSlides(reopened).map(bare),makeSlides(s).map(bare));
});
test('invalid references, nested unbounded data and product injection are rejected on both sides',()=>{
 const a=source('A',100000),s=mergeQuoteSnapshots([{state:a},{state:a}]);
 for(const mutate of [(v:any)=>v.pageComposition.pages[0].index=999,(v:any)=>v.pageComposition.sources[0].slides.find((p:any)=>p.type==='products').items.push('unknown'),(v:any)=>v.pageComposition.sources[0].state.pageComposition={}]){
  const broken=structuredClone(s);mutate(broken);assert.throws(()=>restoreState(broken));assert.throws(()=>cleanCatalogueQuote(broken));
 }
 assert.throws(()=>mergeQuoteSnapshots([{state:a}]));assert.throws(()=>mergeQuoteSnapshots(Array(21).fill({state:a})));
 assert.throws(()=>mergeQuoteSnapshots([{state:source('A',100000,600)},{state:source('B',100000,401)}]),/1.000/);
});
