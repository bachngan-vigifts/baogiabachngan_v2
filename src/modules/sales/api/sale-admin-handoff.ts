import {and,asc,eq,sql,type SQL} from 'drizzle-orm';
import {AppError} from '../../../core/errors.ts';
import {auditLogs} from '../../../core/db/schema.ts';
import {json,readJson,type Router,type RouteContext} from '../../../core/http/router.ts';
import type {SessionState,StaffEnv} from '../../staff/api/auth-routes.ts';
import {employees,positionPermissions} from '../../staff/schema.ts';
import {can} from '../../staff/domain/permissions.ts';
import {isSupportAssignee} from '../../quotes/domain/access.ts';
import {quotations} from '../../quotes/schema.ts';
import {salesOrders} from '../schema.ts';
type Member=SessionState['member'];
type Ctx=RouteContext<StaffEnv>;
type Db=StaffEnv['db']|Parameters<Parameters<StaffEnv['db']['transaction']>[0]>[0];
const me=(c:Ctx)=>(c.state.session as SessionState).member;
export function supportOrderScope(m:{id:string;role:string;positionId?:string|null}){
 return m.role==='employee'&&m.positionId==='sale-admin'?sql`exists(select 1 from ${quotations} where ${quotations.id}=${salesOrders.quoteId} and ${quotations.supportAssigneeId}=${m.id})`:undefined;
}
export async function handlesQuote(db:Db,m:{id:string;role:string;positionId?:string|null},quoteId:string|null){
 if(!quoteId||m.role!=='employee'||m.positionId!=='sale-admin')return false;
 const [q]=await db.select({supportAssigneeId:quotations.supportAssigneeId}).from(quotations).where(eq(quotations.id,quoteId)).limit(1);
 return !!q&&isSupportAssignee(m,q);
}
const mayAssign=(m:Member,o:typeof salesOrders.$inferSelect,q:typeof quotations.$inferSelect)=>o.status!=='cancelled'&&(m.role==='manager'||m.role==='employee'&&[o.ownerId,o.createdBy,q.creatorId].includes(m.id));
async function candidates(db:Db){
 const [people,grants]=await Promise.all([
  db.select({id:employees.id,name:employees.name}).from(employees).where(and(eq(employees.role,'employee'),eq(employees.positionId,'sale-admin'),eq(employees.active,true))).orderBy(asc(employees.name)).limit(200),
  db.select({permission:positionPermissions.permission}).from(positionPermissions).where(eq(positionPermissions.positionId,'sale-admin')),
 ]);
 const perms=grants.map(g=>g.permission),eligible=['page.quotes','page.orders','page.contracts'].every(key=>can({role:'employee',positionId:'sale-admin',perms},key));
 return people.map(p=>({...p,eligible,reason:eligible?'':'Chức vụ chưa đủ quyền trang Báo giá, Đơn hàng và HĐKT.'}));
}
export function registerSaleAdminHandoff(router:Router<StaffEnv>,scope:(m:Member)=>SQL|undefined){
 const load=async(c:Ctx,db:Db)=>{
  const [o]=await db.select().from(salesOrders).where(and(eq(salesOrders.id,c.params.id!),scope(me(c)))).limit(1);
  if(!o||o.channel!=='crm'||!o.quoteId)throw new AppError(404,'Không tìm thấy hồ sơ CRM để giao Sale Admin.');
  return o;
 };
 router.get('/orders/:id/sale-admin-assignment',async c=>{
  const o=await load(c,c.env.db),[q]=await c.env.db.select().from(quotations).where(eq(quotations.id,o.quoteId!)).limit(1);
  if(!q)throw new AppError(404,'Không tìm thấy báo giá nguồn.');
  const [assigned]=q.supportAssigneeId?await c.env.db.select({name:employees.name}).from(employees).where(eq(employees.id,q.supportAssigneeId)).limit(1):[];
  return json({orderId:o.id,quoteId:q.id,quoteNo:q.quoteNo,assigneeId:q.supportAssigneeId,assigneeName:assigned?.name||'',revision:q.supportAssignmentRevision,canAssign:mayAssign(me(c),o,q),candidates:await candidates(c.env.db)});
 },'business');
 router.post('/orders/:id/sale-admin-assignment',async c=>{
  const body=await readJson(c.req,2000),id=body.assigneeId,revision=body.revision;
  if(!(id===null||typeof id==='string'&&id.length>0&&id.length<=100)||typeof revision!=='number'||!Number.isSafeInteger(revision)||revision<0)throw new AppError(400,'Chọn Sale Admin hoặc Không giao và tải lại phiên bản giao việc.');
  const result=await c.env.db.transaction(async tx=>{
   const o=await load(c,tx),[q]=await tx.select().from(quotations).where(eq(quotations.id,o.quoteId!)).limit(1).for('update');
   if(!q||!mayAssign(me(c),o,q))throw new AppError(403,'Chỉ Manager hoặc người tạo/phụ trách hồ sơ được giao Sale Admin.');
   if(q.supportAssignmentRevision!==revision){
    if(q.supportAssigneeId===id)return {assigneeId:id,revision:q.supportAssignmentRevision,replayed:true};
    throw new AppError(409,'Hồ sơ vừa được giao lại. Tải lại để kiểm tra người nhận.');
   }
   if(id){
    const eligible=(await candidates(tx)).some(p=>p.id===id&&p.eligible);
    if(!eligible)throw new AppError(400,'Người nhận phải là Sale Admin đang hoạt động và đủ quyền truy cập hồ sơ.');
   }
   const at=new Date().toISOString(),next=q.supportAssignmentRevision+1;
   await tx.update(quotations).set({supportAssigneeId:id,supportAssignmentRevision:next,updatedAt:at}).where(eq(quotations.id,q.id));
   await tx.insert(auditLogs).values({id:crypto.randomUUID(),actorId:me(c).id,module:'sales-handoff',action:id?'assign':'unassign',entityType:'quotation',entityId:q.id,data:JSON.stringify({orderId:o.id,from:q.supportAssigneeId,to:id,revision:next}),createdAt:at});
   return {assigneeId:id,revision:next,replayed:false};
  });return json(result);
 },'business');
}
