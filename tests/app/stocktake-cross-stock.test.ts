import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setupWarehouseOps} from '../helpers/warehouse-approval-fixture.ts';
import {products,warehouses} from '../../src/modules/catalog/schema.ts';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';
test('stocktake cross-warehouse columns use ledger stock, hide private warehouses and distinguish unopened from zero',async()=>{
 const f=await setupWarehouseOps();
 await f.db.insert(warehouses).values([
  {id:'stocktake-other',name:'Kho công khai',kind:'stock',active:true,sortOrder:10},
  {id:'stocktake-unopened',name:'Kho chưa mở',kind:'stock',active:true,sortOrder:11},
  {id:'stocktake-private',name:'Kho riêng',kind:'stock',active:true,stockPrivate:true,sortOrder:12},
 ]);
 await postMoves(f.db,'mgr',[
  {sku:'00123',warehouseId:'stocktake-other',qty:23,kind:'opening',refType:'opening',refId:'cross-other'},
  {sku:'00123',warehouseId:'stocktake-private',qty:999,kind:'opening',refType:'opening',refId:'cross-private'},
 ]);
 const body={warehouseId:'pos-wh',skus:['00123','not-in-stock'],includeWarehouses:true};
 const plain=await f.call('/inventory/count-stock',f.emp,'POST',{warehouseId:'pos-wh',skus:['00123']});
 assert.equal(plain.status,200);assert.equal(plain.data.warehouseStock,undefined,'old clients retain their response shape');
 const r=await f.call('/inventory/count-stock',f.emp,'POST',body);assert.equal(r.status,200,JSON.stringify(r.data));
 assert.equal(r.data.stock['00123'],10);assert.equal(r.data.warehouseStock['00123']['pos-wh'],10);
 assert.equal(r.data.warehouseStock['00123']['stocktake-other'],23);assert.equal(r.data.warehouseStock['not-in-stock']['stocktake-other'],0);
 assert.equal(r.data.warehouseStock['00123']['stocktake-unopened'],null);assert.equal(r.data.warehouseStock['00123']['stocktake-private'],undefined);
 const mgr=await f.call('/inventory/count-stock',f.mgr,'POST',body);assert.equal(mgr.data.warehouseStock['00123']['stocktake-private'],999);
 assert.equal((await f.call('/inventory/count-stock',f.emp,'POST',{...body,warehouseId:'stocktake-private'})).status,403);
 assert.equal((await f.call('/inventory/count-stock',f.emp,'POST',{...body,includeWarehouses:'true'})).status,400);
});

test('stocktake accepts the real 300-line database boundary and rejects 301 before writing',async()=>{
 const f=await setupWarehouseOps();
 const [product]=await f.db.select().from(products).where(eq(products.sku,'00123'));
 assert.ok(product);await f.db.insert(products).values(Array.from({length:300},(_,i)=>({...product,sku:'LIMIT_'+i})));
 const lines=Array.from({length:300},(_,i)=>({sku:'LIMIT_'+i,expectedQty:0,countedQty:0}));
 const config=await f.call('/inventory/status',f.emp);assert.equal(config.data.stocktakeLimit,300);
 const ok=await f.call('/inventory/adjustments',f.emp,'POST',{source:'stocktake',clientKey:'limit-300-valid',warehouseId:'pos-wh',reason:'Đếm đủ 300 mã',lines});
 assert.equal(ok.status,201,JSON.stringify(ok.data));
 const bad=await f.call('/inventory/adjustments',f.emp,'POST',{source:'stocktake',clientKey:'limit-301-invalid',warehouseId:'pos-wh',reason:'Không vượt giới hạn',lines:[...lines,{sku:'LIMIT_EXTRA',expectedQty:0,countedQty:0}]});
 assert.equal(bad.status,400,JSON.stringify(bad.data));assert.match(bad.data.error??bad.data.message,/300/);
});
