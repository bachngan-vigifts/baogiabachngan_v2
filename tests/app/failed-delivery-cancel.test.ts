import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {fixture,ok,photo} from '../helpers/warehouse-lifecycle-fixture.ts';
import {stockMoves} from '../../src/modules/inventory/schema.ts';
import {deliveries,packingSlips,salesOrders,customerPayments} from '../../src/modules/sales/schema.ts';

/**
 * Đơn CRM đã xuất kho → chuyến rời kho → giao thất bại → khách không nhận: Manager xác nhận kho đã nhận lại hàng rồi huỷ,
 * hàng về đúng kho đã xuất đúng một lần (routes.ts › cancel-after-failed-delivery). Giao lại vẫn dùng luồng giao thường.
 */
async function shipped(){
 const f=await fixture(),c=f.cookies;
 ok(await f.call('/purchase-orders/a1/receipts',c.kho,'POST',{clientKey:crypto.randomUUID(),warehouse:'KHO VIGIFTS',createSapo:false,lines:[{lineId:'line-a1',goodQty:5}]}),201);
 for(const i of [0,1]){const p=await f.pack(i);ok(await f.call('/packing/'+p.id+'/confirm',c.kho,'POST',{warehouseId:'vig',photos:[photo]}));}
 ok(await f.call(`/deliveries/${f.trip.id}/status`,c.emp,'PUT',{status:'in_transit'}));
 const cancel=(cookie=c.mgr,extra:Record<string,unknown>={})=>f.call(`/orders/${f.order.id}/cancel-after-failed-delivery`,cookie,'POST',{key:'failed-cancel-0001',reason:'Khách không nhận hàng',confirmedReceived:true,...extra});
 return {...f,cancel};
}

test('giao thất bại, khách huỷ: kho xác nhận nhận lại → huỷ đơn, hàng về đúng kho đã xuất một lần; gửi lại không cộng thêm',async()=>{
 const f=await shipped(),c=f.cookies;
 assert.equal(await f.balance(),0);
 assert.equal((await f.cancel()).data.code,'DELIVERY_IN_PROGRESS','chuyến đang đi: chưa huỷ được');
 ok(await f.call(`/deliveries/${f.trip.id}/status`,c.emp,'PUT',{status:'failed'}));
 assert.equal((await f.call(`/orders/${f.order.id}/status`,c.mgr,'PUT',{status:'cancelled'})).data.code,'RETURN_REQUIRED','huỷ thường vẫn bị chặn');
 assert.equal((await f.cancel(c.emp)).status,403);
 assert.equal((await f.cancel(c.mgr,{confirmedReceived:false})).status,400);
 assert.equal((await f.cancel(c.mgr,{key:''})).status,400);
 const done=ok(await f.cancel());assert.equal(done.replayed,false);
 assert.equal(await f.balance(),5);assert.equal(await f.balance('other'),10,'kho khác không đổi');
 const [order]=await f.db.select().from(salesOrders).where(eq(salesOrders.id,f.order.id));assert.equal(order!.status,'cancelled');
 assert.ok((await f.db.select().from(packingSlips).where(eq(packingSlips.orderId,f.order.id))).every(s=>s.status==='cancelled'));
 assert.equal((await f.db.select().from(deliveries).where(eq(deliveries.id,f.trip.id)))[0]!.status,'cancelled');
 assert.equal(ok(await f.cancel()).replayed,true);assert.equal(await f.balance(),5);
 assert.equal((await f.cancel(c.mgr,{key:'failed-cancel-0002'})).status,409,'khoá khác trên đơn đã huỷ');
 const reversed=(await f.db.select().from(stockMoves).where(eq(stockMoves.kind,'reverse'))).reduce((n,m)=>n+m.qty,0);assert.equal(reversed,5);
});

test('gửi đồng thời ba lần: huỷ một lần, hàng về kho một lần',async()=>{
 const f=await shipped(),c=f.cookies;
 ok(await f.call(`/deliveries/${f.trip.id}/status`,c.emp,'PUT',{status:'failed'}));
 const rs=await Promise.all([1,2,3].map(()=>f.cancel()));
 assert.ok(rs.every(r=>r.status===200),JSON.stringify(rs.map(r=>r.data)));assert.equal(rs.filter(r=>!r.data.replayed).length,1);
 assert.equal(await f.balance(),5);
});

test('không áp dụng khi chưa rời kho, đã giao một phần hoặc đã thu tiền',async()=>{
 const f=await fixture(),c=f.cookies;
 const r=await f.call(`/orders/${f.order.id}/cancel-after-failed-delivery`,c.mgr,'POST',{key:'failed-cancel-0003',reason:'Khách không nhận hàng',confirmedReceived:true});
 assert.equal(r.data.code,'NOT_DISPATCHED');
 const g=await shipped();ok(await g.call(`/deliveries/${g.trip.id}/status`,g.cookies.emp,'PUT',{status:'failed'}));
 await g.db.insert(customerPayments).values({id:'paid-failed',orderId:g.order.id,amount:1000,paidAt:'2026-10-24',method:'transfer',createdBy:'mgr',createdAt:new Date().toISOString()});
 assert.equal((await g.cancel()).data.code,'ORDER_DELIVERED_OR_PAID');assert.equal(await g.balance(),0);
});
