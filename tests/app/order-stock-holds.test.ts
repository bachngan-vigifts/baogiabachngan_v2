import {approveFixtureOrder} from '../helpers/approval-cost-fixture.ts';
import {test,beforeEach,afterEach,mock} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {fixture,ok,photo,sku} from '../helpers/warehouse-lifecycle-fixture.ts';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';
import {orderStockHolds,salesOrderLines,salesOrders} from '../../src/modules/sales/schema.ts';

// The fixture delivery dates must stay unexpired regardless of when CI runs.
beforeEach(()=>mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-07T00:00:00.000Z')}));
afterEach(()=>mock.timers.reset());

/**
 * Giữ hàng theo đơn CRM (quyết định 28/10/2026, order-hold-store.ts): mỗi lần giữ ≤ có thể bán; tự giữ lúc duyệt khi có ngày giao
 * (hạn ngày giao + 3 ngày); "Giữ hàng" thủ công 5 ngày; xuất kho tiêu hao; hết hạn / huỷ giữ / huỷ đơn chấm dứt.
 * Thao tác đồng thời chạy thật trên PostgreSQL khi có TEST_PG_URL.
 */
async function setup(stock=0){
 const f=await fixture(),c=f.cookies;
 if(stock)await postMoves(f.db,'mgr',[{sku,warehouseId:'vig',qty:stock,kind:'adjust',refType:'adjustment',refId:'stock-'+stock}]);
 /** Đơn mới cùng mã ở KHO VIGIFTS; `date`: ngày giao dự kiến (có thì duyệt là tự giữ). */
 const newOrder=async(qty:number,date?:string)=>{
  const q=ok(await f.call('/quotes',c.emp,'POST',{type:'B2B',quoteNo:'H-'+crypto.randomUUID(),customer:'Khách giữ',vat:8,rows:[{sku,name:'Bộ trà',unit:'Bộ',qty,price:2000}]}),201);
  ok(await f.call('/quotes/'+q.id+'/approve',c.mgr,'POST',{revision:1}));
  const o=ok(await f.call('/orders',c.emp,'POST',{quoteId:q.id,warehouseId:'vig',...(date?{deliveryDate:date}:{})}),201);
  const approved=ok(await approveFixtureOrder(f,`/orders/${o.id}/status`,c.mgr,'PUT',{status:'confirmed',verified:true,costWarningsReviewed:true}));
  return {id:o.id as string,approved};
 };
 const view=async(id:string)=>ok(await f.call(`/orders/${id}/holds`,c.emp));
 const heldOf=async(id:string)=>(await view(id)).lines.reduce((n:number,l:any)=>n+l.held,0);
 const allHeld=async()=>ok(await f.call('/stock-holds?warehouseId=vig',c.mgr)).holds.reduce((n:number,h:any)=>n+h.qty,0);
 const hold=(id:string,key:string=crypto.randomUUID(),cookie=c.emp)=>f.call(`/orders/${id}/holds`,cookie,'POST',{clientKey:key});
 return {...f,newOrder,view,heldOf,allHeld,hold};
}

test('duyệt có ngày giao: chỉ giữ phần có thể bán; đơn sau không giữ được phần đã giữ; tổng giữ không vượt tồn',async()=>{
 const f=await setup(3);
 const a=await f.newOrder(5,'2026-11-05');
 assert.deepEqual(a.approved.hold.map((l:any)=>[l.want,l.qty]),[[5,3]],'tồn 3: giữ 3, thiếu 2');
 assert.equal(await f.heldOf(a.id),3);
 const b=await f.newOrder(4,'2026-11-06');assert.equal(await f.heldOf(b.id),0,'không còn có thể bán');
 const none=await f.newOrder(2);assert.equal(none.approved.hold,undefined,'không ngày giao: không tự giữ');assert.equal(await f.heldOf(none.id),0);
 assert.equal(await f.allHeld(),3);
 const [row]=await f.db.select().from(orderStockHolds).where(eq(orderStockHolds.orderId,a.id));
 assert.deepEqual([row!.source,row!.expiresAt],['auto','2026-11-08T16:59:59.000Z']);
});

test('hàng về bấm "Giữ thêm": giữ phần còn thiếu ≤ có thể bán, hạn 5 ngày; gửi lặp cùng mã không giữ thêm; đơn khác chỉ còn phần trống',async()=>{
 const f=await setup(3);
 const a=await f.newOrder(5,'2026-11-05'),b=await f.newOrder(4);
 await postMoves(f.db,'mgr',[{sku,warehouseId:'vig',qty:4,kind:'receipt',refType:'supplier_receipt',refId:'more-4'}]);
 const key='hold-more-0001',first=await f.hold(a.id,key);
 assert.equal(first.status,201);assert.deepEqual(first.data.lines.map((l:any)=>[l.want,l.qty]),[[2,2]]);
 const again=await f.hold(a.id,key);assert.equal(again.status,200);assert.equal(again.data.replayed,true);assert.equal(await f.heldOf(a.id),5);
 const manual=(await f.db.select().from(orderStockHolds).where(eq(orderStockHolds.source,'manual')))[0]!;
 const days=(Date.parse(manual.expiresAt)-Date.parse(manual.createdAt))/864e5;assert.ok(Math.abs(days-5)<0.01,'hạn 5 ngày');
 assert.deepEqual(ok(await f.hold(b.id),201).lines.map((l:any)=>l.qty),[2],'tồn 7 − 5 đã giữ = 2');
 assert.equal(await f.allHeld(),7);
 assert.equal((await f.hold(a.id,'bad')).status,400,'mã chống gửi lặp bắt buộc');
});

test('nhiều đơn bấm "Giữ hàng" cùng lúc: tổng giữ không vượt tồn',async()=>{
 const f=await setup();
 const orders=await Promise.all([1,2,3].map(()=>f.newOrder(5)));
 await postMoves(f.db,'mgr',[{sku,warehouseId:'vig',qty:6,kind:'receipt',refType:'supplier_receipt',refId:'arrive-6'}]);
 const rs=await Promise.all(orders.map(o=>f.hold(o.id)));
 assert.ok(rs.every(r=>r.status===201),JSON.stringify(rs.map(r=>r.data)));
 assert.equal(rs.reduce((n,r)=>n+r.data.lines[0].qty,0),6);assert.equal(await f.allHeld(),6);
});

test('xuất kho tiêu hao đúng phần giữ của dòng; huỷ giữ thủ công; Manager gia hạn; hết hạn tự nhả và báo người phụ trách',async()=>{
 const f=await setup(),c=f.cookies;
 await postMoves(f.db,'mgr',[{sku,warehouseId:'vig',qty:5,kind:'receipt',refType:'supplier_receipt',refId:'arrive-5'}]);
 ok(await f.hold(f.order.id),201);assert.equal(await f.heldOf(f.order.id),5);
 const p=await f.pack(0);ok(await f.call('/packing/'+p.id+'/confirm',c.kho,'POST',{warehouseId:'vig',photos:[photo]}));
 assert.deepEqual((await f.view(f.order.id)).lines.map((l:any)=>[l.remaining,l.held]),[[0,0],[3,3]],'dòng 1 xuất 2: hết giữ dòng 1, dòng 2 còn giữ 3');
 assert.equal((await f.call(`/orders/${f.order.id}/holds/extend`,c.emp,'POST',{})).status,403);
 const before=(await f.db.select().from(orderStockHolds).where(eq(orderStockHolds.status,'active')))[0]!.expiresAt;
 ok(await f.call(`/orders/${f.order.id}/holds/extend`,c.mgr,'POST',{}));
 const after=(await f.db.select().from(orderStockHolds).where(eq(orderStockHolds.status,'active')))[0]!.expiresAt;
 assert.ok(Math.abs((Date.parse(after)-Date.parse(before))/864e5-5)<0.01,'gia hạn thêm 5 ngày');
 // Hết hạn: không còn trừ có thể bán; nhịp /pulse đánh dấu + báo một lần.
 await f.db.update(orderStockHolds).set({expiresAt:'2026-01-01T00:00:00.000Z'}).where(eq(orderStockHolds.status,'active'));
 assert.equal(await f.allHeld(),0);
 await f.call('/pulse',c.emp);await f.call('/pulse',c.emp);
 assert.ok((await f.db.select().from(orderStockHolds)).every(h=>h.status!=='active'));
 const notes=ok(await f.call('/notifications',c.emp)).notifications.filter((n:any)=>n.title==='Hết hạn giữ hàng');assert.equal(notes.length,1);
 // Giữ lại rồi huỷ giữ thủ công.
 ok(await f.hold(f.order.id),201);assert.equal(await f.heldOf(f.order.id),3);
 assert.equal((await f.call(`/orders/${f.order.id}/holds/release`,c.emp,'POST',{reason:''})).status,400);
 ok(await f.call(`/orders/${f.order.id}/holds/release`,c.emp,'POST',{reason:'Khách dời đơn'}));assert.equal(await f.heldOf(f.order.id),0);
});

test('đổi ngày giao: giữ tự động theo hạn mới; đơn duyệt khi chưa có ngày giao thì có ngày giao mới tự giữ; huỷ đơn nhả giữ',async()=>{
 const f=await setup(5),c=f.cookies;
 const a=await f.newOrder(2,'2026-11-05');
 await f.call(`/orders/${a.id}/packing`,c.mgr,'POST',{schedule:{plannedDate:'2026-11-10'},allocations:[{orderLineId:(await f.db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId,a.id)))[0]!.id,qty:1,source:'warehouse'}]});
 const [ah]=await f.db.select().from(orderStockHolds).where(eq(orderStockHolds.orderId,a.id));
 assert.equal(ah!.expiresAt,'2026-11-13T16:59:59.000Z','ngày giao đổi 10/11 → hạn 13/11');
 const b=await f.newOrder(2);assert.equal(await f.heldOf(b.id),0);
 await f.call(`/orders/${b.id}/packing`,c.mgr,'POST',{schedule:{plannedDate:'2026-11-12'},allocations:[{orderLineId:(await f.db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId,b.id)))[0]!.id,qty:1,source:'warehouse'}]});
 assert.equal(await f.heldOf(b.id),2,'có ngày giao: tự giữ');
 ok(await f.call(`/orders/${b.id}/status`,c.mgr,'PUT',{status:'cancelled'}));
 assert.deepEqual((await f.db.select().from(orderStockHolds).where(eq(orderStockHolds.orderId,b.id))).map(h=>h.status),['released']);
});

test('đơn cũ (legacy) không giữ thủ công được – chờ kế hoạch chuyển đổi',async()=>{
 const f=await setup(5);
 await f.db.update(salesOrders).set({holdMode:'legacy'}).where(eq(salesOrders.id,f.order.id));
 assert.equal((await f.hold(f.order.id)).data.code,'HOLD_LEGACY_ORDER');
});
