import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setupEarly} from '../helpers/purchase-early-fixture.ts';
import {products,productBarcodes} from '../../src/modules/catalog/schema.ts';
test('Tra tồn: Sale vẫn thấy SL/ngày hẹn nhưng không nhận số PO/NCC/ID mua hàng',async()=>{
 const f=await setupEarly();await f.db.insert(products).values({sku:'031106000',name:'Ly',unit:'Cái',updatedAt:new Date().toISOString()});
 const r=await f.call('/inventory/lookup?q=031106000',f.cookies.emp);assert.equal(r.status,200,JSON.stringify(r.data));
 const incoming=r.data.products[0].incoming;assert.equal(incoming.qty,20000);assert.ok(!JSON.stringify(incoming).includes('PO-a1'),'không lộ số PO');assert.ok(!JSON.stringify(incoming).includes('NCC a'),'không lộ NCC');assert.ok(incoming.orders.every((o:any)=>!o.orderId&&!o.ticketNumber&&!o.internalNo&&!o.supplierName));
 assert.equal(incoming.orders[0].arrivalDate,'2026-10-20');
});

import {eq} from 'drizzle-orm';
import {suppliers,incomingShipments,supplierReceipts} from '../../src/modules/suppliers/schema.ts';
import {productStock,warehouses} from '../../src/modules/catalog/schema.ts';
import {syncIncomingStock} from '../../src/modules/suppliers/api/incoming-stock.ts';
import {posStockSources} from '../../src/modules/sales/api/pos-stock-sources.ts';
import {catalogueStockFacts} from '../../src/modules/catalog/api/catalogue-stock.ts';
import {recordMovements} from '../../src/modules/catalog/api/product-history.ts';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';
const sale={id:'emp',role:'employee',positionId:'sale',active:true,perms:['page.purchases']};
const sa={id:'sa',role:'employee',positionId:'sale-admin',active:true,perms:['page.purchases']};
test('Sale Admin: incoming/tồn ảnh chụp chỉ tính hãng được gán; thu hồi hãng đổi cache, không sửa kho materialized',async()=>{
 const f=await setupEarly(),sku='031106000',now=new Date().toISOString();
 await f.db.insert(products).values({sku,name:'Ly',unit:'Cái',updatedAt:now});await f.db.insert(warehouses).values({id:'public',name:'Kho thật',kind:'stock'});
 await f.db.update(suppliers).set({saleAdminBrand:null}).where(eq(suppliers.id,'b'));await syncIncomingStock(f.db,[sku]);
 const before=await f.db.select().from(productStock),lookup=await f.call('/inventory/lookup?q='+sku,f.cookies.sa);assert.equal(lookup.data.products[0].incoming.qty,15000);assert.ok(lookup.data.products[0].incoming.orders.every((o:any)=>o.orderId==='a1'||o.orderId==='a2'));
 for(const [m,expected] of [[sale,20000],[sa,15000]] as const){const pos=(await posStockSources(f.db,m,'public',[sku])).get(sku)!;assert.equal(pos.incoming.qty,expected);const catalog=(await catalogueStockFacts(f.db,m,[sku]))[0]!;assert.equal(catalog.incoming?.qty,expected);if(m===sale){assert.ok(pos.incoming.orders.every(o=>!o.orderId&&!o.orderNo&&!o.supplierName));assert.equal(pos.incoming.orders[0]!.arrivalDate,'2026-10-20');}}
 const snapshot=await f.call('/catalog-snapshot?pageSize=50',f.cookies.sa);assert.equal(snapshot.status,200,JSON.stringify(snapshot.data));const version=snapshot.data.version;
 await f.db.insert(productBarcodes).values({barcode:'000123456789',sku,createdAt:now,createdBy:'mgr'});
 const detail=await f.call('/products/'+sku,f.cookies.sa);assert.deepEqual(detail.data.product.barcodes,['000123456789']);assert.equal(Object.values(detail.data.product.stock).reduce((n:any,q:any)=>n+q,0),15000);
 await f.db.update(suppliers).set({saleAdminBrand:null}).where(eq(suppliers.id,'a'));
 const revoked=await f.call('/catalog-snapshot?pageSize=50&v='+encodeURIComponent(version),f.cookies.sa);assert.equal(revoked.status,200);assert.notEqual(revoked.data.version,version);assert.notEqual(revoked.data.unchanged,true);assert.equal((await f.call('/inventory/lookup?q='+sku,f.cookies.sa)).data.products[0].incoming.qty,0);
 assert.deepEqual(await f.db.select().from(productStock),before,'projection không ghi lại tồn toàn hệ thống');
});

test('Lịch sử/thẻ kho giữ lượng/tồn; metadata và search chứng từ ngoài scope không rò rỉ',async()=>{
 const f=await setupEarly(),sku='031106000',now=new Date().toISOString();await f.db.insert(products).values({sku,name:'Ly',unit:'Cái',updatedAt:now});await f.db.insert(warehouses).values({id:'hist-wh',name:'Kho lịch sử',kind:'stock'});
 await f.db.update(suppliers).set({saleAdminBrand:null}).where(eq(suppliers.id,'b'));
 await f.db.insert(supplierReceipts).values({id:'hist-receipt',shipmentId:'b1',receiptNo:'PNH-PRIVATE',warehouse:'Kho lịch sử',receivedDate:'2026-11-23',clientKey:'hist-receipt-key',requestHash:'test',receivedBy:'mgr',createdAt:now});
 await postMoves(f.db,'mgr',[{sku,warehouseId:'hist-wh',qty:1,kind:'opening',refType:'opening',refId:'hist-open'}]);
 await postMoves(f.db,'mgr',[{sku,warehouseId:'hist-wh',qty:5,kind:'receipt',refType:'supplier_receipt',refId:'hist-receipt',refNo:'PO-PRIVATE',note:'NCC b bí mật'}]);
 await recordMovements(f.db,[{refKey:'hist-b',sku,name:'Ly',kind:'purchase',qty:5,unit:'Cái',unitPrice:100,partner:'NCC b',refCode:'PO-PRIVATE',link:'#/purchases/b1',note:'NCC b bí mật',occurredAt:now}]);
 for(const cookie of [f.cookies.emp,f.cookies.sa]){const h=await f.call('/products/'+sku+'/history',cookie);assert.equal(h.status,200);assert.equal(h.data.history[0].qty,5);for(const key of ['refCode','link','partner','note'])assert.equal(h.data.history[0][key],'',key);
 const ledger=await f.call('/stock-moves?warehouseId=hist-wh',cookie);assert.equal(ledger.status,200);assert.equal(ledger.data.moves.find((r:any)=>r.refType==='supplier_receipt').balanceAfter,6);for(const key of ['refNo','note','link'])assert.equal(ledger.data.moves.find((r:any)=>r.refType==='supplier_receipt')[key],'',key);assert.equal((await f.call('/stock-moves?warehouseId=hist-wh&q=PO-PRIVATE',cookie)).data.total,0);}
 const mgr=await f.call('/stock-moves?warehouseId=hist-wh&q=PO-PRIVATE',f.cookies.mgr);assert.equal(mgr.data.total,1);assert.equal(mgr.data.moves[0].link,'#/purchases/b1');
 assert.equal((await f.call('/products/'+sku+'/documents?kind=purchases',f.cookies.emp)).status,403);const docs=await f.call('/products/'+sku+'/documents?kind=purchases',f.cookies.sa);assert.equal(docs.status,200);assert.ok(!JSON.stringify(docs.data).includes('PO-b1'));
});

import {purchaseLinksForOrder,type Member} from '../../src/modules/suppliers/api/purchase-store.ts';
import {purchaseSuppliers} from '../../src/modules/suppliers/api/customer-purchase-suppliers.ts';
import {supplierOrderSources} from '../../src/modules/suppliers/schema.ts';
import {salesOrders} from '../../src/modules/sales/schema.ts';
test('Liên kết đơn/khách và chứng từ sản phẩm không vượt scope; early trộn bị loại trước count',async()=>{
 const f=await setupEarly(),sku='031106000',now=new Date().toISOString();await f.db.insert(products).values({sku,name:'Ly',unit:'Cái',updatedAt:now});await f.db.update(suppliers).set({saleAdminBrand:null}).where(eq(suppliers.id,'b'));
 await f.db.insert(salesOrders).values({id:'linked-sale',orderNo:'DH-LINK',quoteType:'HRC',customerName:'Khách liên kết',ownerId:'emp',createdBy:'emp',orderDate:'2026-11-23',status:'confirmed',holdsStock:false,createdAt:now,updatedAt:now});
 await f.db.insert(supplierOrderSources).values(['a1','b1'].map(id=>({id:'src-'+id,shipmentId:id,lineId:'line-'+id,sourceType:'order' as const,sourceId:'linked-sale',sourceNo:'DH-LINK',sku,quantity:1,createdAt:now})));
 assert.deepEqual(await purchaseLinksForOrder(f.db,sale as Member,{id:'linked-sale',quoteId:null}),[]);assert.deepEqual((await purchaseLinksForOrder(f.db,sa as Member,{id:'linked-sale',quoteId:null})).map(r=>r.id),['a1']);
 assert.equal((await purchaseSuppliers(f.db,sale as Member,['linked-sale'])).size,0);assert.deepEqual([...await purchaseSuppliers(f.db,sa as Member,['linked-sale'])].flatMap(([,names])=>names),['NCC a']);
 const mixed=await f.call('/purchase-early-requests',f.cookies.mgr,'POST',{clientKey:crypto.randomUUID(),pickupDate:'2026-11-24',lines:[{sku,quantity:16000}]});assert.equal(mixed.status,201,JSON.stringify(mixed.data));
 const docs=await f.call('/products/'+sku+'/documents?kind=early',f.cookies.sa);assert.equal(docs.status,200,JSON.stringify(docs.data));assert.equal(docs.data.total,0);assert.deepEqual(docs.data.rows,[]);
 const overview=await f.call('/products/'+sku+'/overview',f.cookies.emp);assert.equal(overview.status,200);assert.ok(overview.data.documents.every((r:any)=>!['purchases','receipts','early'].includes(r.kind)));
});
