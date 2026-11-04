// @ts-nocheck
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultState,restoreState,validateProduct,makeSlides} from '../../trial-ui/catalogue/core.js';
import {cleanCatalogueQuote} from '../../src/modules/catalog/domain/catalogue-quote.ts';
globalThis.Image=class{set src(value){queueMicrotask(()=>this.onerror?.());}};
globalThis.document={fonts:{ready:Promise.resolve()}};
const {drawSlide}=await import('../../trial-ui/catalogue/render.js');
function fixture(layout){const s=defaultState();s.settings.productsPerPage=layout;s.settings.cover=s.settings.dividers=s.settings.closing=false;s.products=Array.from({length:2},(_,i)=>validateProduct({id:String(i),name:'Product '+i,sku:'SKU'+i,brand:'Elmich',category:'Blender',regular:1000000,discount:0,fee:15000}));s.selected=s.products.map(p=>p.id);return s;}
test('price visibility defaults on for legacy quotes and preserves false when restored',()=>{const s=fixture(4);assert.equal(s.settings.proposedPrice,true);delete s.settings.proposedPrice;assert.equal(restoreState(s).settings.proposedPrice,true);s.settings.proposedPrice=false;assert.equal(restoreState(JSON.parse(JSON.stringify(s))).settings.proposedPrice,false);});
test('shared quote API preserves visibility and defaults legacy quotes to visible',()=>{const s=fixture(8);s.settings.proposedPrice=false;assert.equal(cleanCatalogueQuote(s).settings.proposedPrice,false);delete s.settings.proposedPrice;assert.equal(cleanCatalogueQuote(s).settings.proposedPrice,true);});
for(const layout of [4,8])test(`layout ${layout} hides proposed price in canvas/edit layer and PowerPoint without hiding SKU or list price`,async()=>{
 const s=fixture(layout),ctx={scale(){},fillRect(){},beginPath(){},roundRect(){},fill(){},stroke(){},fillText(){},measureText(t){return{width:t.length*6}}};
 for(const visible of [true,false,true]){s.settings.proposedPrice=visible;const fields=[],ppt=[];await drawSlide({getContext:()=>ctx},makeSlides(s)[0],s,1,1,{addShape(){},addText(t){ppt.push(t)},addNotes(){}},1,fields);
 for(const texts of [fields.map(f=>f.original),ppt]){assert.equal(texts.includes('Giá đề xuất'),visible);assert.equal(texts.includes('1.015.000đ'),visible);assert(texts.includes('Mã: SKU0'));assert(texts.some(t=>t.startsWith('Niêm yết:')));}
 }
});

