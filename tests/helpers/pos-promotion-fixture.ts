import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setup} from './pos-fixture.ts';
import {products,productPrices} from '../../src/modules/catalog/schema.ts';
import {posRegisters} from '../../src/modules/sales/pos-schema.ts';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';
import {employees} from '../../src/modules/staff/schema.ts';
export const GIFT='031059000B2';
export const PROGRAM={revision:0,title:'Minh Long · Tặng bộ 2 chén Gourmet',enabled:true,threshold:1000000,giftSku:GIFT,giftQty:1};
export async function promotionFixture(){
 const f=await setup();
 await f.db.update(employees).set({positionId:'sales-ml'}).where(eq(employees.id,'emp'));
 await f.db.update(posRegisters).set({name:'Showroom Gốm Sứ Minh Long Cần Thơ'}).where(eq(posRegisters.id,f.registerId));
 await f.db.insert(products).values({sku:GIFT,name:'BỘ QUÀ TẶNG 2 CHÉN CƠM 10CM GOURMET',unit:'Bộ',updatedAt:new Date().toISOString()});
 await f.db.insert(productPrices).values([{sku:GIFT,policyId:'retail-vat',price:108000},{sku:GIFT,policyId:'retail',price:100000}]);
 await postMoves(f.db,'mgr',[{sku:GIFT,warehouseId:'pos-wh',qty:10,kind:'opening',refType:'opening',refId:'opening-gifts'}]);
 const save=await f.call('/pos/promotions/'+f.registerId,f.mgr,'PUT',PROGRAM);assert.equal(save.status,200,JSON.stringify(save.data));
 const shift=await f.open();
 const body=(extra={})=>f.cart(shift.id,{rows:[{sku:'00123',qty:10}],promotionRevision:1,tendered:2000000,...extra});
 return {...f,shift,body};
}
