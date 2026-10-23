import {test} from 'node:test';
import assert from 'node:assert/strict';
import { setup } from '../helpers/pos-fixture.ts';
import { productStock, warehouses } from '../../src/modules/catalog/schema.ts';
import { warehouseSellers, stockBalances, stockTransfers } from '../../src/modules/inventory/schema.ts';
import { postMoves } from '../../src/modules/inventory/api/ledger.ts';
import { incomingShipments, incomingShipmentLines, suppliers } from '../../src/modules/suppliers/schema.ts';
import { eq } from 'drizzle-orm';

test('POS catalog batches all stock sources, uses approved incoming lines and protects private warehouses', async()=>{
 const f=await setup();
 await f.db.insert(warehouses).values([
  {id:'vig',name:'KHO VIGIFTS',kind:'stock'}, {id:'ncc-wh',name:'Kho NCC',kind:'supplier'},
  {id:'private',name:'Hoá đơn VIGIFTS',kind:'stock',stockPrivate:true},
 ]);
 await f.db.insert(warehouseSellers).values({warehouseId:'private',positionId:'accounting'});
 await f.db.insert(productStock).values([
  {sku:'00123',warehouseId:'vig',quantity:999,updatedAt:'2026-10-21'},
  {sku:'00123',warehouseId:'ncc-wh',quantity:70,updatedAt:'2026-10-21'},
  {sku:'00123',warehouseId:'private',quantity:9999,updatedAt:'2026-10-21'},
 ]);
 await postMoves(f.db as never,'mgr',[{sku:'00123',warehouseId:'vig',qty:40,kind:'opening',refType:'opening',refId:'vig-opening'}]);
 await f.db.insert(suppliers).values({id:'supplier',name:'NCC A',nameKey:'ncc a',createdAt:'2026-10-21',createdBy:'mgr',updatedAt:'2026-10-21'});
 const base={supplierId:'supplier',warehouse:'Kho cửa hàng',source:'supplier-order' as const,approvalStatus:'approved' as const,supplierName:'NCC minh hoạ',createdAt:'2026-10-21',createdBy:'mgr',updatedAt:'2026-10-21',updatedBy:'mgr'};
 await f.db.insert(incomingShipments).values([
  {...base,id:'in-a',ticketNumber:'DMH_A',arrivalDate:'2026-10-25'},
  {...base,id:'in-b',ticketNumber:'DMH_B',arrivalDate:'2026-10-26'},
  {...base,id:'cancelled',ticketNumber:'DMH_CANCELLED',cancelledAt:'2026-10-21'},
  {...base,id:'draft',ticketNumber:'DMH_DRAFT',approvalStatus:'pending'},
 ]);
 await f.db.insert(incomingShipmentLines).values(['in-a','in-b','cancelled','draft'].map((shipmentId,i)=>({id:'line-'+shipmentId,shipmentId,sku:'00123',name:'Ly sứ',unit:'cái',quantity:i<2?10:999,lineNo:1})));
 const path=`/pos/catalog?registerId=${f.registerId}&q=00123`;
 const result=await f.call(path,f.emp);assert.equal(result.status,200,JSON.stringify(result.data));
 const p=result.data.products[0],d=p.stockSources;
 assert.equal(p.available,10);assert.equal(d.vigifts.qty,40);assert.equal(d.supplier.qty,70);assert.equal(d.incoming.qty,20);
 assert.deepEqual(d.incoming.orders.map((o:any)=>o.orderNo).sort(),['DMH_A','DMH_B']);
 assert.ok(!JSON.stringify(d).includes('private'));assert.ok(!JSON.stringify(d).includes('9999'));
 assert.deepEqual(d.requestWarehouses.map((w:any)=>w.id),['vig']);
 const mgr=await f.call(path,f.mgr);assert.equal(mgr.data.products[0].stockSources.vigifts.qty,10039);
 const before=(await f.db.select().from(stockBalances).where(eq(stockBalances.warehouseId,'vig')))[0]!.qty;
 const transfer=await f.call('/stock-transfers',f.emp,'POST',{fromWarehouseId:'vig',toWarehouseId:'pos-wh',reason:'Xin hàng bổ sung quầy',lines:[{sku:'00123',qty:2}]});
 assert.equal(transfer.status,201,JSON.stringify(transfer.data));assert.equal(transfer.data.status,'pending');
 assert.equal((await f.db.select().from(stockBalances).where(eq(stockBalances.warehouseId,'vig')))[0]!.qty,before);
 assert.equal((await f.db.select().from(stockTransfers)).length,1);
 const denied=await f.call('/stock-transfers',f.emp,'POST',{fromWarehouseId:'private',toWarehouseId:'pos-wh',reason:'Không được thấy kho',lines:[{sku:'00123',qty:2}]});
 assert.equal(denied.status,400);
 const draft=await f.call('/purchase-orders',f.emp,'POST',{orders:[{supplierId:'supplier',warehouse:'Kho cửa hàng',note:'Xin hàng từ POS',lines:[{sku:'00123',name:'Ly sứ',unit:'cái',quantity:2,sources:[]}]}]});
 assert.equal(draft.status,201,JSON.stringify(draft.data));
 const [saved]=await f.db.select().from(incomingShipments).where(eq(incomingShipments.id,draft.data.ids[0]));
 assert.equal(saved!.approvalStatus,'pending');assert.equal(saved!.submittedAt,null);
 assert.equal((await f.call(path,f.emp)).data.products[0].stockSources.incoming.qty,20,'new draft is not incoming stock');
});

test('POS không trừ giữ hàng từ kho khác; giữ cùng kho vẫn chặn bán vượt khả dụng',async()=>{
 const f=await setup(),now=new Date().toISOString();
 const {salesOrders,salesOrderLines}=await import('../../src/modules/sales/schema.ts');
 const {reservedBySku}=await import('../../src/modules/sales/api/pos-store.ts');
 await f.db.insert(warehouses).values({id:'vig-scope',name:'KHO VIGIFTS',kind:'stock'});
 await postMoves(f.db,'mgr',[{sku:'00123',warehouseId:'vig-scope',qty:139,kind:'opening',refType:'opening',refId:'vig-scope-opening'},{sku:'00123',warehouseId:'pos-wh',qty:-7,kind:'adjust',refType:'adjustment',refId:'scope-three-left'}]);
 const insert=async(id:string,warehouseId:string|null,qty:number)=>{
  await f.db.insert(salesOrders).values({id,orderNo:id,quoteType:'HRC',customerName:'Khách giữ hàng',ownerId:'mgr',createdBy:'mgr',warehouseId,orderDate:now.slice(0,10),status:'confirmed',holdsStock:true,createdAt:now,updatedAt:now});
  await f.db.insert(salesOrderLines).values({id:id+'-line',orderId:id,lineNo:1,sku:'00123',name:'Ly sứ',unit:'cái',qty});
 };
 await insert('DH_OTHER_WAREHOUSE','vig-scope',50);
 const path=`/pos/catalog?registerId=${f.registerId}&q=00123`;
 let p=(await f.call(path,f.emp)).data.products[0];
 assert.deepEqual([p.onHand,p.reserved,p.available],[3,0,3],'tồn cửa hàng 3 không bị trừ 50 giữ tại VIGIFTS');
 assert.equal((await reservedBySku(f.db,['00123'],'vig-scope')).get('00123'),50);
 assert.equal((await reservedBySku(f.db,['00123'])).get('00123'),50,'tổng giữ hàng toàn hệ thống không đổi');
 await insert('DH_SAME_WAREHOUSE','pos-wh',2);
 p=(await f.call(path,f.emp)).data.products[0];assert.deepEqual([p.onHand,p.reserved,p.available],[3,2,1]);
 const shift=await f.open();
 const short=await f.call('/pos/checkout',f.emp,'POST',f.cart(shift.id));assert.equal(short.status,409,JSON.stringify(short.data));assert.equal(short.data.code,'POS_STOCK_SHORT');
 const paid=await f.call('/pos/checkout',f.emp,'POST',f.cart(shift.id,{rows:[{sku:'00123',qty:1,discountType:'percent',discountValue:0}]}));assert.equal(paid.status,201,JSON.stringify(paid.data));
 assert.equal((await f.db.select().from(stockBalances).where(eq(stockBalances.warehouseId,'pos-wh')))[0]!.qty,2,'bán đúng 1, vẫn còn 2 cho đơn cùng kho');
 // Đơn / HĐKT cũ chưa chọn kho bán: tính trên tổng tồn – VIGIFTS còn trống 139-50=89 thì kho cửa hàng không bị trừ.
 await insert('DH_NO_WAREHOUSE',null,1);
 assert.equal((await reservedBySku(f.db,['00123'],'pos-wh')).get('00123'),2,'đơn chưa chọn kho được VIGIFTS che: kho cửa hàng chỉ trừ đơn cùng kho');
 await insert('DH_NO_WAREHOUSE_BIG',null,100);
 assert.equal((await reservedBySku(f.db,['00123'],'pos-wh')).get('00123'),2+12,'101 chưa chọn kho, VIGIFTS che 89: 12 còn lại vẫn được bảo vệ ở kho cửa hàng');
 assert.equal((await reservedBySku(f.db,['00123'])).get('00123'),50+2+101,'tổng giữ hàng toàn hệ thống không đổi');
});

test('POS: giữ hàng theo báo giá (không gắn kho) chỉ trừ vào kho quầy phần mà kho khác không đủ che',async()=>{
 const f=await setup(),now=new Date().toISOString(),later=new Date(Date.now()+864e5).toISOString();
 const {quotations}=await import('../../src/modules/quotes/schema.ts');
 const {stockHolds}=await import('../../src/modules/sales/schema.ts');
 await f.db.insert(warehouses).values({id:'vig-q',name:'KHO VIGIFTS',kind:'stock'});
 await postMoves(f.db,'mgr',[{sku:'00123',warehouseId:'vig-q',qty:40,kind:'opening',refType:'opening',refId:'vig-q-opening'}]);
 await f.db.insert(quotations).values({id:'q-hold',creatorId:'emp',quoteNo:'B2B_HOLD',quoteType:'B2B',customer:'Khách giữ',quoteDate:now.slice(0,10),data:'{"rows":[]}',createdAt:now,updatedAt:now});
 const hold=async(qty:number)=>{await f.db.delete(stockHolds);await f.db.insert(stockHolds).values({id:'h-'+qty,quoteId:'q-hold',sku:'00123',qty,status:'active',expiresAt:later,createdBy:'mgr',createdAt:now});};
 const path=`/pos/catalog?registerId=${f.registerId}&q=00123`;
 await hold(30);
 let p=(await f.call(path,f.emp)).data.products[0];
 assert.deepEqual([p.onHand,p.reserved,p.available],[10,0,10],'VIGIFTS còn 40 che đủ 30 giữ: kho cửa hàng không bị trừ');
 await hold(45);
 p=(await f.call(path,f.emp)).data.products[0];
 assert.deepEqual([p.onHand,p.reserved,p.available],[10,5,5],'VIGIFTS chỉ che 40: 5 còn lại giữ ở kho cửa hàng');
 await hold(60);
 p=(await f.call(path,f.emp)).data.products[0];
 assert.deepEqual([p.onHand,p.reserved,p.available],[10,20,0],'giữ vượt tổng tồn: kho cửa hàng hết hàng');
});

test('POS tìm sản phẩm cùng thuật toán trang Sản phẩm; skus= trả đúng thứ tự trình duyệt đã xếp hạng',async()=>{
 const f=await setup(),now=new Date().toISOString();
 const {products,productPrices}=await import('../../src/modules/catalog/schema.ts');
 await f.db.insert(products).values([{sku:'LHC-4282',name:'Bình giữ nhiệt Lock 1.2L',unit:'cái',updatedAt:now},{sku:'NOPRICE',name:'Ly sứ không giá',unit:'cái',updatedAt:now},
  {sku:'BT-NFD',name:'Bộ trà 0,7 L - Chim Lạc'.normalize('NFD'),unit:'bộ',updatedAt:now}]);
 await f.db.insert(productPrices).values([{sku:'LHC-4282',policyId:'retail-vat',price:250000},{sku:'BT-NFD',policyId:'retail-vat',price:900000}]);
 const skus=async(q:string)=>(await f.call(`/pos/catalog?registerId=${f.registerId}&q=${encodeURIComponent(q)}`,f.emp)).data.products.map((p:any)=>p.sku);
 assert.deepEqual(await skus('su ly'),['00123'],'nhiều từ không đúng thứ tự (trước: phải gõ đúng cụm "ly su")');
 assert.deepEqual(await skus('lhc4282'),['LHC-4282'],'mã gõ thiếu gạch nối');
 const exact=async(q:string)=>(await f.call(`/pos/catalog?registerId=${f.registerId}&q=${encodeURIComponent(q)}`,f.emp)).data.exactSku;
 assert.equal(await exact('lhc-4282'),'LHC-4282','đúng SKU (không phân biệt hoa thường): báo khớp chính xác');
 assert.equal(await exact('giu nhiet'),null,'tìm theo tên: không có mã khớp chính xác');
 assert.deepEqual(await skus('giu nhiet 1.2l'),['LHC-4282']);
 assert.deepEqual(await skus('bộ trà 0.7 chim lạc'),['BT-NFD'],'tên lưu dạng Unicode tổ hợp (NFD, gõ trên Mac / nhập từ Sapo) vẫn bỏ dấu được');
 const ordered=await f.call(`/pos/catalog?registerId=${f.registerId}&skus=LHC-4282,NOPRICE,00123`,f.emp);
 assert.equal(ordered.status,200,JSON.stringify(ordered.data));
 assert.deepEqual(ordered.data.products.map((p:any)=>p.sku),['LHC-4282','00123'],'giữ thứ tự gửi lên, bỏ mã không có giá ở bảng giá quầy');
 assert.equal(ordered.data.nextOffset,null);
});

test('POS: còn 1 sau hai chuyến xuất không bị giữ thêm; phần chưa xuất và kho khác vẫn tách đúng',async()=>{
 const f=await setup(),s=await f.open(),now=new Date().toISOString();
 const {salesOrders,salesOrderLines,deliveries}=await import('../../src/modules/sales/schema.ts');
 const {orderHolds}=await import('../../src/modules/sales/api/hold-routes.ts');
 const {reservedBySku}=await import('../../src/modules/sales/api/pos-store.ts');
 const {reverseRef}=await import('../../src/modules/inventory/api/ledger.ts');
 await postMoves(f.db,'mgr',[{sku:'00123',warehouseId:'pos-wh',qty:-7,kind:'adjust',refType:'adjustment',refId:'three-before-dispatch'}]);
 await f.db.insert(warehouses).values({id:'other-dispatch',name:'Kho khác',kind:'stock'});
 await postMoves(f.db,'mgr',[{sku:'00123',warehouseId:'other-dispatch',qty:20,kind:'opening',refType:'opening',refId:'other-dispatch-open'}]);
 async function order(id:string,qty:number){
  await f.db.insert(salesOrders).values({id,orderNo:id,channel:'pos',shiftId:s.id,quoteType:'HRC',customerName:'Khách COD',ownerId:'emp',createdBy:'emp',warehouseId:null,orderDate:now.slice(0,10),status:'delivering',holdsStock:true,createdAt:now,updatedAt:now});
  await f.db.insert(salesOrderLines).values({id:id+'-line',orderId:id,lineNo:1,sku:'00123',name:'Ly',unit:'cái',qty,deliveredQty:0});
  await f.db.insert(deliveries).values({id:id+'-delivery',deliveryNo:id+'-GH',orderId:id,plannedDate:now.slice(0,10),status:'in_transit',createdBy:'emp',createdAt:now,updatedAt:now});
 }
 await order('OUT-A',1);await order('OUT-B',1);
 for(const id of ['OUT-A','OUT-B'])await postMoves(f.db,'mgr',[{sku:'00123',warehouseId:'pos-wh',qty:-1,kind:'issue',refType:'pos_delivery',refId:id+'-delivery',refNo:id}]);
 const path=`/pos/catalog?registerId=${f.registerId}&q=00123`,product=async()=>(await f.call(path,f.emp)).data.products[0];
 let p=await product();assert.deepEqual([p.onHand,p.reserved,p.available],[1,0,1]);
 assert.equal((await orderHolds(f.db,['00123'])).length,0,'global holds also remove stock already issued');
 await order('NOT-OUT',1);p=await product();assert.deepEqual([p.onHand,p.reserved,p.available],[1,1,0],'unissued order still holds the last unit');
 assert.equal((await reservedBySku(f.db,['00123'],'other-dispatch')).get('00123')||0,0,'legacy POS derives warehouse from register, not every warehouse');
 await f.db.update(salesOrders).set({status:'cancelled'}).where(eq(salesOrders.id,'NOT-OUT'));
 p=await product();assert.equal(p.available,1);
 const paid=await f.call('/pos/checkout',f.emp,'POST',f.cart(s.id,{rows:[{sku:'00123',qty:1,discountType:'percent',discountValue:0}]}));assert.equal(paid.status,201,JSON.stringify(paid.data));
 p=await product();assert.deepEqual([p.onHand,p.reserved,p.available],[0,0,0]);
 await f.db.transaction(tx=>reverseRef(tx,'mgr','pos_delivery','OUT-A-delivery','Nhận lại hàng chưa giao'));
 p=await product();assert.deepEqual([p.onHand,p.reserved,p.available],[1,1,0],'reversed issue restores the real outstanding hold while order remains active');
});

test('CRM giữ hàng: packing + POS xuất từng phần, đã giao không bị trừ lần hai; mã trùng dòng gộp trước',async()=>{
 const f=await setup(),now=new Date().toISOString();
 const {salesOrders,salesOrderLines,deliveries,packingSlips}=await import('../../src/modules/sales/schema.ts');
 const {orderHolds}=await import('../../src/modules/sales/api/hold-routes.ts');
 await f.db.insert(salesOrders).values({id:'PARTIAL-HOLD',orderNo:'PARTIAL-HOLD',quoteType:'HRC',warehouseId:'pos-wh',customerName:'Khách',ownerId:'mgr',createdBy:'mgr',orderDate:now.slice(0,10),status:'delivering',holdsStock:true,createdAt:now,updatedAt:now});
 await f.db.insert(salesOrderLines).values([{id:'PARTIAL-L1',orderId:'PARTIAL-HOLD',lineNo:1,sku:'00123',name:'Ly',qty:2,deliveredQty:2},{id:'PARTIAL-L2',orderId:'PARTIAL-HOLD',lineNo:2,sku:'00123',name:'Ly khác dòng',qty:3,deliveredQty:0}]);
 await f.db.insert(deliveries).values({id:'PARTIAL-GH',deliveryNo:'PARTIAL-GH',orderId:'PARTIAL-HOLD',plannedDate:now.slice(0,10),createdBy:'mgr',createdAt:now,updatedAt:now});
 await postMoves(f.db,'mgr',[{sku:'00123',warehouseId:'pos-wh',qty:-2,kind:'issue',refType:'pos_delivery',refId:'PARTIAL-GH'}]);
 const qty=async()=>(await orderHolds(f.db,['00123'],'pos-wh'))[0]?.qty??0;
 assert.equal(await qty(),3,'sum quantity/delivered first; same issue does not get deducted from each matching line');
 await f.db.insert(packingSlips).values({id:'PARTIAL-PACK',slipNo:'PARTIAL-PACK',orderId:'PARTIAL-HOLD',source:'warehouse',sourceNote:'Kho POS',status:'packed',createdBy:'mgr',createdAt:now,updatedAt:now});
 await postMoves(f.db,'mgr',[{sku:'00123',warehouseId:'pos-wh',qty:-1,kind:'issue',refType:'packing_slip',refId:'PARTIAL-PACK'}]);
 assert.equal(await qty(),2,'three issued including two delivered: only two still need stock');
 const p=(await f.call(`/pos/catalog?registerId=${f.registerId}&q=00123`,f.emp)).data.products[0];assert.deepEqual([p.onHand,p.reserved,p.available],[7,2,5],'no extra POS-side subtraction of packing');
});
