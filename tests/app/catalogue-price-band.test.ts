// @ts-nocheck
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultState,validateProduct,makeSlides,restoreState,quoteBudget,price} from '../../trial-ui/catalogue/core.js';
import {readBulkEditPatch} from '../../trial-ui/catalogue/library-bulk.js';
import {cleanCatalogueQuote} from '../../src/modules/catalog/domain/catalogue-quote.ts';
import {cleanCatalogueProduct} from '../../src/modules/catalog/domain/catalogue-data.ts';

const product=(priceBand=null)=>validateProduct({name:'Bộ trà',sku:'001',brand:'Minh Long',category:'Bộ trà',regular:1000000,discount:10,fee:15000,priceBand});
test('explicit price band survives library, backup and shared quote; removing it restores calculated grouping',()=>{
 const s=defaultState();s.products=[product(6),product(6),product(null),product(null)];s.selected=s.products.map(p=>p.id);
 assert.equal(quoteBudget(s.products[0],s),6);assert.equal(quoteBudget(s.products[2],s),2);
 const pages=makeSlides(s).filter(p=>p.type==='products');assert.deepEqual(pages.map(p=>p.band),[6,2]);assert.equal(price(s.products[0]),915000);
 assert.equal(restoreState(s).products[0].priceBand,6);assert.equal(cleanCatalogueQuote(s).products[0].priceBand,6);
 assert.equal(quoteBudget({...s.products[0],priceBand:null},s),2);
 assert.equal(quoteBudget({...s.products[0],regular:0,priceOnRequest:true},s),5);
});
test('automatic, manual and invalid bulk ranges are handled without changing prices',()=>{
 for(const [raw,expected] of [['',null],['0',0],['6',6],['7',7]]){const d=new FormData();d.set('priceBand',raw);assert.deepEqual(readBulkEditPatch(d),{priceBand:expected});}
 for(const raw of ['5','8','-1','x']){const d=new FormData();d.set('priceBand',raw);assert.throws(()=>readBulkEditPatch(d));}
 for(const priceBand of [-1,5,8,1.5,'6'])assert.throws(()=>cleanCatalogueProduct({...product(),priceBand}));
 assert.equal(cleanCatalogueProduct(product(0)).priceBand,0);
});
