// @ts-nocheck
import {test} from 'node:test';import assert from 'node:assert/strict';
import {defaultState,validateProduct,makeSlides} from '../../trial-ui/catalogue/core.js';
globalThis.Image=class{set src(value){queueMicrotask(()=>this.onerror?.());}};
globalThis.document={fonts:{ready:Promise.resolve()}};
const {drawSlide,PAGE_HEIGHT,PAGE_INCH_WIDTH,PAGE_INCH_HEIGHT}=await import('../../trial-ui/catalogue/render.js');
test('A4 landscape renderer keeps price above SKU, name below photo and note once per page',async()=>{
 const s=defaultState();s.settings.productsPerPage=8;s.settings.qr=false;s.settings.cover=s.settings.dividers=s.settings.closing=false;s.products=Array.from({length:8},(_,i)=>validateProduct({id:String(i),sku:'SKU'+i,name:'Product '+i,brand:'Elmich',category:'Blender',regular:1000000,discount:0,fee:15000}));s.selected=s.products.map(p=>p.id);
 const fields=[],boxes=[],ctx={scale(){},fillRect(){},beginPath(){},roundRect(x,y,w,h){boxes.push({x,y,w,h})},fill(){},stroke(){},fillText(){},measureText(t){return{width:t.length*6}}},canvas={getContext:()=>ctx};await drawSlide(canvas,makeSlides(s)[0],s,1,1,null,1,fields);
 assert.equal(PAGE_INCH_WIDTH,297/25.4);assert.equal(PAGE_INCH_HEIGHT,210/25.4);assert.equal(canvas.height,PAGE_HEIGHT);assert.equal(fields.filter(f=>f.original===s.meta.note).length,1);assert.equal(boxes.length,8);assert(fields.every(f=>/^\d+:\d+$/.test(f.position)),'editable text positions must survive saving');assert(boxes[4].y-boxes[0].y-boxes[0].h>=40);
 const sku=fields.find(f=>f.original==='Mã: SKU0'),name=fields.find(f=>f.original==='Product 0'),amount=fields.find(f=>f.original==='1.015.000đ');assert(amount.y<sku.y&&sku.y<name.y);for(const b of boxes)assert(b.y+b.h<PAGE_HEIGHT-50);assert(fields.some(f=>f.original==='BLENDER - ELMICH'));
});


