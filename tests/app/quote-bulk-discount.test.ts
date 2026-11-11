import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Browser module.
import {bulkQuoteDiscount,initBulkQuoteDiscount} from '../../trial-ui/quote-bulk-discount.js';
import {totals} from '../../src/modules/quotes/domain/quote-math.ts';
test('twenty saved product rows change from 0 to 20 percent without altering quantities, prices, tax or manual fees',()=>{
 const rows=[...Array.from({length:20},(_,i)=>({sku:'SKU-'+i,qty:2,price:100000,discount:0,discountType:'percent',taxRate:8,printFee:1000})),{manualLine:true,name:'Phụ phí',qty:1,price:50000,discount:0,printFee:0}];
 const result=bulkQuoteDiscount(rows,20);assert.equal(result.count,20);assert(rows.every(r=>r.discount===0));assert(result.rows.slice(0,20).every((r:any)=>r.discount===20&&r.discountType==='percent'&&r.price===100000&&r.qty===2&&r.taxRate===8&&r.printFee===1000));assert.equal(result.rows[20],rows[20]);
 const total=totals({type:'B2B',rows:result.rows,vat:8} as any);assert.equal(total.subtotal,3290000);assert.equal(total.total,3553200);
});
test('only-zero scope preserves existing discounts and invalid input never partially changes data',()=>{
 const rows=[{sku:'A',price:100,discount:0,discountType:'amount'},{sku:'B',price:100,discount:10,discountType:'percent'},{manualLine:true,sku:'MANUAL',price:100,discount:0},{name:'Phụ phí cũ',price:100,discount:10}];
 const r=bulkQuoteDiscount(rows,20,'zero');assert.equal(r.count,1);assert.equal(r.rows[0].discount,20);assert.equal(r.rows[0].discountType,'percent');assert.equal(r.rows[1],rows[1]);assert.equal(r.rows[2],rows[2]);assert.equal(r.rows[3],rows[3]);
 for(const bad of ['',null,NaN,-1,101,'abc'])assert.throws(()=>bulkQuoteDiscount(rows,bad));assert.equal(rows[0]!.discount,0);
 assert.equal(bulkQuoteDiscount(rows,0).rows[0].discount,0);
});
test('bulk modal does not open for locked quotes and rejects a changed quote or lost edit access',()=>{
 const buttonEvents:Record<string,Function>={},events:Record<string,Function>={},error={textContent:''},summary={textContent:''};let locked=true,key='one',shown=0,applied=0;
 const form={elements:{discount:{value:'20',focus(){}},scope:{value:'all'}},reset(){},addEventListener:(name:string,fn:Function)=>events[name]=fn};
 const dialog={querySelector:(selector:string)=>selector==='form'?form:selector==='[role="alert"]'?error:summary,showModal(){shown++;},close(){},addEventListener(){}};
 initBulkQuoteDiscount({button:{addEventListener:(name:string,fn:Function)=>buttonEvents[name]=fn},dialog,getRows:()=>[{sku:'A',discount:0}],apply:()=>applied++,isLocked:()=>locked,context:()=>key});
 buttonEvents.click!();assert.equal(shown,0);locked=false;buttonEvents.click!();assert.equal(shown,1);
 key='two';events.submit!({preventDefault(){}});assert.equal(applied,0);assert.match(error.textContent,/đã thay đổi/);
 key='one';locked=true;events.submit!({preventDefault(){}});assert.equal(applied,0);
});
