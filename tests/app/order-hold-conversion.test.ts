import {approveFixtureOrder} from '../helpers/approval-cost-fixture.ts';
import {test,beforeEach,afterEach,mock} from 'node:test';
import assert from 'node:assert/strict';
import {eq,inArray} from 'drizzle-orm';
import {fixture,ok,sku} from '../helpers/warehouse-lifecycle-fixture.ts';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';
import {orderStockHolds,salesOrders} from '../../src/modules/sales/schema.ts';

// The fixture delivery dates must stay unexpired regardless of when CI runs.
beforeEach(()=>mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-07T00:00:00.000Z')}));
afterEach(()=>mock.timers.reset());

/** Chuyển đổi đơn cũ đang giữ toàn bộ (legacy) sang giữ ≤ có thể bán: xem trước không ghi, áp dụng đúng mã kế hoạch, đơn trước giữ trước. */
async function setup(){
 const f=await fixture(),c=f.cookies;
 const newOrder=async(qty:number,date?:string,approve=true)=>{
  const q=ok(await f.call('/quotes',c.emp,'POST',{type:'B2B',quoteNo:'CV-'+crypto.randomUUID(),customer:'Khách cũ',vat:8,rows:[{sku,name:'Bộ trà',unit:'Bộ',qty,price:2000}]}),201);
  ok(await f.call('/quotes/'+q.id+'/approve',c.mgr,'POST',{revision:1}));
  const o=ok(await f.call('/orders',c.emp,'POST',{quoteId:q.id,warehouseId:'vig',...(date?{deliveryDate:date}:{})}),201);
  if(approve)ok(await approveFixtureOrder(f,`/orders/${o.id}/status`,c.mgr,'PUT',{status:'confirmed',verified:true,costWarningsReviewed:true}));
  return o.id as string;
 };
 // Bốn đơn có trước khi bật (giữ kiểu cũ): A, B có ngày giao; C không ngày giao; D nháp. Đơn mẫu của fixture cũng là đơn cũ, không ngày giao.
 const a=await newOrder(5,'2026-11-05'),b=await newOrder(4,'2026-11-06'),cc=await newOrder(3),d=await newOrder(2,'2026-11-07',false);
 const ids=[f.order.id,a,b,cc,d];
 await f.db.delete(orderStockHolds);
 await f.db.update(salesOrders).set({holdMode:'legacy'}).where(inArray(salesOrders.id,ids));
 await f.db.update(salesOrders).set({submittedAt:null});
 for(const [i,id] of ids.entries())await f.db.update(salesOrders).set({createdAt:`2026-10-2${i}T00:00:00.000Z`}).where(eq(salesOrders.id,id));
 await postMoves(f.db,'mgr',[{sku,warehouseId:'vig',qty:6,kind:'adjust',refType:'adjustment',refId:'conv-6'}]);
 const allHeld=async()=>ok(await f.call('/stock-holds?warehouseId=vig',c.mgr)).holds.reduce((n:number,h:any)=>n+h.qty,0);
 return {...f,a,b,cc,d,ids,allHeld};
}

test('xem trước không ghi gì; đơn trước giữ trước ≤ có thể bán; không ngày giao / nháp về 0 kèm lý do',async()=>{
 const f=await setup(),c=f.cookies;
 const legacyHeld=await f.allHeld();assert.equal(legacyHeld,19,'kiểu cũ: 5+5+4+3+2 giữ vượt tồn 6');
 const plan=ok(await f.call('/stock-holds/conversion',c.mgr));
 assert.equal((await f.call('/stock-holds/conversion',c.emp)).status,403);
 const row=(id:string)=>plan.orders.find((o:any)=>o.orderId===id);
 assert.deepEqual(plan.orders.map((o:any)=>o.orderId),f.ids,'thứ tự lập / gửi duyệt');
 assert.deepEqual([row(f.order.id).lines[0].after,row(f.order.id).reason],[0,'Không có ngày giao: không tự giữ']);
 assert.deepEqual([row(f.a).lines[0].after,row(f.b).lines[0].after],[5,1],'A giữ 5, B chỉ còn 1');
 assert.match(row(f.b).reason,/phần thiếu chờ hàng về/);
 assert.deepEqual([row(f.cc).lines[0].after,row(f.d).lines[0].after,row(f.d).reason],[0,0,'Đơn nháp: giữ khi duyệt']);
 assert.deepEqual(plan.held,{before:19,after:6});
 assert.equal(await f.allHeld(),19,'xem trước không ghi');
 assert.equal((await f.db.select().from(orderStockHolds)).length,0);
});

test('áp dụng: sai mã kế hoạch hoặc dữ liệu đổi sau khi xem thì chặn; đúng thì ghi một lần, áp dụng lại không đổi gì',async()=>{
 const f=await setup(),c=f.cookies;
 const plan=ok(await f.call('/stock-holds/conversion',c.mgr));
 assert.equal((await f.call('/stock-holds/conversion',c.mgr,'POST',{planId:plan.planId})).status,400,'phải xác nhận');
 assert.equal((await f.call('/stock-holds/conversion',c.emp,'POST',{planId:plan.planId,confirmed:true})).status,403);
 assert.equal((await f.call('/stock-holds/conversion',c.mgr,'POST',{planId:'khac',confirmed:true})).data.code,'HOLD_PLAN_CHANGED');
 await postMoves(f.db,'mgr',[{sku,warehouseId:'vig',qty:1,kind:'adjust',refType:'adjustment',refId:'conv-plus-1'}]);
 assert.equal((await f.call('/stock-holds/conversion',c.mgr,'POST',{planId:plan.planId,confirmed:true})).data.code,'HOLD_PLAN_CHANGED','tồn đổi sau khi xem');
 assert.equal(await f.allHeld(),19);
 const fresh=ok(await f.call('/stock-holds/conversion',c.mgr));
 const done=ok(await f.call('/stock-holds/conversion',c.mgr,'POST',{planId:fresh.planId,confirmed:true}));
 assert.equal(done.applied,5);assert.equal(await f.allHeld(),7);
 assert.ok((await f.db.select().from(salesOrders)).every(o=>o.holdMode==='capped'));
 assert.equal(ok(await f.call('/stock-holds/conversion',c.mgr,'POST',{planId:fresh.planId,confirmed:true})).applied,0,'áp dụng lại: không còn đơn cũ');
 assert.equal(await f.allHeld(),7);
});
