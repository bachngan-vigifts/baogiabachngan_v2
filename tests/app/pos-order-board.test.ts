import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { setup } from '../helpers/pos-fixture.ts';
import { customerPayments, salesOrders } from '../../src/modules/sales/schema.ts';
import { filterPosOrderBoard } from '../../src/modules/sales/domain/pos-order-board.ts';

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
    assert.equal(board.data.orders.length,501); assert.equal(board.data.totals[0].revenue,50100);
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
});

test('web collection uses explicit source timestamp; status/method never imply paid; status-only updates preserve evidence',async()=>{
  const f=await setup();
    const reg=await f.call('/pos/registers',f.mgr,'POST',{name:'Showroom Gốm Sứ Minh Long Cần Thơ',warehouseId:'pos-wh',pricePolicyId:'retail-vat',secondPricePolicyId:'retail',taxRate:8});
    const sync=(body:unknown)=>f.call('/integrations/woocommerce/minhlong/order?token=test-ml-token','','POST',body);
    const order={id:901,number:'WEB901',status:'completed',total:'100',currency:'VND',date_created:'2026-10-21T09:00:00',payment_method:'cod'};
    assert.equal((await sync(order)).status,200);
    const board=(filter:string)=>f.call(`/pos/orders?registerId=${reg.data.id}&source=web&${filter}`,f.mgr);
    assert.equal((await board('payment=unknown')).data.orders.length,1);
    assert.equal((await board('payment=paid')).data.orders.length,0);
    assert.equal((await sync({...order,date_paid_gmt:null})).status,200);
    assert.equal((await board('payment=debt')).data.totals[0].outstanding,100);
    assert.equal((await sync({...order,date_paid:'2026-10-21T10:00:00',shipping_total:'10'})).status,200);
    assert.equal((await board('payment=paid')).data.totals[0].paid,100);
    assert.equal((await sync({id:901,status:'completed',shipping_total:'10'})).status,200);
    assert.equal((await board('payment=paid')).data.orders.length,1);
    assert.equal((await sync({id:901,status:'completed'})).status,200);
    assert.equal((await board('payment=paid')).data.orders.length,1);
    assert.equal((await board('ownerId=emp')).data.orders.length,0);
});
