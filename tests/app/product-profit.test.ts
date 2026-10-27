import {test} from 'node:test';
import assert from 'node:assert/strict';
import {productQuoteProfit} from '../../src/modules/product-hub/domain/product-profit.ts';
import {profit,type QuoteDoc} from '../../src/modules/quotes/domain/quote-math.ts';
test('SKU profit is quantity weighted, uses existing discount/commission/printing math and excludes other SKUs',()=>{
 const row={sku:'A',name:'A',qty:2,price:100,discount:10,costPrice:50,printFee:10,printing:{unitPrice:4},commission:{mode:'percent' as const,value:10}},d:QuoteDoc={type:'B2B',vat:8,rows:[row,{sku:'OTHER',qty:1000,price:100,costPrice:0}]};
 const second:QuoteDoc={type:'HRC',rows:[{sku:'A',qty:1,price:200,costPrice:100}]},r=productQuoteProfit('A',[d,second]);
 assert.equal(r.quantity,3);assert.equal(r.estimatedProfit,profit({...d,rows:[row]}).gross+100);assert.equal(r.averagePerUnit,r.estimatedProfit/3);assert.equal(r.coveredQuotes,2);
});
test('missing cost or unallocated printing stays unknown, explicit zero cost is valid, and negative estimates are retained',()=>{
 const r=productQuoteProfit('A',[{type:'B2B',printing:{totalCost:1000},rows:[{sku:'A',qty:3,price:100},{sku:'A',qty:2,price:100,costPrice:50,printFee:10},{sku:'A',qty:1,price:100,costPrice:0},{sku:'A',qty:1,price:100,costPrice:120}]}]);
 assert.equal(r.missingCostQty,3);assert.equal(r.missingPrintingQty,2);assert.equal(r.quantity,2);assert.equal(r.estimatedProfit,80);assert.equal(r.averagePerUnit,40);
 const missing=productQuoteProfit('A',[{type:'HRC',rows:[{sku:'A',qty:2,price:100}]}]);assert.equal(missing.averagePerUnit,null);assert.equal(missing.margin,null);assert.equal(missing.estimatedProfit,0);
});
