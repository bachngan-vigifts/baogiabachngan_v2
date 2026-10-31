import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setupCrmReturns} from '../helpers/crm-return-fixture.ts';
import {salesOrders,salesOrderLines,salesContracts,deliveries,deliveryLines,packingSlips,packingSlipLines} from '../../src/modules/sales/schema.ts';
// @ts-ignore browser print builders are pure JavaScript
import {orderPrintData,deliveryPrintData,packingPrintData,slipSheetHtml} from '../../trial-ui/order-print.js';

test('order, contract, selected deliveries and both packing entry points keep parent line order, including duplicate SKUs and partial trips',async()=>{
 const f=await setupCrmReturns(),id='printed-line-order',at='2026-11-01T00:00:00Z';
  await f.seed(id,0,'emp',false);
  await f.db.update(salesOrders).set({status:'confirmed'}).where(eq(salesOrders.id,id));
  // The order deliberately differs from SKU, ID, and delivery/packing insertion order.
  await f.db.update(salesOrderLines).set({sku:'042513000',qty:1100,deliveredQty:0}).where(eq(salesOrderLines.id,id+'-a'));
  await f.db.update(salesOrderLines).set({sku:'042213000',qty:1560,deliveredQty:0}).where(eq(salesOrderLines.id,id+'-b'));
  await f.db.insert(salesOrderLines).values({id:'aaa-duplicate-sku',orderId:id,lineNo:3,sku:'042513000',name:'Cùng mã nhưng dòng riêng',unit:'Cái',qty:3,deliveredQty:0,unitPrice:1,amount:3});
  const ids=[id+'-a',id+'-b','aaa-duplicate-sku'];
  await f.db.insert(salesContracts).values({id:'print-contract',contractNo:'HD-PRINT-TEST',orderId:id,legalEntity:'BN',createdBy:'emp',createdAt:at,updatedAt:at});
  for(const trip of ['full','partial'])await f.db.insert(deliveries).values({id:trip,orderId:id,deliveryNo:'GH-'+trip,plannedDate:'2026-11-02',createdBy:'emp',createdAt:at,updatedAt:at});
  await f.db.insert(deliveryLines).values([
   {deliveryId:'full',orderLineId:ids[2]!,qty:1},{deliveryId:'full',orderLineId:ids[1]!,qty:1560},{deliveryId:'full',orderLineId:ids[0]!,qty:1099},
   {deliveryId:'partial',orderLineId:ids[2]!,qty:0.5},{deliveryId:'partial',orderLineId:ids[0]!,qty:1},
  ]);
  await f.db.insert(packingSlips).values({id:'print-pack',slipNo:'PK-PRINT',orderId:id,createdBy:'emp',createdAt:at,updatedAt:at});
  await f.db.insert(packingSlipLines).values([
   {id:'pk-a',slipId:'print-pack',orderLineId:ids[2]!,sku:'042513000',name:'Cùng mã nhưng dòng riêng',unit:'Cái',qty:0.5},
   {id:'pk-b',slipId:'print-pack',orderLineId:ids[1]!,sku:'042213000',name:'Đĩa 22',unit:'Cái',qty:1560},
   {id:'pk-c',slipId:'print-pack',orderLineId:ids[0]!,sku:'042513000',name:'Đĩa 25',unit:'Cái',qty:1100},
  ]);
  const before=await f.client.query('SELECT * FROM delivery_lines ORDER BY delivery_id,order_line_id');
  const d=f.ok(await f.call('/orders/'+id,f.emp));
  assert.deepEqual(d.lines.map((l:any)=>l.id),ids);assert.equal(d.contract.contractNo,'HD-PRINT-TEST');
  assert.deepEqual(orderPrintData(d).lines.map((l:any)=>l.sku),['042513000','042213000','042513000']);
  const byId=new Map<string,any>(d.lines.map((l:any)=>[l.id,l]));
  for(const trip of d.deliveries){
   const expected=trip.id==='full'?ids:[ids[0],ids[2]];
   assert.deepEqual(trip.lines.map((l:any)=>l.orderLineId),expected);
   const lines=trip.lines.map((x:any)=>({...byId.get(x.orderLineId),ordered:byId.get(x.orderLineId).qty,qty:x.qty}));
   const p=deliveryPrintData({seller:'BN',order:d.order,contract:d.contract,delivery:trip,lines});
   assert.deepEqual(p.lines.map((l:any)=>l.qty),trip.id==='full'?[1099,1560,1]:[1,0.5]);
   const html=slipSheetHtml(p);assert.ok(html.indexOf('Jasmine')<html.indexOf('Cùng mã nhưng dòng riêng'));
   assert.equal(p.lines.length,expected.length); // Do not add unselected lines to partial deliveries.
  }
  const all=f.ok(await f.call('/orders/'+id+'/packing',f.emp));
  const detail=f.ok(await f.call('/packing/print-pack',f.emp));
  for(const lines of [all.slips[0].lines,detail.lines]){
   assert.deepEqual(lines.map((l:any)=>l.orderLineId),ids);
   assert.deepEqual(lines.map((l:any)=>l.qty),[1100,1560,0.5]);
   const p=packingPrintData({seller:'BN',order:d.order,lines});
   assert.deepEqual(p.lines.map((l:any)=>l.name),['Đĩa 25','Đĩa 22','Cùng mã nhưng dòng riêng']);
   const html=slipSheetHtml(p);assert.ok(html.indexOf('Đĩa 25')<html.indexOf('Đĩa 22'));assert.ok(html.indexOf('Đĩa 22')<html.indexOf('Cùng mã nhưng dòng riêng'));
  }
  assert.equal((await f.call('/orders/'+id,f.ncc)).status,403);
  assert.equal((await f.call('/packing/print-pack',f.ncc)).status,403);
  assert.deepEqual((await f.client.query('SELECT * FROM delivery_lines ORDER BY delivery_id,order_line_id')).rows,before.rows);
});
