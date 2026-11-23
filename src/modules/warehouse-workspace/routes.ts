import {purchaseTaskProjection} from '../tasks/api/purchase-scope.ts';
import { enqueueSyncJob } from '../../core/jobs/sync-jobs.ts';
import {isWarehouseSourceWork,sourceWorkKeySql,assignmentCandidates,assignmentRoster,prepareSourceAssignment,warehouseSourceTask,withoutAssignedSource,withoutAnyAssignment,assignFreshWarehouseTasks} from './assignment.ts';
import {warehouseWorkSourceLinks as sourceLinks,warehouseWorkParts as workParts,warehouseWorkAssignments as sourceAssignments} from './schema.ts';
import {warehouseSourceHooks} from '../../core/contracts/warehouse-source.ts';
import {payrollLock} from '../../core/db/payroll-lock.ts';
import type {AssertWarehousePayrollOpen} from '../../core/contracts/warehouse-bonus.ts';
import {warehouseAvailability,warehouseDispatchLock,assertWarehouseFree,dispatchWarehouseQueue,waitingWarehouseWork} from './dispatch.ts';
import {stockTransfers} from '../inventory/schema.ts';
import {incomingShipments} from '../suppliers/schema.ts';
import {deliveries,salesOrders} from '../sales/schema.ts';
import {and,asc,desc,eq,inArray,isNull,or,sql} from 'drizzle-orm';
import type {Router,RouteContext} from '../../core/http/router.ts';
import {json,readJson} from '../../core/http/router.ts';
import {AppError} from '../../core/errors.ts';
import type {StaffEnv,SessionState} from '../staff/api/auth-routes.ts';
import {employees} from '../staff/schema.ts';
import {tasks} from '../tasks/schema.ts';
import {vietnamDate} from '../sales/domain/sales.ts';
import {sha256Hex} from '../staff/domain/session.ts';
import {warehouseWorkRuns as runs,warehouseWorkSettings as settings,warehouseWorkMonths as months} from './schema.ts';
import {KINDS,parseJson,validCalendar,elapsed,scoreMonth,bonusFactor,vietnamMonth,type Calendar,type Wait} from './domain.ts';
type Ctx=RouteContext<StaffEnv>;type Db=StaffEnv['db'];
const member=(c:Ctx)=>(c.state.session as SessionState).member;
function access(c:Ctx){const m=member(c);if(m.role!=='manager'&&!(m.role==='employee'&&m.positionId==='warehouse'))throw new AppError(403,'Chỉ nhân viên Kho và Manager dùng Không gian Kho.');return m;}
function fail(message:string,status=400):never{throw new AppError(status,message);}
const text=(x:unknown,max=2000)=>String(x??'').trim().slice(0,max);
const positive=(x:unknown,max:number)=>{const v=Number(x);if(!Number.isFinite(v)||v<=0||v>max)fail('Định mức hoặc khối lượng không hợp lệ.');return v;};
const deadline=(t:{dueDate:string|null;dueTime:string|null})=>t.dueDate?new Date(t.dueDate+'T'+(t.dueTime||'23:59')+':00+07:00').toISOString():null;
const warehousePeople=()=>and(eq(employees.positionId,'warehouse'),eq(employees.role,'employee'),eq(employees.active,true),isNull(employees.deletedAt));
const stageSql=sql<string>`coalesce(${runs.stage},case when ${tasks.status}='done' then 'legacy' when ${tasks.status}='in_progress' then 'untracked-working' when ${tasks.status}='cancelled' then 'cancelled' else 'todo' end)`;
const assignedScope=(id:string)=>or(eq(runs.memberId,id),and(isNull(runs.memberId),eq(tasks.assigneeId,id)));
const teamScope=()=>and(isNull(runs.memberId),isNull(tasks.assigneeId),eq(tasks.assigneePosition,'warehouse'));
const taskScope=(id:string)=>or(assignedScope(id),teamScope());
const monthWhere=(month:string)=>sql`coalesce(((${runs.dueAt})::timestamptz at time zone 'Asia/Ho_Chi_Minh')::date::text,${tasks.dueDate}) like ${month+'%'}`;
async function lockWorker(db:Db,id:string){const [p]=await db.select({id:employees.id}).from(employees).where(and(eq(employees.id,id),warehousePeople())).for('update');if(!p)fail('Chọn nhân viên Kho đang hoạt động.');}
async function assertOpen(db:Db,id:string,month:string){if((await db.select().from(months).where(and(eq(months.memberId,id),eq(months.month,month))).limit(1)).length)fail('Tháng hiệu suất đã chốt, không sửa dữ liệu của kỳ này.',409);}
async function assertSourceCompleted(db:Db,t:typeof tasks.$inferSelect){
 const original=await warehouseSourceTask(db,t);
 if(original.id!==t.id){if(original.status!=='done')fail('Hoàn tất phiếu nghiệp vụ gốc trước khi xác nhận phần việc.',409);t=original;}
 if(!t.autoKey)return;
 const resolved=await warehouseSourceHooks.resolve?.(db,t);
 const [assignment]=await db.select({warehouseId:sourceAssignments.warehouseId}).from(sourceAssignments).where(eq(sourceAssignments.taskId,t.id)).limit(1);
 if(assignment&&(!resolved||resolved.warehouseId!==assignment.warehouseId))fail('Phiếu nguồn hoặc kho không còn khớp phân công. Kiểm tra chứng từ trước khi xác nhận.',409);
 if(resolved){if(resolved.cancelled||!resolved.complete)fail('Phiếu nguồn chưa hoàn tất đúng bước hoặc đã bị hủy.',409);return;}
 if(t.source==='transfer'&&t.sourceId){const [doc]=await db.select({status:stockTransfers.status}).from(stockTransfers).where(eq(stockTransfers.id,t.sourceId));
  const allowed=t.autoKey.startsWith('transfer-receive:')?['done']:t.autoKey.startsWith('transfer-move:')?['shipped','done']:['approved','shipped','done'];
  if(!doc||!allowed.includes(doc.status))fail('Phiếu điều chuyển chưa hoàn tất bước tương ứng hoặc đã hủy.',409);
 }
 if(t.source==='packing'&&t.sourceId){const [order]=await db.select({status:salesOrders.status}).from(salesOrders).where(eq(salesOrders.id,t.sourceId));if(!order||order.status==='cancelled')fail('Đơn nguồn đã hủy hoặc không còn tồn tại.',409);
  if(t.autoKey.startsWith('pack:')){const [trip]=await db.select({status:deliveries.status}).from(deliveries).where(eq(deliveries.id,t.autoKey.slice(5)));if(!trip||!['in_transit','delivered'].includes(trip.status))fail('Chuyến giao chưa bàn giao hoặc đã hủy. Đối soát phiếu gốc.',409);}
 }
 if(t.source==='purchase'&&t.sourceId&&!t.autoKey.includes(':early:')){const [doc]=await db.select({cancelledAt:incomingShipments.cancelledAt}).from(incomingShipments).where(eq(incomingShipments.id,t.sourceId));if(!doc||doc.cancelledAt)fail('Đơn mua nguồn đã hủy hoặc không còn tồn tại.',409);}
}
async function liveReport(db:Db,id:string,month:string,now:string){
 const rows=await db.select({task:tasks,run:runs}).from(tasks).leftJoin(runs,eq(runs.taskId,tasks.id)).where(and(withoutAssignedSource(),or(eq(runs.memberId,id),and(isNull(runs.memberId),eq(tasks.assigneeId,id))),or(monthWhere(month),and(isNull(tasks.dueDate),isNull(runs.dueAt))))).orderBy(asc(tasks.id));
 const [config]=await db.select().from(settings).where(eq(settings.id,'default'));
 const historical=(x:typeof rows[number])=>!x.run&&x.task.status==='done'&&!!config&&(x.task.completedAt||x.task.updatedAt)<config.createdAt;
 const legacyExcluded=rows.filter(historical).length;
 const facts=rows.filter(x=>!historical(x)).map(x=>({dueAt:x.run?.dueAt||deadline(x.task),cancelled:x.task.status==='cancelled',run:x.run}));
 const report=scoreMonth(facts,month,now);
 const budget=config?.bonusBudget??null,factor=bonusFactor(report.score);
 const data={...report,legacyExcluded,budget,factor,bonusPreview:budget!==null&&factor!==null?Math.round(budget*factor):null,previewOnly:true,
  tasks:rows.filter(x=>(x.run?.dueAt||deadline(x.task))&&vietnamMonth((x.run?.dueAt||deadline(x.task))!)===month).map(x=>({id:x.task.id,title:x.task.title,taskStatus:x.task.status,run:x.run}))};
 // The fingerprint includes all input facts so cancelling/reassigning/altering a due task invalidates approval.
 return {...data,fingerprint:sha256Hex(JSON.stringify(data))};
}
/** Composition-root guard: Tasks does not import warehouse metadata. Source hooks remain authoritative. */
export async function assertWarehouseTaskMutable(db:Db,t:typeof tasks.$inferSelect){
 const [linked]=await db.select({id:sourceLinks.taskId}).from(sourceLinks).where(eq(sourceLinks.taskId,t.id)).limit(1);
 if(linked)fail('Việc nguồn đã phân công Kho. Giữ liên kết phiếu gốc và thao tác tại Kho của tôi.',409);
 if(isWarehouseSourceWork(t)){const [configured]=await db.select({id:settings.id}).from(settings).where(eq(settings.id,'default'));const [warehouse]=await db.select({id:tasks.id}).from(tasks).where(and(eq(tasks.id,t.id),or(eq(tasks.assigneePosition,'warehouse'),sql`${tasks.assigneeId} in (select id from staff_members where position_id='warehouse' and role='employee')`))).limit(1);if(configured&&warehouse)fail('Việc tự sinh Kho cần được phân công từ phiếu nguồn. Manager kiểm tra kho và người nhận tại Kho của tôi.',409);}
 const [r]=await db.select({id:runs.taskId}).from(runs).where(eq(runs.taskId,t.id)).limit(1);
 if(r)fail('Việc đã theo dõi hiệu suất Kho. Thao tác tại Kho của tôi; Manager hủy việc thủ công tại đó để giữ lịch sử.',409);
}
export function registerWarehouseWorkspace(router:Router<StaffEnv>,deps:{assertPayrollOpen?:AssertWarehousePayrollOpen;syncSource?:(env:StaffEnv,type:string,id:string)=>Promise<string[]>;reconcileSources?:(env:StaffEnv)=>Promise<unknown>;afterAssignment?:(env:StaffEnv,ids:string[],taskId:string,actor:string)=>Promise<unknown>}={}){
 router.post('/warehouse-workspace/source-sync',async c=>{
  if(access(c).role!=='manager')fail('Chỉ Manager chuẩn bị phân công.',403);
  const b=await readJson(c.req,2000),type=text(b.type,20),id=text(b.id,100);
  if(!['packing','transfer','purchase','early'].includes(type)||!id)fail('Nguồn công việc không hợp lệ.');
  const ids=await deps.syncSource?.(c.env,type,id)??[];return json({taskIds:ids});
 },'business');
 router.get('/warehouse-workspace/assignment-options',async c=>{
  if(access(c).role!=='manager')fail('Chỉ Manager phân công việc nguồn.',403);
  const taskId=c.url.searchParams.get('taskId')||'',q=(c.url.searchParams.get('q')||'').slice(0,100),page=Number(c.url.searchParams.get('page')||0);
  if(!Number.isInteger(page)||page<0||page>10000)fail('Trang không hợp lệ.');
  const now=new Date().toISOString(),result=await assignmentCandidates(c.env.db,now,{taskId,q,page});
  const selected=result.tasks[0], [task]=selected?await c.env.db.select().from(tasks).where(eq(tasks.id,selected.id)):[];
  const info=task?await assignmentRoster(c.env.db,task,now):null;
  return json({...result,selectedTaskId:selected?.id??null,people:info?.people??[],recommended:info?.recommended?.id??null,warehouseId:info?.source.warehouseId??null,reason:!info?.people.length?'Kho chưa có nhân viên được cấp đủ quyền nghiệp vụ':info?.recommended?.status==='free'?'Ưu tiên người rảnh':info?.recommended?.coefficient!=null?'Hệ số hoàn thành đã xác nhận cao hơn':'Chưa đủ hệ số · ưu tiên ít việc chờ',now});
 },'business');
 router.post('/warehouse-workspace/:id/assign',async c=>{
  const m=access(c);if(m.role!=='manager')fail('Chỉ Manager phân công việc nguồn.',403);
  const result=await prepareSourceAssignment(c.env.db,c.params.id!,m.id,await readJson(c.req,16000),new Date().toISOString());
  if(!result.existing&&result.members?.length&&deps.afterAssignment){const job=deps.afterAssignment(c.env,result.members,result.id,m.id).catch(()=>{});if(c.env.waitUntil)c.env.waitUntil(job);else await job;}
  return json(result);
 },'business');
 router.post('/integrations/warehouse-work/reconcile',async c=>{
  if(c.env.durableSyncJobs)return json({checked:0,offered:0,...await enqueueSyncJob(c.env.db,'warehouse')});
  await deps.reconcileSources?.(c.env);
  const now=new Date().toISOString(),pending=await c.env.db.select({id:tasks.id}).from(tasks).where(and(withoutAnyAssignment(),sql`${tasks.autoKey} is not null`,eq(tasks.status,'todo'),or(eq(tasks.assigneePosition,'warehouse'),sql`${tasks.assigneeId} in (select id from staff_members where position_id='warehouse' and role='employee' and active=true and deleted_at is null)`))).orderBy(asc(tasks.createdAt),asc(tasks.id)).limit(100);
  await assignFreshWarehouseTasks(c.env.db,pending.map(t=>t.id),now);
  const offered=await c.env.db.transaction(async tx=>{const db=tx as unknown as Db;await warehouseDispatchLock(db);return dispatchWarehouseQueue(db,now);});
  return json({checked:pending.length,offered:offered.length});
 },'sapo-sync');
 router.get('/warehouse-workspace',async c=>{
  const m=access(c),p=c.url.searchParams,now=new Date().toISOString(),today=vietnamDate().iso,month=p.get('month')||today.slice(0,7);
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))fail('Tháng không hợp lệ.');
  const people=m.role==='manager'?await c.env.db.select({id:employees.id,name:employees.name}).from(employees).where(warehousePeople()).orderBy(asc(employees.name)):[];
  const filter=p.get('scope')||'member';if(!['member','team'].includes(filter))fail('Bộ lọc nhân viên không hợp lệ.');
  if(filter==='team'&&m.role!=='manager')fail('Chỉ Manager lọc riêng việc nhóm.',403);
  if(filter==='team'&&p.get('member'))fail('Chọn nhân viên hoặc việc nhóm, không chọn đồng thời.');
  const id=filter==='team'?'':m.role==='manager'?(p.get('member')||people[0]?.id||''):m.id;
  if(m.role!=='manager'&&p.has('member')&&p.get('member')!==m.id)fail('Không được xem hiệu suất người khác.',403);
  if(id&&m.role==='manager'&&!people.some(x=>x.id===id))fail('Không tìm thấy nhân viên Kho.',404);
  const [config]=await c.env.db.select().from(settings).where(eq(settings.id,'default'));
  const selected=p.get('tab')||'priority';if(!['priority','working','review','done','overdue','todayDone'].includes(selected))fail('Bộ lọc không hợp lệ.');
  const page=Number(p.get('page')||0);if(!Number.isInteger(page)||page<0||page>100000)fail('Trang không hợp lệ.');
  const scope=filter==='team'?teamScope():id?(m.role==='manager'?assignedScope(id):and(taskScope(id),sql`not (${tasks.assigneeId} is null and ${tasks.assigneePosition}='warehouse' and ${sourceWorkKeySql()})`)):sql`false`,active=sql`${tasks.status}<>'cancelled'`;
  const overdueFilter=sql`${stageSql} not in ('confirmed','legacy') and coalesce(${runs.dueAt}::timestamptz,(${tasks.dueDate} || 'T' || coalesce(${tasks.dueTime},'23:59') || ':00+07:00')::timestamptz)<${now}::timestamptz`;
  const doneTodayFilter=sql`${runs.stage}='confirmed' and (${runs.confirmedAt}::timestamptz at time zone 'Asia/Ho_Chi_Minh')::date=${today}::date`;
  const [counts]=await c.env.db.select({todo:sql<number>`count(*) filter(where ${stageSql}='todo' and (${waitingWarehouseWork()}))`.mapWith(Number),working:sql<number>`count(*) filter(where ${stageSql} in ('working','blocked','untracked-working'))`.mapWith(Number),review:sql<number>`count(*) filter(where ${stageSql}='submitted')`.mapWith(Number),overdue:sql<number>`count(*) filter(where ${overdueFilter})`.mapWith(Number),doneToday:sql<number>`count(*) filter(where ${doneTodayFilter})`.mapWith(Number)}).from(tasks).leftJoin(runs,eq(runs.taskId,tasks.id)).where(and(withoutAssignedSource(),scope,active));
  const tabs={overdue:overdueFilter,todayDone:doneTodayFilter,priority:sql`${stageSql} not in ('confirmed','legacy')`,working:sql`${stageSql} in ('working','blocked','untracked-working')`,review:eq(runs.stage,'submitted'),done:sql`${stageSql} in ('confirmed','legacy') and ${monthWhere(month)}`};
  const rows=await c.env.db.select({task:tasks,run:runs}).from(tasks).leftJoin(runs,eq(runs.taskId,tasks.id)).where(and(withoutAssignedSource(),scope,active,tabs[selected as keyof typeof tabs])).orderBy(asc(sql`case when ${runs.stage} in ('working','blocked') or (${runs.taskId} is null and ${tasks.status}='in_progress') then 0 when ${runs.stage}='todo' and ${runs.offeredAt} is not null then 1 when ${runs.stage}='todo' and ${runs.queuedAt} is not null then 2 else 3 end`),asc(sql`case ${tasks.priority} when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end`),asc(tasks.dueDate),asc(tasks.id)).limit(31).offset(page*30);
  const [closed]=id?await c.env.db.select().from(months).where(and(eq(months.memberId,id),eq(months.month,month))):[];
  const report=closed?{...parseJson<Record<string,unknown>>(closed.snapshot,{}),locked:true,approvedAt:closed.approvedAt}:id?{...await liveReport(c.env.db,id,month,now),locked:false}:null;
  const publicReport=report&&Object.fromEntries(Object.entries(report).filter(([key])=>key!=='tasks'));
  const roster=await warehouseAvailability(c.env.db,now);
  const [waiting]=await c.env.db.select({count:sql<number>`count(*)`.mapWith(Number)}).from(runs).innerJoin(tasks,eq(tasks.id,runs.taskId)).where(and(eq(runs.stage,'todo'),isNull(runs.offeredAt),sql`${runs.queuedAt} is not null`,and(sql`${tasks.status}<>'cancelled'`,waitingWarehouseWork())));
  const partRows=rows.length?await c.env.db.select().from(workParts).where(inArray(workParts.taskId,rows.map(r=>r.task.id))):[];
  const partIds=new Set(partRows.map(p=>p.taskId)),partDetails=new Map(partRows.map(p=>[p.taskId,{sourceTaskId:p.assignmentId,part:p.part,share:p.share}]));
  return json({availability:m.role==='manager'?roster:roster.filter(p=>p.id===m.id),waitingDispatch:m.role==='manager'?waiting?.count||0:0,now,today,month,scope:filter,memberId:id,manager:m.role==='manager',people,config:config?{...config,calendar:parseJson(config.calendar,null)}:null,counts,report:publicReport,page,hasMore:rows.length>30,rows:rows.slice(0,30).map(({task:t,run:r})=>{const shown=purchaseTaskProjection(m,t);return {id:t.id,title:shown.title,description:shown.description,source:t.source,link:shown.link,taskStatus:t.status,taskRevision:t.revision,assigneeId:t.assigneeId,team:t.assigneePosition,dueAt:r?.dueAt||deadline(t),priority:t.priority,sourceManaged:!!t.autoKey||partIds.has(t.id),part:partDetails.get(t.id)??null,run:r?{...r,waits:parseJson<Wait[]>(r.waits,[]),elapsed:elapsed(r,now)}:null};})});
 },'business');
 router.put('/warehouse-workspace/settings',async c=>{
  const m=access(c);if(m.role!=='manager')fail('Chỉ Manager cài đặt định mức.',403);
  const b=await readJson(c.req,8000);if(!validCalendar(b.calendar))fail('Ca làm / giờ nghỉ / ngày làm không hợp lệ.');
  if(!text(b.reason))fail('Nhập lý do cài đặt.');const budget=b.bonusBudget==null||b.bonusBudget===''?null:Number(b.bonusBudget);if(budget!==null&&(!Number.isSafeInteger(budget)||budget<0||budget>1e9))fail('Quỹ thưởng không hợp lệ.');
  if(b.autoDispatch!==undefined&&typeof b.autoDispatch!=='boolean')fail('Chế độ tự giao việc không hợp lệ.');const autoFlag=typeof b.autoDispatch==='boolean'?b.autoDispatch:undefined;
  await c.env.db.transaction(async tx=>{const db=tx as unknown as Db;await warehouseDispatchLock(db);await db.select().from(employees).where(eq(employees.id,m.id)).for('update');const [old]=await db.select().from(settings).where(eq(settings.id,'default'));
   if(Number(b.revision||0)!==(old?.revision||0))fail('Cài đặt vừa thay đổi. Tải lại trước khi lưu.',409);
   await db.insert(settings).values({id:'default',createdAt:new Date().toISOString(),calendar:JSON.stringify(b.calendar),autoDispatch:autoFlag??old?.autoDispatch??true,bonusBudget:budget,updatedBy:m.id,updatedAt:new Date().toISOString()}).onConflictDoUpdate({target:settings.id,set:{calendar:JSON.stringify(b.calendar),autoDispatch:autoFlag??old?.autoDispatch??true,bonusBudget:budget,updatedBy:m.id,updatedAt:new Date().toISOString(),revision:sql`${settings.revision}+1`}});
   await dispatchWarehouseQueue(db,new Date().toISOString());
  });return json({ok:true});
 },'business');
 router.post('/warehouse-workspace/create',async c=>{
  const m=access(c);if(m.role!=='manager')fail('Chỉ Manager giao việc có thưởng.',403);
  const b=await readJson(c.req,8000),title=text(b.title,300),description=text(b.description),dueDate=text(b.dueDate,10),dueTime=text(b.dueTime||'23:59',5),requestId=text(b.requestId,36).toLowerCase(),memberId=b.memberId==='auto'?'':text(b.memberId,100),kind=text(b.kind||'manual'),priority=text(b.priority||'normal');
  if(!title||!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(requestId))fail('Nhập tên việc và mã yêu cầu hợp lệ.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)||!Number.isFinite(Date.parse(dueDate+'T00:00:00Z'))||new Date(dueDate+'T00:00:00Z').toISOString().slice(0,10)!==dueDate||!/^([01]\d|2[0-3]):[0-5]\d$/.test(dueTime))fail('Hạn công việc không hợp lệ.');
  if(!KINDS.includes(kind as never)||!['low','normal','high','urgent'].includes(priority))fail('Loại việc / ưu tiên không hợp lệ.');
  const standardMinutes=positive(b.standardMinutes,100000),weight=b.weight==null||b.weight===''?1:positive(b.weight,10000),now=new Date().toISOString(),due=deadline({dueDate,dueTime})!,id='ww-'+m.id+'-'+requestId;
  const creationHash=sha256Hex(JSON.stringify({title,description,dueDate,dueTime,memberId,kind,priority,standardMinutes,weight}));
  const result=await c.env.db.transaction(async tx=>{
   const db=tx as unknown as Db;await warehouseDispatchLock(db);
   const [prior]=await db.select().from(runs).where(eq(runs.taskId,id));
   if(prior){if(prior.creationHash!==creationHash)fail('Mã yêu cầu đã dùng cho nội dung khác. Tải lại trước khi giao.',409);return {ok:true,id,existing:true,memberId:prior.memberId};}
   const [config]=await db.select().from(settings).where(eq(settings.id,'default'));if(!config||!validCalendar(parseJson(config.calendar,null)))fail('Cài đặt ca làm trước khi giao việc.');
   if(memberId){await assertWarehouseFree(db,memberId);await assertOpen(db,memberId,vietnamMonth(due));}
   await db.insert(tasks).values({id,title,description,dueDate,dueTime,priority:priority as 'normal',assigneeId:memberId||null,assigneePosition:memberId?null:'warehouse',createdBy:m.id,createdAt:now,updatedAt:now});
   await db.insert(runs).values({taskId:id,memberId:memberId||null,creationHash,queuedAt:now,offeredAt:memberId?now:null,kind:kind as typeof KINDS[number],weight,standardMinutes,calendar:config.calendar,dueAt:due,reviewNote:'Manager giao việc có thưởng',updatedAt:now});
   await dispatchWarehouseQueue(db,now);const [assigned]=await db.select({memberId:runs.memberId}).from(runs).where(eq(runs.taskId,id));return {ok:true,id,existing:false,memberId:assigned?.memberId||null};
  });return json(result,result.existing?200:201);
 },'business');
 router.post('/warehouse-workspace/dispatch-queue',async c=>{
  const m=access(c),b=await readJson(c.req,1000);if(b.force!==undefined&&typeof b.force!=='boolean')fail('Thao tác không hợp lệ.');if(b.force&&m.role!=='manager')fail('Chỉ Manager giao việc thủ công.',403);
  const count=await c.env.db.transaction(async tx=>{const db=tx as unknown as Db;await warehouseDispatchLock(db);return (await dispatchWarehouseQueue(db,new Date().toISOString(),b.force===true)).length;});return json({ok:true,count});
 },'business');
 router.post('/warehouse-workspace/:id/action',async c=>{
  const m=access(c),b=await readJson(c.req,12000),action=text(b.action,30),now=new Date().toISOString();
  const result=await c.env.db.transaction(async tx=>{
   const db=tx as unknown as Db;await warehouseDispatchLock(db);const [initial]=await db.select({task:tasks,run:runs}).from(tasks).leftJoin(runs,eq(runs.taskId,tasks.id)).where(eq(tasks.id,c.params.id!));if(!initial)fail('Không tìm thấy việc.',404);
   const target=['configure','reoffer'].includes(action)?(b.memberId==='auto'?'':text(b.memberId,100)):initial.run?.memberId||initial.task.assigneeId||(action==='cancel'&&initial.run&&m.role==='manager'?'':m.id);
   if(m.role!=='manager'&&target!==m.id)fail('Không được sửa việc người khác.',403);
   if(m.role!=='manager'&&['configure','reoffer','confirm','reject','review-wait','cancel'].includes(action))fail('Chỉ Manager xác nhận kết quả.',403);
   if(target)await lockWorker(db,target);
   const [t]=await db.select().from(tasks).where(eq(tasks.id,c.params.id!)).for('update');if(!t)fail('Không tìm thấy việc.',404);
   const [r]=await db.select().from(runs).where(eq(runs.taskId,t.id));
   if(t.status==='cancelled')fail('Việc đã hủy.',409);
   if(!['configure','reoffer'].includes(action)&&!r&&t.assigneePosition!=='warehouse'&&t.assigneeId!==target)fail('Công việc không thuộc nhân viên Kho được chọn.',404);
   if(!['configure','reoffer'].includes(action)&&r?.memberId&&r.memberId!==target)fail('Người phụ trách đã thay đổi. Tải lại.',409);
   const due=r?.dueAt||deadline(t);if(due&&['configure','reoffer'].includes(action)&&r?.memberId)await assertOpen(db,r.memberId,vietnamMonth(due));
   if(action==='claim'){
    if(r||t.assigneeId||t.assigneePosition!=='warehouse'||t.status!=='todo')fail('Việc đã được nhận hoặc thay đổi.',409);
    if(Number(b.taskRevision)!==t.revision)fail('Việc vừa thay đổi. Tải lại.',409);
    if(isWarehouseSourceWork(t)){const info=await assignmentRoster(db,t,now);if(!info||!info.people.some(p=>p.id===target))fail('Chưa được phân công tại kho nguồn hoặc thiếu quyền nghiệp vụ.',403);if(info.source.complete)fail('Phiếu nguồn đã hoàn tất.',409);}
    await assertWarehouseFree(db,target);
    await db.update(tasks).set({assigneeId:target,assigneePosition:null,revision:t.revision+1,updatedAt:now}).where(eq(tasks.id,t.id));return {ok:true};
   }
   if(action==='configure'){
    if(!r&&isWarehouseSourceWork(t))fail('Việc tự sinh phải dùng Phân công việc tự sinh để kiểm tra đúng kho và người nhận.',409);
    if((await db.select().from(workParts).where(eq(workParts.taskId,t.id)).limit(1)).length||(await db.select().from(sourceLinks).where(eq(sourceLinks.taskId,t.id)).limit(1)).length)fail('Việc đã gắn phân công từ phiếu nguồn. Không cấu hình lại như việc thủ công.',409);
    if(!r&&t.assigneePosition!=='warehouse'&&(!t.assigneeId||!(await db.select({id:employees.id}).from(employees).where(and(eq(employees.id,t.assigneeId),eq(employees.positionId,'warehouse'),eq(employees.role,'employee'))).limit(1)).length))fail('Chỉ giao định mức cho công việc Kho.',404);
    if(t.status!=='todo'||r&&(r.stage!=='todo'||!!r.startedAt))fail('Chỉ cấu hình trước khi bắt đầu.',409);
    if(!due)fail('Đặt hạn công việc trên phiếu Công việc trước khi cấu hình.');
    if(!KINDS.includes(b.kind as never))fail('Loại việc không hợp lệ.');
    if(!text(b.note))fail('Nhập căn cứ định mức.');
    if(Number(b.revision||0)!==(r?.revision||0)||Number(b.taskRevision)!==t.revision)fail('Việc vừa thay đổi. Tải lại.',409);
    const [config]=await db.select().from(settings).where(eq(settings.id,'default'));if(!config||!validCalendar(parseJson(config.calendar,null)))fail('Cài đặt ca làm trước khi giao định mức.');
    if(target){await assertWarehouseFree(db,target,t.id);await assertOpen(db,target,vietnamMonth(due));}
    const data={taskId:t.id,memberId:target||null,queuedAt:r?.queuedAt||now,offeredAt:target?now:null,kind:b.kind as typeof KINDS[number],weight:b.weight==null||b.weight===''?1:positive(b.weight,10000),standardMinutes:positive(b.standardMinutes,100000),calendar:config.calendar,dueAt:due,evidence:'',reviewNote:text(b.note),updatedAt:now};
    await db.insert(runs).values(data).onConflictDoUpdate({target:runs.taskId,set:{...data,revision:(r?.revision||0)+1}});
    await db.update(tasks).set({assigneeId:target||null,assigneePosition:target?null:'warehouse',revision:t.revision+1,updatedAt:now}).where(eq(tasks.id,t.id));await dispatchWarehouseQueue(db,now);return {ok:true};
   }
   if(!r)fail('Manager cần duyệt định mức và hạn trước khi bắt đầu.',409);
   if(Number(b.revision)!==r.revision)fail('Công việc vừa thay đổi. Tải lại trước khi thao tác.',409);
   if(!r.memberId&&action!=='cancel')fail('Việc đang chờ phân công. Chờ được giao trước khi nhận.',409);
   if(action==='reoffer'){
    if((await db.select().from(workParts).where(eq(workParts.taskId,t.id)).limit(1)).length)fail('Phần việc đã gắn thành viên team. Không giao lại bằng luồng việc đơn.',409);
    if(r.stage!=='todo'||!r.offeredAt||!target||target===r.memberId||text(b.note).length<3)fail('Chỉ giao lại việc chờ nhận cho người rảnh khác và ghi lý do.',409);
    const sourceTask=await warehouseSourceTask(db,t),info=sourceTask.autoKey?await assignmentRoster(db,sourceTask,now):null;
    if(info&&!info.people.some(p=>p.id===target))fail('Nhân viên không được phân công tại kho nguồn.',403);
    await assertWarehouseFree(db,target,t.id);await assertOpen(db,target,vietnamMonth(r.dueAt));
    await db.update(sourceAssignments).set({leadId:target,requestHash:'',reason:text(b.note),revision:sql`${sourceAssignments.revision}+1`,updatedAt:now}).where(and(eq(sourceAssignments.taskId,t.id),eq(sourceAssignments.mode,'single')));
    await db.update(runs).set({memberId:target,offeredAt:now,updatedAt:now,revision:r.revision+1,reviewNote:text(b.note)}).where(eq(runs.taskId,t.id));
    await db.update(tasks).set({assigneeId:target,assigneePosition:null,revision:t.revision+1,updatedAt:now}).where(eq(tasks.id,t.id));await dispatchWarehouseQueue(db,now);return {ok:true};
   }
   let sourceFinished=false;
   if(['start','resume'].includes(action)){
    const source=await warehouseSourceTask(db,t),[assignment]=await db.select().from(sourceAssignments).where(eq(sourceAssignments.taskId,source.id)).limit(1);
    if(assignment){const info=await assignmentRoster(db,source,now);sourceFinished=!!info?.source.complete;
     if(!info||info.source.cancelled||(info.source.complete&&!(r.startedAt&&r.quality==='error'))||info.source.warehouseId!==assignment.warehouseId)fail('Phiếu nguồn hoặc kho đã thay đổi. Manager cần kiểm tra lại phân công.',409);
     if(!info.people.some(p=>p.id===target))fail('Nhân viên không còn được phân công tại kho nguồn.',403);
    }
   }
   const patch:Partial<typeof runs.$inferInsert>={updatedAt:now,revision:r.revision+1};const waits=parseJson<Wait[]>(r.waits,[]);
   if(action==='start'){
    if(r.stage!=='todo'||t.status==='done'&&!sourceFinished)fail('Không thể bắt đầu việc này.',409);
    await assertWarehouseFree(db,target,t.id);
    if(r.startedAt&&r.queuedAt){waits.push({id:crypto.randomUUID(),start:r.queuedAt,end:r.offeredAt||now,reason:'Chờ lượt làm lại',decision:'approved',reviewNote:'Hệ thống xếp lại hàng chờ',reviewedBy:m.id});patch.waits=JSON.stringify(waits);}
    patch.stage='working';patch.startedAt=r.startedAt||now;patch.offeredAt=r.offeredAt||now;
    await db.update(tasks).set({status:sourceFinished&&t.autoKey?t.status:'in_progress',startedAt:t.startedAt||now,revision:t.revision+1,updatedAt:now}).where(eq(tasks.id,t.id));
   }else if(action==='cancel'){
    if(t.autoKey)fail('Hủy trên phiếu nghiệp vụ gốc, không hủy bước kho từ bảng chấm điểm.',409);
    if(!text(b.note))fail('Nhập lý do hủy.');patch.stage='cancelled';patch.reviewNote=text(b.note);
    await db.update(tasks).set({status:'cancelled',revision:t.revision+1,updatedAt:now}).where(eq(tasks.id,t.id));
   }else if(action==='block'){
    if(r.stage!=='working'||text(b.note).length<3)fail('Nhập lý do vướng mắc cho việc đang làm.');
    waits.push({id:crypto.randomUUID(),start:now,end:null,reason:text(b.note),decision:'pending'});patch.waits=JSON.stringify(waits);patch.stage='blocked';
   }else if(action==='resume'){
    if(r.stage!=='blocked')fail('Việc không đang chờ.',409);
    await assertWarehouseFree(db,target,t.id);
    const wait=waits.find(w=>!w.end);if(!wait)fail('Khoảng chờ không hợp lệ.',409);wait.end=now;patch.waits=JSON.stringify(waits);patch.stage='working';
   }else if(action==='submit'){
    if(r.stage!=='working'||text(b.note).length<3)fail('Nhập kết quả / bằng chứng trước khi gửi hoàn thành.');
    patch.stage='submitted';patch.submittedAt=now;patch.evidence=text(b.note);
   }else if(action==='review-wait'){
    const wait=waits.find(w=>w.id===b.waitId);if(!wait||!wait.end||wait.decision!=='pending')fail('Chỉ duyệt khoảng chờ đã kết thúc và chưa xử lý.',409);
    if(!['approved','rejected'].includes(String(b.decision))||!text(b.note))fail('Chọn kết quả và nhập lý do.');
    wait.decision=b.decision as Wait['decision'];wait.reviewedBy=m.id;wait.reviewNote=text(b.note);patch.waits=JSON.stringify(waits);
   }else if(action==='reject'){
    if(r.stage!=='submitted'||!text(b.note))fail('Nhập lý do yêu cầu làm lại.');patch.stage='todo';patch.offeredAt=null;patch.queuedAt=now;patch.submittedAt=null;patch.reviewNote=text(b.note);patch.quality='error';
    waits.push({id:crypto.randomUUID(),start:r.submittedAt!,end:now,reason:'Chờ xác nhận kết quả trước khi yêu cầu làm lại',decision:'approved',reviewedBy:m.id,reviewNote:text(b.note)});patch.waits=JSON.stringify(waits);

   }else if(action==='confirm'){
    if(r.stage!=='submitted'||!['clean','error'].includes(String(b.quality))||!text(b.note))fail('Chọn chất lượng và nhập nhận xét.');
    if(waits.some(w=>w.decision==='pending'))fail('Duyệt các khoảng chờ trước khi xác nhận kết quả.',409);
    const source=await warehouseSourceTask(db,t);
    if(source.autoKey&&source.status!=='done')fail('Hoàn tất phiếu nghiệp vụ gốc trước; xác nhận điểm không thay thao tác nhập/xuất kho.',409);
    await assertSourceCompleted(db,t);
    patch.stage='confirmed';patch.confirmedAt=now;patch.confirmedBy=m.id;patch.quality=r.quality==='error'?'error':String(b.quality);patch.reviewNote=text(b.note);
    if(!t.autoKey)await db.update(tasks).set({status:'done',completedAt:r.submittedAt,completedBy:target,revision:t.revision+1,updatedAt:now}).where(eq(tasks.id,t.id));
   }else fail('Thao tác không hợp lệ.');
   await db.update(runs).set(patch).where(eq(runs.taskId,t.id));await dispatchWarehouseQueue(db,now);return {ok:true};
  });return json(result);
 },'business');
 router.post('/warehouse-workspace/approve-month',async c=>{
  const m=access(c);if(m.role!=='manager')fail('Chỉ Manager duyệt điểm tháng.',403);const b=await readJson(c.req,4000),id=text(b.memberId,100),month=text(b.month,7),now=new Date().toISOString();
  const currentMonth=vietnamDate().iso.slice(0,7);
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))fail('Tháng không hợp lệ.');
  if(b.demo!==undefined&&typeof b.demo!=='boolean')fail('Chế độ demo không hợp lệ.');
  if(b.demo===true){
   if(month!==currentMonth)fail('Demo chỉ áp dụng cho tháng hiện tại.');
   const report=await c.env.db.transaction(async tx=>{
    const db=tx as unknown as Db,[person]=await db.select({id:employees.id}).from(employees).where(and(eq(employees.id,id),warehousePeople())).limit(1);
    if(!person)fail('Chọn nhân viên Kho đang hoạt động.');
    const {tasks:_tasks,...preview}=await liveReport(db,id,month,now);return {...preview,locked:false};
   },{isolationLevel:'repeatable read',accessMode:'read only'});
   return json({ok:true,demo:true,previewOnly:true,month,memberId:id,generatedAt:now,report});
  }
  if(month>=currentMonth)fail('Chỉ duyệt sau khi tháng đã kết thúc. Dùng Demo cho tháng hiện tại.');
  await c.env.db.transaction(async tx=>{const db=tx as unknown as Db;await payrollLock(db);await warehouseDispatchLock(db);await lockWorker(db,id);await assertOpen(db,id,month);
   if(!deps.assertPayrollOpen)fail('Chưa có kết nối kiểm tra kỳ lương. Không thể duyệt thưởng.',503);await deps.assertPayrollOpen(db,id,month);const report=await liveReport(db,id,month,now);
   if(report.score===null)fail('Chưa đủ dữ liệu hoặc còn kết quả / khoảng chờ chưa xác nhận.',409);
   if(report.fingerprint!==b.fingerprint)fail('Số liệu vừa thay đổi. Tải lại và đối soát trước khi duyệt.',409);
   if(report.bonusPreview===null||report.budget===null||report.factor===null)fail('Cài quỹ thưởng trước khi duyệt tháng.',409);
   const approved={...report,previewOnly:false,payrollBonus:{version:1,amount:report.bonusPreview,score:report.score,budget:report.budget,factor:report.factor}};
   await db.insert(months).values({memberId:id,month,snapshot:JSON.stringify(approved),approvedBy:m.id,approvedAt:now});
  });return json({ok:true,previewOnly:false});
 },'business');
}
