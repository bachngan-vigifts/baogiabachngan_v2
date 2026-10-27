import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore browser module; helpers do not require DOM
import {loadEarlyRequestPages,receivedRequestLines,mergeRelatedRequests} from '../../trial-ui/supplier-request-details.js';
test('related early requests follow pagination, retain the same scope and do not truncate or duplicate headers',async()=>{
 const calls:string[]=[];const api=async(path:string)=>{calls.push(path);return calls.length===1?{requests:[{id:'a'}],nextOffset:50}:{requests:[{id:'a'},{id:'b'}],nextOffset:null};};
 assert.deepEqual(await loadEarlyRequestPages(api,{supplierId:'supplier-a',q:'LY1'}),[{id:'a'},{id:'b'}]);
 assert.equal(calls.length,2);for(const path of calls){const q=new URL(path,'https://fixture.invalid').searchParams;assert.equal(q.get('supplierId'),'supplier-a');assert.equal(q.get('q'),'LY1');}assert.match(calls[1]!,/offset=50/);
 await assert.rejects(loadEarlyRequestPages(async()=>({requests:[],nextOffset:0})),/Không tải tiếp/);
 let touched=false;assert.deepEqual(await loadEarlyRequestPages(async()=>{touched=true;return{};},{},()=>false),[]);assert.equal(touched,false);
});
test('received links are limited to the selected order and SKU, with positive recorded receipts only',()=>{
 const alloc=(orderId:string,receivedQty:number)=>({orderId,receivedQty});
 const request={lines:[{sku:'LY1',allocations:[alloc('a',4),alloc('b',30),alloc('a',0)]},{sku:'LY2',allocations:[alloc('a',8)]}]};
 const rows=receivedRequestLines(request,'a','ly1');assert.equal(rows.length,1);assert.deepEqual(rows[0].allocations,[alloc('a',4)]);assert.equal(request.lines[0]!.allocations.length,3);
});

test('a request shared by multiple suppliers retains every scoped allocation exactly once',()=>{
 const request=(id:string,qty:number)=>({id:'r',lines:[{id:'line',sku:'LY1',allocations:[{id,quantity:qty}]}]});
 const a=request('supplier-a',5),b=request('supplier-b',7);const rows=mergeRelatedRequests([[a],[b],[a]]);
 assert.equal(rows.length,1);assert.equal(rows[0].lines.length,1);assert.equal(rows[0].lines[0].allocations.reduce((s:number,x:any)=>s+x.quantity,0),12);assert.equal(a.lines[0]!.allocations.length,1);
});
