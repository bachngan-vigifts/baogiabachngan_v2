import {warehouseSourceHooks} from '../../core/contracts/warehouse-source.ts';
import {and,asc,eq,inArray,isNotNull,isNull,ne,or,sql} from 'drizzle-orm';
import type {AnyDb} from '../../core/db/client.ts';
import {AppError} from '../../core/errors.ts';
import {employees} from '../staff/schema.ts';
import {tasks} from '../tasks/schema.ts';
import {warehouseWorkRuns as runs,warehouseWorkSettings as settings,warehouseWorkMonths as months,warehouseWorkParts as parts} from './schema.ts';
import {vietnamMonth} from './domain.ts';

/** All dispatch/start/release operations take this transaction lock first. */
export async function warehouseDispatchLock(db:AnyDb){await db.execute(sql`select pg_advisory_xact_lock(170332,4101)`);}
export const activeWarehousePeople=()=>and(eq(employees.positionId,'warehouse'),eq(employees.role,'employee'),eq(employees.active,true),isNull(employees.deletedAt));
export type Availability='free'|'offered'|'working'|'blocked';
export async function warehouseAvailability(db:AnyDb,now:string){
 const people=await db.select({id:employees.id,name:employees.name,createdAt:employees.createdAt}).from(employees).where(activeWarehousePeople()).orderBy(asc(employees.id));
 if(!people.length)return [];
 const ids=people.map(p=>p.id);
 const tracked=await db.select({taskId:runs.taskId,memberId:runs.memberId,title:tasks.title,revision:runs.revision,taskRevision:tasks.revision,stage:runs.stage,startedAt:runs.startedAt,submittedAt:runs.submittedAt,offeredAt:runs.offeredAt,updatedAt:runs.updatedAt})
  .from(runs).innerJoin(tasks,eq(tasks.id,runs.taskId)).where(and(inArray(runs.memberId,ids),ne(tasks.status,'cancelled'),or(inArray(runs.stage,['working','blocked']),and(eq(runs.stage,'todo'),ne(tasks.status,'done'),isNotNull(runs.offeredAt)))));
 const legacy=await db.select({taskId:tasks.id,memberId:tasks.assigneeId,title:tasks.title,taskRevision:tasks.revision,startedAt:tasks.startedAt,updatedAt:tasks.updatedAt}).from(tasks).leftJoin(runs,eq(runs.taskId,tasks.id)).where(and(inArray(tasks.assigneeId,ids),eq(tasks.status,'in_progress'),isNull(runs.taskId)));
 const jobs=[...tracked,...legacy.map(t=>({...t,revision:0,stage:'working' as const,submittedAt:null,offeredAt:null}))];
 const legacyReleases=await db.select({id:tasks.assigneeId,at:sql<string|null>`max(coalesce(${tasks.completedAt},${tasks.updatedAt}))`}).from(tasks).leftJoin(runs,eq(runs.taskId,tasks.id)).where(and(inArray(tasks.assigneeId,ids),inArray(tasks.status,['done','cancelled']),isNull(runs.taskId))).groupBy(tasks.assigneeId);
 const releases=await db.select({id:runs.memberId,at:sql<string|null>`max(case when ${tasks.status}='cancelled' or ${runs.stage}='cancelled' or (${tasks.status}='done' and ${runs.stage}='todo') then greatest(${tasks.updatedAt},${runs.updatedAt}) when ${runs.stage} in ('submitted','confirmed') then ${runs.submittedAt} when ${runs.stage}='todo' and ${runs.startedAt} is not null and ${runs.offeredAt} is null then ${runs.queuedAt} end)`})
  .from(runs).innerJoin(tasks,eq(tasks.id,runs.taskId)).where(inArray(runs.memberId,ids)).groupBy(runs.memberId);
 return people.map(p=>{
  const own=jobs.filter(j=>j.memberId===p.id),active=own.filter(j=>j.stage==='working'||j.stage==='blocked'||j.stage==='todo'&&!!j.offeredAt)
   .sort((a,b)=>({working:0,blocked:1,todo:2}[a.stage as 'working']??3)-({working:0,blocked:1,todo:2}[b.stage as 'working']??3)||(a.offeredAt||a.startedAt||a.updatedAt).localeCompare(b.offeredAt||b.startedAt||b.updatedAt));
  const job=active[0]||null,status:Availability=job?(job.stage==='todo'?'offered':job.stage as 'working'|'blocked'):'free';
  const freeSince=[releases.find(r=>r.id===p.id)?.at,legacyReleases.find(r=>r.id===p.id)?.at,p.createdAt].filter((s):s is string=>!!s).sort().at(-1)!;
  return {id:p.id,name:p.name,status,freeSince,job,activeCount:active.length,
   waitingMinutes:job?.offeredAt?Math.max(0,Math.floor((Date.parse(now)-Date.parse(job.offeredAt))/60000)):0,
   needsReminder:status==='offered'&&!!job?.offeredAt&&Date.parse(now)-Date.parse(job.offeredAt)>=300000};
 });
}
/** Must run under warehouseDispatchLock. The employee row lock also protects identity changes. */
export async function assertWarehouseFree(db:AnyDb,id:string,exceptTask?:string){
 const [person]=await db.select({id:employees.id}).from(employees).where(and(eq(employees.id,id),activeWarehousePeople())).for('update');
 if(!person)throw new AppError(400,'Chọn nhân viên Kho đang hoạt động.');
 const [occupied]=await db.select({id:runs.taskId}).from(runs).innerJoin(tasks,eq(tasks.id,runs.taskId)).where(and(eq(runs.memberId,id),ne(tasks.status,'cancelled'),exceptTask?ne(runs.taskId,exceptTask):undefined,
  or(inArray(runs.stage,['working','blocked']),and(eq(runs.stage,'todo'),ne(tasks.status,'done'),isNotNull(runs.offeredAt))))).limit(1);
 const [legacy]=await db.select({id:tasks.id}).from(tasks).leftJoin(runs,eq(runs.taskId,tasks.id)).where(and(eq(tasks.assigneeId,id),eq(tasks.status,'in_progress'),isNull(runs.taskId),exceptTask?ne(tasks.id,exceptTask):undefined)).limit(1);
 if(occupied||legacy)throw new AppError(409,'Nhân viên đang bận hoặc đã có việc chờ nhận. Chỉ giao việc cho người rảnh.','WAREHOUSE_BUSY');
}
/** Source closure never grants unworked team credit; cancellation frees unconfirmed parts. */
async function releaseClosedParts(db:AnyDb,now:string){
 const rows=await db.select({part:parts,run:runs}).from(parts).innerJoin(runs,eq(runs.taskId,parts.taskId)).where(inArray(runs.stage,['todo','working','blocked','submitted']));
 if(!rows.length)return;
 const ids=[...new Set(rows.map(r=>r.part.assignmentId))],parents=await db.select().from(tasks).where(inArray(tasks.id,ids));
 const contexts=new Map<string,Awaited<ReturnType<NonNullable<typeof warehouseSourceHooks.resolve>>>>();
 for(const parent of parents){if(parent.status!=='done'&&parent.status!=='cancelled')continue;contexts.set(parent.id,await warehouseSourceHooks.resolve?.(db,parent)??null);}
 for(const {part,run} of rows){const parent=parents.find(t=>t.id===part.assignmentId),source=contexts.get(part.assignmentId);
  if(!parent||!contexts.has(parent.id))continue;
  const cancelled=parent.status==='cancelled'||source?.cancelled;
  if(!cancelled&&!(parent.status==='done'&&source?.complete&&run.stage==='todo'&&!run.startedAt))continue;
  const note=cancelled?'Phiếu nguồn đã hủy · không tính điểm':'Nguồn đã hoàn tất trước khi bắt đầu phần việc · không ghi nhận thời gian/điểm';
  await db.update(runs).set({stage:'cancelled',reviewNote:note,updatedAt:now,revision:sql`${runs.revision}+1`}).where(eq(runs.taskId,part.taskId));
  await db.update(tasks).set({status:'cancelled',updatedAt:now,revision:sql`${tasks.revision}+1`}).where(eq(tasks.id,part.taskId));
 }
}

/** Only explicitly queued rewarded work is auto-assigned; legacy backlogs are never adopted. */
export async function dispatchWarehouseQueue(db:AnyDb,now:string,force=false){
 await releaseClosedParts(db,now);
 const [config]=await db.select().from(settings).where(eq(settings.id,'default'));
 if(!config||!config.autoDispatch&&!force)return [];
 const queue=await db.select({run:runs,task:tasks}).from(runs).innerJoin(tasks,eq(tasks.id,runs.taskId)).where(and(eq(runs.stage,'todo'),isNull(runs.offeredAt),isNotNull(runs.queuedAt),ne(tasks.status,'cancelled'),ne(tasks.status,'done')))
  .orderBy(asc(sql`case ${tasks.priority} when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end`),asc(runs.queuedAt),asc(runs.taskId));
 const roster=await warehouseAvailability(db,now),closed=await db.select({id:months.memberId,month:months.month}).from(months);
 const offered:{taskId:string;memberId:string}[]=[];
 for(const {run,task} of queue){
  const candidate=roster.filter(p=>p.status==='free'&&(!run.memberId||p.id===run.memberId)&&!closed.some(m=>m.id===p.id&&m.month===vietnamMonth(run.dueAt)))
   .sort((a,b)=>a.freeSince.localeCompare(b.freeSince)||a.id.localeCompare(b.id))[0];
  if(!candidate)continue;
  await assertWarehouseFree(db,candidate.id,run.taskId);
  const [current]=await db.select().from(tasks).where(eq(tasks.id,task.id)).for('update');
  if(!current||['done','cancelled'].includes(current.status))continue;
  await db.update(runs).set({memberId:candidate.id,offeredAt:now,revision:sql`${runs.revision}+1`,updatedAt:now}).where(and(eq(runs.taskId,run.taskId),eq(runs.stage,'todo'),isNull(runs.offeredAt)));
  await db.update(tasks).set({assigneeId:candidate.id,assigneePosition:null,revision:sql`${tasks.revision}+1`,updatedAt:now}).where(eq(tasks.id,task.id));
  candidate.status='offered';offered.push({taskId:task.id,memberId:candidate.id});
 }
 return offered;
}
