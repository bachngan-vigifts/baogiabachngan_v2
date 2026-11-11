import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {brandDiscountKey} from '../../src/modules/quotes/domain/quote-math.ts';
const app=readFileSync(new URL('../../trial-ui/app.js',import.meta.url),'utf8');
const reservations=app.slice(app.indexOf('const heldQty ='),app.indexOf('const stockDetail ='));
const kinds=app.slice(app.indexOf('const hasSupplierStock ='),app.indexOf('const stockText ='));
const columns=app.slice(app.indexOf('function pickerStockColumns('),app.indexOf('function renderPicker('));
function read({quoteId='own',loaded=true,stock={physical:20,incoming:25,supplier:40},brand='Lock',holds=[{quoteId:'own',qty:3},{quoteId:'other',qty:4}]}:any={}){
 const ctx:any={state:{warehouses:[{id:'physical',kind:'stock'},{id:'incoming',kind:'incoming'},{id:'supplier',kind:'supplier'}],holdsLoaded:loaded,holds:new Map([['SKU',holds]])},editor:{id:quoteId},p:{sku:'SKU',brand,stock},brandDiscountKey};
 runInNewContext(reservations+kinds+columns+';result=pickerStockColumns(p);',ctx);
 return JSON.parse(JSON.stringify(ctx.result));
}
test('picker columns separate physical/total holds/quote availability from incoming and supplier stock',()=>{
 assert.deepEqual(read(),{physical:20,held:7,mine:3,sellable:16,incoming:25,supplier:40});
 assert.equal(read({quoteId:''}).sellable,13,'new quote cannot use stock held by another quote');
 assert.equal(read({brand:'Minh Long'}).supplier,null,'preserve current supplier-stock eligibility');
});
test('missing reservation or stock data remains unknown instead of a false zero/available balance',()=>{
 assert.deepEqual(read({loaded:false}),{physical:20,held:null,mine:null,sellable:null,incoming:25,supplier:40});
 assert.equal(read({stock:{}}).physical,null);assert.equal(read({stock:{}}).sellable,null);
 assert.equal(read({stock:{physical:null}}).physical,null);
 assert.deepEqual(read({stock:{physical:0,incoming:0,supplier:0}}),{physical:0,held:7,mine:3,sellable:-4,incoming:0,supplier:0});
});
