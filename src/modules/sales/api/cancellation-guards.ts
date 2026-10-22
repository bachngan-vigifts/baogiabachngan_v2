import {and,eq,inArray} from 'drizzle-orm';
import {AppError} from '../../../core/errors.ts';
import {auditLogs} from '../../../core/db/schema.ts';
import {deliveries} from '../schema.ts';
import type {CashDb} from './cash-store.ts';

/** A delivery label can be reset; its committed dispatch history must not be erased by that reset. */
export async function assertNotDispatched(db:CashDb,orderId:string,deliveryId?:string) {
  const rows=await db.select({id:deliveries.id,no:deliveries.deliveryNo,status:deliveries.status,tracking:deliveries.trackingStatus}).from(deliveries)
    .where(and(eq(deliveries.orderId,orderId),deliveryId?eq(deliveries.id,deliveryId):undefined));
  if(!rows.length)return;
  const logs=await db.select({action:auditLogs.action,data:auditLogs.data}).from(auditLogs).where(and(eq(auditLogs.entityType,'deliveries'),inArray(auditLogs.entityId,rows.map(d=>d.id))));
  const history=logs.some(l=>{if(l.action==='dispatch')return true;try{return ['in_transit','delivered'].includes(JSON.parse(l.data).body?.status);}catch{return false;}});
  const physicallyOut=rows.some(d=>['in_transit','failed','delivered'].includes(d.status)||['picked','storing','transporting','sorting','delivering','returning','returned','return_transporting','return_sorting','waiting_to_return','lost','damage'].includes(d.tracking));
  if(history||physicallyOut)throw new AppError(409,'Chuyến đã hoặc đang rời kho. Xử lý thu hồi và xác nhận nhận hàng thực tế; không huỷ thẳng để tự hoàn tồn.','RETURN_REQUIRED');
}
export async function recordDispatch(db:CashDb,orderId:string,deliveryId:string,actorId:string,status:string) {
  await db.insert(auditLogs).values({id:crypto.randomUUID(),actorId,module:'sales',action:'dispatch',entityType:'deliveries',entityId:deliveryId,data:JSON.stringify({orderId,status}),createdAt:new Date().toISOString()});
}
