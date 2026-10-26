import {test} from 'node:test';
import assert from 'node:assert/strict';
import {and,eq} from 'drizzle-orm';
import {setupWarehouseOps,makeCrm} from '../helpers/warehouse-approval-fixture.ts';
import {warehouses,products,productStock} from '../../src/modules/catalog/schema.ts';
import {stockMoves} from '../../src/modules/inventory/schema.ts';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';
import {salesOrders,salesOrderLines,packingSlips} from '../../src/modules/sales/schema.ts';
test('542 physical Vigifts units cover the own 300-unit hold; other warehouses/incoming never count as stock to issue',async()=>{
 const f=await setupWarehouseOps(),sku='071588000';
 await f.db.insert(warehouses).values([{id:'vig',name:'KHO VIGIFTS',kind:'stock'},{id:'store',name:'Cửa hàng khác',kind:'stock'},{id:'incoming-test',name:'Hàng chờ về',kind:'incoming'}]);
 await f.db.insert(products).values({sku,name:'Tô thấp 15cm',unit:'Cái',updatedAt:'2026-10-18'});
 await f.db.insert(productStock).values([{sku,warehouseId:'vig',quantity:999,updatedAt:'2026-10-18'},{sku,warehouseId:'incoming-test',quantity:500,updatedAt:'2026-10-18'}]);
 await postMoves(f.db,'mgr',[{sku,warehouseId:'vig',qty:542,kind:'opening',refType:'opening',refId:'ops-open'},{sku,warehouseId:'store',qty:28,kind:'opening',refType:'opening',refId:'ops-open'}]);
 const d=await makeCrm(f,'542_300',300,sku,'vig'),id=d.order.id;
 const read=async()=>(await f.call('/orders/'+id+'/packing',f.emp)).data;
 let data=await read();assert.deepEqual(data.stockAvailability,[{sku,warehouseId:'vig',onHand:542,reservedOther:0,available:542}]);
 const [base]=await f.db.select().from(salesOrders).where(eq(salesOrders.id,id));const [line]=await f.db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId,id));
 async function other(otherId:string,warehouseId:string){await f.db.insert(salesOrders).values({...base!,id:otherId,orderNo:'OPS_'+otherId,quoteId:null,warehouseId});await f.db.insert(salesOrderLines).values({...line!,id:otherId+'-line',orderId:otherId,qty:100});}
 await other('other-store','store');assert.equal((await read()).stockAvailability[0].available,542,'other store reservations do not consume Vigifts');
 await other('other-vig','vig');data=await read();assert.equal(data.stockAvailability[0].reservedOther,100);assert.equal(data.stockAvailability[0].available,442,'other orders retain their holds');
 await postMoves(f.db,'mgr',[{sku,warehouseId:'vig',qty:-300,kind:'adjust',refType:'adjustment',refId:'ops-stock-change'}]);
 assert.equal((await read()).stockAvailability[0].available,142,'real shortage is still shown');
 const made=await f.call('/orders/'+id+'/packing',f.mgr,'POST',{schedule:{plannedDate:'2026-10-26'},sendToWarehouse:true,allocations:[{orderLineId:d.lines[0].id,qty:300,source:'warehouse'}]});assert.equal(made.status,201,JSON.stringify(made.data));
 const slipId=made.data.slips[0].id,result=await f.call('/packing/'+slipId+'/confirm',f.mgr,'POST',{warehouseId:'vig',photos:['data:image/jpeg;base64,YW5o']});assert.equal(result.status,409);assert.equal(result.data.code,'STOCK_SHORT');
 assert.equal((await f.db.select().from(packingSlips).where(eq(packingSlips.id,slipId)))[0]!.status,'sent');
 assert.equal((await f.db.select().from(stockMoves).where(and(eq(stockMoves.refType,'packing_slip'),eq(stockMoves.refId,slipId)))).length,0);
});
