import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setupEarly} from '../helpers/purchase-early-fixture.ts';
import {products,productPrices,pricePolicies,productStock,warehouses} from '../../src/modules/catalog/schema.ts';
import {auditLogs} from '../../src/core/db/schema.ts';
import {syncProducts} from '../../src/modules/integrations/api/sapo-sync-routes.ts';
import {snapshotVersion} from '../../src/modules/catalog/api/routes.ts';
test('Manager archives/restores without deleting history/prices; source sync cannot resurrect; stock and stale requests blocked',async()=>{
 const f=await setupEarly();
 const at='2026-11-01T00:00:00.000Z';await f.db.insert(products).values([{sku:'ZERO-001',name:'Sản phẩm kiểm thử',updatedAt:at},{sku:'STOCK-001',name:'Còn tồn',updatedAt:at},{sku:'031106000',name:'Đang về',updatedAt:at}]);
 await f.db.insert(pricePolicies).values({id:'test-retail',name:'Giá bán lẻ',sortOrder:0});await f.db.insert(productPrices).values({sku:'ZERO-001',policyId:'test-retail',price:10000});await f.db.insert(warehouses).values({id:'archive-wh',name:'Kho kiểm thử',sortOrder:0});await f.db.insert(productStock).values({sku:'STOCK-001',warehouseId:'archive-wh',quantity:2,updatedAt:at});
 for(const who of ['sa','emp','kho','ncc']){assert.equal((await f.call('/products/ZERO-001/archive',f.cookies[who],'POST',{expectedUpdatedAt:at})).status,403,who);assert.equal((await f.call('/archived-products',f.cookies[who])).status,403);}
 assert.equal((await f.call('/products/STOCK-001/archive',f.cookies.mgr,'POST',{expectedUpdatedAt:at})).status,409);
 assert.equal((await f.call('/products/031106000/archive',f.cookies.mgr,'POST',{expectedUpdatedAt:at})).status,409,'incoming stock also blocks removal');
 assert.equal((await f.call('/products/ZERO-001/archive',f.cookies.mgr,'POST',{expectedUpdatedAt:'stale'})).status,409);
 const version=await snapshotVersion(f.db);let r=await f.call('/products/ZERO-001/archive',f.cookies.mgr,'POST',{expectedUpdatedAt:at});assert.equal(r.status,200,JSON.stringify(r.data));
 let [p]=await f.db.select().from(products).where(eq(products.sku,'ZERO-001'));assert.equal(p!.active,false);assert.ok(p!.archivedAt);assert.equal(p!.archivedBy,'mgr');assert.equal((await f.db.select().from(productPrices).where(eq(productPrices.sku,'ZERO-001')))[0]!.price,10000);assert.notEqual((await snapshotVersion(f.db)).base,version.base);
 assert.equal((await f.call('/archived-products?q=ZERO-001',f.cookies.mgr)).data.products.length,1);assert.equal((await f.call('/archived-products?q=%25',f.cookies.mgr)).data.products.length,0);
 await syncProducts(f.db,{products:[{id:999,name:'Đồng bộ thử',status:'active',variants:[{sku:'ZERO-001',status:'active'}]}]});[p]=await f.db.select().from(products).where(eq(products.sku,'ZERO-001'));assert.equal(p!.active,false);assert.ok(p!.archivedAt);
 r=await f.call('/admin/catalog-import',f.cookies.mgr,'POST',{format:'sapo-catalog-v1',warehouses:['Kho kiểm thử'],pricePolicies:['Giá bán lẻ'],products:[{sku:'ZERO-001',name:'Nhập file thử',prices:[10000],stock:[0]}],finalize:false});assert.equal(r.status,200,JSON.stringify(r.data));[p]=await f.db.select().from(products).where(eq(products.sku,'ZERO-001'));assert.equal(p!.active,false);
 assert.equal((await f.call('/products/ZERO-001/restore',f.cookies.mgr,'POST',{expectedUpdatedAt:p!.updatedAt})).status,200);[p]=await f.db.select().from(products).where(eq(products.sku,'ZERO-001'));assert.equal(p!.active,true);assert.equal(p!.archivedAt,null);assert.equal((await f.db.select().from(auditLogs).where(eq(auditLogs.entityId,'ZERO-001'))).filter(r=>['product-archive','product-restore'].includes(r.action)).length,2);
});
