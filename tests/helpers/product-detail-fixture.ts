import {setupEarly} from './purchase-early-fixture.ts';
import {products,warehouses,pricePolicies,productPrices,productStock,productBarcodes} from '../../src/modules/catalog/schema.ts';
import {salesOrders,salesOrderLines,salesContracts} from '../../src/modules/sales/schema.ts';
import {quotations,quoteLines} from '../../src/modules/quotes/schema.ts';
import {supplierReceipts,supplierReceiptLines} from '../../src/modules/suppliers/schema.ts';
import {posReturns,posReturnLines} from '../../src/modules/sales/return-schema.ts';
export async function productDetailFixture(){
 const f=await setupEarly(),now='2026-10-27T05:00:00Z',sku='031106000';
 await f.db.insert(products).values({sku,name:'Bộ trà Jasmine · sản phẩm kiểm thử',brand:'Minh Long',unit:'Bộ',pattern:'Jasmine',perCarton:12,cartonWeight:5,cartonLength:40,cartonWidth:30,cartonHeight:25,taxable:true,taxIn:8,taxOut:8,updatedAt:now});
 await f.db.insert(warehouses).values([{id:'public',name:'KHO VIGIFTS',kind:'stock'},{id:'private',name:'Kho riêng',kind:'stock',stockPrivate:true}]);
 await f.db.insert(productStock).values([{sku,warehouseId:'public',quantity:10,updatedAt:now},{sku,warehouseId:'private',quantity:999,updatedAt:now}]);
 await f.db.insert(pricePolicies).values({id:'retail',name:'Giá lẻ + VAT'});await f.db.insert(productPrices).values({sku,policyId:'retail',price:108});await f.db.insert(productBarcodes).values({sku,barcode:'8931234567890'});
 for(const [id,owner,status,qty] of [['own','emp','confirmed',2],['contract','mgr','confirmed',3],['secret','mgr','confirmed',4],['draft','emp','draft',99],['cancelled','emp','cancelled',99]] as const){
  await f.db.insert(salesOrders).values({id,orderNo:'DH-'+id,quoteType:'HRC',customerName:'Khách '+id,ownerId:owner,createdBy:owner,orderDate:'2026-10-27',status,subtotal:qty*100,total:qty*100,createdAt:now,updatedAt:now,holdsStock:false});
  await f.db.insert(salesOrderLines).values({id:'ol-'+id,orderId:id,lineNo:1,sku,name:'Sản phẩm',unit:'Bộ',qty,unitPrice:100,amount:qty*100,deliveredQty:status==='confirmed'?qty:0});
 }
 await f.db.insert(salesContracts).values({id:'contract-id',orderId:'contract',contractNo:'HĐKT-fixture',legalEntity:'VG',status:'signed',signedDate:'2026-10-27',value:300,createdBy:'mgr',createdAt:now,updatedAt:now});
 // More than one history page: source queries must retain all rows and ignore the 20-movement cache.
 for(let i=0;i<28;i++){
  const id='quote-'+i,owner=i===27?'mgr':'emp',row={sku,name:'Bộ trà',qty:2,price:100,costPrice:60};
  await f.db.insert(quotations).values({id,creatorId:owner,quoteNo:'BG-'+String(i).padStart(3,'0'),quoteType:'HRC',customer:'Khách báo giá '+i,approvalStatus:'approved',data:JSON.stringify({type:'HRC',vat:8,rows:[row]}),createdAt:now,updatedAt:now});
  await f.db.insert(quoteLines).values({id:'ql-'+i,quoteId:id,lineNo:1,...row});
 }
 // A quote for another SKU must never match a substring search of this one.
 await f.db.insert(quotations).values({id:'other-sku',creatorId:'mgr',quoteNo:'BG-OTHER',quoteType:'HRC',customer:'Ngoài phạm vi',data:JSON.stringify({type:'HRC',rows:[{sku:sku+'X',qty:1,price:100}]}),createdAt:now,updatedAt:now});
 await f.db.insert(quoteLines).values({id:'ql-other',quoteId:'other-sku',lineNo:1,sku:sku+'X',name:'Mã khác',qty:1,price:100});
 await f.db.insert(supplierReceipts).values([{id:'receipt',receiptNo:'PNH-active',shipmentId:'a1',receivedDate:'2026-10-27',receivedBy:'mgr',warehouse:'KHO VIGIFTS',clientKey:'fixture-active',createSapo:false,createdAt:now},{id:'receipt-void',receiptNo:'PNH-void',shipmentId:'a1',receivedDate:'2026-10-27',receivedBy:'mgr',warehouse:'KHO VIGIFTS',clientKey:'fixture-void',createSapo:false,cancelledAt:now,cancelledBy:'mgr',cancelReason:'Fixture',createdAt:now}]);
 await f.db.insert(supplierReceiptLines).values([{receiptId:'receipt',lineId:'line-a1',sku,goodQty:5,damagedQty:1},{receiptId:'receipt-void',lineId:'line-a1',sku,goodQty:100,damagedQty:0}]);
 await f.db.insert(posReturns).values({id:'return',returnNo:'TH-fixture',source:'crm',orderId:'own',warehouseId:'public',requestContext:'after_delivery',kind:'return',status:'completed',reason:'Fixture',subtotal:100,total:100,sourceSnapshot:'{}',requestKey:'fixture-return',createdBy:'mgr',createdAt:now,updatedAt:now,creditEffectiveAt:now,receivedAt:now});
 await f.db.insert(posReturnLines).values({id:'return-line',returnId:'return',orderLineId:'ol-own',sku,name:'Bộ trà',unit:'Bộ',requestedQty:1,receivedQty:1,restockQty:1,disposition:'restock',subtotal:100,tax:0,total:100});
 return{...f,sku};
}
