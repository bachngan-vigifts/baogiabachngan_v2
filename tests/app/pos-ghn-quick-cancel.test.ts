import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq,sql} from 'drizzle-orm';
import {setup} from '../helpers/pos-fixture.ts';
import {salesOrders,deliveries,customerPayments} from '../../src/modules/sales/schema.ts';
import {stockBalances,stockMoves} from '../../src/modules/inventory/schema.ts';
import {posReturns,posRefunds} from '../../src/modules/sales/return-schema.ts';
import {cashEntries} from '../../src/modules/sales/cash-schema.ts';
import {applyGhnStatus} from '../../src/modules/sales/api/pos-ghn-sync.ts';
import {returnAccount} from '../../src/modules/sales/api/pos-return-credit.ts';
import {reservedBySku} from '../../src/modules/sales/api/pos-store.ts';
const ok=(r:any,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};
async function fixture(issued=false,deposit=0){
 const f=await setup(),shift=await f.open();
 const made=ok(await f.call('/pos/checkout',f.emp,'POST',f.cart(shift.id,{fulfillmentMode:'cod',depositAmount:deposit,delivery:{address:'Kho khách',receiverName:'Khách',receiverPhone:'0900000000'}})),201);
 const d=ok(await f.call('/orders/'+made.id,f.mgr)),ship=d.deliveries[0];
 await f.db.update(deliveries).set({carrier:'GHN',trackingCode:'GHN-QC',trackingStatus:issued?'returned':'cancel'}).where(eq(deliveries.id,ship.id));
 if(issued)await applyGhnStatus(f.env,ship.id,'picked',new Date().toISOString());
 const remote:any={order_code:'GHN-QC',client_order_code:made.orderNo,shop_id:6096731,status:issued?'returned':'cancel'};
 const hooks:{offline?:boolean;onRead?:()=>Promise<void>}={},calls:any[]=[];
 f.env.ghnToken='test-only-credential';f.env.ghnFetch=(async(url,init)=>{calls.push({url:String(url),body:JSON.parse(String(init?.body))});if(hooks.offline)throw Error('offline');await hooks.onRead?.();return Response.json({code:200,data:{...remote}});}) as typeof fetch;
 const path='/pos/orders/'+made.id+'/ghn-quick-cancel';
 const body={key:crypto.randomUUID(),revision:d.order.revision,reason:'GHN đã kết thúc, Manager huỷ nhanh',confirmed:true,shiftId:deposit?shift.id:'',method:deposit?'cash':'',reference:''};
 return {...f,shift,made,ship,remote,hooks,calls,path,body};
}
test('Manager cancels unpicked GHN order in one action: releases holds, no invented stock or refund; employee remains blocked',async()=>{
 const f=await fixture();assert.equal((await reservedBySku(f.db,['00123'],'pos-wh')).get('00123'),2);
 for(const method of ['GET','POST'])assert.equal((await f.call(f.path,f.emp,method,method==='POST'?f.body:undefined)).status,403);
 const preview=ok(await f.call(f.path,f.mgr));assert.equal(preview.amount,0);assert.equal(preview.lines.length,0);
 const before=await f.db.select().from(stockMoves);ok(await f.call(f.path,f.mgr,'POST',f.body));
 const [order]=await f.db.select().from(salesOrders).where(eq(salesOrders.id,f.made.id));assert.equal(order!.status,'cancelled');assert.equal(order!.holdsStock,false);
 assert.equal((await reservedBySku(f.db,['00123'],'pos-wh')).get('00123')||0,0);assert.deepEqual(await f.db.select().from(stockMoves),before);
 assert.equal((await f.db.select().from(posRefunds)).length,0);assert.equal((await returnAccount(f.db,f.made.id)).balance,0);
 assert.ok(f.calls.every(x=>x.url.endsWith('/detail')),'only reads GHN, never sends a cancel/refund');
});
test('returned GHN: one atomic cancellation restocks issued quantity and refunds deposit once; late callbacks cannot issue/collect again',async()=>{
 const f=await fixture(true,50000),payments=await f.db.select().from(customerPayments);
 assert.equal((await f.db.select().from(stockBalances))[0]!.qty,8);
 const responses=await Promise.all([f.call(f.path,f.mgr,'POST',f.body),f.call(f.path,f.mgr,'POST',f.body)]);for(const response of responses)ok(response);assert.equal(responses.filter(r=>r.data.replayed).length,1);
 assert.equal((await f.db.select().from(stockBalances))[0]!.qty,10);assert.equal((await f.db.select().from(posReturns)).length,1);
 assert.equal((await f.db.select().from(posRefunds))[0]!.amount,50000);assert.equal((await f.db.select().from(cashEntries)).filter(e=>e.kind==='customer_refund').length,1);
 assert.deepEqual(await f.db.select().from(customerPayments),payments);const account=await returnAccount(f.db,f.made.id);assert.equal(account.netDue,0);assert.equal(account.netPaid,0);
 f.hooks.offline=true;const count=f.calls.length;assert.equal(ok(await f.call(f.path,f.mgr,'POST',f.body)).replayed,true);assert.equal(f.calls.length,count,'committed replay does not need GHN');
 assert.equal((await f.call(f.path,f.mgr,'POST',{...f.body,key:crypto.randomUUID()})).status,409);
 await applyGhnStatus(f.env,f.ship.id,'delivered',new Date().toISOString());assert.equal((await f.db.select().from(stockBalances))[0]!.qty,10);assert.deepEqual(await f.db.select().from(customerPayments),payments);
});
test('fresh GHN state required: returning/failure/damage/lost/delivered and wrong shop/code are rejected without writes',async()=>{
 const f=await fixture(true);for(const status of ['ready_to_pick','picking','picked','delivery_fail','returning','return_fail','damage','lost','delivered']){f.remote.status=status;assert.equal((await f.call(f.path,f.mgr,'POST',f.body)).status,409,status);}
 f.remote.status='returned';f.remote.shop_id=111;assert.equal((await f.call(f.path,f.mgr,'POST',f.body)).status,409);f.remote.shop_id=6096731;f.remote.order_code='OTHER';assert.equal((await f.call(f.path,f.mgr,'POST',f.body)).status,409);
 f.remote.order_code='GHN-QC';f.hooks.offline=true;assert.equal((await f.call(f.path,f.mgr,'POST',f.body)).status,502);
 assert.equal((await f.db.select().from(posReturns)).length,0);assert.equal((await f.db.select().from(stockBalances))[0]!.qty,8);
});
test('refund transaction failure rolls cancellation and restock back; identical retry succeeds',async()=>{
 const f=await fixture(true,50000);
 await f.db.execute(sql`create function fail_ghn_refund() returns trigger language plpgsql as $$ begin raise exception 'injected failure'; end $$`);
 await f.db.execute(sql`create trigger fail_ghn_refund before insert on pos_refunds for each row execute function fail_ghn_refund()`);
 assert.equal((await f.call(f.path,f.mgr,'POST',f.body)).status,500);assert.equal((await f.db.select().from(stockBalances))[0]!.qty,8);assert.equal((await f.db.select().from(posReturns)).length,0);
 await f.db.execute(sql`drop trigger fail_ghn_refund on pos_refunds`);ok(await f.call(f.path,f.mgr,'POST',f.body));assert.equal((await f.db.select().from(stockBalances))[0]!.qty,10);
});
test('confirmation, revision, invoice, payment reference and existing recall remain guarded',async()=>{
 const f=await fixture(true,50000);
 for(const patch of [{confirmed:false},{revision:-1},{method:'transfer',reference:''}])assert.ok((await f.call(f.path,f.mgr,'POST',{...f.body,...patch})).status>=400);
 await f.db.update(salesOrders).set({invoiceNo:'HD-1'}).where(eq(salesOrders.id,f.made.id));assert.equal((await f.call(f.path,f.mgr,'POST',f.body)).status,409);
 await f.db.update(salesOrders).set({invoiceNo:''}).where(eq(salesOrders.id,f.made.id));
 const lines=ok(await f.call('/orders/'+f.made.id,f.mgr)).lines;
 ok(await f.call('/pos/returns',f.emp,'POST',{key:crypto.randomUUID(),orderId:f.made.id,shiftId:f.shift.id,reason:'Đã lập thu hồi',lines:lines.map((l:any)=>({orderLineId:l.id,qty:l.qty}))}),201);
 assert.equal((await f.call(f.path,f.mgr,'POST',f.body)).status,409);assert.equal((await f.db.select().from(posRefunds)).length,0);
});
test('changes while GHN is being read and pending product amendments cannot be bypassed',async()=>{
 const f=await fixture(true);
 f.hooks.onRead=async()=>{await f.db.update(salesOrders).set({revision:f.body.revision+1}).where(eq(salesOrders.id,f.made.id));};
 assert.equal((await f.call(f.path,f.mgr,'POST',f.body)).status,409);
 assert.equal((await f.db.select().from(posReturns)).length,0);assert.equal((await f.db.select().from(stockBalances))[0]!.qty,8);
 f.hooks.onRead=undefined;
 const [order]=await f.db.select().from(salesOrders).where(eq(salesOrders.id,f.made.id)),snap=JSON.parse(order!.posSnapshot!);snap.ghnAmendment={version:1,key:'pending-amendment'};
 await f.db.update(salesOrders).set({posSnapshot:JSON.stringify(snap)}).where(eq(salesOrders.id,f.made.id));
 const count=f.calls.length;assert.equal((await f.call(f.path,f.mgr,'POST',{...f.body,revision:order!.revision})).status,409);assert.equal(f.calls.length,count);
});
