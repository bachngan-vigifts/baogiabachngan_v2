import {and,eq,inArray,isNull,or} from 'drizzle-orm';
import type {StaffEnv,SessionState} from '../../staff/api/auth-routes.ts';
import {salesOrders} from '../../sales/schema.ts';
import {incomingShipments,supplierOrderSources} from '../../suppliers/schema.ts';
import {purchaseScope} from '../../suppliers/api/purchase-store.ts';

export const purchaseSupplierKey=(orderId:string,sku:string)=>JSON.stringify([orderId,sku.trim().toUpperCase()]);

/** Only explicit order/quote source links, scoped to visible confirmed sales orders and purchasing access. */
export async function purchaseSuppliers(db:StaffEnv['db'],me:SessionState['member'],orderIds:string[]){
 const result=new Map<string,string[]>();
 if(!orderIds.length)return result;
 const rows=await db.selectDistinct({orderId:salesOrders.id,sku:supplierOrderSources.sku,name:incomingShipments.supplierName})
  .from(supplierOrderSources).innerJoin(incomingShipments,eq(incomingShipments.id,supplierOrderSources.shipmentId))
  .innerJoin(salesOrders,or(
   and(eq(supplierOrderSources.sourceType,'order'),eq(supplierOrderSources.sourceId,salesOrders.id)),
   and(eq(supplierOrderSources.sourceType,'quote'),eq(supplierOrderSources.sourceId,salesOrders.quoteId))))
  .where(and(inArray(salesOrders.id,orderIds),purchaseScope(me),isNull(incomingShipments.cancelledAt)));
 for(const row of rows){
  const name=row.name.trim();if(!name||!row.sku.trim())continue;
  const key=purchaseSupplierKey(row.orderId,row.sku),names=result.get(key)||[];
  if(!names.includes(name))names.push(name);result.set(key,names);
 }
 return result;
}
