import {test} from 'node:test';
import assert from 'node:assert/strict';
import {and,eq} from 'drizzle-orm';
import {setupWarehouseOps} from '../helpers/warehouse-approval-fixture.ts';
import {inventoryAdjustments,stockBalances,stockMoves} from '../../src/modules/inventory/schema.ts';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';

test('counted quantities wait for Manager, persist their baseline, approve once; zero counts and zero differences are valid',async()=>{
 const f=await setupWarehouseOps();
 const balance=async()=>(await f.db.select().from(stockBalances).where(and(eq(stockBalances.sku,'00123'),eq(stockBalances.warehouseId,'pos-wh'))))[0]!.qty;
 const preview=await f.call('/inventory/count-stock',f.emp,'POST',{warehouseId:'pos-wh',skus:['00123']});assert.equal(preview.status,200);assert.equal(preview.data.stock['00123'],10);
 const body={source:'stocktake',clientKey:'stocktake-test-001',warehouseId:'pos-wh',reason:'Kiểm kê thực tế',lines:[{sku:'00123',expectedQty:10,countedQty:8,qty:99999}]};
 const r=await f.call('/inventory/adjustments',f.emp,'POST',body);assert.equal(r.status,201,JSON.stringify(r.data));assert.equal(r.data.status,'pending');assert.match(r.data.refNo,/^KK_\d{3}_\d{8}$/);assert.equal(await balance(),10);
 const detail=await f.call('/inventory/adjustments/'+r.data.id,f.mgr);assert.equal(detail.data.adjustment.lines[0].qty,-2);assert.equal(detail.data.adjustment.lines[0].countedQty,8);
 const list=await f.call('/inventory/adjustments?kind=stocktake',f.mgr);assert.equal(list.data.adjustments.length,1);
 assert.equal((await f.call('/inventory/adjustments/'+r.data.id+'/review',f.emp,'POST',{decision:'approved'})).status,403);
 for(let i=0;i<2;i++)assert.equal((await f.call('/inventory/adjustments/'+r.data.id+'/review',f.mgr,'POST',{decision:'approved'})).status,200);
 assert.equal(await balance(),8);assert.equal((await f.db.select().from(stockMoves).where(eq(stockMoves.refId,r.data.id))).length,1);
 assert.equal((await f.call('/inventory/adjustments',f.emp,'POST',body)).status,200);assert.equal(await balance(),8);
 const same=await f.call('/inventory/adjustments',f.mgr,'POST',{...body,clientKey:'stocktake-test-same',lines:[{sku:'00123',expectedQty:8,countedQty:8}]});assert.equal(same.status,201);assert.equal(same.data.status,'pending','even Manager counts must explicitly complete');
 assert.equal((await f.call('/inventory/adjustments/'+same.data.id+'/review',f.mgr,'POST',{decision:'approved'})).status,200);assert.equal((await f.db.select().from(stockMoves).where(eq(stockMoves.refId,same.data.id))).length,0);
 const zero=await f.call('/inventory/adjustments',f.emp,'POST',{...body,clientKey:'stocktake-test-zero',lines:[{sku:'00123',expectedQty:8,countedQty:0}]});assert.equal(zero.status,201);assert.equal((await f.call('/inventory/adjustments/'+zero.data.id+'/review',f.mgr,'POST',{decision:'approved'})).status,200);assert.equal(await balance(),0);
});

test('stale count baselines block submission and completion; pending count survives for rejection and stock is not overwritten',async()=>{
 const f=await setupWarehouseOps(),body={source:'stocktake',clientKey:'stocktake-conflict-001',warehouseId:'pos-wh',reason:'Kiểm đếm cuối ngày',lines:[{sku:'00123',expectedQty:10,countedQty:7}]};
 const old=await f.call('/inventory/adjustments',f.emp,'POST',{...body,clientKey:'stocktake-stale-001',lines:[{sku:'00123',expectedQty:99,countedQty:7}]});assert.equal(old.status,409);assert.equal(old.data.code,'STOCKTAKE_STOCK_CHANGED');
 const r=await f.call('/inventory/adjustments',f.emp,'POST',body);assert.equal(r.status,201);
 await postMoves(f.db,'mgr',[{sku:'00123',warehouseId:'pos-wh',qty:2,kind:'adjust',refType:'adjustment',refId:'other-operation'}]);
 const review=await f.call('/inventory/adjustments/'+r.data.id+'/review',f.mgr,'POST',{decision:'approved'});assert.equal(review.status,409);assert.equal(review.data.code,'STOCKTAKE_STOCK_CHANGED');
 assert.equal((await f.db.select().from(inventoryAdjustments).where(eq(inventoryAdjustments.id,r.data.id)))[0]!.status,'pending');assert.equal((await f.db.select().from(stockMoves).where(eq(stockMoves.refId,r.data.id))).length,0);
 assert.equal((await f.call('/inventory/adjustments/'+r.data.id+'/review',f.mgr,'POST',{decision:'rejected',note:'Kiểm đếm lại sau nhập kho'})).status,200);
 for(const countedQty of [null,undefined,-1,1.2345])assert.equal((await f.call('/inventory/adjustments',f.emp,'POST',{...body,lines:[{sku:'00123',expectedQty:12,countedQty}]})).status,400);
 assert.equal((await f.call('/inventory/count-stock',f.emp,'POST',{warehouseId:'unknown',skus:['00123']})).status,403);
});
