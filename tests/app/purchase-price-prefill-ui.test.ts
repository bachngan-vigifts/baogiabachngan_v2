import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {defaultCostDiscount,netPrice} from '../../src/modules/quotes/domain/quote-math.ts';

const source=readFileSync(new URL('../../trial-ui/purchases.js',import.meta.url),'utf8');
const start=source.indexOf('  async function prefillCosts(');
const end=source.indexOf('\n  }',start)+4;
// Exercise the actual form logic; inject the same exports as its browser module import.
const prefill=source.slice(start,end).replace("await import('./quote-math.js')",'math');
const product=(extra:Record<string,unknown>={})=>({sku:'LINK-1',brand:'Healthycook',name:'Nồi Ceres',taxable:true,taxOut:8,
  prices:[{policyId:'retail',price:1_000_000},{policyId:'vat',price:1_080_000}],...extra});
const line=(extra:Record<string,unknown>={})=>({l:{sku:'LINK-1',price:null,taxRate:null},p:{value:''},dc:{value:'0'},tx:{value:'8'},...extra});
async function fill(rows:any[],products:any[],pref='retail',fail=false){
  const hint={textContent:''},calls:string[]=[];
  const c={math:{defaultCostDiscount,netPrice},price:new Map(rows.map((r,i)=>[i,r])),hint,
    localStorage:{getItem:()=>pref},api:async(path:string)=>{calls.push(path);if(fail)throw Error('offline');return{products,policies:[{id:'retail',name:'Giá bán lẻ'},{id:'vat',name:'Giá lẻ +VAT'}]};}};
  await runInNewContext(prefill+';prefillCosts(price,hint)',c);
  return{hint:hint.textContent,calls};
}

test('linked Healthycook and existing Healthy Cook share the established 15% rule',async()=>{
  for(const brand of ['Healthycook','HEALTHY COOK','healthy  cook']){
    const row=line();await fill([row],[product({brand})]);
    assert.deepEqual([row.p.value,row.dc.value,row.tx.value],['1000000','15','8']);
  }
  assert.equal(defaultCostDiscount({brand:'Unhealthycook',name:'Nồi'}),null);
  assert.equal(defaultCostDiscount({brand:'Healthycookware',name:'Nồi'}),null);
  assert.equal(defaultCostDiscount({brand:'Minh Long',name:'Nồi Healthycook'}),15,'specific range wins over manufacturer');
});
test('VAT-inclusive reference is converted once; non-taxable reference stays unchanged',async()=>{
  const row=line();await fill([row],[product()],'vat');assert.equal(row.p.value,'1000000');
  const untaxed=line();await fill([untaxed],[product({taxable:false})],'vat');
  assert.equal(untaxed.p.value,'1080000');assert.equal(untaxed.tx.value,'0');
});
test('saved purchase prices and discounts are not overwritten with catalogue suggestions',async()=>{
  const row=line({l:{sku:'LINK-1',price:900000,taxRate:8},p:{value:'900000'},dc:{value:'0'}});
  const result=await fill([row],[product()]);assert.equal(result.calls.length,0);
  assert.deepEqual([row.p.value,row.dc.value],['900000','0']);
});
test('unsaved manual price and nonzero discount survive an in-flight catalogue response',async()=>{
  const row=line({p:{value:'900000'},dc:{value:'5'}});await fill([row],[product()]);
  assert.deepEqual([row.p.value,row.dc.value],['900000','5']);
});
test('missing product, selected-policy price, and purchase rule report distinct reasons without guessing prices',async()=>{
  for(const [products,reason] of [
    [[],/không tìm thấy sản phẩm/],
    [[product({prices:[]})],/chưa có giá ở bảng giá đang chọn/],
    [[product({brand:'Unknown'})],/chưa có quy tắc CK mua vào/],
  ] as const){
    const row=line();const result=await fill([row],[...products]);
    assert.equal(row.p.value,'');assert.match(result.hint,reason);assert.match(result.hint,/LINK-1/);
  }
});
test('failed catalogue request leaves fields editable and explains manual entry',async()=>{
  const row=line();const result=await fill([row],[],undefined,true);
  assert.equal(row.p.value,'');assert.match(result.hint,/Không lấy được giá niêm yết/);
});
