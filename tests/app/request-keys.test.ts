import {approveFixtureOrder} from '../helpers/approval-cost-fixture.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {fixture,ok,sku} from '../helpers/warehouse-lifecycle-fixture.ts';
import {deliveries,salesOrderLines} from '../../src/modules/sales/schema.ts';
import {supplierReceipts} from '../../src/modules/suppliers/schema.ts';

/**
 * Mã chống gửi lặp kiểm cả NỘI DUNG (migration 20261029120000):
 *  - lịch giao: cùng mã + cùng nội dung → trả chuyến cũ; cùng mã khác nội dung → 409;
 *  - phiếu nhận NCC: cùng mã nhưng khác số lượng / kho / ngày / phiếu xin hàng → 409 (không trả phiếu cũ).
 * Gửi đồng thời cùng mã chỉ tạo một chứng từ (chạy thật trên PostgreSQL khi có TEST_PG_URL).
 */
async function setup(){
 const f=await fixture(),c=f.cookies;
 const q=ok(await f.call('/quotes',c.emp,'POST',{type:'B2B',quoteNo:'RK-'+crypto.randomUUID(),customer:'Khách lịch giao',vat:8,rows:[{sku,name:'Bộ trà',unit:'Bộ',qty:5,price:2000}]}),201);
 ok(await f.call('/quotes/'+q.id+'/approve',c.mgr,'POST',{revision:1}));
 const o=ok(await f.call('/orders',c.emp,'POST',{quoteId:q.id,warehouseId:'vig'}),201);
 ok(await approveFixtureOrder(f,`/orders/${o.id}/status`,c.mgr,'PUT',{status:'confirmed',verified:true,costWarningsReviewed:true}));
 const [line]=await f.db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId,o.id));
 const trips=async()=>(await f.db.select().from(deliveries).where(eq(deliveries.orderId,o.id))).length;
 const schedule=(body:Record<string,unknown>)=>f.call('/deliveries',c.emp,'POST',{orderId:o.id,plannedDate:'2026-11-05',lines:[{orderLineId:line!.id,qty:2}],...body});
 const receive=(body:Record<string,unknown>)=>f.call('/purchase-orders/a1/receipts',c.kho,'POST',{warehouse:'KHO VIGIFTS',createSapo:false,receivedDate:'2026-10-28',lines:[{lineId:'line-a1',goodQty:2,damagedQty:0}],...body});
 return {...f,orderId:o.id as string,line:line!,trips,schedule,receive};
}

test('lịch giao: gửi lại cùng nội dung trả chuyến cũ; cùng mã khác nội dung báo lỗi; mã không hợp lệ báo lỗi',async()=>{
 const f=await setup(),key='trip-key-0001';
 const first=await f.schedule({clientKey:key});assert.equal(first.status,201,JSON.stringify(first.data));
 const again=await f.schedule({clientKey:key});assert.equal(again.status,200);assert.deepEqual([again.data.id,again.data.replayed],[first.data.id,true]);
 for(const other of [{lines:[{orderLineId:f.line.id,qty:3}]},{plannedDate:'2026-11-06'},{address:'Địa chỉ khác'}]){
  const r=await f.schedule({clientKey:key,...other});assert.equal(r.status,409,JSON.stringify(other));assert.equal(r.data.code,'IDEMPOTENCY_CONFLICT');
 }
 assert.equal((await f.schedule({clientKey:'bad'})).status,400);
 assert.equal(await f.trips(),1);
 assert.equal((await f.schedule({clientKey:'trip-key-0002'})).status,201,'mã mới = lịch giao mới (còn 3 chưa lên lịch)');
 assert.equal(await f.trips(),2);
});

test('lịch giao: ba lần gửi cùng mã đồng thời chỉ tạo một chuyến',async()=>{
 const f=await setup();
 const rs=await Promise.all([1,2,3].map(()=>f.schedule({clientKey:'trip-key-race1'})));
 assert.ok(rs.every(r=>r.status===200||r.status===201),JSON.stringify(rs.map(r=>r.data)));
 assert.equal(new Set(rs.map(r=>r.data.id)).size,1);assert.equal(await f.trips(),1);
});

test('phiếu nhận NCC: cùng mã khác số lượng / kho / ngày / phiếu xin hàng → báo lỗi, không trả phiếu cũ; cùng nội dung → trả phiếu cũ',async()=>{
 const f=await setup(),key='rcv-key-000001';
 const first=await f.receive({clientKey:key});assert.equal(first.status,201,JSON.stringify(first.data));assert.equal(await f.balance(),2);
 const again=await f.receive({clientKey:key});assert.equal(again.status,200);assert.equal(again.data.duplicate,true);
 for(const other of [{lines:[{lineId:'line-a1',goodQty:3,damagedQty:0}]},{warehouse:'Kho khác'},{receivedDate:'2026-10-27'},{earlyRequestId:'phieu-xin-khac'}]){
  const r=await f.receive({clientKey:key,...other});assert.equal(r.status,409,JSON.stringify(other));assert.equal(r.data.code,'IDEMPOTENCY_CONFLICT');
 }
 assert.equal((await f.db.select().from(supplierReceipts)).length,1);assert.equal(await f.balance(),2,'không cộng kho lần hai');
});

test('phiếu nhận NCC: ba lần gửi cùng mã đồng thời chỉ một phiếu, cộng kho một lần',async()=>{
 const f=await setup();
 const rs=await Promise.all([1,2,3].map(()=>f.receive({clientKey:'rcv-key-race01'})));
 assert.ok(rs.every(r=>r.status===200||r.status===201),JSON.stringify(rs.map(r=>r.data)));
 assert.equal((await f.db.select().from(supplierReceipts)).length,1);assert.equal(await f.balance(),2);
});
