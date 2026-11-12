import {and,eq} from 'drizzle-orm';
import {setup} from './pos-fixture.ts';
import {products,warehouses} from '../../src/modules/catalog/schema.ts';
import {packingSlips,packingSlipLines,packingSlipPhotos,salesOrders,salesOrderLines} from '../../src/modules/sales/schema.ts';
import {stockBalances} from '../../src/modules/inventory/schema.ts';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';

import {employees,credentials} from '../../src/modules/staff/schema.ts';
import {hashPassword} from '../../src/core/auth/password.ts';
import {PASSWORD} from './staff-fixture.ts';
export async function adjustmentFixture(){
 const f=await setup(),now=new Date().toISOString();
 await f.db.insert(employees).values({id:'adjust-kho',email:'adjust-kho@x.vn',name:'Kho kiểm thử',role:'employee',positionId:'warehouse',createdAt:now});
 await f.db.insert(credentials).values({memberId:'adjust-kho',passwordHash:await hashPassword(PASSWORD,1000)});
 const kho=(await f.call('/login','','POST',{email:'adjust-kho@x.vn',password:PASSWORD})).cookie;
 await f.db.insert(warehouses).values({id:'adjust-wh',name:'Kho điều chỉnh thử',kind:'stock'});
 await f.db.insert(products).values({sku:'PACK-ADJUST',name:'Sản phẩm kiểm thử điều chỉnh',unit:'Bộ',updatedAt:now});
 await f.db.insert(salesOrders).values({id:'adjust-order',orderNo:'DH-ADJUST',quoteType:'B2B',customerName:'Khách kiểm thử',ownerId:'emp',createdBy:'emp',warehouseId:'adjust-wh',orderDate:'2030-01-01',status:'confirmed',subtotal:2000,total:2160,createdAt:now,updatedAt:now,holdMode:'capped',holdsStock:false});
 await f.db.insert(salesOrderLines).values({id:'adjust-line',orderId:'adjust-order',lineNo:1,sku:'PACK-ADJUST',name:'Sản phẩm kiểm thử điều chỉnh',unit:'Bộ',qty:20,unitPrice:100,amount:2000});
 await f.db.insert(packingSlips).values({id:'adjust-slip',slipNo:'DG-ADJUST',orderId:'adjust-order',status:'packed',stockWarehouseId:'adjust-wh',totalQty:10,totalWeight:5,createdBy:'emp',createdAt:now,updatedAt:now,sentBy:'emp',sentAt:now,packedBy:'mgr',packedAt:now,revision:3});
 await f.db.insert(packingSlipLines).values({id:'adjust-slip-line',slipId:'adjust-slip',orderLineId:'adjust-line',sku:'PACK-ADJUST',name:'Sản phẩm kiểm thử điều chỉnh',unit:'Bộ',qty:10,perCarton:10,cartonWeight:5,weight:5});
 await f.db.insert(packingSlipPhotos).values({id:'adjust-photo',slipId:'adjust-slip',dataUrl:'data:image/png;base64,fixture',bytes:7,createdBy:'mgr',createdAt:now});
 await postMoves(f.db,'mgr',[{sku:'PACK-ADJUST',warehouseId:'adjust-wh',qty:50,kind:'opening',refType:'opening',refId:'adjust-opening'}]);
 await postMoves(f.db,'mgr',[{sku:'PACK-ADJUST',warehouseId:'adjust-wh',qty:-10,kind:'issue',refType:'packing_slip',refId:'adjust-slip',refNo:'DG-ADJUST'}]);
 const payload=(qty:number,revision=3)=>({revision,clientKey:crypto.randomUUID(),reason:'Kiểm lại số thực tế đã đóng',lines:[{id:'adjust-slip-line',qty}]});
 const adjust=(p:object,cookie=f.mgr)=>f.call('/packing/adjust-slip/adjust-quantities',cookie,'POST',p);
 const balance=async()=>(await f.db.select().from(stockBalances).where(and(eq(stockBalances.sku,'PACK-ADJUST'),eq(stockBalances.warehouseId,'adjust-wh'))))[0]!.qty;
 const read=async()=>(await f.call('/packing/adjust-slip',f.mgr)).data;
 return {...f,kho,adjust,payload,balance,read};
}
