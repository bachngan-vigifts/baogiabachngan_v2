import assert from 'node:assert/strict';
import {setupEarly} from './purchase-early-fixture.ts';
import {products,warehouses} from '../../src/modules/catalog/schema.ts';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';
export async function setupWarehouseWork(){
 const f=await setupEarly(),at='2026-10-21T00:00:00Z';
 await f.db.insert(warehouses).values([{id:'from',name:'KHO VIGIFTS',kind:'stock'},{id:'to',name:'Kho Cần Thơ',kind:'stock'},{id:'private',name:'Kho riêng',kind:'stock',stockPrivate:true}]);
 await f.db.insert(products).values({sku:'031106000',name:'Bộ trà Jasmine Trắng',unit:'Bộ',updatedAt:at});
 await postMoves(f.db,'mgr',['from','to','private'].map(warehouseId=>({sku:'031106000',warehouseId,qty:100,kind:'opening' as const,refType:'opening' as const,refId:'opening-'+warehouseId})));
 const ok=(r:any,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};
 const create=async()=>ok(await f.call('/stock-transfers',f.cookies.mgr,'POST',{clientKey:crypto.randomUUID(),fromWarehouseId:'from',toWarehouseId:'to',reason:'Chuyển hàng cho khách',lines:[{sku:'031106000',qty:2}]}),201);
 return{...f,ok,create};
}
