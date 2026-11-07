import {returnPurpose} from '../domain/crm-return-purpose.ts';
import {eq,asc} from 'drizzle-orm';
import type {AnyDb} from '../../../core/db/client.ts';
import {warehouses} from '../../catalog/schema.ts';
import {posReturns,posReturnLines} from '../return-schema.ts';
/** Read-only projection; requested, physically received and sellable restock remain distinct. */
export async function orderReturnSummary(db:AnyDb,orderId:string){
 const rows=await db.select({r:posReturns,l:posReturnLines,warehouseName:warehouses.name}).from(posReturns).innerJoin(posReturnLines,eq(posReturnLines.returnId,posReturns.id)).leftJoin(warehouses,eq(warehouses.id,posReturns.warehouseId)).where(eq(posReturns.orderId,orderId)).orderBy(asc(posReturns.createdAt),asc(posReturnLines.id));
 const byLine=new Map<string,{returnedQty:number;restockedQty:number;pendingReturnQty:number;redeliveryQty:number}>();
 const requests=new Map<string,{id:string;returnNo:string;status:string;receivedAt:string|null;warehouseName:string;basisKind:string|null;purpose:'credit'|'redelivery';lines:{orderLineId:string;sku:string;unit:string;receivedQty:number;restockQty:number;requestedQty:number;disposition:string}[]}>();
 for(const {r,l,warehouseName}of rows){
  const received=!!r.receivedAt,pending=!received&&['pending','approved'].includes(r.status);
  const n=byLine.get(l.orderLineId)||{returnedQty:0,restockedQty:0,pendingReturnQty:0,redeliveryQty:0};
  if(received){n.returnedQty+=l.receivedQty;if(returnPurpose(r.sourceSnapshot)==='redelivery')n.redeliveryQty+=l.receivedQty;n.restockedQty+=l.restockQty;}else if(pending)n.pendingReturnQty+=l.requestedQty;
  byLine.set(l.orderLineId,n);
  let basisKind:string|null=null;if(r.approvedBy&&r.receivedAt){try{const kind=JSON.parse(r.sourceSnapshot)?.stockBasis?.kind;if(['pre_opening','adjustment'].includes(kind))basisKind=kind;}catch{}}
  const item=requests.get(r.id)||{id:r.id,returnNo:r.returnNo,status:r.status,receivedAt:r.receivedAt,warehouseName:warehouseName||'',basisKind,purpose:returnPurpose(r.sourceSnapshot),lines:[]};
  item.lines.push({orderLineId:l.orderLineId,sku:l.sku,unit:l.unit,receivedQty:received?l.receivedQty:0,restockQty:received?l.restockQty:0,requestedQty:l.requestedQty,disposition:l.disposition});requests.set(r.id,item);
 }
 return{byLine,requests:[...requests.values()],receivedQty:[...byLine.values()].reduce((n,l)=>n+l.returnedQty,0),restockedQty:[...byLine.values()].reduce((n,l)=>n+l.restockedQty,0)};
}
