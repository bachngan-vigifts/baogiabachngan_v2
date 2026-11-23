import {isSupportAssignee} from '../domain/access.ts';
import {and,desc,eq,inArray,sql} from 'drizzle-orm';
import {alias} from 'drizzle-orm/pg-core';
import {auditLogs} from '../../../core/db/schema.ts';
import {AppError} from '../../../core/errors.ts';
import {json,readJson,type Router} from '../../../core/http/router.ts';
import type {SessionState,StaffEnv} from '../../staff/api/auth-routes.ts';
import {employees,positions} from '../../staff/schema.ts';
import {notify,notifyMany} from '../../notifications/api/routes.ts';
import {quotations} from '../schema.ts';
import {quotationPredicate} from './department-access.ts';

type Db=StaffEnv['db']|Parameters<Parameters<StaffEnv['db']['transaction']>[0]>[0];
type Quote=typeof quotations.$inferSelect;
type Member=SessionState['member'];
type Check=(tx:Parameters<Parameters<StaffEnv['db']['transaction']>[0]>[0],quote:Quote,member:Pick<Member,'id'|'role'>)=>Promise<void>;
const moduleName='quote-edit';
const entityType='quotation';
/** Append-only approval events use the existing indexed, private audit journal.
 * Permission is bound to quote revision + requester; a successful save retires it by advancing revision.
 * No timestamp ordering is used to decide whether a grant exists. */
export async function quoteEditState(db:Db,quote:Pick<Quote,'id'|'revision'|'approvalStatus'|'supportAssigneeId'>,member:Pick<Member,'id'|'role'|'positionId'>){
 const events=quote.approvalStatus==='approved'?await db.select().from(auditLogs).where(and(eq(auditLogs.entityType,entityType),eq(auditLogs.entityId,quote.id),eq(auditLogs.module,moduleName),sql`${auditLogs.data}::jsonb->>'revision'=${String(quote.revision)}`)).orderBy(desc(auditLogs.createdAt),desc(auditLogs.id)):[];
 const decisions=new Map(events.filter(e=>['approved','rejected'].includes(e.action)).map(e=>[JSON.parse(e.data).requestId,e]));
 const requests=events.filter(e=>e.action==='requested').map(e=>{
  const decision=decisions.get(e.id),data=JSON.parse(e.data);
  return{id:e.id,requesterId:e.actorId!,reason:String(data.reason||''),at:e.createdAt,status:decision?.action??'pending',decisionReason:decision?String(JSON.parse(decision.data).reason||''):''};
 });
 const own=requests.filter(r=>r.requesterId===member.id);
 const mine=own.find(r=>r.status==='approved')??own.find(r=>r.status==='pending')??own[0]??null;
 const pending=member.role==='manager'?requests.filter(r=>r.status==='pending'):[];
 const names=pending.length?await db.select({id:employees.id,name:employees.name}).from(employees).where(inArray(employees.id,[...new Set(pending.map(r=>r.requesterId))])):[];
 return{mine,pending:pending.map(r=>({...r,requesterName:names.find(m=>m.id===r.requesterId)?.name||'Nhân viên'})),canEditApproved:member.role==='employee'&&(mine?.status==='approved'||isSupportAssignee(member,quote))};
}

/** Manager-only edit requests appear under the existing Báo giá approval group. Stale revisions disappear. */
export async function pendingQuoteEdits(db:Db,countOnly=false){
 const r=alias(auditLogs,'quote_edit_requests');
 const where=and(eq(r.module,moduleName),eq(r.entityType,entityType),eq(r.action,'requested'),eq(quotations.approvalStatus,'approved'),
  sql`${r.data}::jsonb->>'revision'=${quotations.revision}::text`,
  sql`not exists(select 1 from ${auditLogs} where ${auditLogs.module}=${moduleName} and ${auditLogs.entityType}=${entityType} and ${auditLogs.entityId}=${r.entityId} and ${auditLogs.action} in ('approved','rejected') and ${auditLogs.data}::jsonb->>'requestId'=${r.id})`);
 if(countOnly){const [row]=await db.select({n:sql<number>`count(*)`.mapWith(Number)}).from(r).innerJoin(quotations,eq(quotations.id,r.entityId)).where(where);return{count:row?.n??0,items:[]};}
 const rows=await db.select({id:r.id,quoteId:quotations.id,quoteNo:quotations.quoteNo,at:r.createdAt,data:r.data,by:employees.name}).from(r)
  .innerJoin(quotations,eq(quotations.id,r.entityId)).leftJoin(employees,eq(employees.id,r.actorId)).where(where).orderBy(desc(r.createdAt)).limit(200);
 return{count:rows.length,items:rows.map(r=>({kind:'quote' as const,id:r.id,title:`Xin sửa báo giá ${r.quoteNo}`,sub:String(JSON.parse(r.data).reason||''),by:r.by||'',at:r.at,amount:null,link:`#/quotes/${encodeURIComponent(r.quoteId)}`}))};
}

export function registerQuoteEditRequests(router:Router<StaffEnv>,check:Check){
 router.post('/quotes/:id/edit-request',async c=>{
  const member=(c.state.session as SessionState).member,body=await readJson(c.req,4000);
  if(member.role!=='employee')throw new AppError(403,'Chỉ nhân viên được gửi yêu cầu sửa báo giá.');
  const reason=(typeof body.reason==='string'?body.reason:'').trim();
  if(reason.length<5||reason.length>500||!Number.isSafeInteger(body.revision))throw new AppError(400,'Nhập lý do sửa từ 5–500 ký tự và phiên bản báo giá.');
  const result=await c.env.db.transaction(async tx=>{
   const [quote]=await tx.select().from(quotations).where(and(eq(quotations.id,c.params.id!),quotationPredicate(member,true))).for('update');
   if(!quote)throw new AppError(404,'Không tìm thấy báo giá có quyền sửa.');
   if(quote.revision!==body.revision||quote.approvalStatus!=='approved')throw new AppError(409,'Báo giá đã đổi phiên bản hoặc không còn ở trạng thái đã duyệt. Tải lại báo giá.');
   await check(tx,quote,member);
   const state=await quoteEditState(tx,quote,member);
   if(state.mine&&['pending','approved'].includes(state.mine.status))return{id:state.mine.id,replayed:true,quoteNo:quote.quoteNo};
   const id=crypto.randomUUID();
   await tx.insert(auditLogs).values({id,actorId:member.id,module:moduleName,action:'requested',entityType,entityId:quote.id,data:JSON.stringify({revision:quote.revision,reason}),createdAt:new Date().toISOString()});
   return{id,replayed:false,quoteNo:quote.quoteNo};
  });
  if(!result.replayed)await notifyMany(c.env,'managers',{eventType:'quote_edit_requested',title:'Xin phép sửa báo giá',body:`${member.name}: ${result.quoteNo} · ${reason}`,url:`/index.html#/quotes/${c.params.id}`,actorId:member.id,data:{quoteId:c.params.id,requestId:result.id}});
  return json(result);
 },'business');
 router.post('/quotes/:id/edit-request/:requestId/decision',async c=>{
  const member=(c.state.session as SessionState).member,body=await readJson(c.req,4000);
  if(member.role!=='manager')throw new AppError(403,'Chỉ Manager được cho phép sửa báo giá.');
  const decision=body.decision;
  if((decision!=='approved'&&decision!=='rejected')||!Number.isSafeInteger(body.revision))throw new AppError(400,'Chọn cho phép hoặc từ chối và đúng phiên bản.');
  const reason=(typeof body.reason==='string'?body.reason:'').trim();if(reason.length>500||(decision==='rejected'&&reason.length<5))throw new AppError(400,'Lý do từ chối từ 5–500 ký tự.');
  const result=await c.env.db.transaction(async tx=>{
   const [quote]=await tx.select().from(quotations).where(eq(quotations.id,c.params.id!)).for('update');
   if(!quote||quote.revision!==body.revision||quote.approvalStatus!=='approved')throw new AppError(409,'Báo giá đã đổi phiên bản. Tải lại trước khi xử lý.');
   const state=await quoteEditState(tx,quote,member),request=state.pending.find(r=>r.id===c.params.requestId);
   if(!request){
    const [existingDecision]=await tx.select().from(auditLogs).where(and(eq(auditLogs.module,moduleName),eq(auditLogs.entityType,entityType),eq(auditLogs.entityId,quote.id),eq(auditLogs.action,decision),sql`${auditLogs.data}::jsonb->>'requestId'=${c.params.requestId}`,sql`${auditLogs.data}::jsonb->>'revision'=${String(quote.revision)}`)).limit(1);
    if(existingDecision)return{replayed:true,requesterId:'',quoteNo:quote.quoteNo};
    throw new AppError(409,'Yêu cầu đã được xử lý hoặc không còn hợp lệ.');
   }
   const [requesterRow]=await tx.select({member:employees,dataScope:positions.dataScope,departmentId:positions.departmentId}).from(employees).leftJoin(positions,eq(positions.id,employees.positionId)).where(and(eq(employees.id,request.requesterId),eq(employees.active,true)));
   const requester=requesterRow?{...requesterRow.member,dataScope:requesterRow.dataScope,departmentId:requesterRow.departmentId}:null;
   if(decision==='approved'&&(!requester||requester.role!=='employee'))throw new AppError(409,'Nhân viên không còn hoạt động.');
   const editable=requester&&(await tx.select({id:quotations.id}).from(quotations).where(and(eq(quotations.id,quote.id),quotationPredicate(requester,true)))).length>0;
   if(decision==='approved'&&!editable)throw new AppError(409,'Nhân viên không còn quyền sửa báo giá này.');
   if(decision==='approved')await check(tx,quote,requester!);
   await tx.insert(auditLogs).values({id:crypto.randomUUID(),actorId:member.id,module:moduleName,action:decision,entityType,entityId:quote.id,data:JSON.stringify({revision:quote.revision,requestId:request.id,reason}),createdAt:new Date().toISOString()});
   return{replayed:false,requesterId:request.requesterId,quoteNo:quote.quoteNo};
  });
  if(!result.replayed)await notify(c.env,{eventType:'quote_edit_decided',title:decision==='approved'?'Được phép sửa báo giá':'Yêu cầu sửa báo giá bị từ chối',body:`${result.quoteNo}${reason?' · '+reason:''}`,targetMemberId:result.requesterId,actorId:member.id,url:`/index.html#/quotes/${c.params.id}`,data:{quoteId:c.params.id,requestId:c.params.requestId}});
  return json({ok:true,replayed:result.replayed});
 },'business');
}
