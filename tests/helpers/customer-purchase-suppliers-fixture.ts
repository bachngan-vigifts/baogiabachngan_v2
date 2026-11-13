import {setup} from './pos-fixture.ts';
import {eq} from 'drizzle-orm';
import {positions} from '../../src/modules/staff/schema.ts';
import {customers,customerStaff} from '../../src/modules/customers/schema.ts';
import {quotations} from '../../src/modules/quotes/schema.ts';
import {salesOrders,salesOrderLines,salesContracts} from '../../src/modules/sales/schema.ts';
import {suppliers,incomingShipments,incomingShipmentLines,supplierOrderSources} from '../../src/modules/suppliers/schema.ts';

export async function customerPurchaseSuppliersFixture(){
 const f=await setup(),now='2026-11-13T00:00:00.000Z',id='supplier-history-customer';
 await f.db.update(positions).set({dataScope:'own'}).where(eq(positions.id,'sales-lock'));
 const customerDefaults={contact:'',phone:'',email:'',address:'',search:'',sourceVersion:0,syncedAt:'',createdAt:now};
 await f.db.insert(customers).values({...customerDefaults,id,name:'Khách lịch sử mua kiểm thử'});
 await f.db.insert(customers).values({...customerDefaults,id:'history-other-customer',name:'Khách khác'});
 await f.db.insert(customerStaff).values({customerId:id,memberId:'emp',role:'owner',createdBy:'mgr',createdAt:now});
 for(const q of ['q-history','q-unrelated'])await f.db.insert(quotations).values({id:q,creatorId:'emp',quoteNo:q,quoteType:'B2B',customer:'Khách kiểm thử',data:JSON.stringify({type:'B2B',rows:[],vat:0}),createdAt:now,updatedAt:now});
 for(const [orderId,status,quoteId,ownerId] of [['h-one','confirmed','q-history','emp'],['h-two','confirmed',null,'emp'],['h-draft','draft',null,'emp'],['h-cancelled','cancelled',null,'emp'],['h-hidden','confirmed','q-unrelated','cashier2']] as const){
  await f.db.insert(salesOrders).values({id:orderId,orderNo:orderId,quoteId,quoteType:'B2B',customerId:orderId==='h-hidden'?'history-other-customer':id,customerName:'Khách kiểm thử',ownerId,createdBy:ownerId,orderDate:'2026-11-11',status,createdAt:now,updatedAt:now,total:8000000});
  await f.db.insert(salesOrderLines).values({id:orderId+'-line',orderId,lineNo:1,sku:'TUIGIAY',name:'Túi giấy',unit:'Cái',qty:800,unitPrice:10000,amount:8000000});
 }
 await f.db.insert(salesContracts).values({id:'history-contract',orderId:'h-two',contractNo:'11-01/HĐKT/BN-FIXTURE',legalEntity:'BN',status:'signed',value:8000000,createdBy:'emp',createdAt:now,updatedAt:now});
 await f.db.insert(salesOrderLines).values({id:'no-supplier-line',orderId:'h-one',lineNo:2,sku:'KHAC',name:'Hàng chưa liên kết NCC',unit:'Cái',qty:1,unitPrice:20,amount:20});
 const add=async(key:string,name:string,type:'order'|'quote',sourceId:string,sku='TUIGIAY',opts:{pending?:boolean,cancelled?:boolean}={})=>{
  await f.db.insert(suppliers).values({id:key,name,nameKey:key,createdBy:'mgr',createdAt:now,updatedAt:now});
  await f.db.insert(incomingShipments).values({id:key,ticketNumber:key,source:'supplier-order',supplierId:key,supplierName:name,warehouse:'Kho kiểm thử',approvalStatus:opts.pending?'pending':'approved',cancelledAt:opts.cancelled?now:null,createdBy:'mgr',createdAt:now,updatedAt:now});
  await f.db.insert(incomingShipmentLines).values({id:key+'-line',shipmentId:key,lineNo:1,sku,name:'Hàng',quantity:800});
  await f.db.insert(supplierOrderSources).values({id:key+'-source',shipmentId:key,lineId:key+'-line',sourceType:type,sourceId,sku,quantity:800,createdAt:now});
 };
 await add('ncc-a','NCC Bao bì A','order','h-one');
 await add('ncc-a-duplicate','NCC Bao bì A','order','h-two');
 await add('ncc-b','NCC B <Kiểm thử>','quote','q-history',' tuigiay ');
 await add('ncc-pending','NCC Nháp riêng Manager','order','h-one','TUIGIAY',{pending:true});
 await add('ncc-cancelled','NCC Đơn mua đã hủy','order','h-one','TUIGIAY',{cancelled:true});
 await add('ncc-wrong-sku','NCC Sai mã','order','h-one','TUIGIAY-OTHER');
 await add('ncc-wrong-source','NCC Sai nguồn','quote','q-unrelated');
 await add('ncc-draft-order','NCC Đơn bán nháp','order','h-draft');
 await add('ncc-cancelled-sale','NCC Đơn bán hủy','order','h-cancelled');
 await add('ncc-hidden','NCC Đơn bán ngoài quyền','order','h-hidden');
 return {...f,id};
}
