import {test} from 'node:test';
import assert from 'node:assert/strict';
import {and,eq} from 'drizzle-orm';
import {setupWarehouseOps} from '../helpers/warehouse-approval-fixture.ts';
import {stockBalances,stockMoves,inventoryAdjustments} from '../../src/modules/inventory/schema.ts';
import {stocktakeCommands,stocktakeStates} from '../../src/modules/inventory/stocktake-schema.ts';
import {products} from '../../src/modules/catalog/schema.ts';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';
type Fixture=Awaited<ReturnType<typeof setupWarehouseOps>>;
const qty=async(f:Fixture)=>(await f.db.select().from(stockBalances).where(and(eq(stockBalances.sku,'00123'),eq(stockBalances.warehouseId,'pos-wh'))))[0]!.qty;
async function draft(f:Fixture,key:string,countedQty:number,sku='00123',expectedQty=10){const r=await f.call('/inventory/stocktakes',f.mgr,'POST',{key,warehouseId:'pos-wh',lines:[{sku,expectedQty,countedQty}]});assert.equal(r.status,201,JSON.stringify(r.data));return{id:r.data.id,revision:1};}
const move=(f:Fixture,n:number,id:string,sku='00123')=>postMoves(f.db,'mgr',[{sku,warehouseId:'pos-wh',qty:n,kind:n<0?'sale':'adjust',refType:n<0?'sales_order':'adjustment',refId:id}]);
async function unchanged(f:Fixture,body:any){const snapshot=async()=>JSON.stringify(await Promise.all([f.db.select().from(inventoryAdjustments),f.db.select().from(stocktakeStates),f.db.select().from(stocktakeCommands),f.db.select().from(stockMoves),f.db.select().from(stockBalances)]));const before=await snapshot();for(let i=0;i<2;i++){const r=await f.call('/inventory/stocktakes/merge',f.mgr,'POST',body);assert.equal(r.status,409,JSON.stringify(r.data));assert.equal(r.data.code,'STOCKTAKE_MERGE_CONFLICT');assert.equal(await snapshot(),before,'rejection/retry leaves sources, receipts and ledger unchanged');}}
for(const scenario of ['sale','other-count','offsetting','baseline'] as const)test('merge blocks stale counts: '+scenario,async()=>{
 const f=await setupWarehouseOps(),a=await draft(f,'merge-source-a',4),b=await draft(f,'merge-source-b',6);
 if(scenario==='sale')await move(f,-2,'sale-after-count');
 if(scenario==='offsetting'){await move(f,-2,'sale-after-count');await move(f,2,'receipt-after-count');}
 if(scenario==='other-count'){const other=await draft(f,'merge-other-count',8);assert.equal((await f.call('/inventory/stocktakes/'+other.id+'/complete',f.mgr,'POST',{key:'merge-other-complete',revision:1})).status,200);}
 if(scenario==='baseline'){const r=await f.call('/inventory/stocktakes/'+a.id,f.mgr,'PUT',{key:'merge-wrong-baseline',revision:1,lines:[{sku:'00123',expectedQty:9,countedQty:4}]});assert.equal(r.status,200);a.revision=2;}
 await unchanged(f,{key:'merge-stale-request',sources:[a,b],applyDelta:true});assert.equal(await qty(f),['sale','other-count'].includes(scenario)?8:10);
});
test('safe merge and completion replay exactly once, unrelated SKU movements do not block',async()=>{
 const f=await setupWarehouseOps(),a=await draft(f,'merge-safe-a',4),b=await draft(f,'merge-safe-b',7);
 await f.db.insert(products).values({sku:'UNRELATED',name:'Khác',unit:'cái',updatedAt:new Date().toISOString()});await move(f,2,'unrelated-change','UNRELATED');
 const body={key:'merge-safe-command',sources:[a,b]},r=await f.call('/inventory/stocktakes/merge',f.mgr,'POST',body);assert.equal(r.status,201,JSON.stringify(r.data));assert.equal((await f.call('/inventory/stocktakes/merge',f.mgr,'POST',body)).data.id,r.data.id);
 for(let i=0;i<2;i++)assert.equal((await f.call('/inventory/stocktakes/'+r.data.id+'/complete',f.mgr,'POST',{key:'merge-safe-complete',revision:1})).status,200);
 assert.equal(await qty(f),11);assert.equal((await f.db.select().from(stockMoves).where(eq(stockMoves.refId,r.data.id))).length,1);
});
test('movement before a SKU source must not be blocked by an older unrelated source',async()=>{
 const f=await setupWarehouseOps();await f.db.insert(products).values({sku:'UNRELATED',name:'Khác',unit:'cái',updatedAt:new Date().toISOString()});
 const a=await draft(f,'merge-old-unrelated',0,'UNRELATED',0);await move(f,-2,'before-relevant-count');
 const b=await draft(f,'merge-new-relevant',8,'00123',8);
 const r=await f.call('/inventory/stocktakes/merge',f.mgr,'POST',{key:'merge-per-sku-clock',sources:[a,b]});assert.equal(r.status,201,JSON.stringify(r.data));
 assert.equal((await f.call('/inventory/stocktakes/'+r.data.id+'/complete',f.mgr,'POST',{key:'merge-per-sku-done',revision:1})).status,200);assert.equal(await qty(f),8);
});
