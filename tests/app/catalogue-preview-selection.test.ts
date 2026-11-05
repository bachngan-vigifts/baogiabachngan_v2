// @ts-nocheck
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {syncPreviewProducts} from '../../trial-ui/catalogue/preview-selection.js';
function fixture(){
 const rows=['a','b','c'].map((id,i)=>({dataset:{productId:id},active:false,classList:{toggle(k,on){rows[i].active=on}},getBoundingClientRect:()=>({top:100+i*60})}));
 const list={scrollTop:0,querySelectorAll:()=>rows,getBoundingClientRect:()=>({top:100}),scrollTo(o){this.target=o}};
 return {rows,list};
}
test('page navigation follows slide order, highlights all matching rows, scrolls only the list',()=>{
 const {rows,list}=fixture();syncPreviewProducts(list,{type:'products',items:[{id:'c'},{id:'a'}]},true);
 assert.deepEqual(rows.map(r=>r.active),[true,false,true]);assert.equal(list.target.top,120);
});
test('cover clears highlights and does not scroll; redraw never moves list',()=>{
 const {rows,list}=fixture();syncPreviewProducts(list,{type:'products',items:[{id:'b'}]});assert.equal(rows[1].active,true);assert.equal(list.target,undefined);
 syncPreviewProducts(list,{type:'cover'},true);assert.ok(rows.every(r=>!r.active));assert.equal(list.target,undefined);
 syncPreviewProducts(null,{type:'empty'},true);
});

