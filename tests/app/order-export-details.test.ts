import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setup} from '../helpers/pos-fixture.ts';
import {salesOrders,salesOrderLines} from '../../src/modules/sales/schema.ts';
import {posRegisters,webStoreOrders} from '../../src/modules/sales/pos-schema.ts';
import {stockMoves} from '../../src/modules/inventory/schema.ts';
import {webOrderFinancials} from '../../src/modules/sales/domain/web-order-financials.ts';
const {orderListExportSheets}:any=await import(new URL('../../trial-ui/order-list-export.js',import.meta.url).href);

test('filtered export batches current CRM/POS/web line prices and charged shipping without applying discounts twice',async()=>{
 const f=await setup(),stamp='2026-11-03T01:00:00Z';
 await f.db.update(posRegisters).set({name:'CỬA HÀNG LOCKNLOCK CẦN THƠ'}).where(eq(posRegisters.id,f.registerId));
 const shift=await f.open();
 const saved={sku:'00123',qty:2,subtotal:175926,taxRate:8,tax:14074,total:190000};
 await f.db.insert(salesOrders).values([
  {id:'export-pos',orderNo:'EXP_POS',channel:'pos',shiftId:shift.id,total:205000,posSnapshot:JSON.stringify({lines:[saved],fees:{shippingFee:15000}})},
  {id:'export-crm',orderNo:'EXP_CRM',channel:'crm',total:243000},
 ].map(o=>({...o,quoteType:'HRC' as const,customerName:'Fixture',ownerId:'emp',createdBy:'emp',orderDate:'2026-11-03',status:'delivered' as const,createdAt:stamp,updatedAt:stamp})));
 await f.db.insert(salesOrderLines).values([
  {id:'export-pos-line',orderId:'export-pos',lineNo:1,sku:'00123',name:'Ly POS',unit:'cái',qty:2,unitPrice:87963,listUnitPrice:108000,discountAmount:26000,amount:175926,taxRate:8},
  {id:'export-crm-line',orderId:'export-crm',lineNo:1,sku:'00123',name:'Ly CRM',unit:'cái',qty:3,unitPrice:75000,amount:225000,taxRate:8},
 ]);
 const line={sku:'00123',name:'Ly web',quantity:2,subtotal:'200000',subtotal_tax:'16000',total:'160000',total_tax:'12800'};
 const financials=webOrderFinancials({line_items:[line],shipping_total:'30000',shipping_tax:'2400',total:'215000',coupon_lines:[{code:'SALE',discount:'40000',discount_tax:'3200'}],fee_lines:[{name:'Phí thêm',total:'9800',total_tax:'0'}]});
 await f.db.insert(webStoreOrders).values([
  {id:'export-web',orderNo:'EXP_WEB',lines:JSON.stringify([{...line,total:160000,totalTax:12800}]),financialSnapshot:JSON.stringify(financials),total:215000},
  {id:'export-legacy',orderNo:'EXP_LEGACY',lines:JSON.stringify([{sku:'00123',name:'Legacy',quantity:1,total:1000}]),total:1000},
  {id:'export-excluded',orderNo:'OTHER',lines:'[]',total:999999},
 ].map(o=>({...o,externalId:o.id,source:'lock',registerId:f.registerId,status:'completed',customerName:'Fixture',orderedAt:stamp,updatedAt:stamp})));
 const before=(await f.db.select().from(stockMoves)).length;
 const r=await f.call('/orders?flow=order&export=1&q=EXP_',f.mgr);assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.total,4);
 const orders=r.data.orders,pos=orders.find((o:any)=>o.id==='export-pos'),crm=orders.find((o:any)=>o.id==='export-crm'),web=orders.find((o:any)=>o.webOrderId==='export-web'),legacy=orders.find((o:any)=>o.webOrderId==='export-legacy');
 assert.equal(pos.exportDetails.items[0].unitPriceAfterDiscount,87963);
 assert.equal(pos.exportDetails.items[0].unitPriceAfterDiscountVat,95000);assert.equal(pos.exportDetails.items[0].total,190000);assert.equal(pos.exportDetails.shippingFee,15000);
 assert.equal(crm.exportDetails.items[0].unitPriceAfterDiscount,75000);assert.equal(crm.exportDetails.items[0].total,243000);assert.equal(crm.exportDetails.shippingFee,null);
 assert.equal(web.exportDetails.items[0].unitPriceAfterDiscount,80000);assert.equal(web.exportDetails.items[0].unitPriceAfterDiscountVat,86400);assert.equal(web.exportDetails.shippingFee,32400);assert.equal(web.total,215000);
 assert.equal(legacy.exportDetails.items[0].unitPriceAfterDiscount,1000);assert.equal(legacy.exportDetails.items[0].unitPriceAfterDiscountVat,null);assert.equal(legacy.exportDetails.shippingFee,null);
 const sheets=orderListExportSheets(orders);assert.equal(sheets.length,2);assert.equal(sheets[0].rows.length,4);assert.equal(sheets[1].rows.length,4);
 const totals=sheets[0].header.indexOf('Tổng giá trị đơn hàng');assert.equal(sheets[0].rows.reduce((n:number,row:any[])=>n+row[totals],0),664000);
 assert.ok(!sheets[1].header.includes('Tổng giá trị đơn hàng'),'do not repeat order totals for each SKU');
 assert.ok(sheets[1].rows.every((row:any[])=>row.length===sheets[1].header.length));
 const normal=await f.call('/orders?flow=order&q=EXP_',f.mgr);assert.ok(normal.data.orders.every((o:any)=>!Object.hasOwn(o,'exportDetails')));
 const filtered=await f.call('/orders?flow=order&export=1&source=web&q=EXP_',f.mgr);assert.equal(filtered.data.orders.length,2);assert.ok(filtered.data.orders.every((o:any)=>o.external));
 assert.equal((await f.db.select().from(stockMoves)).length,before);
});

test('Excel preserves one order total for multiple products and does not convert missing values into zero',()=>{
 const orders=[{orderNo:'=literal text',customerName:'Fixture',total:320,exportDetails:{currency:'VND',shippingFee:20,items:[
  {sku:'001',name:'A',qty:2,unitPriceAfterDiscount:100,subtotal:200,tax:0,total:200,unitPriceAfterDiscountVat:100},
  {sku:'002',name:'B',qty:1,unitPriceAfterDiscount:100,subtotal:100,tax:null,total:null,unitPriceAfterDiscountVat:null},
 ]}}];
 const sheets=orderListExportSheets(orders);assert.equal(sheets[0].rows.length,1);assert.equal(sheets[1].rows.length,2);
 assert.equal(sheets[1].rows[0][3],'001');assert.equal(sheets[1].rows[0][7],100);assert.equal(sheets[1].rows[1][8],'Chưa có dữ liệu');
 assert.equal(sheets[0].rows[0][0],'=literal text');
 assert.throws(()=>orderListExportSheets([{orderNo:'old-api'}]),/API chưa có dữ liệu/);
});
