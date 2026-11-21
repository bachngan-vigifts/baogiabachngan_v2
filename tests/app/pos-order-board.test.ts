import {webOrderBucket} from '../../src/modules/sales/domain/web-order-outcome.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { setup } from '../helpers/pos-fixture.ts';
import {auditLogs} from '../../src/core/db/schema.ts';
import {webStoreOrders} from '../../src/modules/sales/pos-schema.ts';
import { customerPayments, salesOrders } from '../../src/modules/sales/schema.ts';
import { filterPosOrderBoard, cancellationAnalytics, advertisingCancellationRisk } from '../../src/modules/sales/domain/pos-order-board.ts';

test('board totals apply every filter, omit cancellations, and keep currencies separate', () => {
  const row = { id:'a', orderNo:'POS_A', customerName:'Nguyễn An', phone:'09', ownerId:'emp', ownerName:'Nhân viên', sapoOrderCode:null, orderDate:'2026-10-21', bucket:'completed', orderSource:'pos', paymentStatus:'paid', total:100, paid:100, outstanding:0, currency:'VND' };
  const rows = [row, {...row,id:'b',orderSource:'cod',paymentStatus:'debt',paid:20,outstanding:80,bucket:'waiting_delivery'}, {...row,id:'c',bucket:'cancelled'}, {...row,id:'d',orderSource:'web',ownerId:'',paymentStatus:'unknown',currency:'USD',total:5,paid:null,outstanding:null}];
  const all = filterPosOrderBoard(rows, new URLSearchParams());
  assert.deepEqual(all.totals.map(t=>[t.currency,t.revenue,t.orders]), [['VND',200,2],['USD',5,1]]);
  assert.equal(all.counts.all,4);
  const debt = filterPosOrderBoard(rows,new URLSearchParams('source=cod&payment=debt&from=2026-10-21&to=2026-10-21&ownerId=emp&q=nguyen&status=waiting_delivery'));
  assert.deepEqual(debt.orders.map(o=>o.id),['b']);
  assert.equal(debt.totals[0]!.outstanding,80);
  assert.equal(filterPosOrderBoard(rows,new URLSearchParams('from=2026-10-22')).orders.length,0);
  assert.equal(filterPosOrderBoard(rows,new URLSearchParams('payment=paid')).orders.length,1);
  assert.equal(filterPosOrderBoard(rows,new URLSearchParams('payment=unknown')).orders.length,1);
  for (const p of ['from=2026-02-30','from=2026-11-01&to=2026-10-01','source=bad','payment=bad','status=bad']) assert.throws(()=>filterPosOrderBoard(rows,new URLSearchParams(p)));
});

test('board API: more than 500 orders, receipts/voids, staff, dates, sources and store scope', async () => {
  const f=await setup();
    const shift=await f.open();
    const checkout=await f.call('/pos/checkout',f.emp,'POST',f.cart(shift.id));
    assert.equal(checkout.status,201,JSON.stringify(checkout.data));
    const [base]=await f.db.select().from(salesOrders).where(eq(salesOrders.id,checkout.data.id));
    assert.ok(base);
    // 501 additional rows expose the old 500-row cap. Different days exercise inclusive range filtering.
    await f.db.insert(salesOrders).values(Array.from({length:501},(_,i)=>({...base,id:`board-${i}`,orderNo:`BOARD_${i}`,checkoutKey:null,posPaymentRequestId:null,orderDate:'2026-10-20',total:100,fulfillmentMode:'cod',status:'confirmed' as const})));
    let board=await f.call(`/pos/orders?registerId=${f.registerId}&source=cod&from=2026-10-20&to=2026-10-20&payment=debt&ownerId=emp`,f.emp);
    assert.equal(board.status,200,JSON.stringify(board.data));
    assert.equal(board.data.totalOrders,501); assert.equal(board.data.orders.length,100,'danh sách trả theo trang 100 đơn'); assert.equal(board.data.nextOffset,100); assert.equal(board.data.totals[0].revenue,50100,'tổng tiền vẫn tính trên toàn bộ kết quả lọc');
    assert.equal(board.data.totals[0].outstanding,50100);
    board=await f.call(`/pos/orders?registerId=${f.registerId}&source=pos&payment=paid`,f.emp);
    assert.equal(board.data.orders.length,1);
    await f.db.update(customerPayments).set({voidedAt:new Date().toISOString()}).where(eq(customerPayments.orderId,base.id));
    board=await f.call(`/pos/orders?registerId=${f.registerId}&source=pos&payment=paid`,f.emp);
    assert.equal(board.data.orders.length,0);
    board=await f.call(`/pos/orders?registerId=${f.registerId}&source=pos&payment=debt`,f.emp);
    assert.equal(board.data.orders.length,1);
    assert.equal(board.data.totals[0].outstanding,base.total);
    assert.equal((await f.call('/pos/orders?from=invalid',f.emp)).status,400);
    const other=await f.call('/pos/registers',f.mgr,'POST',{name:'Quầy khác',warehouseId:'pos-wh',pricePolicyId:'retail-vat',secondPricePolicyId:'retail',taxRate:8});
    assert.equal((await f.call(`/pos/orders?registerId=${other.data.id}`,f.emp)).status,403);
    await f.db.update(salesOrders).set({status:'cancelled',posSnapshot:JSON.stringify({cancelReason:'Khách đổi ý'})}).where(eq(salesOrders.id,'board-0'));
    const report=await f.call(`/pos/orders?registerId=${f.registerId}&source=cod&from=2026-10-20&to=2026-10-20&payment=paid&status=completed`,f.emp);
    assert.equal(report.data.orders.length,0);assert.equal(report.data.analytics.total,501);assert.equal(report.data.analytics.unsuccessful,1);assert.equal(report.data.analytics.reasons[0].reason,'Khách đổi ý');
    const cancelled=await f.call(`/pos/orders?registerId=${f.registerId}&source=cod&from=2026-10-20&to=2026-10-20&status=cancelled`,f.emp);assert.equal(cancelled.data.orders[0].cancelReason,'Khách đổi ý');assert.equal(cancelled.data.orders[0].cancelSnapshot,undefined);
    await f.db.insert(webStoreOrders).values(['returned','lost','cancel',''].map((ghnStatus,i)=>({id:'analysis-web-'+i,source:'lock',externalId:'analysis-'+i,registerId:f.registerId,orderNo:'WEB-'+i,status:i===3?'completed':'cancelled',ghnStatus,orderedAt:'2026-10-20T01:00:00Z',updatedAt:'2026-10-20T01:00:00Z'})));
    const web=await f.call(`/pos/orders?registerId=${f.registerId}&source=web&from=2026-10-20&to=2026-10-20`,f.emp);assert.equal(web.data.analytics.total,4);assert.equal(web.data.analytics.unsuccessful,3);assert.equal(web.data.analytics.completed,1);assert.equal(web.data.analytics.missingReasons,3);assert.deepEqual(web.data.analytics.kinds.map((k:any)=>k.kind).sort(),['cancelled','failed','returned']);
    await f.db.insert(auditLogs).values([{id:'reason-old',actorId:'mgr',module:'sales',action:'web-order-cancel',entityType:'web-store-order',entityId:'analysis-web-2',data:JSON.stringify({reason:'Lý do cũ'}),createdAt:'2026-10-20T01:01:00Z'},{id:'reason-new',actorId:'mgr',module:'sales',action:'web-order-cancel',entityType:'web-store-order',entityId:'analysis-web-2',data:JSON.stringify({reason:'Khách đặt trùng đơn'}),createdAt:'2026-10-20T01:02:00Z'}]);
    const reasons=await f.call(`/pos/orders?registerId=${f.registerId}&source=web&from=2026-10-20&to=2026-10-20`,f.emp);assert.equal(reasons.data.analytics.missingReasons,2);assert.ok(reasons.data.analytics.reasons.some((r:any)=>r.reason==='Khách đặt trùng đơn'&&r.count===1));assert.equal(reasons.data.analytics.reasons.some((r:any)=>r.reason==='Lý do cũ'),false);


});

test('website paid timestamp stays pending reconciliation; status-only updates preserve the source claim',async()=>{
  const f=await setup();
    const reg=await f.call('/pos/registers',f.mgr,'POST',{name:'Showroom Gốm Sứ Minh Long Cần Thơ',warehouseId:'pos-wh',pricePolicyId:'retail-vat',secondPricePolicyId:'retail',taxRate:8});
    const sync=(body:unknown)=>f.call('/integrations/woocommerce/minhlong/order?token=test-ml-token','','POST',body);
    const order={id:901,number:'WEB901',status:'completed',total:'100',currency:'VND',date_created:'2026-10-21T09:00:00',payment_method:'cod'};
    assert.equal((await sync(order)).status,200);
    // Pin the payment fixture's date: completed orders leave the default 30-day window as the calendar advances.
    const board=(filter:string)=>f.call(`/pos/orders?registerId=${reg.data.id}&source=web&from=2026-10-21&to=2026-10-21&${filter}`,f.mgr);
    assert.equal((await board('payment=unknown')).data.orders.length,1);
    assert.equal((await board('payment=paid')).data.orders.length,0);
    assert.equal((await sync({...order,date_paid_gmt:null})).status,200);
    assert.equal((await board('payment=debt')).data.totals[0].outstanding,100);
    assert.equal((await sync({...order,date_paid:'2026-10-21T10:00:00',shipping_total:'10'})).status,200);
    assert.equal((await board('payment=unknown')).data.totals[0].paid,0);
    assert.equal((await board('payment=unknown')).data.orders[0].paymentEvidence,'website');
    assert.equal((await sync({id:901,status:'completed',shipping_total:'10'})).status,200);
    assert.equal((await board('payment=unknown')).data.orders.length,1);
    assert.equal((await sync({id:901,status:'completed'})).status,200);
    assert.equal((await board('payment=unknown')).data.orders.length,1);
    assert.equal((await board('ownerId=emp')).data.orders.length,0);
});


test('cancellation metrics use all cohort rows before status/payment/pagination, keep pending distinct and never invent reasons',()=>{
 const base={id:'base',orderNo:'POS',customerName:'Khách',phone:'',ownerId:'emp',ownerName:'NV',sapoOrderCode:null,orderDate:'2026-10-31',bucket:'completed',orderSource:'pos',paymentStatus:'paid',total:100,paid:100,outstanding:0,currency:'VND'};
 const rows=Array.from({length:100},(_,i)=>({...base,id:String(i),bucket:i<50?'cancelled':i<80?'completed':'pending',cancelReason:i<25?' Khách đổi ý ':i<50?'':''}));
 const a=filterPosOrderBoard(rows,new URLSearchParams('status=completed&payment=paid')).analytics;
 assert.deepEqual([a.total,a.unsuccessful,a.completed,a.pending,a.unsuccessfulRate,a.successRate],[100,50,30,20,50,30]);assert.equal(a.closedSuccessRate,37.5);assert.equal(a.missingReasons,25);assert.equal(a.reasons.reduce((n,r)=>n+r.count,0),50);assert.equal(a.reasons.find(r=>r.reason==='Khách đổi ý')?.count,25);
 const scope=filterPosOrderBoard([...rows,{...base,id:'older',orderDate:'2026-09-01',bucket:'pending'}],new URLSearchParams(),{analyticsFrom:'2026-10-01'});assert.equal(scope.counts.all,101);assert.equal(scope.analytics.total,100,'old open orders do not dilute the default analytics period');
 assert.equal(filterPosOrderBoard(rows,new URLSearchParams('ownerId=other')).analytics.total,0);assert.equal(cancellationAnalytics([]).unsuccessfulRate,null);assert.equal(cancellationAnalytics([{bucket:'pending'}]).closedSuccessRate,null);
 const split=cancellationAnalytics([{bucket:'cancelled',cancellationKind:'returned'},{bucket:'cancelled',cancellationKind:'refunded'}]);assert.deepEqual(split.kinds,[{kind:'returned',count:1},{kind:'refunded',count:1}]);assert.equal(split.missingReasons,2);
});


test('ad budget warning uses website ended orders only, requires 30 outcomes and has exact 10/20 percent boundaries',()=>{
 const rows=(ended:number,bad:number,pending=0)=>Array.from({length:ended+pending},(_,i)=>({orderSource:'web',bucket:i<bad?'cancelled':i<ended?'completed':'pending'}));
 assert.equal(advertisingCancellationRisk(rows(29,29)).level,'insufficient');
 assert.equal(advertisingCancellationRisk(rows(30,6)).level,'budget');
 assert.equal(advertisingCancellationRisk(rows(30,3)).level,'improve');
 assert.equal(advertisingCancellationRisk(rows(30,2)).level,'normal');
 const pending=advertisingCancellationRisk(rows(30,6,70));assert.equal(pending.rate,20);assert.equal(pending.pending,70);assert.equal(pending.total,100);
 assert.equal(advertisingCancellationRisk(rows(10000,1996)).level,'improve','do not compare a rounded percentage to the threshold');
 const mixed=advertisingCancellationRisk([...rows(30,0),...Array.from({length:100},()=>({orderSource:'pos',bucket:'cancelled'}))]);assert.equal(mixed.level,'normal');assert.equal(mixed.total,30);assert.equal(advertisingCancellationRisk([]).rate,null);
});


test('website → GHN custom statuses include delivered before COD settlement and retryable shipping failures',()=>{
 for(const status of ['completed','lnl-delivered','wc-lnl-delivered',' LNL-DELIVERED '])assert.equal(webOrderBucket(status),'completed',status);
 for(const status of ['lnl-awaiting-pickup','lnl-pickup','lnl-awaiting-del','lnl-delivery-failed','lnl-del-failed'])assert.equal(webOrderBucket(status),'waiting_delivery',status);
 for(const status of ['lnl-returning','lnl-returned','failed','cancelled'])assert.equal(webOrderBucket(status),'cancelled',status);
 assert.equal(webOrderBucket('processing','delivered'),'completed');
 assert.equal(webOrderBucket('lnl-delivered','returned'),'cancelled');
 assert.equal(webOrderBucket('cancelled','delivery_fail'),'waiting_delivery');
 assert.equal(webOrderBucket('refunded','delivered'),'cancelled');
 assert.equal(webOrderBucket('trash','delivered'),'cancelled');
 assert.equal(webOrderBucket('processing'),'pending');
});

test('all failed website mirror needs reconciliation; deleted orders do not establish ad performance',()=>{
 const rows=Array.from({length:60},()=>({orderSource:'web',bucket:'cancelled',status:'cancelled'}));
 const risk=advertisingCancellationRisk([...rows,{orderSource:'web',bucket:'cancelled',status:'trash'},...Array.from({length:2},()=>({orderSource:'web',bucket:'waiting_delivery',status:'processing'}))]);
 assert.equal(risk.level,'check_data');assert.equal(risk.unsuccessful,60);assert.equal(risk.ended,60);assert.equal(risk.total,62);assert.equal(risk.excludedDeleted,1);assert.equal(risk.pending,2);assert.equal(risk.rate,100,'retain visible arithmetic rather than inventing successful deliveries');
});

test('board API recognises direct-web GHN custom delivery and keeps payment unknown without evidence',async()=>{
 const f=await setup();
 await f.db.insert(webStoreOrders).values(['lnl-delivered','lnl-pickup','lnl-del-failed','lnl-returned','trash'].map((status,i)=>({id:'direct-web-'+i,source:'lock',externalId:'direct-'+i,registerId:f.registerId,orderNo:'DIRECT-'+i,status,ghnStatus:'',orderedAt:'2026-10-20T01:00:00Z',updatedAt:'2026-10-20T01:00:00Z'})));
 const result=await f.call(`/pos/orders?registerId=${f.registerId}&source=web&from=2026-10-20&to=2026-10-20`,f.emp);
 assert.equal(result.status,200);assert.equal(result.data.counts.completed,1);assert.equal(result.data.counts.waiting_delivery,2);assert.equal(result.data.counts.cancelled,2);
 const delivered=result.data.orders.find((o:any)=>o.id==='direct-web-0');assert.equal(delivered.bucket,'completed');assert.equal(delivered.paymentStatus,'unknown');assert.equal(delivered.paid,null);
 assert.equal(result.data.analytics.advertising.excludedDeleted,1);assert.equal(result.data.analytics.advertising.unsuccessful,1);assert.equal(result.data.analytics.advertising.completed,1);
 assert.equal(result.data.orders.find((o:any)=>o.id==='direct-web-3').cancellationKind,'returned');
});
