import {and,eq,inArray,sql,type SQLWrapper} from 'drizzle-orm';
import type {StaffEnv} from '../../staff/api/auth-routes.ts';
import {supplierReceipts,supplierGoodsReturns,incomingShipments} from '../schema.ts';
import {purchaseScope,type Member} from './purchase-store.ts';
/** Resolvers never authorize an unscoped commercial link. */
export async function supplierReceiptStockLinks(db:StaffEnv['db'],ids:readonly string[],m?:Member){
 if(!m||!ids.length)return new Map<string,string>();
 const rows=await db.select({id:supplierReceipts.id,shipmentId:supplierReceipts.shipmentId}).from(supplierReceipts).innerJoin(incomingShipments,eq(incomingShipments.id,supplierReceipts.shipmentId)).where(and(inArray(supplierReceipts.id,[...ids]),purchaseScope(m)));
 return new Map(rows.map(r=>[r.id,'#/purchases/'+encodeURIComponent(r.shipmentId)]));
}
export async function supplierReturnStockLinks(db:StaffEnv['db'],ids:readonly string[],m?:Member){
 if(!m||!ids.length)return new Map<string,string>();
 const rows=await db.select({id:supplierGoodsReturns.id,shipmentId:supplierGoodsReturns.shipmentId}).from(supplierGoodsReturns).innerJoin(incomingShipments,eq(incomingShipments.id,supplierGoodsReturns.shipmentId)).where(and(inArray(supplierGoodsReturns.id,[...ids]),purchaseScope(m)));
 return new Map(rows.map(r=>[r.id,'#/purchases/'+encodeURIComponent(r.shipmentId)]));
}
/** Used before search/count/pagination: private refNo/note cannot act as a search oracle. */
export function supplierStockRefScope(m:Member,refType:SQLWrapper,refId:SQLWrapper){
 return sql`(${refType} not in ('supplier_receipt','supplier_return') or
 (${refType}='supplier_receipt' and exists(select 1 from ${supplierReceipts} join ${incomingShipments} on ${incomingShipments.id}=${supplierReceipts.shipmentId} where ${supplierReceipts.id}=split_part(${refId},'#',1) and ${purchaseScope(m)})) or
 (${refType}='supplier_return' and exists(select 1 from ${supplierGoodsReturns} join ${incomingShipments} on ${incomingShipments.id}=${supplierGoodsReturns.shipmentId} where ${supplierGoodsReturns.id}=split_part(${refId},'#',1) and ${purchaseScope(m)})))`;
}
