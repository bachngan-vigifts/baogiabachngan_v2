// @ts-nocheck
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultState,restoreState,makeSlides,validateProduct} from '../../trial-ui/catalogue/core.js';
test('4/8 pagination preserves groups and drops singleton tails',()=>{
 const s=defaultState();s.products=Array.from({length:10},(_,i)=>validateProduct({id:String(i),name:'Máy xay '+i,sku:String(i),brand:'Elmich',category:'Máy xay',regular:1000000,discount:0,fee:15000}));s.selected=s.products.map(p=>p.id);
 const counts=()=>makeSlides(s).filter(p=>p.type==='products').map(p=>p.items.length);
 assert.deepEqual(counts(),[4,4,2]);s.settings.productsPerPage=8;assert.deepEqual(counts(),[8,2]);assert.equal(restoreState(s).settings.productsPerPage,8);s.selected.pop();assert.deepEqual(counts(),[8]);s.settings.productsPerPage=123;assert.equal(restoreState(s).settings.productsPerPage,4);
});


import {cleanCatalogueQuote} from '../../src/modules/catalog/domain/catalogue-quote.ts';
test('shared quotes retain 8 layout and older quotes default to 4',()=>{const s=defaultState();const p=validateProduct({name:'Máy xay',sku:'001',brand:'Elmich',category:'Máy xay',regular:1000000,discount:0,fee:15000});s.products=[p];s.selected=[p.id];s.settings.productsPerPage=8;assert.equal(cleanCatalogueQuote(s).settings.productsPerPage,8);delete s.settings.productsPerPage;assert.equal(cleanCatalogueQuote(s).settings.productsPerPage,4);s.settings.productsPerPage=12;assert.throws(()=>cleanCatalogueQuote(s));});


