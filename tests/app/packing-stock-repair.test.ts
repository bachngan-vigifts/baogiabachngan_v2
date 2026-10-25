import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq,sql} from 'drizzle-orm';
import {createTestDb} from '../helpers/postgres.ts';
import {seedStaff} from '../helpers/staff-fixture.ts';
import {warehouses} from '../../src/modules/catalog/schema.ts';
import {salesOrders,salesOrderLines,packingSlips,packingSlipLines} from '../../src/modules/sales/schema.ts';
import {incomingShipments,incomingShipmentLines,supplierReceipts,supplierReceiptLines,suppliers} from '../../src/modules/suppliers/schema.ts';
import {stockBalances,stockMoves} from '../../src/modules/inventory/schema.ts';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';
import {packingStockRepairSql,packingStockReviewSql,type PackingStockRepairPlan} from '../../src/modules/inventory/domain/packing-stock-repair.ts';
async function fixture(){
 const {db,d1}=await createTestDb();await seedStaff(d1);
 const opening='2026-10-18T00:00:00.000Z',received='2026-10-25T07:49:00.000Z',packed='2026-10-25T08:07:00.000Z';
 await db.insert(warehouses).values({id:'vig',name:'KHO VIGIFTS',kind:'stock'});
 await postMoves(db,'mgr',[{sku:'TEA',warehouseId:'vig',qty:8,kind:'opening',refType:'opening',refId:'opening'},{sku:'BAG',warehouseId:'vig',qty:100,kind:'opening',refType:'opening',refId:'opening'}],opening);
 await db.insert(suppliers).values({id:'supplier',name:'NCC kiểm thử',nameKey:'ncc',createdBy:'mgr',createdAt:received,updatedAt:received});
 await db.insert(incomingShipments).values({id:'po',ticketNumber:'DMH',source:'supplier-order',supplierId:'supplier',warehouse:'KHO VIGIFTS',createdBy:'mgr',createdAt:received,updatedAt:received});
 await db.insert(incomingShipmentLines).values({id:'incoming',shipmentId:'po',lineNo:1,sku:'TEA',name:'Bộ trà',quantity:29});
 await db.insert(supplierReceipts).values({id:'receipt',receiptNo:'PNH',shipmentId:'po',receivedBy:'mgr',receivedDate:'2026-10-25',warehouse:'KHO VIGIFTS',clientKey:'receipt-key',createdAt:received});
 await db.insert(supplierReceiptLines).values({receiptId:'receipt',lineId:'incoming',sku:'TEA',goodQty:29});
 await postMoves(db,'mgr',[{sku:'TEA',warehouseId:'vig',qty:29,kind:'receipt',refType:'supplier_receipt',refId:'receipt'}],received);
 await db.insert(salesOrders).values({id:'order',orderNo:'DH',quoteType:'HRC',customerName:'Khách thử',ownerId:'mgr',createdBy:'mgr',orderDate:'2026-10-21',createdAt:received,updatedAt:received});
 for(const [i,sku] of ['TEA','BAG'].entries())await db.insert(salesOrderLines).values({id:sku,orderId:'order',lineNo:i+1,sku,name:sku,qty:29});
 await db.insert(packingSlips).values({id:'slip',slipNo:'DG',orderId:'order',source:'supplier',status:'packed',totalQty:58,createdBy:'mgr',createdAt:received,updatedAt:packed,packedAt:packed,packedBy:'mgr',revision:3});
 for(const sku of ['TEA','BAG'])await db.insert(packingSlipLines).values({id:sku,slipId:'slip',orderLineId:sku,sku,name:sku,qty:29});
 const plan:PackingStockRepairPlan={slipId:'slip',warehouseId:'vig',actorId:'mgr',expectedRevision:3,receiptId:'receipt',reason:'Sửa phiếu NCC đã nhập kho nhưng thiếu ghi xuất',lines:[{sku:'TEA',qty:29},{sku:'BAG',qty:29}]};
 const run=(p=plan)=>db.execute(sql.raw(packingStockRepairSql(p)));
 const balances=()=>db.select().from(stockBalances).orderBy(stockBalances.sku);
 return {db,plan,run,balances};
}
test('repair exact receipt-backed packed slip atomically, ledger agrees, replay is no-op with original revision',async()=>{
 const f=await fixture();await f.run();const first=await f.balances();assert.deepEqual(first.map(b=>[b.sku,b.qty]),[['BAG',71],['TEA',8]]);
 assert.equal((await f.db.select().from(stockMoves).where(eq(stockMoves.refId,'slip'))).length,2);
 assert.equal((await f.db.select().from(packingSlips))[0]!.stockWarehouseId,'vig');
 await f.run();assert.deepEqual(await f.balances(),first);
 const audit=await f.db.execute(sql`select count(*)::int n from audit_logs where action='repair_packing_stock'`);assert.equal((audit as any).rows[0].n,1);
});
test('repair fails closed for shortage, stale revision, pre-opening slip, cancelled receipt; no partial posting',async()=>{
 for(const scenario of ['short','stale','before-opening','cancelled-receipt']){
  const f=await fixture();
  if(scenario==='short')await postMoves(f.db,'mgr',[{sku:'TEA',warehouseId:'vig',qty:-20,kind:'issue',refType:'adjustment',refId:'other-issue'}]);
  if(scenario==='stale')f.plan.expectedRevision=2;
  if(scenario==='before-opening')await f.db.update(packingSlips).set({packedAt:'2026-10-17T00:00:00.000Z'}).where(eq(packingSlips.id,'slip'));
  if(scenario==='cancelled-receipt')await f.db.update(supplierReceipts).set({cancelledAt:'2026-10-25T09:00:00.000Z'}).where(eq(supplierReceipts.id,'receipt'));
  const before=await f.balances();await assert.rejects(()=>f.run(),/REPAIR_/);assert.deepEqual(await f.balances(),before,scenario);
  assert.equal((await f.db.select().from(stockMoves).where(eq(stockMoves.refId,'slip'))).length,0,scenario);
 }
});


test('review unsupported old completion reopens warehouse task, preserves balances/recorded delivery; old period only annotated',async()=>{
 for(const old of [false,true]){
  const f=await fixture();if(old)await f.db.update(packingSlips).set({packedAt:'2026-10-17T00:00:00.000Z'}).where(eq(packingSlips.id,'slip'));
  const before=await f.balances(),q=packingStockReviewSql({slipId:'slip',actorId:'mgr',expectedRevision:3,reason:'Đối soát phiếu cũ thiếu chứng từ xuất kho'});
  await f.db.execute(sql.raw(q));const [p]=await f.db.select().from(packingSlips);assert.equal(p!.status,old?'packed':'sent');
  if(!old){assert.equal(p!.source,'warehouse');assert.equal(p!.packedBy,null);assert.match(p!.sourceNote,/supplier/);}
  assert.deepEqual(await f.balances(),before);await f.db.execute(sql.raw(q));assert.deepEqual(await f.balances(),before);
 }
});
