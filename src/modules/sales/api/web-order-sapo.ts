import {sendPosClawPayload} from './pos-sapo.ts';
import {and,eq,sql} from 'drizzle-orm';
import {AppError} from '../../../core/errors.ts';
import {json,type RouteContext} from '../../../core/http/router.ts';
import type {StaffEnv,SessionState} from '../../staff/api/auth-routes.ts';
import {employees,staffSapoLinks} from '../../staff/schema.ts';
import {warehouses} from '../../catalog/schema.ts';
import {sapoOrderStatuses} from '../../integrations/schema.ts';
import {posRegisters,webStoreOrders as web} from '../pos-schema.ts';
import {webDocumentDetail} from './web-order-documents.ts';
import {webSapoPayload,webSapoReference} from '../domain/web-sapo.ts';
import {webSapoFields,webSapoMetadata,webSapoStatuses} from './web-sapo-status.ts';
import {assertSapoClawReady,sapoPushRequired} from './sapo-push.ts';
import {webOrderBucket} from '../domain/web-order-outcome.ts';
import {canSalesCreateSapo} from '../domain/order-sapo-access.ts';
type Ctx=RouteContext<StaffEnv>;
const member=(c:Ctx)=>(c.state.session as SessionState).member;
async function source(c:Ctx){
 const id=c.params.id?.slice(4)||c.url.searchParams.get('orderId')?.slice(4)||'';
 // Load through the same store/data scope as the list/detail before reading private source data.
 const detail=await webDocumentDetail(c,id);
 const [row]=await c.env.db.select({order:web,branch:{id:posRegisters.id,name:posRegisters.name,warehouseId:warehouses.id,warehouseName:warehouses.name}}).from(web).innerJoin(posRegisters,eq(posRegisters.id,web.registerId)).innerJoin(warehouses,eq(warehouses.id,posRegisters.warehouseId)).where(eq(web.id,id)).limit(1);
 if(!row)throw new AppError(404,'Không tìm thấy đơn website.');
 const [actor]=await c.env.db.select({name:employees.name,phone:employees.phone,email:employees.email,sapoId:staffSapoLinks.sapoId}).from(employees).leftJoin(staffSapoLinks,eq(staffSapoLinks.memberId,employees.id)).where(eq(employees.id,member(c).id)).limit(1);
 return {...row,detail,actor:actor??{name:member(c).name,phone:''}};
}
export async function previewWebSapo(c:Ctx){
 const r=await source(c),built=webSapoPayload(r.order,r.branch,r.actor),status=(await webSapoStatuses(c.env.db,[r.order])).get(built.code),fields=webSapoFields(c.env,r.order,member(c),r.detail.document.status,status);
 if(fields.sapoOrderUrl)return {pushed:{code:fields.sapoOrderCode,url:fields.sapoOrderUrl},required:sapoPushRequired(c)};
 const problems=[...built.problems];
 if(!canSalesCreateSapo(member(c),r.detail.document))problems.push('Đơn đã huỷ hoặc tài khoản không được tạo đơn Sapo.');
 if(fields.sapoPending)problems.push(fields.sapoMessage||'Đã gửi yêu cầu. Chờ Sapo đối soát và trả liên kết trước khi tạo lại.');
 if(fields.sapoSourceChanged)problems.push('Đơn website đã đổi sau lần gửi Sapo. Cần đối soát mã tham chiếu trước khi gửi lại.');
 if(c.env.sapoOrderMode!=='n8n'&&sapoPushRequired(c))problems.push('Chưa cấu hình n8n tạo đơn Sapo.');
 return {connected:true,viaClaw:true,required:sapoPushRequired(c),code:built.code,owner:r.actor.name,account:null,locations:[],problems};
}
export async function createWebSapo(c:Ctx){
 const initial=await source(c),code=webSapoReference(initial.order),me=member(c),now=new Date().toISOString(),requestId=crypto.randomUUID();
 if(initial.detail.document.sapoOrderUrl)return {sapo:{status:'existing',id:initial.detail.document.sapoOrderId,code:initial.detail.document.sapoOrderCode,url:initial.detail.document.sapoOrderUrl}};
 if(!sapoPushRequired(c))throw new AppError(409,'Đẩy đơn sang Sapo đang tắt trên hệ thống.','SAPO_PUSH_DISABLED');
 if(initial.detail.document.status==='cancelled')throw new AppError(409,'Đơn website đã huỷ/hoàn, không tạo đơn Sapo.','ORDER_CANCELLED');
 if(!canSalesCreateSapo(me,initial.detail.document))throw new AppError(403,'Tài khoản không được tạo đơn Sapo.','SAPO_PUSH_FORBIDDEN');
 assertSapoClawReady(c);
 const claimed=await c.env.db.transaction(async tx=>{
  const [order]=await tx.select().from(web).where(eq(web.id,initial.order.id)).for('update');if(!order)throw new AppError(404,'Không tìm thấy đơn website.');
  if(order.registerId!==initial.order.registerId)throw new AppError(409,'Cửa hàng của đơn đã đổi. Tải lại đơn trước khi tạo Sapo.');
  if(webOrderBucket(order.status,order.ghnStatus)==='cancelled')throw new AppError(409,'Đơn website đã huỷ/hoàn.','ORDER_CANCELLED');
  const [old]=await tx.select().from(sapoOrderStatuses).where(eq(sapoOrderStatuses.quoteNumber,code)).for('update');
  const fields=webSapoFields(c.env,order,me,initial.detail.document.status,old),meta=webSapoMetadata(old);
  if(fields.sapoOrderUrl)return {existing:{status:'existing',id:fields.sapoOrderId,code:fields.sapoOrderCode,url:fields.sapoOrderUrl}};
  if(fields.sapoPending)return {existing:{status:'updating',code,message:fields.sapoMessage||'Yêu cầu đã được gửi; đang chờ Sapo trả kết quả.'}};
  const built=webSapoPayload(order,initial.branch,initial.actor);
  if(old&&(!meta||meta.webOrderId!==order.id||meta.source!==order.source||meta.externalId!==order.externalId))throw new AppError(409,'Mã tham chiếu Sapo đã được dùng; cần đối soát trước khi tạo.');
  if(meta&&meta.inputHash!==built.inputHash)throw new AppError(409,'Đơn website đã đổi sau lần gửi Sapo. Cần đối soát trước khi gửi lại.','SAPO_WEB_CHANGED');
  if(built.problems.length)throw new AppError(400,built.problems.join(' '),'SAPO_PUSH_INVALID');
  const data={kind:'web-sapo',webOrderId:order.id,source:order.source,externalId:order.externalId,inputHash:built.inputHash,requestId,requestedBy:me.id,requestedAt:now};
  const state={quoteNumber:code,status:'requesting',message:'Đang giao yêu cầu tạo đơn nháp Sapo.',payloadJson:JSON.stringify(data),updatedAt:now};
  await tx.insert(sapoOrderStatuses).values(state).onConflictDoUpdate({target:sapoOrderStatuses.quoteNumber,set:state});
  return {built};
 });
 if(claimed.existing)return {sapo:claimed.existing};
 try{
  const result=await sendPosClawPayload(c.env,claimed.built!.payload,'web');
  await c.env.db.update(sapoOrderStatuses).set({status:'updating',message:'Đã giao Claw tạo đơn Sapo. Đang chờ liên kết.',updatedAt:new Date().toISOString()}).where(and(eq(sapoOrderStatuses.quoteNumber,code),eq(sapoOrderStatuses.status,'requesting'),sql`${sapoOrderStatuses.payloadJson}::jsonb->>'requestId'=${requestId}`));
  const state=(await webSapoStatuses(c.env.db,[initial.order])).get(code),fields=webSapoFields(c.env,initial.order,me,initial.detail.document.status,state);
  if(state?.status==='failed')throw new AppError(502,state.message||'Claw chưa tạo được đơn Sapo.','SAPO_WEBHOOK_FAILED');
  return {sapo:fields.sapoOrderUrl?{status:'existing',id:fields.sapoOrderId,code:fields.sapoOrderCode,url:fields.sapoOrderUrl}:{status:'updating',code,runId:result.runId??null,message:'Đã giao Claw tạo đơn Sapo cho đơn website. Đang chờ liên kết.'}};
 }catch(error){
  // A timeout is not evidence that no order was created. Only the authenticated callback resolves the attempt.
  await c.env.db.update(sapoOrderStatuses).set({status:'unknown',message:'Chưa rõ kết quả gửi. Chờ callback Sapo trước khi tạo lại để tránh trùng đơn.',updatedAt:new Date().toISOString()}).where(and(eq(sapoOrderStatuses.quoteNumber,code),eq(sapoOrderStatuses.status,'requesting'),sql`${sapoOrderStatuses.payloadJson}::jsonb->>'requestId'=${requestId}`));
  const current=(await webSapoStatuses(c.env.db,[initial.order])).get(code);if(current?.sapoOrderId){const fields=webSapoFields(c.env,initial.order,me,initial.detail.document.status,current);return {sapo:{status:'existing',id:fields.sapoOrderId,code:fields.sapoOrderCode,url:fields.sapoOrderUrl}};}throw error;
 }
}
/** Called only by the token-protected existing Sapo result endpoint. Never creates CRM orders/stock/cash. */
export async function recordWebSapoResult(c:Ctx,body:Record<string,unknown>,code:string){
 if(!code.startsWith('WEB_'))return null;
 const [state]=await c.env.db.select().from(sapoOrderStatuses).where(eq(sapoOrderStatuses.quoteNumber,code));const meta=webSapoMetadata(state);if(!meta)return null;
 const status=String(body.status||''),id=body.sapo_order_id==null?'':String(body.sapo_order_id),successful=['created','created_after_error','existing'].includes(status)&&!!id;
 if(!successful&&!['failed','error','dry_run','dry_run_error'].includes(status))return json({ok:true,ignored:true});
 if(successful&&(!/^[1-9]\d{0,79}$/.test(id)))throw new AppError(400,'ID Sapo không hợp lệ.');
 return c.env.db.transaction(async tx=>{
  const [o]=await tx.select().from(web).where(eq(web.id,meta.webOrderId)).for('update');
  if(!o||o.source!==meta.source||o.externalId!==meta.externalId||webSapoReference(o)!==code)throw new AppError(404,'Không tìm thấy đơn website tương ứng.');
  const [current]=await tx.select().from(sapoOrderStatuses).where(eq(sapoOrderStatuses.quoteNumber,code)).for('update');
  if(current?.sapoOrderId){if(successful&&current.sapoOrderId!==id)throw new AppError(409,'Đơn website đã liên kết Sapo khác; không tự ghi đè.');return json({ok:true,orderId:'web:'+o.id,existing:true});}
  const stamp=new Date().toISOString();await tx.update(sapoOrderStatuses).set({status:successful?'created':'failed',...(successful?{sapoOrderId:id,sapoOrderCode:typeof body.sapo_order_code==='string'?body.sapo_order_code.slice(0,160):code}:{}),message:successful?'Đã có liên kết Sapo.':'Claw báo chưa tạo được đơn. Kiểm tra rồi có thể gửi lại cùng mã tham chiếu.',updatedAt:stamp}).where(eq(sapoOrderStatuses.quoteNumber,code));
  await tx.update(web).set({updatedAt:stamp}).where(eq(web.id,o.id));
  return json({ok:true,orderId:'web:'+o.id});
 });
}
