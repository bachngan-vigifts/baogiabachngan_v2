import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setupWarehouseOps} from '../helpers/warehouse-approval-fixture.ts';
import {inventoryAdjustments,stockMoves} from '../../src/modules/inventory/schema.ts';
import {warehouses} from '../../src/modules/catalog/schema.ts';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';

test('pending count references are shared within the allowed warehouse; quick view excludes ordinary adjustments and private warehouses',async()=>{
 const f=await setupWarehouseOps(),body={source:'stocktake',warehouseId:'pos-wh',reason:'Kiểm kê ca sáng',clientKey:'overlap-first-001',lines:[{sku:'00123',expectedQty:10,countedQty:8}]};
 const made=await f.call('/inventory/adjustments',f.emp,'POST',body);assert.equal(made.status,201,JSON.stringify(made.data));
 const preview=await f.call('/inventory/count-stock',f.other,'POST',{warehouseId:'pos-wh',skus:['00123','NO-STOCK']});assert.equal(preview.status,200);assert.equal(preview.data.stock['00123'],10);assert.equal(preview.data.pendingBySku['00123'][0].id,made.data.id);assert.equal(preview.data.pendingBySku['00123'][0].refNo,made.data.refNo);assert.equal(preview.data.pendingBySku['NO-STOCK'],undefined);
 const shared=await f.call('/inventory/stocktakes/'+made.data.id,f.other);assert.equal(shared.status,200);assert.equal(shared.data.canApprove,false);assert.equal(shared.data.adjustment.lines[0].countedQty,8);
 assert.equal((await f.call('/inventory/adjustments?kind=stocktake',f.other)).data.adjustments.length,1);
 assert.equal((await f.call('/inventory/adjustments/'+made.data.id+'/review',f.other,'POST',{decision:'approved'})).status,403);
 const again=await f.call('/inventory/adjustments',f.emp,'POST',body);assert.equal(again.status,200);assert.equal(again.data.id,made.data.id,'retrying the same submitted document is not an overlap error');
 const second=await f.call('/inventory/adjustments',f.other,'POST',{...body,clientKey:'overlap-second-001'});assert.equal(second.status,409);assert.equal(second.data.code,'STOCKTAKE_PENDING');assert.equal((await f.db.select().from(inventoryAdjustments)).length,1);
 const adjustment=await f.call('/inventory/adjustments',f.emp,'POST',{warehouseId:'pos-wh',reason:'Đề nghị điều chỉnh riêng',clientKey:'ordinary-adjust-001',lines:[{sku:'00123',qty:1}]});assert.equal(adjustment.status,201);
 assert.equal((await f.call('/inventory/stocktakes/'+adjustment.data.id,f.other)).status,404);assert.equal((await f.call('/inventory/adjustments/'+adjustment.data.id,f.other)).status,404);
 await f.db.insert(warehouses).values({id:'private-stock',name:'Kho riêng',kind:'stock',stockPrivate:true});await postMoves(f.db,'mgr',[{sku:'00123',warehouseId:'private-stock',qty:5,kind:'opening',refType:'opening',refId:'opening-private'}]);
 const hidden=await f.call('/inventory/adjustments',f.mgr,'POST',{...body,warehouseId:'private-stock',clientKey:'private-count-001',lines:[{sku:'00123',expectedQty:5,countedQty:4}]});assert.equal(hidden.status,201);
 assert.equal((await f.call('/inventory/stocktakes/'+hidden.data.id,f.other)).status,404);assert.equal((await f.call('/inventory/count-stock',f.other,'POST',{warehouseId:'private-stock',skus:['00123']})).status,403);
 assert.ok(!(await f.call('/inventory/adjustments?kind=stocktake',f.other)).data.adjustments.some((row:any)=>row.id===hidden.data.id));
 assert.equal((await f.call('/inventory/adjustments/'+made.data.id+'/review',f.mgr,'POST',{decision:'approved'})).status,200);
 const after=await f.call('/inventory/count-stock',f.other,'POST',{warehouseId:'pos-wh',skus:['00123']});assert.equal(after.data.stock['00123'],8);assert.equal(after.data.pendingBySku['00123'],undefined,'completed counts and pending ordinary adjustments are not conflicts');
});

test('concurrent submissions for the same warehouse and SKU admit one pending count only; different warehouses do not conflict',async()=>{
 const f=await setupWarehouseOps(),body={source:'stocktake',warehouseId:'pos-wh',reason:'Kiểm kê đồng thời',lines:[{sku:'00123',expectedQty:10,countedQty:9}]};
 const requests=await Promise.all([f.emp,f.other].map((cookie,index)=>f.call('/inventory/adjustments',cookie,'POST',{...body,clientKey:'parallel-count-00'+index})));
 assert.deepEqual(requests.map(r=>r.status).sort(),[201,409]);assert.equal(requests.find(r=>r.status===409)!.data.code,'STOCKTAKE_PENDING');
 const rows=await f.db.select().from(inventoryAdjustments);assert.equal(rows.length,1);assert.equal(rows[0]!.status,'pending');assert.equal((await f.db.select().from(stockMoves).where(eq(stockMoves.refId,rows[0]!.id))).length,0);
});
