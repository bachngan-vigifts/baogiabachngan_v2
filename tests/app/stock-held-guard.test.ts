import {approveFixtureOrder} from '../helpers/approval-cost-fixture.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {and,eq} from 'drizzle-orm';
import {fixture,ok,photo,sku} from '../helpers/warehouse-lifecycle-fixture.ts';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';
import {stockMoves,stockTransfers} from '../../src/modules/inventory/schema.ts';
import {salesOrderLines} from '../../src/modules/sales/schema.ts';
import {auditLogs} from '../../src/core/db/schema.ts';

/**
 * Điều chuyển / xác nhận xuất kho không lấy hàng đang giữ cho đơn khác (sales/api/stock-free.ts).
 * Không tự xếp ưu tiên giữa các đơn: phần giữ của đơn khác luôn được bảo vệ, Manager xuất vượt phải ghi lý do.
 * Thao tác đồng thời chạy thật trên PostgreSQL khi có TEST_PG_URL.
 */
async function setup(){
 const f=await fixture(),c=f.cookies;
 ok(await f.call('/purchase-orders/a1/receipts',c.kho,'POST',{clientKey:crypto.randomUUID(),warehouse:'KHO VIGIFTS',createSapo:false,lines:[{lineId:'line-a1',goodQty:5}]}),201);
 await f.hold(); // hàng về: đơn A bấm Giữ hàng
 const transfer=async(qty:number)=>{let t=ok(await f.call('/stock-transfers',c.mgr,'POST',{fromWarehouseId:'vig',toWarehouseId:'other',reason:'Chuyển bổ sung kho khác',lines:[{sku,qty}]}),201);
  if(t.status==='pending')t=ok(await f.call(`/stock-transfers/${t.id}/approve`,c.mgr,'POST',{revision:t.revision}));return t;};
 const done=(t:any,cookie=c.mgr,overrideHolds?:unknown)=>f.call(`/stock-transfers/${t.id}/ship`,cookie,'POST',{revision:t.revision,...(overrideHolds?{overrideHolds}:{})});
 const receive=async(t:any,cookie=c.mgr)=>{const v=ok(await f.call(`/stock-transfers/${t.id}`,cookie));return f.call(`/stock-transfers/${t.id}/receive`,cookie,'POST',{revision:v.revision,lines:v.lines.map((l:any)=>({sku:l.sku,qty:l.qty}))});};
 /** Đơn B cùng mã, duyệt sau đơn A của fixture, có lịch giao + phiếu xuất đã gửi kho. */
 const orderB=async(qty:number,holdIt=false)=>{
  const q=ok(await f.call('/quotes',c.emp,'POST',{type:'B2B',quoteNo:'B-'+crypto.randomUUID(),customer:'Khách B',vat:8,rows:[{sku,name:'Bộ trà',unit:'Bộ',qty,price:2000}]}),201);
  ok(await f.call('/quotes/'+q.id+'/approve',c.mgr,'POST',{revision:1}));const o=ok(await f.call('/orders',c.emp,'POST',{quoteId:q.id,warehouseId:'vig'}),201);
  ok(await approveFixtureOrder(f,`/orders/${o.id}/status`,c.mgr,'PUT',{status:'confirmed',verified:true,costWarningsReviewed:true}));
  const lines=await f.db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId,o.id));
  ok(await f.call('/deliveries',c.emp,'POST',{orderId:o.id,plannedDate:'2026-10-24',lines:lines.map(l=>({orderLineId:l.id,qty:l.qty}))}),201);
  if(holdIt)await f.hold(o.id);
  const slip=ok(await f.call(`/orders/${o.id}/packing`,c.emp,'POST',{allocations:[{orderLineId:lines[0]!.id,qty,source:'warehouse'}]}),201).slips[0];
  ok(await f.call('/packing/'+slip.id+'/send',c.emp,'POST',{}));return {order:o,slip};};
 const confirm=(slipId:string,cookie=c.kho,overrideHolds?:unknown)=>f.call('/packing/'+slipId+'/confirm',cookie,'POST',{warehouseId:'vig',photos:[photo],...(overrideHolds?{overrideHolds}:{})});
 const overrides=async()=>(await f.db.select().from(auditLogs).where(eq(auditLogs.action,'stock-hold-override'))).length;
 return {...f,transfer,done,receive,orderB,confirm,overrides};
}

test('điều chuyển: chỉ chuyển phần không giữ; lấy phần đang giữ cần Manager + lý do, có nhật ký',async()=>{
 const f=await setup(),c=f.cookies;
 const all=await f.transfer(5),denied=await f.done(all);
 assert.equal(denied.status,409);assert.equal(denied.data.code,'HELD_FOR_OTHER_ORDER');assert.match(denied.data.error,/đang giữ cho đơn khác 5 \(/);assert.match(denied.data.error,new RegExp(f.order.orderNo));
 assert.equal(await f.balance(),5);assert.equal((await f.db.select().from(stockTransfers).where(eq(stockTransfers.id,all.id)))[0]!.status,'approved');
 await postMoves(f.db,'mgr',[{sku,warehouseId:'vig',qty:3,kind:'adjust',refType:'adjustment',refId:'free-3'}]);
 const free=await f.transfer(3);ok(await f.done(free,c.kho));ok(await f.receive(free,c.mgr));assert.equal(await f.balance(),5);assert.equal(await f.balance('other'),13);
 assert.equal((await f.done(all,c.kho,{reason:'Gấp cho khách khác'})).status,403,'kho không được lấy hàng giữ');
 assert.equal((await f.done(all,c.mgr,{reason:'ab'})).data.code,'HELD_OVERRIDE_REASON');
 ok(await f.done(all,c.mgr,{reason:'Khách A dời lịch, ưu tiên khách khác'}));assert.equal(await f.balance(),0);assert.equal(await f.overrides(),1);
 assert.equal((await f.confirm((await f.pack(0)).id)).data.code,'STOCK_SHORT','đơn A thiếu hàng thật – báo đúng thiếu tồn');
});

test('xác nhận xuất: đơn B không lấy phần giữ của đơn A; phần giữ của chính đơn được dùng; Manager xuất vượt có lý do',async()=>{
 const f=await setup(),c=f.cookies;
 const b=await f.orderB(5),denied=await f.confirm(b.slip.id);
 assert.equal(denied.data.code,'HELD_FOR_OTHER_ORDER');assert.equal(await f.balance(),5);
 assert.equal((await f.db.select().from(stockMoves).where(eq(stockMoves.refId,b.slip.id))).length,0,'bị chặn: không ghi sổ');
 assert.equal((await f.confirm(b.slip.id,c.kho,{reason:'Xuất gấp cho B'})).status,403);
 ok(await f.confirm(b.slip.id,c.mgr,{reason:'Khách A đồng ý chờ đợt hàng sau'}));assert.equal(await f.balance(),0);assert.equal(await f.overrides(),1);
});

test('đủ hàng cho cả hai đơn: A và B xác nhận xuất cùng lúc đều được, không âm kho, mỗi phiếu ghi một lần',async()=>{
 const f=await setup();
 await postMoves(f.db,'mgr',[{sku,warehouseId:'vig',qty:3,kind:'adjust',refType:'adjustment',refId:'stock-8'}]);
 const b=await f.orderB(3),a1=await f.pack(0),a2=await f.pack(1);
 const rs=await Promise.all([f.confirm(a1.id),f.confirm(a2.id),f.confirm(b.slip.id),f.confirm(b.slip.id)]);
 assert.deepEqual(rs.map(r=>r.status).sort(),[200,200,200,409],JSON.stringify(rs.map(r=>r.data)));
 assert.equal(await f.balance(),0);
 assert.equal((await f.db.select().from(stockMoves).where(and(eq(stockMoves.refType,'packing_slip'),eq(stockMoves.warehouseId,'vig')))).length,3);
});

test('đồng thời: điều chuyển phần trống và đơn B lấy hàng giữ của A – không bên nào ăn vào phần giữ, tồn không âm',async()=>{
 const f=await setup();
 await postMoves(f.db,'mgr',[{sku,warehouseId:'vig',qty:2,kind:'adjust',refType:'adjustment',refId:'stock-7'}]);
 const t=await f.transfer(2),b=await f.orderB(2,true);
 const [moved,packed]=await Promise.all([f.done(t),f.confirm(b.slip.id)]);
 // Tồn 7, A giữ 5, B giữ 2 → phần trống cho điều chuyển = 0; B được dùng phần giữ của chính B.
 assert.equal(moved.data.code,'HELD_FOR_OTHER_ORDER',JSON.stringify(moved.data));assert.equal(packed.status,200,JSON.stringify(packed.data));
 assert.equal(await f.balance(),5,'còn đủ phần A đang giữ');
});
