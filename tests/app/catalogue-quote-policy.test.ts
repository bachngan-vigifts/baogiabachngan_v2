// @ts-nocheck
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultState,validateProduct,quotePrice,restoreState,makeSlides} from '../../trial-ui/catalogue/core.js';
import {defaultQuotePolicy,cleanQuotePolicy} from '../../trial-ui/catalogue/quote-pricing.js';
import {cleanCatalogueQuote} from '../../src/modules/catalog/domain/catalogue-quote.ts';
import {setupWarehouseWork} from '../helpers/warehouse-work-fixture.ts';
function fixture(){const s=defaultState();s.products=[validateProduct({id:'tea',name:'Bộ trà',sku:'001',brand:'Minh Long',category:'Bộ trà',regular:200000,discount:10,fee:15000,override:188888,qty:2}),validateProduct({id:'cup',name:'Ly',sku:'002',brand:'Minh Long',category:'Bộ trà',regular:100000,discount:0,fee:0,qty:3})];s.selected=['tea','cup'];return s;}
test('quote-only policy keeps old/manual prices until enabled, respects contact/bundles and leaves shared products unchanged',()=>{
 const s=fixture(),original=structuredClone(s.products);assert.equal(quotePrice(s.products[0],s),188888);
 s.settings.quotePolicy={...defaultQuotePolicy(),discount:25,printFee:10000,shipping:2000,gift:3000,coffee:1000};
 assert.equal(quotePrice(s.products[0],s),166000);assert.equal(quotePrice(s.products[1],s),91000);
 assert.deepEqual(s.products,original);assert.equal(defaultState().settings.quotePolicy,undefined);
 s.settings.bundle10=true;s.settings.bundle10Ids=['tea'];assert.equal(quotePrice(s.products[0],s),1660000);
 s.products[0].priceOnRequest=true;assert.equal(quotePrice(s.products[0],s),0);
 s.settings.quotePolicy.enabled=false;assert.equal(quotePrice(s.products[1],s),100000);
});
test('cost margin includes all costs, missing cost falls back visibly to list/discount, and saved snapshots retain policy without drift',()=>{
 const s=fixture();s.settings.quotePolicy={...defaultQuotePolicy(),basis:'cost',margin:20,discount:10,printFee:10000,shipping:2000,gift:3000,coffee:1000,costs:{tea:104000,removed:99}};
 assert.equal(quotePrice(s.products[0],s),150000);assert.equal(quotePrice(s.products[1],s),106000);
 const clean=cleanCatalogueQuote(s),restored=restoreState(clean);assert.deepEqual(clean.settings.quotePolicy.costs,{tea:104000});
 assert.equal(quotePrice(restored.products[0],restored),150000);assert.equal(quotePrice(restored.products[1],restored),106000);
 assert.ok(makeSlides(restored).length>0);assert.equal(quotePrice(s.products[0],fixture()),188888);
});
test('invalid policy, unbounded costs and excessive computed prices fail on browser and API',()=>{
 for(const patch of [{margin:100},{discount:-1},{shipping:Infinity},{coffee:-1},{costs:{tea:NaN}},{basis:'unknown'}]){
  const s=fixture();s.settings.quotePolicy={...defaultQuotePolicy(),...patch};assert.throws(()=>cleanQuotePolicy(s.settings.quotePolicy));assert.throws(()=>cleanCatalogueQuote(s));assert.throws(()=>restoreState(s));
 }
 const s=fixture();s.settings.quotePolicy={...defaultQuotePolicy(),basis:'cost',margin:95,costs:{tea:1e10}};assert.throws(()=>quotePrice(s.products[0],s));assert.throws(()=>cleanCatalogueQuote(s));
});
test('shared quote create/open/update preserves distinct policies without modifying the original quote',async()=>{
 const f=await setupWarehouseWork(),a=fixture(),b=fixture(),id=crypto.randomUUID(),other=crypto.randomUUID();
 a.settings.quotePolicy={...defaultQuotePolicy(),discount:15,shipping:3000};b.settings.quotePolicy={...defaultQuotePolicy(),basis:'cost',costs:{tea:100000},margin:25};
 for(const [key,state]of [[id,a],[other,b]])assert.equal((await f.call('/catalogue-quotes',f.cookies.emp,'POST',{id:key,clientKey:crypto.randomUUID(),state})).status,200);
 const first=await f.call('/catalogue-quotes/'+id,f.cookies.emp),second=await f.call('/catalogue-quotes/'+other,f.cookies.emp);
 assert.equal(first.data.state.settings.quotePolicy.discount,15);assert.equal(second.data.state.settings.quotePolicy.margin,25);
 second.data.state.settings.quotePolicy.margin=30;
 assert.equal((await f.call('/catalogue-quotes/'+other,f.cookies.emp,'PUT',{revision:second.data.revision,clientKey:crypto.randomUUID(),state:second.data.state})).status,200);
 assert.equal((await f.call('/catalogue-quotes/'+id,f.cookies.emp)).data.state.settings.quotePolicy.discount,15);
});
test('customer canvas/PPT uses the quote price and never exports cost or margin metadata',async()=>{
 globalThis.Image=class{set src(value){queueMicrotask(()=>this.onerror?.());}};globalThis.document={fonts:{ready:Promise.resolve()}};
 const {drawSlide}=await import('../../trial-ui/catalogue/render.js');
 const s=fixture();s.settings.cover=s.settings.dividers=s.settings.closing=false;s.settings.quotePolicy={...defaultQuotePolicy(),basis:'cost',margin:20,printFee:16000,costs:{tea:104000}};
 for(const layout of [4,6,8]){
  s.settings.productsPerPage=layout;const slide=makeSlides(s)[0],fields=[],notes=[],texts=[];
  const ctx={scale(){},fillRect(){},beginPath(){},roundRect(){},fill(){},stroke(){},fillText(){},measureText(t){return{width:t.length*6}}};
  await drawSlide({getContext:()=>ctx},slide,s,1,1,{addShape(){},addText(t){texts.push(t)},addNotes(t){notes.push(t)}},1,fields);
  assert.ok(fields.some(f=>f.original==='150.000đ'));assert.ok(texts.some(t=>t==='150.000đ'));
  assert.ok(!JSON.stringify({texts,notes}).includes('104000'));assert.ok(!JSON.stringify({texts,notes}).includes('margin'));assert.ok(!JSON.stringify({texts,notes}).includes('giá vốn'));
 }
});
test('merged exports preserve each source policy, including repeated product IDs',async()=>{
 const {mergeQuoteSnapshots}=await import('../../trial-ui/catalogue/quote-merge.js');
 const a=fixture(),b=fixture();a.settings.quotePolicy={...defaultQuotePolicy(),discount:25};b.settings.quotePolicy={...defaultQuotePolicy(),basis:'cost',costs:{tea:104000},printFee:16000,margin:20};
 const merged=restoreState(cleanCatalogueQuote(mergeQuoteSnapshots([{state:a},{state:b}]))),pages=makeSlides(merged).filter(p=>p.type==='products');
 const teaPrices=pages.flatMap(page=>page.items.filter(p=>p.id==='tea').map(p=>quotePrice(p,page.sourceState)));
 assert.deepEqual(teaPrices,[150000,150000]);
 const cupPrices=pages.flatMap(page=>page.items.filter(p=>p.id==='cup').map(p=>quotePrice(p,page.sourceState)));
 assert.deepEqual(cupPrices,[75000,116000]);
});
