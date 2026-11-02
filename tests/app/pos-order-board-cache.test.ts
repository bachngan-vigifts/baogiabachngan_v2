import {test} from 'node:test';
import assert from 'node:assert/strict';
import {filterPosOrderBoard} from '../../src/modules/sales/domain/pos-order-board.ts';
// @ts-ignore browser module
import {createPosOrderBoardCache} from '../../trial-ui/pos-order-board-cache.js';
const states=['all','web','pending','packing','waiting_delivery','completed','cancelled'];
const rows=Array.from({length:18},(_,i)=>({id:String(i),orderNo:'POS'+i,customerName:'Khách',phone:'',ownerId:null,ownerName:null,sapoOrderCode:null,orderDate:'2026-11-02',bucket:states[2+i%5]!,orderSource:i%2?'web':'pos',paymentStatus:i%3===0?'unknown':i%3===1?'paid':'debt',currency:i%4===0?'USD':'VND',total:100+i,paid:i%3===0?null:i%3===1?100+i:10,outstanding:i%3===0?null:i%3===1?0:90+i}));
const params=(status='all',source='all')=>new URLSearchParams({registerId:'store',status,source,payment:'all'});
test('complete local cohort matches server status filters, counts and currency totals, including web open and unknown payments',()=>{
 for(const payment of ['all','paid','debt','unknown']){
  const cache=createPosOrderBoardCache(),p=params();p.set('payment',payment);const full=filterPosOrderBoard(rows,p);cache.remember(p,{...full,registerId:'store',totalOrders:full.orders.length,nextOffset:null},'employee');
  for(const status of states){const next=params(status);next.set('payment',payment);const expected=filterPosOrderBoard(rows,next),got=cache.get(next,'employee');assert.ok(got,status);assert.deepEqual(got.orders,expected.orders);assert.deepEqual(got.totals,expected.totals);assert.deepEqual(got.counts,expected.counts);assert.deepEqual(got.analytics,expected.analytics);assert.equal(got.totalOrders,expected.orders.length);}
 }
});
test('partial first page never becomes a complete local filter; a recent exact view can still be reused',()=>{
 const cache=createPosOrderBoardCache(),p=params(),data={registerId:'store',orders:rows.slice(0,4),counts:{all:18},totalOrders:18,nextOffset:4};cache.remember(p,data,'a');assert.equal(cache.get(p,'a'),data);assert.equal(cache.get(params('web'),'a'),null);
});
test('cache expires without extending on reads and never crosses account, store or other filters',()=>{
 let now=0;const cache=createPosOrderBoardCache({now:()=>now}),p=params(),data={...filterPosOrderBoard(rows,p),registerId:'store',totalOrders:18,nextOffset:null};cache.remember(p,data,'a');
 assert.equal(cache.get(params('web','cod'),'a'),null);const other=params();other.set('registerId','other');assert.equal(cache.get(other,'a'),null);now=14999;assert.ok(cache.get(p,'a'));now=15001;assert.equal(cache.get(p,'a'),null);
 cache.remember(p,data,'a');assert.equal(cache.get(p,'b'),null);assert.equal(cache.get(p,'a'),null);cache.remember(p,data,'a');cache.clear();assert.equal(cache.get(p,'a'),null);
});
