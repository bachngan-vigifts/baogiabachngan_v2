import {test} from 'node:test';
import assert from 'node:assert/strict';
import {and,eq} from 'drizzle-orm';
import {setupWarehouseOps} from '../helpers/warehouse-approval-fixture.ts';
import {warehouses} from '../../src/modules/catalog/schema.ts';
import {positionPermissions} from '../../src/modules/staff/schema.ts';
import {stockMoves} from '../../src/modules/inventory/schema.ts';
test('transfer quick balance follows server inventory permissions and never writes inventory on GET',async()=>{
 const f=await setupWarehouseOps();
  await f.db.insert(warehouses).values({id:'destination',name:'Kho nhận',kind:'stock'});
  const made=await f.call('/stock-transfers',f.mgr,'POST',{clientKey:crypto.randomUUID(),fromWarehouseId:'pos-wh',toWarehouseId:'destination',reason:'Chuyển bán',lines:[{sku:'00123',qty:2}]});assert.equal(made.status,201,JSON.stringify(made.data));
  const before=JSON.stringify(await f.db.select().from(stockMoves));
  for(const cookie of [f.mgr,f.emp]){const read=await f.call('/stock-transfers/'+made.data.id,cookie);assert.equal(read.status,200);assert.equal(read.data.actions.adjustBalance,true);}
  await f.db.delete(positionPermissions).where(and(eq(positionPermissions.positionId,'sales-lock'),eq(positionPermissions.permission,'inventory.manage')));
  const denied=await f.call('/stock-transfers/'+made.data.id,f.emp);assert.equal(denied.data.actions.adjustBalance,false);
  const write=await f.call('/inventory/adjustments',f.emp,'POST',{warehouseId:'pos-wh',clientKey:'forged-quick-adjustment',reason:'Cân bằng từ phiếu',lines:[{sku:'00123',qty:24}]});assert.equal(write.status,403);
  assert.equal(JSON.stringify(await f.db.select().from(stockMoves)),before);
});
