import {and,asc,eq,sql} from 'drizzle-orm';
import {auditLogs} from '../../../core/db/schema.ts';
import {AppError} from '../../../core/errors.ts';
import {json,type Router} from '../../../core/http/router.ts';
import type {SessionState,StaffEnv} from '../../staff/api/auth-routes.ts';
import {webStoreOrders as web} from '../pos-schema.ts';
import {webOrderAttention} from '../domain/web-order-attention.ts';
import {allowedPosRegisters} from './pos-register-scope.ts';
import {posPermission} from './pos-store.ts';
const CONTACT='web-order-contacted';
const handled=()=>sql`exists(select 1 from ${auditLogs} where ${auditLogs.entityType}='web-store-order' and ${auditLogs.entityId}=${web.id} and ${auditLogs.module}='sales' and ${auditLogs.action} in ('web-order-contacted','web-order-edit','web-order-confirm','web-order-cancel'))`;
// Read only operational flags, never original cart snapshots or images.
const flags=sql<string>`jsonb_build_object('revision',${web.crmEditSnapshot}::jsonb->'revision','confirmationStartedAt',${web.crmEditSnapshot}::jsonb->'confirmationStartedAt','ghnAttemptedAt',${web.crmEditSnapshot}::jsonb->'ghnAttemptedAt')::text`;
export function registerWebOrderAttention(router:Router<StaffEnv>){
 router.get('/pos/web-orders/attention',async c=>{
  const m=(c.state.session as SessionState).member;posPermission(m);
  const scope=await allowedPosRegisters(c),registerId=c.url.searchParams.get('registerId')||scope.regs[0]?.id||'';
  if(!scope.ids.has(registerId))throw new AppError(403,'Bạn không được xem đơn của cửa hàng này.');
  const now=Date.now();
  const rows=await c.env.db.select({id:web.id,orderNo:web.orderNo,customerName:web.customerName,phone:web.phone,source:web.source,orderedAt:web.orderedAt,status:web.status,ghnStatus:web.ghnStatus,ghnOrderCode:web.ghnOrderCode,stockStatus:web.stockStatus,crmEditSnapshot:flags}).from(web)
   .where(and(eq(web.registerId,registerId),eq(web.ghnOrderCode,''),eq(web.ghnStatus,''),sql`not (${handled()})`,sql`lower(regexp_replace(${web.status},'^wc-','','i')) not in ('completed','cancelled','refunded','failed','trash','packing','packed','shipped','out-for-delivery','delivery','delivering','lnl-delivered','lnl-returning','lnl-returned','lnl-awaiting-pickup','lnl-pickup','lnl-awaiting-del','lnl-delivery-failed','lnl-del-failed')`))
   .orderBy(asc(web.orderedAt),asc(web.id));
  const eligible=rows.flatMap(o=>{const a=webOrderAttention(o,now);return a.eligible?[{id:o.id,orderNo:o.orderNo,customerName:o.customerName,phone:o.phone,source:o.source,orderedAt:o.orderedAt,ageMinutes:a.ageMinutes}]:[];})
   .sort((a,b)=>b.ageMinutes!-a.ageMinutes!||a.id.localeCompare(b.id));
  return json({registerId,serverNow:new Date(now).toISOString(),count:eligible.length,orders:eligible.slice(0,50)});
 },'business');
 router.post('/pos/web-orders/:id/contact',async c=>{
  const m=(c.state.session as SessionState).member;posPermission(m);
  const result=await c.env.db.transaction(async tx=>{
   const [order]=await tx.select().from(web).where(eq(web.id,c.params.id!)).for('update');
   if(!order)throw new AppError(404,'Không tìm thấy đơn website.');
   const scope=await allowedPosRegisters(c,tx);if(!scope.ids.has(order.registerId))throw new AppError(403,'Bạn không được thao tác đơn của cửa hàng này.');
   const [prior]=await tx.select({at:auditLogs.createdAt}).from(auditLogs).where(and(eq(auditLogs.entityType,'web-store-order'),eq(auditLogs.entityId,order.id),eq(auditLogs.module,'sales'),eq(auditLogs.action,CONTACT))).limit(1);
   if(prior)return{contactedAt:prior.at,replayed:true};
   if(!webOrderAttention(order).eligible)throw new AppError(409,'Đơn chưa quá 30 phút hoặc đã được xử lý. Tải lại danh sách nhắc nhở.');
   const [other]=await tx.select({id:web.id}).from(web).where(and(eq(web.id,order.id),handled())).limit(1);
   if(other)throw new AppError(409,'Đơn đã được người khác xử lý. Tải lại danh sách.');
   const at=new Date().toISOString();
   await tx.insert(auditLogs).values({id:crypto.randomUUID(),actorId:m.id,module:'sales',action:CONTACT,entityType:'web-store-order',entityId:order.id,data:JSON.stringify({orderNo:order.orderNo,registerId:order.registerId}),createdAt:at});
   return{contactedAt:at,replayed:false};
  });
  return json(result);
 },'business');
}
