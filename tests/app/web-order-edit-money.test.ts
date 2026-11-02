import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculateWebCart,webEditorModel} from '../../src/modules/sales/domain/web-order-edit.ts';
test('Woo coupon already allocated to line: model retains discount exactly once; inclusive VAT, shipping tax and extra discount reconcile',()=>{
 const model=webEditorModel({lines:JSON.stringify([{sku:'A',quantity:2,subtotal:200000,subtotalTax:16000,total:180000,totalTax:14400}]),financialSnapshot:JSON.stringify({version:1,itemsSubtotal:200000,itemsSubtotalTax:16000,itemsTotal:180000,itemsTax:14400,discountTotal:20000,discountTax:1600,shippingTotal:10000,shippingTax:800,totalTax:15200,total:205200,coupons:[{code:'TEN',discount:20000,tax:1600}],fees:[],shipping:[]}),crmEditSnapshot:'{}'});
 assert.equal(model.lines[0].unitPrice,108000);assert.equal(model.lines[0].discountValue,21600);assert.equal(model.orderDiscount,0);
 const p=calculateWebCart(model);assert.equal(p.total,205200);assert.equal(p.financials.totalTax,15200);assert.equal(p.financials.shippingTax,800);assert.equal(p.financials.itemsTax,14400);
 const extra=calculateWebCart({...model,orderDiscount:10000});assert.equal(extra.total,195200);assert.equal(extra.lines.reduce((s,l)=>s+l.total,0)+10800,extra.total);
});
test('price/quantity/discount validation blocks negative and excessive values; zero-price replacement is explicit and valid',()=>{
 const b={lines:[{sku:'A',qty:1,unitPrice:108000,taxRate:8,discountType:'percent',discountValue:10}],orderDiscount:0};
 assert.equal(calculateWebCart(b).total,97200);
 for(const patch of [{unitPrice:-1},{qty:0},{qty:NaN},{taxRate:101},{discountValue:101},{discountType:'amount',discountValue:108001}])assert.throws(()=>calculateWebCart({...b,lines:[{...b.lines[0],...patch}]}));
 assert.throws(()=>calculateWebCart({...b,orderDiscount:100000}));assert.throws(()=>calculateWebCart({...b,lines:[b.lines[0],b.lines[0]]}));
 assert.equal(calculateWebCart({lines:[{sku:'GIFT',qty:1,unitPrice:0,taxRate:0}]}).total,0);
});
