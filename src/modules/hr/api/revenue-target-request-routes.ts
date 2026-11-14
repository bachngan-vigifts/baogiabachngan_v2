import {and,asc,desc,eq,gte,inArray,lt,sql} from 'drizzle-orm';
import type {AnyDb} from '../../../core/db/client.ts';
import {auditLogs} from '../../../core/db/schema.ts';
import {payrollLock} from '../../../core/db/payroll-lock.ts';
import {AppError} from '../../../core/errors.ts';
import {json,readJson,type Router,type RouteContext} from '../../../core/http/router.ts';
import type {SessionState,StaffEnv} from '../../staff/api/auth-routes.ts';
import {employees} from '../../staff/schema.ts';
import {tracksSalesKpi} from '../../staff/domain/roles.ts';
import {sha256Hex} from '../../staff/domain/session.ts';
import {hrPayslips} from '../schema.ts';
import {hrRevenueTargets} from '../revenue-target-schema.ts';
import {hrRevenueTargetRequests,type RevenueTargetChange} from '../revenue-target-request-schema.ts';

type Ctx=RouteContext<StaffEnv>;
type RequestRow=typeof hrRevenueTargetRequests.$inferSelect;
const actor=(c:Ctx)=>(c.state.session as SessionState).member.id;
const yearOf=(v:unknown)=>{if(typeof v!=='string'||!/^\d{4}$/.test(v)||+v<2000||+v>2100)throw new AppError(400,'Năm phải từ 2000 đến 2100.');return v;};
const monthsOf=(year:string)=>Array.from({length:12},(_,i)=>year+'-'+String(i+1).padStart(2,'0'));
const amountOk=(v:unknown):v is number|null=>v===null||typeof v==='number'&&Number.isSafeInteger(v)&&v>0&&v<=1e13;
const reasonOf=(v:unknown)=>{if(typeof v!=='string'||v.trim().length<3||v.trim().length>500)throw new AppError(400,'Nhập lý do từ 3 đến 500 ký tự.');return v.trim();};
function storedChanges(row:RequestRow):RevenueTargetChange[]{
 const changes=row.changes,months=monthsOf(row.year),seen=new Set<string>();
 if(!Array.isArray(changes)||!changes.length||changes.length>12)throw new AppError(409,'Nội dung đăng ký không hợp lệ. Yêu cầu nhân viên gửi lại.');
 for(const c of changes){if(!c||!months.includes(c.month)||seen.has(c.month)||!amountOk(c.from)||!amountOk(c.to)||c.from===c.to)throw new AppError(409,'Nội dung đăng ký không hợp lệ. Yêu cầu nhân viên gửi lại.');seen.add(c.month);}
 return changes;
}
async function memberOf(db:AnyDb,id:string,lock=false){
 const query=db.select({id:employees.id,name:employees.name,positionId:employees.positionId,role:employees.role,active:employees.active,deletedAt:employees.deletedAt}).from(employees).where(eq(employees.id,id)).limit(1);
 const [m]=await(lock?query.for('update'):query);return m;
}
const isSale=(m:Awaited<ReturnType<typeof memberOf>>)=>!!m&&m.active&&m.deletedAt===null&&tracksSalesKpi(m.positionId)&&!['customer','supplier'].includes(m.role);
async function ownMember(db:AnyDb,id:string,lock=false){const m=await memberOf(db,id,lock);if(!isSale(m))throw new AppError(403,'Chỉ nhân viên Sale / Sale Admin được đăng ký chỉ tiêu của chính mình.');return m!;}
async function yearState(db:AnyDb,id:string,year:string){
 const next=String(+year+1)+'-01';
 const [entries,locks,history]=await Promise.all([
  db.select().from(hrRevenueTargets).where(and(eq(hrRevenueTargets.memberId,id),gte(hrRevenueTargets.month,year+'-01'),lt(hrRevenueTargets.month,next))).orderBy(asc(hrRevenueTargets.month)),
  db.select({month:hrPayslips.month}).from(hrPayslips).where(and(eq(hrPayslips.memberId,id),gte(hrPayslips.month,year+'-01'),lt(hrPayslips.month,next))).orderBy(asc(hrPayslips.month)),
  db.select().from(hrRevenueTargetRequests).where(and(eq(hrRevenueTargetRequests.memberId,id),eq(hrRevenueTargetRequests.year,year))).orderBy(desc(hrRevenueTargetRequests.submittedAt),desc(hrRevenueTargetRequests.id)).limit(20),
 ]);
 const months=monthsOf(year),map=new Map(entries.map(e=>[e.month,e.amount])),pending=history.find(r=>r.status==='pending')??null;
 return {year,months,values:Object.fromEntries(months.map(m=>[m,map.get(m)??null])) as Record<string,number|null>,lockedMonths:locks.map(l=>l.month),pending,history,
  version:sha256Hex(JSON.stringify({id,year,entries,locks,requests:history.map(r=>({id:r.id,status:r.status,revision:r.revision}))}))};
}
async function logRequest(db:AnyDb,actorId:string,row:RequestRow,action:string,note:string){await db.insert(auditLogs).values({id:crypto.randomUUID(),actorId,module:'hr',action,entityType:'hr-revenue-target-request',entityId:row.id,data:JSON.stringify({memberId:row.memberId,year:row.year,revision:row.revision,status:row.status,reason:note}),createdAt:new Date().toISOString()});}
async function requestOf(db:AnyDb,id:string,lock=false){const q=db.select().from(hrRevenueTargetRequests).where(eq(hrRevenueTargetRequests.id,id)).limit(1);const [r]=await(lock?q.for('update'):q);if(!r)throw new AppError(404,'Không tìm thấy đăng ký.');return r;}

export function registerRevenueTargetRequests(router:Router<StaffEnv>){
 const write=(fn:(c:Ctx)=>Promise<Response>)=>async(c:Ctx)=>c.env.db.transaction(async tx=>{await payrollLock(tx as AnyDb);return fn({...c,env:{...c.env,db:tx as AnyDb}});});
 router.get('/hr/revenue-target-requests/me/:year',async c=>{
  const year=yearOf(c.params.year),member=await ownMember(c.env.db,actor(c));return json({member: {id:member.id,name:member.name},...await yearState(c.env.db,member.id,year)});
 },'business');
 router.put('/hr/revenue-target-requests/me/:year',write(async c=>{
  const db=c.env.db,id=actor(c),year=yearOf(c.params.year),b=await readJson(c.req,12000);await ownMember(db,id,true);
  if(Object.keys(b).some(k=>!['version','values','reason'].includes(k)))throw new AppError(400,'Chỉ gửi đăng ký của chính mình.');
  const reason=reasonOf(b.reason),state=await yearState(db,id,year);
  if(typeof b.version!=='string'||b.version!==state.version)throw new AppError(409,'Đăng ký hoặc chỉ tiêu đã thay đổi. Tải lại trước khi gửi.','TARGET_REQUEST_CHANGED');
  const values=b.values as Record<string,unknown>;
  if(!values||typeof values!=='object'||Array.isArray(values)||Object.keys(values).length!==12||Object.keys(values).some(m=>!state.months.includes(m)))throw new AppError(400,'Gửi đủ 12 tháng trong năm đang chọn.');
  const changes:RevenueTargetChange[]=[];
  for(const month of state.months){const to=values[month];if(!amountOk(to))throw new AppError(400,'Chỉ tiêu phải là tiền nguyên lớn hơn 0; để trống nếu không đăng ký.');if(to===state.values[month])continue;if(state.lockedMonths.includes(month))throw new AppError(409,'Tháng '+month+' đã chốt lương, không thể đổi chỉ tiêu.');changes.push({month,from:state.values[month]!,to});}
  if(!changes.length)throw new AppError(400,'Chưa có chỉ tiêu thay đổi. Nếu muốn bỏ đăng ký đang chờ, bấm Rút đăng ký.');
  const now=new Date().toISOString(),prior=state.pending;
  const row:RequestRow={id:prior?.id??crypto.randomUUID(),memberId:id,year,changes,reason,status:'pending',revision:(prior?.revision??0)+1,submittedAt:now,resolvedBy:null,resolvedAt:null,resolutionNote:''};
  if(prior)await db.update(hrRevenueTargetRequests).set({changes,reason,revision:row.revision,submittedAt:now}).where(eq(hrRevenueTargetRequests.id,prior.id));else await db.insert(hrRevenueTargetRequests).values(row);
  await logRequest(db,id,row,prior?'hr-revenue-target-request-update':'hr-revenue-target-request-submit',reason);
  return json({ok:true,id:row.id,revision:row.revision,status:'pending'});
 }),'business');
 router.post('/hr/revenue-target-requests/me/:year/withdraw',write(async c=>{
  const db=c.env.db,id=actor(c),year=yearOf(c.params.year),b=await readJson(c.req,2000);await ownMember(db,id,true);const state=await yearState(db,id,year);
  if(Object.keys(b).some(k=>k!=='version'))throw new AppError(400,'Yêu cầu rút đăng ký không hợp lệ.');
  if(b.version!==state.version||!state.pending)throw new AppError(409,'Đăng ký đã thay đổi hoặc đã được xử lý. Tải lại để xem.');
  const row={...state.pending,status:'withdrawn' as const,revision:state.pending.revision+1,resolvedBy:id,resolvedAt:new Date().toISOString(),resolutionNote:'Nhân viên rút đăng ký'};
  await db.update(hrRevenueTargetRequests).set({status:row.status,revision:row.revision,resolvedBy:row.resolvedBy,resolvedAt:row.resolvedAt,resolutionNote:row.resolutionNote}).where(eq(hrRevenueTargetRequests.id,row.id));await logRequest(db,id,row,'hr-revenue-target-request-withdraw',row.resolutionNote);return json({ok:true});
 }),'business');
 router.get('/hr/revenue-target-requests',async c=>{
  const year=c.url.searchParams.get('year'),status=c.url.searchParams.get('status')||'pending';if(year)yearOf(year);if(!['pending','approved','rejected','withdrawn'].includes(status))throw new AppError(400,'Trạng thái không hợp lệ.');
  const rows=await c.env.db.select({request:hrRevenueTargetRequests,member:{id:employees.id,name:employees.name,positionId:employees.positionId}}).from(hrRevenueTargetRequests).innerJoin(employees,eq(employees.id,hrRevenueTargetRequests.memberId)).where(and(year?eq(hrRevenueTargetRequests.year,year):undefined,eq(hrRevenueTargetRequests.status,status as RequestRow['status']))).orderBy(desc(hrRevenueTargetRequests.submittedAt),desc(hrRevenueTargetRequests.id)).limit(200);
  return json({items:rows});
 },'admin');
 router.get('/hr/revenue-target-requests/:id',async c=>{
  const r=await requestOf(c.env.db,c.params.id!),member=await memberOf(c.env.db,r.memberId),state=await yearState(c.env.db,r.memberId,r.year),changes=storedChanges(r);
  const conflicts=changes.filter(x=>state.lockedMonths.includes(x.month)||state.values[x.month]!==x.from).map(x=>x.month);
  return json({request:r,member:member?{id:member.id,name:member.name,positionId:member.positionId}:null,current:state.values,lockedMonths:state.lockedMonths,conflicts,canApprove:r.status==='pending'&&isSale(member)&&!conflicts.length});
 },'admin');
 router.post('/hr/revenue-target-requests/:id/review',write(async c=>{
  const db=c.env.db,me=actor(c),b=await readJson(c.req,2000),r=await requestOf(db,c.params.id!,true);
  if(r.status!=='pending'||b.revision!==r.revision)throw new AppError(409,'Đăng ký đã thay đổi hoặc đã được xử lý. Tải lại trước khi duyệt.');
  if(!['approved','rejected'].includes(String(b.decision)))throw new AppError(400,'Chọn Duyệt hoặc Từ chối.');
  const note=b.decision==='rejected'?reasonOf(b.reason):typeof b.reason==='string'&&b.reason.trim()?reasonOf(b.reason):'Duyệt đăng ký chỉ tiêu của Sale';
  const now=new Date().toISOString();
  if(b.decision==='approved'){
   const m=await memberOf(db,r.memberId,true);if(!isSale(m))throw new AppError(409,'Nhân viên không còn ở chức vụ Sale / Sale Admin đang hoạt động. Chỉ có thể từ chối đăng ký này.');
   const state=await yearState(db,r.memberId,r.year),changes=storedChanges(r);
   if(changes.some(x=>state.lockedMonths.includes(x.month)))throw new AppError(409,'Có tháng đã chốt lương. Yêu cầu Sale điều chỉnh và gửi lại.');
   if(changes.some(x=>state.values[x.month]!==x.from))throw new AppError(409,'Chỉ tiêu hiện hành đã đổi từ khi đăng ký. Yêu cầu Sale tải lại và gửi lại.');
   const removed=changes.filter(x=>x.to===null).map(x=>x.month),puts=changes.flatMap(x=>x.to===null?[]:[{memberId:r.memberId,month:x.month,amount:x.to,updatedBy:me,updatedAt:now}]);
   if(removed.length)await db.delete(hrRevenueTargets).where(and(eq(hrRevenueTargets.memberId,r.memberId),inArray(hrRevenueTargets.month,removed)));
   if(puts.length){await db.insert(hrRevenueTargets).values(puts).onConflictDoUpdate({target:[hrRevenueTargets.memberId,hrRevenueTargets.month],set:{amount:sql`excluded.amount`,updatedBy:me,updatedAt:now}});}
   await db.insert(auditLogs).values(changes.map(x=>({id:crypto.randomUUID(),actorId:me,module:'hr',action:'hr-revenue-target-update',entityType:'hr-revenue-target',entityId:r.memberId+':'+x.month,data:JSON.stringify({year:r.year,month:x.month,from:x.from,to:x.to,reason:note,source:'sale-request-approval',requestId:r.id,employeeReason:r.reason}),createdAt:now})));
  }
  const row={...r,status:b.decision as 'approved'|'rejected',revision:r.revision+1,resolvedBy:me,resolvedAt:now,resolutionNote:note};
  await db.update(hrRevenueTargetRequests).set({status:row.status,revision:row.revision,resolvedBy:me,resolvedAt:now,resolutionNote:note}).where(eq(hrRevenueTargetRequests.id,r.id));await logRequest(db,me,row,'hr-revenue-target-request-'+row.status,note);
  return json({ok:true,status:row.status});
 }),'admin');
}
