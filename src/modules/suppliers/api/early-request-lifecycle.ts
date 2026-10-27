import {and,asc,desc,eq,inArray,isNull} from 'drizzle-orm';
import {AppError} from '../../../core/errors.ts';
import {auditLogs} from '../../../core/db/schema.ts';
import {sha256Hex} from '../../staff/domain/session.ts';
import {purchaseEarlyRequests as requests,purchaseEarlyRequestLines as lines,purchaseEarlyRequestAllocations as allocations} from '../early-request-schema.ts';
import {incomingShipmentLines,incomingShipments,supplierOrderEvents,supplierReceipts} from '../schema.ts';
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
 const events=orderIds.length?await tx.select({data:supplierOrderEvents.data,orderId:supplierOrderEvents.shipmentId}).from(supplierOrderEvents).where(and(inArray(supplierOrderEvents.shipmentId,orderIds),eq(supplierOrderEvents.action,'receive'))):[];
 const parsed=events.flatMap(e=>{try{const data=JSON.parse(e.data);return data.earlyRequestId===id?[{...e,receiptId:data.receiptId}]:[];}catch{return [];}});
 const receiptIds=parsed.flatMap(e=>typeof e.receiptId==='string'?[e.receiptId]:[]);
 const receipts=receiptIds.length?await tx.select({id:supplierReceipts.id,cancelledAt:supplierReceipts.cancelledAt}).from(supplierReceipts).where(inArray(supplierReceipts.id,receiptIds)):[];
 const cancelled=new Set(receipts.filter(r=>r.cancelledAt).map(r=>r.id)),receivedOrders=new Set<string>();
 // A completed receipt reversal releases the request. Missing/legacy provenance stays protected.
 for(const e of parsed)if(!cancelled.has(e.receiptId))receivedOrders.add(e.orderId);
 return {request,saved,details,receivedOrders};
}
async function record(tx:Tx,id:string,actorId:string,action:string,data:unknown){await tx.insert(auditLogs).values({id:crypto.randomUUID(),actorId,module:'suppliers',action,entityType:'purchase-early-requests',entityId:id,data:JSON.stringify(data,(_,value)=>value instanceof Set?[...value]:value),createdAt:new Date().toISOString()});}
export async function splitResult(tx:Tx|Db,id:string){
 const [entry]=await tx.select({data:auditLogs.data}).from(auditLogs).where(and(eq(auditLogs.entityType,'purchase-early-requests'),eq(auditLogs.entityId,id),eq(auditLogs.action,'early-request-split'))).orderBy(desc(auditLogs.createdAt)).limit(1);
 return entry?JSON.parse(entry.data).childIds as string[]:null;
}
export async function deleteEarlyRequest(tx:Tx,id:string,actorId:string){
 const s=await snapshot(tx,id);if(s.receivedOrders.size)throw new AppError(409,'Phiếu đã phát sinh nhận hàng; không được xoá. Giữ phiếu để đối soát kho.');if(s.request.deletedAt)return {replayed:true};
 await tx.update(requests).set({deletedAt:new Date().toISOString(),deletedBy:actorId}).where(eq(requests.id,id));
 await record(tx,id,actorId,'early-request-delete',s);return {replayed:false};
}
export async function splitEarlyRequest(tx:Tx,id:string,actorId:string){
 const s=await snapshot(tx,id);
 const existing=await splitResult(tx,id);if(existing)return existing;
 if(s.request.deletedAt){throw new AppError(409,'Phiếu đã xoá, không tạo lại.');}
 const groups=new Map<string,typeof s.details>();
 for(const d of s.details){const ref=d.order.supplierInternalOrderNumber?.trim()||'',key=JSON.stringify([d.a.supplierId,ref?'ncc':'crm',ref?ref.toLocaleLowerCase('vi'):d.order.id]);const group=groups.get(key)||[];group.push(d);groups.set(key,group);}
 if(groups.size<=1){if(s.receivedOrders.size)throw new AppError(409,'Phiếu đã phát sinh nhận hàng; không còn nhóm chưa nhận để tách.');return [id];}
 const retained=[...groups.values()].flatMap(group=>group.some(d=>s.receivedOrders.has(d.order.id))?group:[]);
 if(retained.length===s.details.length)throw new AppError(409,'Các phiếu NCC đều đã phát sinh nhận hàng; giữ nguyên để đối soát.');
 const childIds:string[]=retained.length?[id]:[],now=new Date().toISOString();
 for(const [key,group] of groups){
  if(group.some(d=>s.receivedOrders.has(d.order.id)))continue;
  const childId=crypto.randomUUID(),scope=JSON.parse(s.request.scope),orderSources:Record<string,{orderNo:string;supplierOrderNo:string;quantity:number}[]>={};
  for(const d of group){const source=orderSources[d.line.sku]||[];const old=source.find(o=>o.orderNo===d.order.ticketNumber);if(old)old.quantity+=d.a.quantity;else source.push({orderNo:d.order.ticketNumber,supplierOrderNo:d.order.supplierInternalOrderNumber||'',quantity:d.a.quantity});orderSources[d.line.sku]=source;}
  scope.orderSources=JSON.stringify(orderSources);scope.splitFrom=id;scope.supplierId=group[0]!.a.supplierId;
  await tx.insert(requests).values({id:childId,clientKey:'split_'+id+'_'+sha256Hex(key).slice(0,16),payloadHash:sha256Hex(JSON.stringify(group.map(d=>d.a.id))),createdBy:s.request.createdBy,createdAt:now,status:s.request.status,pickupDate:s.request.pickupDate,scope:JSON.stringify(scope),updatedAt:now});
  const lineIds=[...new Set(group.map(d=>d.line.id))];
  for(const [index,lineId] of lineIds.entries()){
   const own=group.filter(d=>d.line.id===lineId),source=own[0]!.line,newLineId=crypto.randomUUID();
   await tx.insert(lines).values({...source,id:newLineId,requestId:childId,lineNo:index+1,quantity:own.reduce((sum,d)=>sum+d.a.quantity,0)});
   if(retained.length)await tx.update(allocations).set({requestLineId:newLineId}).where(inArray(allocations.id,own.map(d=>d.a.id)));
   else await tx.insert(allocations).values(own.map(d=>({...d.a,id:crypto.randomUUID(),requestLineId:newLineId})));
  }
  childIds.push(childId);await record(tx,childId,actorId,'early-request-split-child',{parentId:id,key});
 }
 if(retained.length){
  // Received allocations, original line IDs and receipt provenance stay on the original ID.
  for(const line of s.saved){const own=retained.filter(d=>d.line.id===line.id);
   if(own.length)await tx.update(lines).set({quantity:own.reduce((sum,d)=>sum+d.a.quantity,0)}).where(eq(lines.id,line.id));
   else await tx.delete(lines).where(eq(lines.id,line.id));
  }
  const scope=JSON.parse(s.request.scope),orderSources:Record<string,{orderNo:string;supplierOrderNo:string;quantity:number}[]>={};
  for(const d of retained)(orderSources[d.line.sku]??=[]).push({orderNo:d.order.ticketNumber,supplierOrderNo:d.order.supplierInternalOrderNumber||'',quantity:d.a.quantity});
  scope.orderSources=JSON.stringify(orderSources);
  await tx.update(requests).set({scope:JSON.stringify(scope),updatedAt:now,revision:s.request.revision+1}).where(eq(requests.id,id));
 }else await tx.update(requests).set({deletedAt:now,deletedBy:actorId}).where(eq(requests.id,id));
 await record(tx,id,actorId,'early-request-split',{childIds,snapshot:s});return childIds;
}

/** Cancel exactly one displayed supplier/reference slip, atomically preserving its siblings. */
export async function cancelEarlySlip(tx:Tx,id:string,allocationIds:string[],actorId:string):Promise<{replayed:boolean;cancelledRequestId:string;remainingRequestIds:string[]}>{
 const original=await snapshot(tx,id);
 if(original.request.status!=='submitted')throw new AppError(409,'Chỉ huỷ từng phiếu NCC sau khi đã gửi.');
 const key=(d:typeof original.details[number])=>JSON.stringify([d.a.supplierId,d.order.supplierInternalOrderNumber?.trim()? 'ncc':'crm',d.order.supplierInternalOrderNumber?.trim().toLocaleLowerCase('vi')||d.order.id]);
 const family=await splitResult(tx,id);
 if(family){const owners=await tx.select({id:lines.requestId}).from(lines).innerJoin(allocations,eq(allocations.requestLineId,lines.id)).where(and(inArray(lines.requestId,family),inArray(allocations.id,allocationIds)));
  const ids=[...new Set(owners.map(o=>o.id))];if(ids.length===1&&ids[0]!==id)return cancelEarlySlip(tx,ids[0]!,allocationIds,actorId);
 }
 const chosen=original.details.filter(d=>allocationIds.includes(d.a.id));
 if(chosen.length!==allocationIds.length||new Set(chosen.map(key)).size!==1)throw new AppError(409,'Phiếu NCC đã thay đổi. Tải lại trước khi huỷ.');
 const group=original.details.filter(d=>key(d)===key(chosen[0]!));
 if(group.length!==chosen.length)throw new AppError(400,'Phải chọn toàn bộ mã thuộc một phiếu NCC.');
 if(group.some(d=>original.receivedOrders.has(d.order.id)))throw new AppError(409,'Phiếu NCC này đã phát sinh nhận hàng; không được huỷ.');
 if(original.request.deletedAt&&!family)return deleteEarlyRequest(tx,id,actorId).then(result=>({...result,cancelledRequestId:id,remainingRequestIds:[]}));
 const ids=await splitEarlyRequest(tx,id,actorId);
 let target=id;
 if(ids.length>1){
  const targets=await tx.select({id:lines.requestId}).from(lines).innerJoin(allocations,eq(allocations.requestLineId,lines.id))
   .where(and(inArray(lines.requestId,ids),inArray(allocations.purchaseLineId,chosen.map(d=>d.a.purchaseLineId))));
  const matches=[...new Set(targets.map(t=>t.id))];
  if(matches.length!==1)throw new AppError(409,'Không đối chiếu được phiếu NCC cần huỷ.');target=matches[0]!;
 }
 const result=await deleteEarlyRequest(tx,target,actorId);
 if(!result.replayed)await record(tx,id,actorId,'early-request-cancel-slip',{targetId:target,allocationIds,supplierId:chosen[0]!.a.supplierId});
 const remaining=await tx.select({id:requests.id}).from(requests).where(and(inArray(requests.id,ids),isNull(requests.deletedAt)));
 return {...result,cancelledRequestId:target,remainingRequestIds:remaining.map(r=>r.id)};
}
