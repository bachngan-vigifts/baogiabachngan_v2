import test from 'node:test';
import assert from 'node:assert/strict';
// Browser module's pure pricing/layout helpers do not access the DOM on import.
// @ts-ignore browser JS module
import {retailVatPolicies,labelLayout,priceLabelRows,loadLabelProducts} from '../../trial-ui/price-labels.js';
test('labels use the VAT-inclusive retail policy exactly once, preserving SKU and rejecting missing prices',()=>{
 assert.deepEqual(retailVatPolicies([{id:'r',name:'Giá bán lẻ'},{id:'v',name:'Giá bán lẻ (+ VAT)'},{id:'c',name:'Giá lẻ + VAT'},{id:'i',name:'Giá nhập'}]).map((p:any)=>p.id),['v','c']);
 const p={sku:'0000123',name:'Ly sứ',prices:[{policyId:'r',price:100000},{policyId:'v',price:108000}]};
 assert.deepEqual(priceLabelRows([p],'v')[0],{sku:'0000123',name:'Ly sứ',price:108000,qrText:'0000123'});
 assert.equal(priceLabelRows([{...p,prices:{v:0}}],'v')[0].price,0);
 assert.throws(()=>priceLabelRows([{...p,prices:{r:100000}}],'v'),/chưa có/);
 assert.throws(()=>priceLabelRows([{...p,active:false}],'v'),/hoạt động/);
 assert.throws(()=>priceLabelRows([p],'v',{copies:1001}),/1.000/);
 assert.equal(priceLabelRows([{...p,sku:'A/B trắng'}],'v',{qrMode:'link',origin:'https://crm.example'})[0].qrText,'https://crm.example/#/products/A%2FB%20tr%E1%BA%AFng');
});
test('A4 labels fit physical dimensions, margins and page capacity',()=>{
 assert.equal(labelLayout({width:70,height:35}).perPage,24);
 assert.equal(labelLayout({width:70,height:50}).perPage,15);
 assert.equal(labelLayout({width:70,height:35,margin:3}).perPage,16);
 assert.throws(()=>labelLayout({width:210,height:297,margin:1}),/không vừa/);
 assert.throws(()=>labelLayout({width:NaN,height:35}),/Tem cần/);
});
test('label product refresh is batched, ordered, read-only and fails on missing products',async()=>{
 const calls:string[]=[];const skus=Array.from({length:51},(_,i)=>'00'+i);
 const result=await loadLabelProducts(async(path:string)=>{calls.push(path);return {products:new URLSearchParams(path.split('?')[1]).get('skus')!.split(',').reverse().map(sku=>({sku})),policies:[{id:'v',name:'Giá lẻ + VAT'}]};},skus);
 assert.deepEqual(result.products.map((p:any)=>p.sku),skus);assert.equal(calls.length,2);assert.ok(calls.every(p=>p.startsWith('/products?skus=')));
 await assert.rejects(loadLabelProducts(async()=>({products:[]}),['missing']),/không tìm thấy/);
});
// @ts-ignore browser JS module
import {splitPrintable} from '../../trial-ui/price-labels.js';
test('quote labels skip unknown, inactive and unpriced codes instead of blocking the whole print',async()=>{
 const loaded=await loadLabelProducts(async()=>({products:[{sku:'A'},{sku:'C'}],policies:[]}),['A','B','C'],{allowMissing:true});
 assert.deepEqual(loaded.products.map((p:any)=>p.sku),['A','C']);assert.deepEqual(loaded.missing,['B']);
 const split=splitPrintable([{sku:'A',prices:[{policyId:'v',price:108000}]},{sku:'B',prices:[{policyId:'r',price:1}]},{sku:'C',active:false,prices:[{policyId:'v',price:5}]},{sku:'D',approvalStatus:'pending',prices:{v:5}},{sku:'E',prices:{v:0}}],'v');
 assert.deepEqual(split.ok.map((p:any)=>p.sku),['A','E']);
 assert.deepEqual(split.skipped,[{sku:'B',reason:'chưa có giá bán lẻ + VAT'},{sku:'C',reason:'ngừng bán hoặc chưa duyệt'},{sku:'D',reason:'ngừng bán hoặc chưa duyệt'}]);
});
