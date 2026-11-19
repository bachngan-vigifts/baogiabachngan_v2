import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setupWarehouseOps} from '../helpers/warehouse-approval-fixture.ts';
import {products} from '../../src/modules/catalog/schema.ts';
import {inventoryAdjustments,stockBalances,stockMoves} from '../../src/modules/inventory/schema.ts';

async function fixture(skus=['HAP522BLU']){
 const f=await setupWarehouseOps();
 await f.db.insert(products).values(skus.map(sku=>({sku,name:sku,updatedAt:new Date().toISOString()})));
 return {...f,body:{warehouseId:'pos-wh',reason:'Kiểm thử mã viết thường',clientKey:'adjust-case-test-001',lines:[{sku:'hap522blu',qty:120}]}};
}

test('lowercase and mixed-case resolve to catalog SKU; retries across spelling post once',async()=>{
 const f=await fixture();
 const made=await f.call('/inventory/adjustments',f.mgr,'POST',f.body);
 assert.equal(made.status,201,JSON.stringify(made.data));
 for(const sku of ['HAP522BLU',' HaP522bLu ']){
  const replay=await f.call('/inventory/adjustments',f.mgr,'POST',{...f.body,lines:[{sku,qty:120}]});
  assert.equal(replay.status,200);assert.equal(replay.data.replayed,true);
 }
 const balances=await f.db.select().from(stockBalances);
 assert.equal(balances.find(r=>r.sku==='HAP522BLU')?.qty,120);
 assert.equal(balances.some(r=>r.sku==='hap522blu'),false);
 assert.equal((await f.db.select().from(stockMoves)).filter(r=>r.refId===made.data.id).length,1);
 assert.equal((await f.db.select().from(inventoryAdjustments)).length,1);
});

test('different spellings merge into one adjustment delta, pending until Manager approval',async()=>{
 const f=await fixture(['HaP522BLu']);
 const r=await f.call('/inventory/adjustments',f.emp,'POST',{...f.body,lines:[{sku:'hap522blu',qty:2},{sku:'HaP522BLu',qty:3}]});
 assert.equal(r.status,201,JSON.stringify(r.data));assert.equal(r.data.status,'pending');
 assert.equal((await f.db.select().from(stockBalances)).some(r=>r.sku==='HaP522BLu'),false);
 assert.equal((await f.call('/inventory/adjustments/'+r.data.id+'/review',f.mgr,'POST',{decision:'approved'})).status,200);
 assert.equal((await f.db.select().from(stockBalances)).find(r=>r.sku==='HaP522BLu')?.qty,5);
});

test('ambiguous casing and unknown codes fail without stock writes; exact catalog key still works',async()=>{
 const f=await fixture(['HAP522BLU','hap522blu']);
 for(const sku of ['HaP522BLu','NOT-A-PRODUCT']){
  const r=await f.call('/inventory/adjustments',f.mgr,'POST',{...f.body,lines:[{sku,qty:1}]});
  assert.equal(r.status,400);assert.match(r.data.error,sku==='NOT-A-PRODUCT'?/không có/:/trùng/);
 }
 assert.equal((await f.db.select().from(inventoryAdjustments)).length,0);
 assert.equal((await f.call('/inventory/adjustments',f.mgr,'POST',f.body)).status,201);
 assert.equal((await f.db.select().from(stockBalances)).find(r=>r.sku==='hap522blu')?.qty,120);
});

test('stocktake casing resolves but duplicate snapshots are rejected',async()=>{
 const f=await fixture();
 const line={sku:'hap522blu',expectedQty:0,countedQty:2};
 const duplicate=await f.call('/inventory/adjustments',f.mgr,'POST',{...f.body,source:'stocktake',lines:[line,{...line,sku:'HAP522BLU'}]});
 assert.equal(duplicate.status,400);
 assert.equal((await f.db.select().from(inventoryAdjustments)).length,0);
 const made=await f.call('/inventory/adjustments',f.mgr,'POST',{...f.body,source:'stocktake',lines:[line]});
 assert.equal(made.status,201,JSON.stringify(made.data));assert.equal(made.data.status,'pending');
 assert.equal((await f.call('/inventory/adjustments/'+made.data.id+'/review',f.mgr,'POST',{decision:'approved'})).status,200);
 assert.equal((await f.db.select().from(stockBalances)).find(r=>r.sku==='HAP522BLU')?.qty,2);
});
