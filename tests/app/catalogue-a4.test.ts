// @ts-nocheck
import {test} from 'node:test';import assert from 'node:assert/strict';
import {defaultState,validateProduct,makeSlides,slideKey} from '../../trial-ui/catalogue/core.js';
globalThis.Image=class{set src(value){queueMicrotask(()=>this.onerror?.());}};
globalThis.document={fonts:{ready:Promise.resolve()}};
const {drawSlide,PAGE_HEIGHT,PAGE_INCH_WIDTH,PAGE_INCH_HEIGHT}=await import('../../trial-ui/catalogue/render.js');
test('A4 landscape renderer keeps price above SKU, name below photo and note once per page',async()=>{
 const s=defaultState();s.settings.productsPerPage=8;s.settings.qr=true;s.settings.cover=s.settings.dividers=s.settings.closing=false;s.products=Array.from({length:8},(_,i)=>validateProduct({id:String(i),sku:'SKU'+i,name:'Product '+i,brand:'Elmich',category:'Blender',regular:1000000,discount:0,fee:15000,url:'https://example.com/item'}));s.selected=s.products.map(p=>p.id);
 const fields=[],boxes=[],ctx={scale(){},fillRect(){},beginPath(){},roundRect(x,y,w,h){boxes.push({x,y,w,h})},fill(){},stroke(){},fillText(){},measureText(t){return{width:t.length*6}}},canvas={getContext:()=>ctx};await drawSlide(canvas,makeSlides(s)[0],s,1,1,null,1,fields);
 assert.equal(PAGE_INCH_WIDTH,297/25.4);assert.equal(PAGE_INCH_HEIGHT,210/25.4);assert.equal(canvas.height,PAGE_HEIGHT);assert.equal(fields.filter(f=>f.original===s.meta.note).length,1);assert.equal(boxes.length,8);assert(!fields.some(f=>f.original==='Xem chi tiết'));assert(fields.every(f=>/^\d+:\d+$/.test(f.position)),'editable text positions must survive saving');assert(boxes[4].y-boxes[0].y-boxes[0].h>=40);
 const sku=fields.find(f=>f.original==='Mã: SKU0'),name=fields.find(f=>f.original==='Product 0'),amount=fields.find(f=>f.original==='1.015.000đ');assert(amount.y<sku.y&&sku.y<name.y);for(const b of boxes)assert(b.y+b.h<PAGE_HEIGHT-50);assert(fields.some(f=>f.original==='BLENDER - ELMICH'));
});



test('six layout uses three columns and two rows with matching PowerPoint geometry',async()=>{
 const s=defaultState();s.settings.productsPerPage=6;s.settings.cover=s.settings.dividers=s.settings.closing=false;s.products=Array.from({length:6},(_,i)=>validateProduct({id:String(i),sku:'SKU'+i,name:'Product '+i,brand:'Elmich',category:'Blender',regular:1000000,discount:0,fee:15000}));s.selected=s.products.map(p=>p.id);
 const fields=[],boxes=[],pptBoxes=[],ctx={scale(){},fillRect(){},beginPath(){},roundRect(x,y,w,h){boxes.push({x,y,w,h})},fill(){},stroke(){},fillText(){},measureText(t){return{width:t.length*6}}},canvas={getContext:()=>ctx},ppt={addShape(type,o){pptBoxes.push(o)},addText(){},addNotes(){}};
 await drawSlide(canvas,makeSlides(s)[0],s,1,1,ppt,1,fields);
 assert.equal(boxes.length,6);assert.equal(new Set(boxes.map(b=>b.x)).size,3);assert.equal(new Set(boxes.map(b=>b.y)).size,2);assert.equal(pptBoxes.length,6);
 assert(fields.every(f=>/^\d+:\d+$/.test(f.position)));
 boxes.forEach((b,i)=>{assert(b.x+b.w<=1236&&b.y+b.h<PAGE_HEIGHT-50);const name=fields.find(f=>f.original==='Product '+i),sku=fields.find(f=>f.original==='Mã: SKU'+i);assert(name.x>b.x+140&&name.y<sku.y);assert(name.x+name.w<=b.x+b.w);assert(Math.abs(pptBoxes[i].x-b.x/(1280/PAGE_INCH_WIDTH))<0.001)});
});


test('six cards enlarge photo area and align fitting amount beside label while preserving edits',async()=>{
 const s=defaultState();s.settings.productsPerPage=6;s.settings.cover=s.settings.dividers=s.settings.closing=false;s.products=Array.from({length:6},(_,i)=>validateProduct({id:String(i),sku:'SKU'+i,name:'Product '+i,brand:'Elmich',category:'Blender',regular:1000000000,discount:0,fee:15000}));s.selected=s.products.map(p=>p.id);
 const slide=makeSlides(s)[0];s.pageText[slideKey(slide)]={'204:218':'Tên đã chỉnh'};
 const fields=[],ctx={scale(){},fillRect(){},beginPath(){},roundRect(){},fill(){},stroke(){},fillText(){},measureText(t){return{width:t.length*10}}};await drawSlide({getContext:()=>ctx},slide,s,1,1,null,1,fields);
 const name=fields.find(f=>f.original==='Product 0'),photo=fields.find(f=>f.original==='CHƯA CÓ ẢNH'),label=fields.find(f=>f.original==='Giá đề xuất'),amount=fields.find(f=>f.original==='1.000.015.000đ');
 assert(photo.w>132);assert(name.y>218&&name.size<14);assert.equal(name.value,'Tên đã chỉnh');assert.equal(amount.y,label.y);assert.equal(amount.align,'right');assert(amount.x>=label.x+label.w);assert(amount.x+amount.w<=426);assert(amount.size<18);
});

