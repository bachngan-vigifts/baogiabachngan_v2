// @ts-nocheck
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readBulkEditPatch} from '../../trial-ui/catalogue/library-bulk.js';
import {libraryPricing,price} from '../../trial-ui/catalogue/core.js';
import {createLibraryBudget,validBudgetRanges} from '../../trial-ui/catalogue/library-budget.js';
test('bulk pricing reads numeric values and empty override restores formula',()=>{
 const d=new FormData();d.set('override','');d.set('discount','12.5');d.set('fee','15000');
 assert.deepEqual(readBulkEditPatch(d),{override:null,discount:12.5,fee:15000});
 d.set('override','250000');assert.equal(readBulkEditPatch(d).override,250000);
});
test('shared values override defaults, zero values remain valid and null price restores formula',()=>{
 const settings={lockDiscount:40,minhDiscount:10,fee:15000},p={brand:'Minh Long',regular:100000};
 assert.equal(price(libraryPricing(p,settings)),105000);
 assert.equal(price(libraryPricing({...p,discount:0,fee:0,override:null},settings)),100000);
 assert.equal(price(libraryPricing({...p,override:123000},settings)),123000);
});
test('budget defaults unchecked, custom ranges persist but selections do not; OR filters exclude contact',()=>{
 const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
 const b=createLibraryBudget();assert.deepEqual(b.active(),[]);assert(b.matches({priceOnRequest:true},0));
 b.change({dataset:{budgetCheck:'0'},checked:true});assert(b.matches({},350000));assert(!b.matches({},350001));assert(!b.matches({priceOnRequest:true},0));
 b.change({dataset:{budgetMax:'0'},value:'450000'});assert(b.matches({},400000));
 b.change({dataset:{budgetCheck:'4'},checked:true});assert(b.matches({},3000000));assert(!b.matches({},900000));
 const next=createLibraryBudget();assert.deepEqual(next.active(),[]);next.change({dataset:{budgetCheck:'0'},checked:true});assert.equal(next.active()[0][1],450000);
 assert.throws(()=>b.change({dataset:{budgetMax:'0'},value:'-1'}));assert(!validBudgetRanges([[10,1]]));b.clear();assert.deepEqual(b.active(),[]);
});
test('bulk pricing rejects invalid ranges and preserves unchecked fields',()=>{
 assert.deepEqual(readBulkEditPatch(new FormData()),{});
 for(const [k,v] of [['discount','101'],['fee','-1'],['override','no'],['discount','']]){const d=new FormData();d.set(k,v);assert.throws(()=>readBulkEditPatch(d));}
});