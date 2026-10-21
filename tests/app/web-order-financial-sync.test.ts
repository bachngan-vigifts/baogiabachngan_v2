import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setup} from '../helpers/pos-fixture.ts';
import {posRegisters,webStoreOrders} from '../../src/modules/sales/pos-schema.ts';
import {tasks} from '../../src/modules/tasks/schema.ts';
const ok=(r:any,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};
const payload={id:54321,number:'WEB-54321',status:'processing',total:'38390020',currency:'VND',billing:{first_name:'Khách web',phone:'0901'},line_items:[{sku:'00123',name:'Ly web',quantity:2,subtotal:'38545020',subtotal_tax:'0',total:'38395020',total_tax:'0'}],discount_total:'150000',discount_tax:'0',coupon_lines:[{code:'lnl150k',discount:'150000',discount_tax:'0'}],fee_lines:[{name:'Đổi điểm',total:'-5000',total_tax:'0'}],shipping_total:'0',shipping_tax:'0',shipping_lines:[{method_id:'free_shipping',method_title:'Miễn phí vận chuyển',total:'0',total_tax:'0'}],total_tax:'0',meta_data:[{key:'_lnl_ghn_order_code',value:'GHN54321'},{key:'_lnl_ghn_last_status',value:'delivered'},{key:'_lnl_ghn_total_fee',value:'32000'}]};
for(const source of ['lock','minhlong'])test(`Đơn ${source}: lưu đủ coupon/đổi điểm/ship, đồng bộ lặp, trạng thái không xoá tiền và kế toán nhận chi tiết`,async()=>{
 const f=await setup();await f.db.update(posRegisters).set({name:source==='lock'?'CỬA HÀNG LOCKNLOCK CẦN THƠ':'Showroom Gốm Sứ Minh Long Cần Thơ'}).where(eq(posRegisters.id,f.registerId));
 const path='/integrations/woocommerce/'+source+'/order?token='+ (source==='lock'?'test-lock-token':'test-ml-token');
 ok(await f.call(path,'','POST',payload));ok(await f.call(path,'','POST',payload));
 let rows=await f.db.select().from(webStoreOrders);assert.equal(rows.length,1);const id=rows[0]!.id;
 assert.equal(rows[0]!.total,38390020);assert.equal(rows[0]!.ghnFee,32000);
 let d=JSON.parse(rows[0]!.financialSnapshot);assert.equal(d.coupons[0].code,'lnl150k');assert.equal(d.fees[0].total,-5000);assert.equal(d.shippingTotal,0);
 const board=ok(await f.call('/pos/orders?registerId='+f.registerId,f.mgr));assert.equal(board.orders[0].financials.total,38390020);assert.equal(board.orders[0].financials.shipping[0].title,'Miễn phí vận chuyển');
 let [invoice]=await f.db.select().from(tasks).where(eq(tasks.autoKey,'invoice-web:'+id));assert.ok(invoice);assert.match(invoice!.description,/lnl150k/);assert.match(invoice!.description,/-5\.000/);assert.match(invoice!.description,/Miễn phí vận chuyển/);
 const detail=ok(await f.call('/tasks/accounting/'+invoice!.id,f.mgr));assert.equal(detail.task.sourceData.webFinancials.total,38390020);
 assert.equal((await f.call('/tasks/accounting/'+invoice!.id,f.ncc)).status,403);
 if(source==='minhlong')assert.equal((await f.call('/pos/orders?registerId='+f.registerId,f.other)).status,403,'NVBH Lock không thấy chi tiết tiền Minh Long');
 f.env.webOrderAction={token:'test-private-token',lockUrl:'https://lock.test/action',minhlongUrl:'https://ml.test/action',fetch:(async()=>Response.json({status:'completed',ghnStatus:'delivered'})) as typeof fetch};
 ok(await f.call('/pos/web-orders/'+id+'/action',f.mgr,'POST',{action:'refresh'}));
 const [refreshed]=await f.db.select().from(webStoreOrders);assert.equal(refreshed!.financialSnapshot,rows[0]!.financialSnapshot,'làm mới GHN không làm mất coupon/điểm/ship');

 ok(await f.call(path,'','POST',{id:54321,status:'completed'}));
 rows=await f.db.select().from(webStoreOrders);assert.equal(rows[0]!.total,38390020);assert.equal(rows[0]!.customerName,'Khách web');assert.equal(rows[0]!.orderNo,'WEB-54321');assert.equal(JSON.parse(rows[0]!.financialSnapshot).fees[0].total,-5000);
 ok(await f.call(path,'','POST',{...payload,total:'38545020',discount_total:'0',coupon_lines:[],fee_lines:[],points_redemption:{points:0,amount:0}}));
 const [updated]=await f.db.select().from(webStoreOrders);d=JSON.parse(updated!.financialSnapshot);assert.deepEqual(d.coupons,[]);assert.deepEqual(d.fees,[]);assert.equal(d.points.amount,0);assert.equal(updated!.total,38545020);
});
