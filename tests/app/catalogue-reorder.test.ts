import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Browser modules intentionally stay independent of CRM database modules.
import {defaultState,validateProduct,restoreState,makeSlides,sortedProducts,setSelectionSort,moveSelectedProduct} from '../../trial-ui/catalogue/core.js';
// @ts-ignore Pure page selector used by both file exporters.
import {parsePageSelection} from '../../trial-ui/catalogue/export-pages.js';
// @ts-ignore Pages adapter.
import {normalizeProduct,handleApi} from '../../catalogue-server/api.mjs';
// @ts-ignore Read-only CRM adapter.
import {readCrmStock} from '../../catalogue-server/crm-stock.mjs';
const fixture=()=>{const s=defaultState();s.products=Array.from({length:12},(_,i)=>validateProduct({id:'p'+i,name:'SP '+i,brand:'Minh Long',category:'Bộ trà',regular:100000+i*1000,discount:10,fee:15000,qty:i+1,collection:i%2?'Camellia':'Anna',pattern:i%2?'Sen':'Chanh',color:i%2?'Trắng':'Vàng'}));s.selected=s.products.map((p:any)=>p.id);return s;};
const ids=(s:any)=>sortedProducts(s).map((p:any)=>p.id);
test('manual reorder persists across restore and export while preserving quantity, price, bundle scope and stock evidence',()=>{
 const s=fixture(),before=structuredClone(s.products);setSelectionSort(s,'manual');s.settings.bundle10=true;s.settings.bundle10Ids=['p0','p1'];
 assert(moveSelectedProduct(s,'p0','p11',true));assert.equal(ids(s).at(-1),'p0');assert.equal(s.settings.sortPrice,false);assert.equal(s.settings.selectionSort,'manual');assert.deepEqual(s.products,before);assert.deepEqual(s.settings.bundle10Ids,['p0','p1']);
 const restored=restoreState(s);assert.deepEqual(ids(restored),ids(s));assert.equal(restored.products[0].qty,1);
 // Within each fixed budget/brand/category/pack group, preview and both exporters share the manual order.
 for(const page of makeSlides(restored).filter((p:any)=>p.type==='products')){const expected=ids(restored).filter((id:string)=>page.items.some((p:any)=>p.id===id));assert.deepEqual(page.items.map((p:any)=>p.id),expected);}
 assert(moveSelectedProduct(s,'p11','p1'));assert.equal(ids(s)[0],'p11');
 const snapshot=structuredClone(s);assert(!moveSelectedProduct(s,'p11','p11'));assert(!moveSelectedProduct(s,'unknown','p1'));assert.deepEqual(s,snapshot);
});
test('newest uses source creation dates only; missing dates stay last and are never inferred from import time',()=>{
 const s=fixture();Object.assign(s.products[1],{createdAt:'2026-01-01T00:00:00Z'});Object.assign(s.products[2],{createdAt:'2026-10-01T00:00:00Z'});Object.assign(s.products[0],{addedAt:'2099-01-01T00:00:00Z'});
 setSelectionSort(s,'newest');assert.deepEqual(ids(s).slice(0,3),['p2','p1','p0']);
 const saved=restoreState(s);assert.deepEqual(ids(saved),ids(s));assert.equal(saved.products[0].createdAt,null);
});
test('attribute sorting is stable, keeps missing values last, and switching to manual freezes the displayed order',()=>{
 const s=fixture();s.products[0].collection='';setSelectionSort(s,'collection');assert.equal(ids(s).at(-1),'p0');assert.equal(sortedProducts(s)[0].collection,'Anna');const order=ids(s);setSelectionSort(s,'manual');assert.deepEqual(s.selected,order);
 for(const key of ['category','pattern','color']){setSelectionSort(s,key);assert.equal(s.settings.sortPrice,false);assert.deepEqual(ids(restoreState(s)),ids(s));}
 setSelectionSort(s,'price');assert.equal(s.settings.sortPrice,true);assert.equal(ids(s)[0],'p0');assert(!setSelectionSort(s,'__proto__'));
});
test('legacy manual files retain their order; metadata round-trips without inventing a creation date',()=>{
 const s=fixture();delete s.settings.selectionSort;s.settings.sortPrice=false;s.selected.reverse();const r=restoreState(s);assert.equal(r.settings.selectionSort,'manual');assert.deepEqual(ids(r),s.selected);assert.equal(r.products[0].createdAt,null);
 const p=validateProduct({...s.products[0],createdAt:'bad',color:'Trắng',collection:'Camellia'});assert.equal(p.createdAt,null);assert.equal(p.collection,'Camellia');assert.equal(p.color,'Trắng');
});
test('custom export pages match full-preview numbering, deduplicate and reject invalid/out-of-range input',()=>{
 assert.deepEqual(parsePageSelection('5, 1, 3–4, 3',6),[1,3,4,5]);assert.deepEqual(parsePageSelection('2',6),[2]);
 for(const raw of ['', '0','7','4-2','1,','-1','1.5','1-99999999','NaN','<script>','1;2'])assert.throws(()=>parsePageSelection(raw,6),Error,raw);
 assert.throws(()=>parsePageSelection('1',0));
});
test('website metadata comes from explicit attributes/date fields rather than guesses from product names',()=>{
 const q={name:'Bộ trà Camellia trắng',sku:'0012',prices:{currency_code:'VND',regular_price:'100000',currency_minor_unit:0},date_created_gmt:'2026-01-02T03:04:05',attributes:[{name:'Bộ sưu tập',terms:[{name:'Camellia'}]},{name:'Hoa văn',terms:[{name:'Sen hồng'}]},{name:'Màu sắc',terms:[{name:'Trắng'}]}]};
 const p=normalizeProduct(q,new URL('https://minhlongonline.com/san-pham/bo-tra/'));assert.equal(p.collection,'Camellia');assert.equal(p.pattern,'Sen hồng');assert.equal(p.color,'Trắng');assert.equal(p.createdAt,'2026-01-02T03:04:05.000Z');
 const missing=normalizeProduct({...q,date_created_gmt:undefined,attributes:[]},new URL('https://minhlongonline.com/san-pham/bo-tra/'));assert.equal(missing.color,'');assert.equal(missing.collection,'');assert.equal(missing.createdAt,null);const malformed=normalizeProduct({...q,attributes:[null,{name:'Màu sắc',terms:'Trắng'}]},new URL('https://minhlongonline.com/san-pham/bo-tra/'));assert.equal(malformed.color,'');
});
test('CRM metadata proxy cannot read without authentication or accept oversized batches',async()=>{
 const url='https://crm.minhlongonline.com/catalogue/api/product-metadata';
 const result=await handleApi(new Request(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({skus:['0012']})}));assert.equal(result.status,400);assert.match((await result.json()).error,/đăng nhập CRM/);
 const tooMany=await handleApi(new Request(url,{method:'POST',body:JSON.stringify({skus:Array(1001).fill('0012')})}));assert.equal(tooMany.status,400);
});

test('CRM source creation date and pattern are read as metadata without deriving a date from stock updates',async()=>{
 const req=new Request('https://crm.test',{headers:{Authorization:'Bearer TEST_ONLY_CATALOGUE_TOKEN_12345'}});
 const result=await readCrmStock(req,['0001','0002'],async()=>Response.json({warehouses:[],products:[{sku:'0001',filteredStock:0,createdAt:'2026-02-01T00:00:00Z',pattern:'Sen',stockUpdatedAt:'2026-11-03T00:00:00Z'},{sku:'0002',filteredStock:0,createdAt:null,stockUpdatedAt:'2026-11-03T00:00:00Z'}]}));
 assert.equal(result.get('0001').productCreatedAt,'2026-02-01T00:00:00Z');assert.equal(result.get('0001').pattern,'Sen');assert.equal(result.get('0002').productCreatedAt,null);
});
