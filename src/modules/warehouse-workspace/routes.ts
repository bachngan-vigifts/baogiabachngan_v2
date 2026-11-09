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
const stageSql=sql<string>`coalesce(${runs.stage},case when ${tasks.status}='done' then 'legacy' when ${tasks.status}='cancelled' then 'cancelled' else 'todo' end)`;
const assignedScope=(id:string)=>or(eq(runs.memberId,id),and(isNull(runs.memberId),eq(tasks.assigneeId,id)));
const teamScope=()=>and(isNull(runs.memberId),isNull(tasks.assigneeId),eq(tasks.assigneePosition,'warehouse'));
const taskScope=(id:string)=>or(assignedScope(id),teamScope());
const monthWhere=(month:string)=>sql`coalesce(((${runs.dueAt})::timestamptz at time zone 'Asia/Ho_Chi_Minh')::date::text,${tasks.dueDate}) like ${month+'%'}`;
async function lockWorker(db:Db,id:string){const [p]=await db.select({id:employees.id}).from(employees).where(and(eq(employees.id,id),warehousePeople())).for('update');if(!p)fail('Chọn nhân viên Kho đang hoạt động.');}
async function assertOpen(db:Db,id:string,month:string){if((await db.select().from(months).where(and(eq(months.memberId,id),eq(months.month,month))).limit(1)).length)fail('Tháng hiệu suất đã chốt, không sửa dữ liệu của kỳ này.',409);}
async function assertSourceCompleted(db:Db,t:typeof tasks.$inferSelect){
 if(!t.autoKey)return;
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
 const rows=await db.select({task:tasks,run:runs}).from(tasks).leftJoin(runs,eq(runs.taskId,tasks.id)).where(and(or(eq(runs.memberId,id),and(isNull(runs.memberId),eq(tasks.assigneeId,id))),or(monthWhere(month),and(isNull(tasks.dueDate),isNull(runs.dueAt))))).orderBy(asc(tasks.id));
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
 const [r]=await db.select({id:runs.taskId}).from(runs).where(eq(runs.taskId,t.id)).limit(1);
 if(r)fail('Việc đã theo dõi hiệu suất Kho. Thao tác tại Kho của tôi; Manager hủy việc thủ công tại đó để giữ lịch sử.',409);
}
async function workingJob(db:Db,id:string){
 return (await db.select({id:runs.taskId}).from(runs).innerJoin(tasks,eq(tasks.id,runs.taskId)).where(and(eq(runs.memberId,id),eq(runs.stage,'working'),inArray(tasks.status,['todo','in_progress']))).limit(1)).length>0;
}
export function registerWarehouseWorkspace(router:Router<StaffEnv>){
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
  const scope=filter==='team'?teamScope():id?(m.role==='manager'?assignedScope(id):taskScope(id)):sql`false`,active=sql`${tasks.status}<>'cancelled'`;
  const overdueFilter=sql`${stageSql} not in ('confirmed','legacy') and coalesce(${runs.dueAt}::timestamptz,(${tasks.dueDate} || 'T' || coalesce(${tasks.dueTime},'23:59') || ':00+07:00')::timestamptz)<${now}::timestamptz`;
  const doneTodayFilter=sql`${runs.stage}='confirmed' and (${runs.confirmedAt}::timestamptz at time zone 'Asia/Ho_Chi_Minh')::date=${today}::date`;
  const [counts]=await c.env.db.select({todo:sql<number>`count(*) filter(where ${stageSql}='todo' and ${tasks.status}<>'done')`.mapWith(Number),working:sql<number>`count(*) filter(where ${stageSql} in ('working','blocked'))`.mapWith(Number),review:sql<number>`count(*) filter(where ${stageSql}='submitted')`.mapWith(Number),overdue:sql<number>`count(*) filter(where ${overdueFilter})`.mapWith(Number),doneToday:sql<number>`count(*) filter(where ${doneTodayFilter})`.mapWith(Number)}).from(tasks).leftJoin(runs,eq(runs.taskId,tasks.id)).where(and(scope,active));
  const tabs={overdue:overdueFilter,todayDone:doneTodayFilter,priority:sql`${stageSql} not in ('confirmed','legacy')`,working:sql`${stageSql} in ('working','blocked')`,review:eq(runs.stage,'submitted'),done:sql`${stageSql} in ('confirmed','legacy') and ${monthWhere(month)}`};
  const rows=await c.env.db.select({task:tasks,run:runs}).from(tasks).leftJoin(runs,eq(runs.taskId,tasks.id)).where(and(scope,active,tabs[selected as keyof typeof tabs])).orderBy(asc(sql`case ${tasks.priority} when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end`),asc(tasks.dueDate),asc(tasks.id)).limit(31).offset(page*30);
  const [closed]=id?await c.env.db.select().from(months).where(and(eq(months.memberId,id),eq(months.month,month))):[];
  const report=closed?{...parseJson<Record<string,unknown>>(closed.snapshot,{}),locked:true,approvedAt:closed.approvedAt}:id?{...await liveReport(c.env.db,id,month,now),locked:false}:null;
  const publicReport=report&&Object.fromEntries(Object.entries(report).filter(([key])=>key!=='tasks'));
  return json({now,today,month,scope:filter,memberId:id,manager:m.role==='manager',people,config:config?{...config,calendar:parseJson(config.calendar,null)}:null,counts,report:publicReport,page,hasMore:rows.length>30,rows:rows.slice(0,30).map(({task:t,run:r})=>({id:t.id,title:t.title,description:t.description,source:t.source,link:t.link,taskStatus:t.status,taskRevision:t.revision,assigneeId:t.assigneeId,team:t.assigneePosition,dueAt:r?.dueAt||deadline(t),priority:t.priority,sourceManaged:!!t.autoKey,run:r?{...r,waits:parseJson<Wait[]>(r.waits,[]),elapsed:elapsed(r,now)}:null}))});
 },'business');
 router.put('/warehouse-workspace/settings',async c=>{
  const m=access(c);if(m.role!=='manager')fail('Chỉ Manager cài đặt định mức.',403);
  const b=await readJson(c.req,8000);if(!validCalendar(b.calendar))fail('Ca làm / giờ nghỉ / ngày làm không hợp lệ.');
  if(!text(b.reason))fail('Nhập lý do cài đặt.');const budget=b.bonusBudget==null||b.bonusBudget===''?null:Number(b.bonusBudget);if(budget!==null&&(!Number.isFinite(budget)||budget<0||budget>1e9))fail('Quỹ thưởng không hợp lệ.');
  await c.env.db.transaction(async tx=>{const db=tx as unknown as Db;await db.select().from(employees).where(eq(employees.id,m.id)).for('update');const [old]=await db.select().from(settings).where(eq(settings.id,'default'));
   if(Number(b.revision||0)!==(old?.revision||0))fail('Cài đặt vừa thay đổi. Tải lại trước khi lưu.',409);
   await db.insert(settings).values({id:'default',createdAt:new Date().toISOString(),calendar:JSON.stringify(b.calendar),bonusBudget:budget,updatedBy:m.id,updatedAt:new Date().toISOString()}).onConflictDoUpdate({target:settings.id,set:{calendar:JSON.stringify(b.calendar),bonusBudget:budget,updatedBy:m.id,updatedAt:new Date().toISOString(),revision:sql`${settings.revision}+1`}});
  });return json({ok:true});
 },'business');
 router.post('/warehouse-workspace/:id/action',async c=>{
  const m=access(c),b=await readJson(c.req,12000),action=text(b.action,30),now=new Date().toISOString();
  const result=await c.env.db.transaction(async tx=>{
   const db=tx as unknown as Db,[initial]=await db.select({task:tasks,run:runs}).from(tasks).leftJoin(runs,eq(runs.taskId,tasks.id)).where(eq(tasks.id,c.params.id!));if(!initial)fail('Không tìm thấy việc.',404);
   const target=action==='configure'?text(b.memberId,100):initial.run?.memberId||initial.task.assigneeId||m.id;
   if(m.role!=='manager'&&target!==m.id)fail('Không được sửa việc người khác.',403);
   if(m.role!=='manager'&&['configure','confirm','reject','review-wait','cancel'].includes(action))fail('Chỉ Manager xác nhận kết quả.',403);
   await lockWorker(db,target);
   const [t]=await db.select().from(tasks).where(eq(tasks.id,c.params.id!)).for('update');if(!t)fail('Không tìm thấy việc.',404);
   const [r]=await db.select().from(runs).where(eq(runs.taskId,t.id));
   if(t.status==='cancelled')fail('Việc đã hủy.',409);
   if(!r&&t.assigneePosition!=='warehouse'&&t.assigneeId!==target)fail('Công việc không thuộc nhân viên Kho được chọn.',404);
   if(r?.memberId&&r.memberId!==target)fail('Người phụ trách đã thay đổi. Tải lại.',409);
   const due=r?.dueAt||deadline(t);if(due&&action==='configure')await assertOpen(db,target,vietnamMonth(due));
   if(action==='claim'){
    if(r||t.assigneeId||t.assigneePosition!=='warehouse'||t.status!=='todo')fail('Việc đã được nhận hoặc thay đổi.',409);
    if(Number(b.taskRevision)!==t.revision)fail('Việc vừa thay đổi. Tải lại.',409);
    await db.update(tasks).set({assigneeId:target,assigneePosition:null,revision:t.revision+1,updatedAt:now}).where(eq(tasks.id,t.id));return {ok:true};
   }
   if(action==='configure'){
    if(t.status!=='todo'||r&&r.stage!=='todo')fail('Chỉ cấu hình trước khi bắt đầu.',409);
    if(!due)fail('Đặt hạn công việc trên phiếu Công việc trước khi cấu hình.');
    if(!KINDS.includes(b.kind as never))fail('Loại việc không hợp lệ.');
    if(!text(b.note))fail('Nhập căn cứ định mức.');
    if(Number(b.revision||0)!==(r?.revision||0)||Number(b.taskRevision)!==t.revision)fail('Việc vừa thay đổi. Tải lại.',409);
    const [config]=await db.select().from(settings).where(eq(settings.id,'default'));if(!config||!validCalendar(parseJson(config.calendar,null)))fail('Cài đặt ca làm trước khi giao định mức.');
    const data={taskId:t.id,memberId:target,kind:b.kind as typeof KINDS[number],weight:positive(b.weight,10000),standardMinutes:positive(b.standardMinutes,100000),calendar:config.calendar,dueAt:due,evidence:'',reviewNote:text(b.note),updatedAt:now};
    await db.insert(runs).values(data).onConflictDoUpdate({target:runs.taskId,set:{...data,revision:(r?.revision||0)+1}});
    await db.update(tasks).set({assigneeId:target,assigneePosition:null,revision:t.revision+1,updatedAt:now}).where(eq(tasks.id,t.id));return {ok:true};
   }
   if(!r)fail('Manager cần duyệt định mức và hạn trước khi bắt đầu.',409);
   if(Number(b.revision)!==r.revision)fail('Công việc vừa thay đổi. Tải lại trước khi thao tác.',409);
   const patch:Partial<typeof runs.$inferInsert>={updatedAt:now,revision:r.revision+1};const waits=parseJson<Wait[]>(r.waits,[]);
   if(action==='start'){
    if(r.stage!=='todo'||t.status==='done')fail('Không thể bắt đầu việc này.',409);
    if(await workingJob(db,target))fail('Hoàn thành hoặc báo vướng mắc việc đang làm trước.',409);
    patch.stage='working';patch.startedAt=now;
    await db.update(tasks).set({status:'in_progress',startedAt:t.startedAt||now,revision:t.revision+1,updatedAt:now}).where(eq(tasks.id,t.id));
   }else if(action==='cancel'){
    if(t.autoKey)fail('Hủy trên phiếu nghiệp vụ gốc, không hủy bước kho từ bảng chấm điểm.',409);
    if(!text(b.note))fail('Nhập lý do hủy.');patch.stage='cancelled';patch.reviewNote=text(b.note);
    await db.update(tasks).set({status:'cancelled',revision:t.revision+1,updatedAt:now}).where(eq(tasks.id,t.id));
   }else if(action==='block'){
    if(r.stage!=='working'||text(b.note).length<3)fail('Nhập lý do vướng mắc cho việc đang làm.');
    waits.push({id:crypto.randomUUID(),start:now,end:null,reason:text(b.note),decision:'pending'});patch.waits=JSON.stringify(waits);patch.stage='blocked';
   }else if(action==='resume'){
    if(r.stage!=='blocked')fail('Việc không đang chờ.',409);
    if(await workingJob(db,target))fail('Có việc khác đang làm.',409);
    const wait=waits.find(w=>!w.end);if(!wait)fail('Khoảng chờ không hợp lệ.',409);wait.end=now;patch.waits=JSON.stringify(waits);patch.stage='working';
   }else if(action==='submit'){
    if(r.stage!=='working'||text(b.note).length<3)fail('Nhập kết quả / bằng chứng trước khi gửi hoàn thành.');
    patch.stage='submitted';patch.submittedAt=now;patch.evidence=text(b.note);
   }else if(action==='review-wait'){
    const wait=waits.find(w=>w.id===b.waitId);if(!wait||!wait.end||wait.decision!=='pending')fail('Chỉ duyệt khoảng chờ đã kết thúc và chưa xử lý.',409);
    if(!['approved','rejected'].includes(String(b.decision))||!text(b.note))fail('Chọn kết quả và nhập lý do.');
    wait.decision=b.decision as Wait['decision'];wait.reviewedBy=m.id;wait.reviewNote=text(b.note);patch.waits=JSON.stringify(waits);
   }else if(action==='reject'){
    if(r.stage!=='submitted'||!text(b.note))fail('Nhập lý do yêu cầu làm lại.');patch.stage='working';patch.submittedAt=null;patch.reviewNote=text(b.note);patch.quality='error';
    waits.push({id:crypto.randomUUID(),start:r.submittedAt!,end:now,reason:'Chờ xác nhận kết quả trước khi yêu cầu làm lại',decision:'approved',reviewedBy:m.id,reviewNote:text(b.note)});patch.waits=JSON.stringify(waits);
    if(await workingJob(db,target))fail('Nhân viên có việc khác đang làm. Xử lý việc đó trước.',409);
   }else if(action==='confirm'){
    if(r.stage!=='submitted'||!['clean','error'].includes(String(b.quality))||!text(b.note))fail('Chọn chất lượng và nhập nhận xét.');
    if(waits.some(w=>w.decision==='pending'))fail('Duyệt các khoảng chờ trước khi xác nhận kết quả.',409);
    if(t.autoKey&&t.status!=='done')fail('Hoàn tất phiếu nghiệp vụ gốc trước; xác nhận điểm không thay thao tác nhập/xuất kho.',409);
    await assertSourceCompleted(db,t);
    patch.stage='confirmed';patch.confirmedAt=now;patch.confirmedBy=m.id;patch.quality=r.quality==='error'?'error':String(b.quality);patch.reviewNote=text(b.note);
    if(!t.autoKey)await db.update(tasks).set({status:'done',completedAt:r.submittedAt,completedBy:target,revision:t.revision+1,updatedAt:now}).where(eq(tasks.id,t.id));
   }else fail('Thao tác không hợp lệ.');
   await db.update(runs).set(patch).where(eq(runs.taskId,t.id));return {ok:true};
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
  await c.env.db.transaction(async tx=>{const db=tx as unknown as Db;await lockWorker(db,id);await assertOpen(db,id,month);const report=await liveReport(db,id,month,now);
   if(report.score===null)fail('Chưa đủ dữ liệu hoặc còn kết quả / khoảng chờ chưa xác nhận.',409);
   if(report.fingerprint!==b.fingerprint)fail('Số liệu vừa thay đổi. Tải lại và đối soát trước khi duyệt.',409);
   await db.insert(months).values({memberId:id,month,snapshot:JSON.stringify(report),approvedBy:m.id,approvedAt:now});
  });return json({ok:true,previewOnly:true});
 },'business');
}
