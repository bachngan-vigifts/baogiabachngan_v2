import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { setup } from './pos-fixture.ts';
import { employees } from '../../src/modules/staff/schema.ts';
import { salesOrders, salesOrderLines, paymentSchedules, customerPayments } from '../../src/modules/sales/schema.ts';
export async function setupCrmReturns(){
 const f=await setup();await f.db.update(employees).set({positionId:'sale'}).where(eq(employees.id,'emp'));
 const seed=async(id:string,paid=2186125,ownerId='emp')=>{
  const at=new Date().toISOString();await f.db.insert(salesOrders).values({id,orderNo:'DH-'+id,channel:'crm',quoteType:'B2B',status:'delivered',customerName:'Khách trả hàng',ownerId,createdBy:ownerId,orderDate:'2026-10-14',subtotal:4048380,tax:323870,total:4372250,createdAt:at,updatedAt:at,invoiceNo:'0002026',invoiceStatus:'issued'});
  await f.db.insert(salesOrderLines).values([{id:id+'-a',orderId:id,lineNo:1,sku:'09566',name:'Bộ đồ ăn 09 sản phẩm Jasmine Thạch Vân',unit:'Bộ',qty:2,deliveredQty:2,unitPrice:741150,amount:1482300,taxRate:8},{id:id+'-b',orderId:id,lineNo:2,sku:'22566',name:'Bộ đồ ăn 22 sản phẩm Jasmine Thạch Vân',unit:'Bộ',qty:2,deliveredQty:2,unitPrice:1283040,amount:2566080,taxRate:8}]);
  await f.db.insert(paymentSchedules).values({id:'schedule-'+id,orderId:id,kind:'balance',amount:4372250,dueDate:'2026-10-15',createdAt:at});
  if(paid)await f.db.insert(customerPayments).values({id:'paid-'+id,orderId:id,amount:paid,paidAt:'2026-10-14',method:'transfer',createdBy:'mgr',createdAt:at});
 };
 const ok=(r:any,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};
 const create=async(id:string,lines:any[],extra:any={})=>{const body={key:crypto.randomUUID(),warehouseId:'pos-wh',reason:'Khách trả hàng',lines,...extra};return{body,data:ok(await f.call('/orders/'+id+'/returns',f.emp,'POST',body),201)};};
 const receive=async(id:string,returnId:string)=>{ok(await f.call(`/orders/${id}/returns/${returnId}/approve`,f.mgr,'POST',{}));return ok(await f.call(`/orders/${id}/returns/${returnId}/receive`,f.emp,'POST',{confirmed:true}));};
 return{...f,seed,ok,create,receive};
}
