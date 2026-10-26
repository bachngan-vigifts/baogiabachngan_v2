import {and,asc,desc,eq,inArray} from 'drizzle-orm';
import {AppError} from '../../../core/errors.ts';
import {auditLogs} from '../../../core/db/schema.ts';
import {sha256Hex} from '../../staff/domain/session.ts';
import {purchaseEarlyRequests as requests,purchaseEarlyRequestLines as lines,purchaseEarlyRequestAllocations as allocations} from '../early-request-schema.ts';
import {incomingShipmentLines,incomingShipments,supplierOrderEvents} from '../schema.ts';
import type {Db} from './purchase-store.ts';
type Tx=Parameters<Parameters<Db['transaction']>[0]>[0];
/** Header lock serializes edit/delete/split; purchase locks serialize with receiving. */
async function snapshot(tx:Tx,id:string){
 const [request]=await tx.select().from(requests).where(eq(requests.id,id)).for('update');
 if(!request)throw new AppError(404,'Không tìm thấy phiếu xin hàng.');
 const saved=await tx.select().from(lines).where(eq(lines.requestId,id)).orderBy(asc(lines.id)).for('update');
 const details=saved.length?await tx.select({a:allocations,line:lines,order:incomingShipments}).from(allocations)
  .innerJoin(lines,eq(lines.id,allocations.requestLineId)).innerJoin(incomingShipmentLines,eq(incomingShipmentLines.id,allocations.purchaseLineId))
  .innerJoin(incomingShipments,eq(incomingShipments.id,incomingShipmentLines.shipmentId)).where(eq(lines.requestId,id)):[];
 const orderIds=[...new Set(details.map(d=>d.order.id))].sort();
 if(orderIds.length)await tx.select({id:incomingShipments.id}).from(incomingShipments).where(inArray(incomingShipments.id,orderIds)).orderBy(asc(incomingShipments.id)).for('update');
 const events=orderIds.length?await tx.select({data:supplierOrderEvents.data}).from(supplierOrderEvents).where(and(inArray(supplierOrderEvents.shipmentId,orderIds),eq(supplierOrderEvents.action,'receive'))):[];
 for(const e of events){let data;try{data=JSON.parse(e.data);}catch{continue;}if(data.earlyRequestId===id)throw new AppError(409,'Phiếu đã phát sinh nhận hàng; không được xoá hoặc tách. Giữ phiếu để đối soát kho.');}
 return {request,saved,details};
}
async function record(tx:Tx,id:string,actorId:string,action:string,data:unknown){await tx.insert(auditLogs).values({id:crypto.randomUUID(),actorId,module:'suppliers',action,entityType:'purchase-early-requests',entityId:id,data:JSON.stringify(data),createdAt:new Date().toISOString()});}
export async function splitResult(tx:Tx|Db,id:string){
 const [entry]=await tx.select({data:auditLogs.data}).from(auditLogs).where(and(eq(auditLogs.entityType,'purchase-early-requests'),eq(auditLogs.entityId,id),eq(auditLogs.action,'early-request-split'))).orderBy(desc(auditLogs.createdAt)).limit(1);
 return entry?JSON.parse(entry.data).childIds as string[]:null;
}
export async function deleteEarlyRequest(tx:Tx,id:string,actorId:string){
 const s=await snapshot(tx,id);if(s.request.deletedAt)return {replayed:true};
 await tx.update(requests).set({deletedAt:new Date().toISOString(),deletedBy:actorId}).where(eq(requests.id,id));
 await record(tx,id,actorId,'early-request-delete',s);return {replayed:false};
}
export async function splitEarlyRequest(tx:Tx,id:string,actorId:string){
 const s=await snapshot(tx,id);
 if(s.request.deletedAt){const existing=await splitResult(tx,id);if(existing)return existing;throw new AppError(409,'Phiếu đã xoá, không tạo lại.');}
 const groups=new Map<string,typeof s.details>();
 for(const d of s.details){const ref=d.order.supplierInternalOrderNumber?.trim()||'',key=JSON.stringify([d.a.supplierId,ref?'ncc':'crm',ref?ref.toLocaleLowerCase('vi'):d.order.id]);const group=groups.get(key)||[];group.push(d);groups.set(key,group);}
 if(groups.size<=1)return [id];
 const childIds:string[]=[],now=new Date().toISOString();
 for(const [key,group] of groups){
  const childId=crypto.randomUUID(),scope=JSON.parse(s.request.scope),orderSources:Record<string,{orderNo:string;supplierOrderNo:string;quantity:number}[]>={};
  for(const d of group){const source=orderSources[d.line.sku]||[];const old=source.find(o=>o.orderNo===d.order.ticketNumber);if(old)old.quantity+=d.a.quantity;else source.push({orderNo:d.order.ticketNumber,supplierOrderNo:d.order.supplierInternalOrderNumber||'',quantity:d.a.quantity});orderSources[d.line.sku]=source;}
  scope.orderSources=JSON.stringify(orderSources);scope.splitFrom=id;scope.supplierId=group[0]!.a.supplierId;
  await tx.insert(requests).values({id:childId,clientKey:'split_'+id+'_'+sha256Hex(key).slice(0,16),payloadHash:sha256Hex(JSON.stringify(group.map(d=>d.a.id))),createdBy:s.request.createdBy,createdAt:now,status:s.request.status,pickupDate:s.request.pickupDate,scope:JSON.stringify(scope),updatedAt:now});
  const lineIds=[...new Set(group.map(d=>d.line.id))];
  for(const [index,lineId] of lineIds.entries()){
   const own=group.filter(d=>d.line.id===lineId),source=own[0]!.line,newLineId=crypto.randomUUID();
   await tx.insert(lines).values({...source,id:newLineId,requestId:childId,lineNo:index+1,quantity:own.reduce((sum,d)=>sum+d.a.quantity,0)});
   await tx.insert(allocations).values(own.map(d=>({...d.a,id:crypto.randomUUID(),requestLineId:newLineId})));
  }
  childIds.push(childId);await record(tx,childId,actorId,'early-request-split-child',{parentId:id,key});
 }
 await tx.update(requests).set({deletedAt:now,deletedBy:actorId}).where(eq(requests.id,id));
 await record(tx,id,actorId,'early-request-split',{childIds,snapshot:s});return childIds;
}
