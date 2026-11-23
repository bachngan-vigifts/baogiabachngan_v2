import {approveFixtureOrder} from '../helpers/approval-cost-fixture.ts';
import {confirmLocalIssue} from '../helpers/confirmed-local-issue.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setup} from '../helpers/pos-fixture.ts';
import {salesOrders,salesContracts,salesOrderLines,deliveries,packingSlips} from '../../src/modules/sales/schema.ts';
import {stockBalances,stockMoves} from '../../src/modules/inventory/schema.ts';
import {posReturns,posRefunds} from '../../src/modules/sales/return-schema.ts';
import {syncPosLockGhn} from '../../src/modules/sales/api/pos-ghn-sync.ts';
const delivery={address:'123 Cần Thơ',receiverName:'Khách',receiverPhone:'0901234567',plannedDate:'2026-10-25'};
const ok=(r:any,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};
const balance=async(f:Awaited<ReturnType<typeof setup>>)=>(await f.db.select().from(stockBalances))[0]!.qty;
async function contract(){
 const f=await setup();
 const q=ok(await f.call('/quotes',f.mgr,'POST',{type:'B2B',quoteNo:'AUDIT-CANCEL',customer:'Khách kiểm thử',customerTaxCode:'1800000000',vat:8,rows:[{sku:'00123',name:'Sản phẩm',unit:'cái',qty:2,price:1000}]}),201);
 ok(await f.call('/quotes/'+q.id+'/approve',f.mgr,'POST',{revision:1}));
 const k=ok(await f.call('/contracts',f.mgr,'POST',{quoteId:q.id,legalEntity:'BN',warehouseId:'pos-wh'}),201);
 ok(await approveFixtureOrder(f,'/orders/'+k.orderId+'/status',f.mgr,'PUT',{status:'confirmed',verified:true,costWarningsReviewed:true}));
 return {...f,k};
}
test('huỷ HĐKT chưa xuất qua API hợp đồng không cộng tồn chưa từng trừ',async()=>{
 const f=await contract();assert.equal(await balance(f),10,'duyệt chưa xuất thì chưa trừ');
 ok(await f.call('/contracts/'+f.k.id,f.mgr,'PUT',{status:'cancelled'}));
 assert.equal((await f.db.select().from(salesOrders))[0]!.status,'cancelled');assert.equal(await balance(f),10);
 assert.equal((await f.db.select().from(salesContracts))[0]!.status,'cancelled');
});
test('huỷ đơn gốc của HĐKT phải đồng bộ trạng thái hợp đồng',async()=>{
 const f=await contract();ok(await f.call('/orders/'+f.k.orderId+'/status',f.mgr,'PUT',{status:'cancelled'}));
 assert.equal((await f.db.select().from(salesContracts))[0]!.status,'cancelled');assert.equal(await balance(f),10);
});
test('HĐKT đã thu tiền không được lách kiểm tra bằng PUT hợp đồng',async()=>{
 const f=await contract();ok(await f.call('/payments',f.mgr,'POST',{orderId:f.k.orderId,amount:1000,method:'transfer'}),201);
 const before=await f.db.select().from(stockMoves);
 ok(await f.call('/contracts/'+f.k.id,f.mgr,'PUT',{status:'cancelled'}),409);
 assert.equal((await f.db.select().from(salesContracts))[0]!.status,'draft');assert.equal((await f.db.select().from(salesOrders))[0]!.status,'confirmed');assert.deepEqual(await f.db.select().from(stockMoves),before);
});
test('đơn CRM đang vận chuyển không tự hoàn tồn khi huỷ đơn hoặc huỷ chuyến',async()=>{
 const f=await contract(),[line]=await f.db.select().from(salesOrderLines);
 const d=ok(await f.call('/deliveries',f.mgr,'POST',{orderId:f.k.orderId,...delivery,lines:[{orderLineId:line!.id,qty:2}]}),201);
 await confirmLocalIssue(f,f.k.orderId);
 ok(await f.call('/deliveries/'+d.id+'/status',f.mgr,'PUT',{status:'in_transit'}));
 ok(await f.call('/orders/'+f.k.orderId+'/status',f.mgr,'PUT',{status:'cancelled'}),409);
 ok(await f.call('/deliveries/'+d.id+'/status',f.mgr,'PUT',{status:'cancelled'}),409);
 assert.equal(await balance(f),8);
});
async function issuedCod(extra:Record<string,unknown>={}){
 const f=await setup(),s=await f.open();
 const o=ok(await f.call('/pos/checkout',f.emp,'POST',f.cart(s.id,{fulfillmentMode:'cod',delivery,note:'GHN-ABC1234',...extra})),201);
 f.env.ghnToken='test-token';f.env.ghnFetch=(async()=>Response.json({data:{status:'picked',updated_date:new Date().toISOString()}})) as typeof fetch;
 assert.equal((await syncPosLockGhn(f.env)).ok,true);assert.equal(await balance(f),8);
 return {...f,s,o};
}
test('COD thường đã xuất chưa giao phải lập được phiếu thu hồi; không huỷ chuyến thẳng',async()=>{
 const f=await issuedCod(),[l]=await f.db.select().from(salesOrderLines),[d]=await f.db.select().from(deliveries);
 const r=await f.call('/pos/returns',f.emp,'POST',{key:crypto.randomUUID(),orderId:f.o.id,shiftId:f.s.id,reason:'Thu hồi hàng chưa giao',lines:[{orderLineId:l!.id,qty:2}]});ok(r,201);assert.equal(r.data.requestContext,'after_issue');
 ok(await f.call('/deliveries/'+d!.id+'/status',f.mgr,'PUT',{status:'cancelled'}),409);
});
test('phiếu trả sau xuất và nút nhận hoàn đơn huỷ không được nhập cùng hàng hai lần',async()=>{
 const f=await setup(),s=await f.open();
 const o=ok(await f.call('/pos/checkout',f.emp,'POST',f.cart(s.id,{saleFlow:'prepaid',delivery})),201),[l]=await f.db.select().from(salesOrderLines);
 const made=ok(await f.call('/orders/'+o.id+'/packing',f.mgr,'POST',{allocations:[{orderLineId:l!.id,qty:1,source:'warehouse'}],sendToWarehouse:true}),201);
 ok(await f.call('/packing/'+made.slips[0].id+'/confirm',f.mgr,'POST',{warehouseId:'pos-wh',photos:['data:image/jpeg;base64,'+'A'.repeat(100)]}));
 const r=ok(await f.call('/pos/returns',f.emp,'POST',{key:crypto.randomUUID(),shiftId:s.id,orderId:o.id,reason:'Thu hồi đơn',lines:[{orderLineId:l!.id,qty:1}]}),201);
 ok(await f.call('/pos/returns/'+r.id+'/approve',f.mgr,'POST',{}));
 ok(await f.call('/pos/returns/'+r.id+'/receive',f.emp,'POST',{shiftId:s.id,confirmed:true}));assert.equal(await balance(f),10);
 const before=await f.db.select().from(stockMoves);
 ok(await f.call('/pos/orders/'+o.id+'/receive-cancelled-stock',f.emp,'POST',{}),409);
 assert.deepEqual(await f.db.select().from(stockMoves),before);assert.equal(await balance(f),10);
});

test('GHN không giao tiếp khi COD đang thu hồi; không mở lại đơn đã huỷ hoặc ghi thu ảo',async()=>{
 const f=await issuedCod(),[l]=await f.db.select().from(salesOrderLines),[d]=await f.db.select().from(deliveries);
 const r=ok(await f.call('/pos/returns',f.emp,'POST',{key:crypto.randomUUID(),orderId:f.o.id,shiftId:f.s.id,reason:'Thu hồi',lines:[{orderLineId:l!.id,qty:2}]}),201);
 const detail=ok(await f.call('/pos/returns?orderId='+f.o.id,f.emp));assert.equal(detail.recoveringIssued,true);assert.equal(detail.lines[0].returnableQty,2);
 f.env.ghnFetch=(async()=>Response.json({data:{status:'delivered'}})) as typeof fetch;
 const result=await syncPosLockGhn(f.env);assert.equal(result.ok,false);assert.match(result.errors[0]!.message,/thu hồi/);
 assert.equal((await f.db.select().from(salesOrderLines))[0]!.deliveredQty,0);
 ok(await f.call('/deliveries/'+d!.id+'/status',f.mgr,'PUT',{status:'delivered'}),409);
 ok(await f.call('/pos/returns/'+r.id+'/approve',f.mgr,'POST',{}));
 const {customerPayments}=await import('../../src/modules/sales/schema.ts');assert.equal((await f.db.select().from(customerPayments)).length,0);
 // A historical cancellation may have left the delivery open; sync must never revive its order.
 await f.db.update(deliveries).set({status:'in_transit'}).where(eq(deliveries.id,d!.id));
 await syncPosLockGhn(f.env);assert.equal((await f.db.select().from(salesOrders))[0]!.status,'cancelled');
 assert.equal((await f.db.select().from(salesOrderLines))[0]!.deliveredQty,0);assert.equal((await f.db.select().from(customerPayments)).length,0);
});

test('lùi nhãn chuyến giao không được xoá dấu vết đã xuất; không tự hoàn tồn sau failed → planned',async()=>{
 const f=await contract(),[l]=await f.db.select().from(salesOrderLines);
 const d=ok(await f.call('/deliveries',f.mgr,'POST',{orderId:f.k.orderId,...delivery,lines:[{orderLineId:l!.id,qty:2}]}),201);
 await confirmLocalIssue(f,f.k.orderId);
 for(const status of ['in_transit','failed','planned'])ok(await f.call('/deliveries/'+d.id+'/status',f.mgr,'PUT',{status}));
 ok(await f.call('/orders/'+f.k.orderId+'/status',f.mgr,'PUT',{status:'cancelled'}),409);assert.equal(await balance(f),8);
});

/** Inject a committed competing action after initial reads, immediately before the next transaction. */
function beforeTransaction(f:Awaited<ReturnType<typeof setup>>,action:()=>Promise<void>){
 const original=f.env.db;let armed=true;
 f.env.db=new Proxy(original,{get(target,prop){
  if(prop==='transaction')return async(...args:any[])=>{if(armed){armed=false;await action();}return (original.transaction as any)(...args);};
  const value=Reflect.get(target,prop);return typeof value==='function'?value.bind(target):value;
 }});
}
test('huỷ đóng gói đọc trạng thái cũ: kho vừa xác nhận trước transaction thì không ghi đè Đã đóng',async()=>{
 const f=await contract(),[l]=await f.db.select().from(salesOrderLines);
 ok(await f.call('/deliveries',f.mgr,'POST',{orderId:f.k.orderId,...delivery,lines:[{orderLineId:l!.id,qty:2}]}),201);
 const p=ok(await f.call('/orders/'+f.k.orderId+'/packing',f.mgr,'POST',{allocations:[{orderLineId:l!.id,qty:2,source:'warehouse'}],sendToWarehouse:true}),201).slips[0];
 beforeTransaction(f,async()=>{ok(await f.call('/packing/'+p.id+'/confirm',f.mgr,'POST',{warehouseId:'pos-wh',photos:['data:image/jpeg;base64,'+'A'.repeat(100)]}));});
 ok(await f.call('/packing/'+p.id+'/cancel',f.mgr,'POST',{}),409);
 assert.equal((await f.db.select().from(packingSlips))[0]!.status,'packed');assert.equal(await balance(f),8);
});
test('ghi thu đọc trạng thái cũ: đơn vừa huỷ trước transaction thì không tạo phiếu thu mới',async()=>{
 const f=await contract();beforeTransaction(f,async()=>{ok(await f.call('/orders/'+f.k.orderId+'/status',f.mgr,'PUT',{status:'cancelled'}));});
 ok(await f.call('/payments',f.mgr,'POST',{orderId:f.k.orderId,amount:1000,method:'transfer'}),409);
 const {customerPayments}=await import('../../src/modules/sales/schema.ts');assert.equal((await f.db.select().from(customerPayments)).length,0);assert.equal(await balance(f),10);
});


test('thu hồi COD chưa thu có phí: không huỷ mất công nợ; chỉ duyệt khi phí đã được xử lý, không tạo tiền hoàn',async()=>{
 const f=await issuedCod({shippingFee:10000}),[l]=await f.db.select().from(salesOrderLines);
 const body={key:crypto.randomUUID(),orderId:f.o.id,shiftId:f.s.id,reason:'Thu hồi hàng',lines:[{orderLineId:l!.id,qty:2}]};
 const first=ok(await f.call('/pos/returns',f.emp,'POST',body),201);
 const denied=await f.call('/pos/returns/'+first.id+'/approve',f.mgr,'POST',{});ok(denied,409);assert.equal(denied.data.code,'RETURN_FEES_UNSETTLED');
 assert.equal((await f.db.select().from(salesOrders))[0]!.status,'delivering');assert.equal((await f.db.select().from(posReturns))[0]!.status,'pending');assert.equal(await balance(f),8);
 ok(await f.call('/pos/returns/'+first.id+'/cancel',f.emp,'POST',{reason:'Lập lại kèm phí'}));
 const second=ok(await f.call('/pos/returns',f.emp,'POST',{...body,key:crypto.randomUUID(),shippingFee:10000}),201);
 ok(await f.call('/pos/returns/'+second.id+'/approve',f.mgr,'POST',{shippingFee:10000}));
 ok(await f.call('/pos/returns/'+second.id+'/receive',f.emp,'POST',{shiftId:f.s.id,confirmed:true}));assert.equal(await balance(f),10);
 ok(await f.call('/pos/returns/'+second.id+'/refund',f.emp,'POST',{key:crypto.randomUUID(),shiftId:f.s.id,amount:1,method:'cash',confirmed:true}),409);
 assert.equal((await f.db.select().from(posRefunds)).length,0);
});

test('đơn huỷ còn hàng xuất: chi tiết nhận hoàn đúng kho, không xoá mất dấu vết, nhận một lần', async () => {
 const f=await issuedCod();
 await f.db.update(salesOrders).set({status:'cancelled'}).where(eq(salesOrders.id,f.o.id));
 await f.db.update(deliveries).set({status:'cancelled'});
 const summary=ok(await f.call('/pos/orders/'+f.o.id+'/cancelled-stock',f.emp));
 assert.deepEqual(summary.lines,[{sku:'00123',warehouseId:'pos-wh',warehouseName:'Kho POS',qty:2}]);
 assert.equal(await balance(f),8,'đọc chi tiết không tự nhập kho');
 ok(await f.call('/orders/'+f.o.id,f.mgr,'DELETE'),409);
 ok(await f.call('/pos/orders/'+f.o.id+'/receive-cancelled-stock',f.emp,'POST',{}));
 assert.equal(await balance(f),10);
 assert.deepEqual(ok(await f.call('/pos/orders/'+f.o.id+'/cancelled-stock',f.emp)).lines,[]);
 const before=await f.db.select().from(stockMoves);
 const replay=ok(await f.call('/pos/orders/'+f.o.id+'/receive-cancelled-stock',f.emp,'POST',{}));
 assert.equal(replay.replayed,true);assert.deepEqual(await f.db.select().from(stockMoves),before);
 ok(await f.call('/orders/'+f.o.id,f.mgr,'DELETE'),409);
});
