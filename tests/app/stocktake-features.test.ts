import {test} from 'node:test';
import assert from 'node:assert/strict';
import {and,eq} from 'drizzle-orm';
import {setupWarehouseOps} from '../helpers/warehouse-approval-fixture.ts';
import {stockBalances} from '../../src/modules/inventory/schema.ts';
import {productMovements,products} from '../../src/modules/catalog/schema.ts';
import {auditLogs} from '../../src/core/db/schema.ts';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';

const balance=async(f:Awaited<ReturnType<typeof setupWarehouseOps>>)=>(await f.db.select().from(stockBalances).where(and(eq(stockBalances.sku,'00123'),eq(stockBalances.warehouseId,'pos-wh'))))[0]!.qty;

test('tồn đổi sau lúc đếm: mặc định chặn, Manager duyệt theo chênh lệch ghi (thực đếm − tồn lúc đếm) vào tồn hiện tại', async () => {
 const f=await setupWarehouseOps();
 const r=await f.call('/inventory/adjustments',f.emp,'POST',{source:'stocktake',clientKey:'stocktake-delta-001',warehouseId:'pos-wh',reason:'Kiểm kê cuối ngày',lines:[{sku:'00123',expectedQty:10,countedQty:7}]});
 assert.equal(r.status,201,JSON.stringify(r.data));
 await postMoves(f.db,'mgr',[{sku:'00123',warehouseId:'pos-wh',qty:2,kind:'adjust',refType:'adjustment',refId:'sale-after-count'}]);
 assert.equal(await balance(f),12);
 const blocked=await f.call('/inventory/adjustments/'+r.data.id+'/review',f.mgr,'POST',{decision:'approved'});
 assert.equal(blocked.status,409);assert.equal(blocked.data.code,'STOCKTAKE_STOCK_CHANGED');assert.match(blocked.data.error??blocked.data.message??'',/00123/);
 const ok=await f.call('/inventory/adjustments/'+r.data.id+'/review',f.mgr,'POST',{decision:'approved',applyDelta:true});
 assert.equal(ok.status,200,JSON.stringify(ok.data));
 assert.equal(await balance(f),9,'12 + (7 − 10)');
 const log=(await f.db.select().from(auditLogs).where(and(eq(auditLogs.entityId,r.data.id),eq(auditLogs.action,'adjustment-approved'))))[0]!;
 assert.equal(JSON.parse(log.data).appliedDelta,true);
 // Gửi phiếu với tồn lúc đếm cũ: chặn nếu không chọn áp chênh lệch.
 const stale={source:'stocktake',warehouseId:'pos-wh',reason:'Đếm từ sáng',lines:[{sku:'00123',expectedQty:5,countedQty:6}]};
 assert.equal((await f.call('/inventory/adjustments',f.emp,'POST',{...stale,clientKey:'stocktake-delta-002'})).status,409);
 assert.equal((await f.call('/inventory/adjustments',f.emp,'POST',{...stale,clientKey:'stocktake-delta-003',applyDelta:true})).status,201);
});

test('giá trị chênh lệch theo giá nhập gần nhất chỉ Manager thấy; lịch sử kiểm kê theo mã', async () => {
 const f=await setupWarehouseOps();
 const now=new Date().toISOString();
 await f.db.insert(productMovements).values([
  {id:'pm-old',refKey:'purchase:old',sku:'00123',kind:'purchase',qty:5,unitPrice:4000,occurredAt:'2026-01-01T00:00:00Z',recordedAt:now},
  {id:'pm-new',refKey:'purchase:new',sku:'00123',kind:'purchase',qty:5,unitPrice:5000,occurredAt:now,recordedAt:now},
 ]);
 const r=await f.call('/inventory/adjustments',f.emp,'POST',{source:'stocktake',clientKey:'stocktake-value-001',warehouseId:'pos-wh',reason:'Kiểm kê giá trị',lines:[{sku:'00123',expectedQty:10,countedQty:7}]});
 assert.equal(r.status,201);
 assert.equal((await f.call('/inventory/stocktakes/'+r.data.id,f.mgr)).data.names['00123'].cost,5000);
 assert.equal((await f.call('/inventory/stocktakes/'+r.data.id,f.emp)).data.names['00123'].cost,undefined,'nhân viên không thấy giá vốn');
 const mine=(await f.call('/inventory/adjustments?kind=stocktake&status=',f.mgr)).data.adjustments[0];
 assert.deepEqual(mine.valueDelta,{value:-15000,missing:0});
 assert.equal((await f.call('/inventory/adjustments?kind=stocktake&status=',f.emp)).data.adjustments[0].valueDelta,undefined);
 const h=await f.call('/inventory/stocktake-history?sku=00123',f.emp);
 assert.equal(h.status,200);assert.deepEqual(h.data.history.map((x:any)=>[x.refNo,x.expectedQty,x.countedQty,x.qty]),[[r.data.refNo,10,7,-3]]);
 assert.equal((await f.call('/inventory/stocktake-history?sku=00123&warehouseId=khac',f.emp)).data.history.length,0);
 assert.equal((await f.call('/inventory/stocktake-history?sku=khong-co',f.emp)).data.history.length,0);
 assert.equal((await f.call('/inventory/stocktake-history',f.emp)).status,400);
});

test('tạo nhanh phiếu kiểm kê: theo thương hiệu, mã còn tồn, mã lệch Sapo; kiểm tra kho và cách tạo', async () => {
 const f=await setupWarehouseOps();
 const [p]=await f.db.select().from(products).where(eq(products.sku,'00123'));
 const call=(body:Record<string,unknown>,who=f.emp)=>f.call('/inventory/count-candidates',who,'POST',{warehouseId:'pos-wh',...body});
 const instock=await call({mode:'instock'});
 assert.equal(instock.status,200,JSON.stringify(instock.data));
 assert.ok(instock.data.items.some((i:any)=>i.sku==='00123'&&i.stock===10),'mã còn tồn kèm tồn sổ kho');
 assert.ok(instock.data.items.every((i:any)=>i.stock>0));
 await f.db.update(products).set({brand:'Thương hiệu thử'}).where(eq(products.sku,p!.sku));
 const brand=await call({mode:'brand',brand:'Thương hiệu thử'});
 assert.deepEqual(brand.data.items.map((i:any)=>i.sku),['00123']);
 const sapo=await call({mode:'sapo',limit:5});
 assert.equal(sapo.status,200);assert.ok(sapo.data.items.length<=5);
 assert.equal((await call({mode:'brand'})).status,400,'thiếu thương hiệu');
 assert.equal((await call({mode:'bogus'})).status,400);
 assert.equal((await f.call('/inventory/count-candidates',f.emp,'POST',{warehouseId:'khac',mode:'instock'})).status,403);
});
