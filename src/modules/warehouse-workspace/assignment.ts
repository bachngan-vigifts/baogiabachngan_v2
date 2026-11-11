import {and,eq,inArray,isNull,or,sql,asc,ne} from 'drizzle-orm';
import type {AnyDb} from '../../core/db/client.ts';
import type {WarehouseSourceTask} from '../../core/contracts/warehouse-source.ts';
import {warehouseSourceHooks} from '../../core/contracts/warehouse-source.ts';
import {AppError} from '../../core/errors.ts';
import {employees} from '../staff/schema.ts';
import {tasks} from '../tasks/schema.ts';
import {warehouseStaff} from '../inventory/api/transfer-routes.ts';
import {warehouseWorkAssignments as assignments,warehouseWorkSourceLinks as links,warehouseWorkParts as parts,warehouseWorkRuns as runs,warehouseWorkMonths as months,warehouseWorkSettings as settings} from './schema.ts';
import {warehouseAvailability,warehouseDispatchLock,dispatchWarehouseQueue} from './dispatch.ts';
import {recommendWarehouseMember,parseJson,validCalendar,vietnamMonth} from './domain.ts';
import {sha256Hex} from '../staff/domain/session.ts';
function fail(message:string,status=409):never{throw new AppError(status,message);}
export const withoutAssignedSource=()=>sql`not exists(select 1 from ${links} join ${assignments} on ${assignments.taskId}=${links.assignmentId} where ${links.taskId}=${tasks.id} and (${assignments.mode}='team' or ${links.taskId}<>${assignments.taskId}))`;
export const withoutAnyAssignment=()=>sql`not exists(select 1 from ${links} where ${links.taskId}=${tasks.id})`;
export async function warehouseAssignees(db:AnyDb,ids:string[]){
 if(!ids.length)return new Map<string,{memberId:string;canonicalId:string}>();
 const rows=await db.select({id:links.taskId,lead:assignments.leadId,canonicalId:assignments.taskId}).from(links).innerJoin(assignments,eq(assignments.taskId,links.assignmentId)).where(inArray(links.taskId,ids));
 return new Map(rows.map(r=>[r.id,{memberId:r.lead,canonicalId:r.canonicalId}]));
}
export async function warehouseSourceTask(db:AnyDb,t:typeof tasks.$inferSelect){
 const [p]=await db.select({sourceId:parts.assignmentId}).from(parts).where(eq(parts.taskId,t.id)).limit(1);
 if(!p)return t;
 const [source]=await db.select().from(tasks).where(eq(tasks.id,p.sourceId));if(!source)fail('Không tìm thấy công việc nguồn.');return source!;
}
export async function assignmentRoster(db:AnyDb,t:WarehouseSourceTask,now:string){
 if(!warehouseSourceHooks.resolve)fail('Chưa kết nối phân công với phiếu nguồn.',503);
 const source=await warehouseSourceHooks.resolve!(db,t);if(!source||source.cancelled)return null;
 const ids=await warehouseStaff(db,source.warehouseId);
 const people=ids.length?await db.select({id:employees.id,name:employees.name}).from(employees).where(and(inArray(employees.id,ids),eq(employees.positionId,'warehouse'),eq(employees.active,true),isNull(employees.deletedAt))):[];
 const roster=await warehouseAvailability(db,now);
 if(!people.length)return{source,people:[],recommended:null};
 const peopleIds=people.map(p=>p.id),since=new Date(Date.parse(now)-30*86400e3).toISOString();
 const [coefficients,queued,unprepared]=await Promise.all([
  db.select({id:runs.memberId,total:sql<number>`sum(${runs.weight})`.mapWith(Number),done:sql<number>`coalesce(sum(${runs.weight}) filter(where ${runs.stage}='confirmed' and ${runs.quality} in ('clean','error')),0)`.mapWith(Number)}).from(runs).innerJoin(tasks,eq(tasks.id,runs.taskId)).where(and(inArray(runs.memberId,peopleIds),ne(tasks.status,'cancelled'),sql`${runs.dueAt}>=${since} and ${runs.dueAt}<=${now}`)).groupBy(runs.memberId),
  db.select({id:runs.memberId,n:sql<number>`count(*)`.mapWith(Number)}).from(runs).innerJoin(tasks,eq(tasks.id,runs.taskId)).where(and(inArray(runs.memberId,peopleIds),eq(runs.stage,'todo'),isNull(runs.offeredAt),ne(tasks.status,'cancelled'),ne(tasks.status,'done'))).groupBy(runs.memberId),
  db.select({id:assignments.leadId,n:sql<number>`count(*)`.mapWith(Number)}).from(assignments).innerJoin(tasks,eq(tasks.id,assignments.taskId)).where(and(inArray(assignments.leadId,peopleIds),eq(assignments.prepared,false),ne(tasks.status,'done'),ne(tasks.status,'cancelled'))).groupBy(assignments.leadId),
 ]);
 const available=people.map(p=>{const state=roster.find(r=>r.id===p.id),c=coefficients.find(c=>c.id===p.id);return{...p,status:state?.status??'free',freeSince:state?.freeSince??now,coefficient:c&&c.done>0&&c.total>0?c.done/c.total:null,queueCount:(queued.find(q=>q.id===p.id)?.n??0)+(unprepared.find(q=>q.id===p.id)?.n??0)};});
 return{source,people:available,recommended:recommendWarehouseMember(available)};
}
const warehouseTask=()=>or(eq(tasks.assigneePosition,'warehouse'),sql`${tasks.assigneeId} in (select id from staff_members where position_id='warehouse' and role='employee')`);
export async function assignmentCandidates(db:AnyDb,now:string,query={taskId:'',q:'',page:0}){
 const rows=await db.select().from(tasks).where(and(warehouseTask(),sql`${tasks.autoKey} is not null`,eq(tasks.status,'todo'),sql`not exists(select 1 from ${runs} where ${runs.taskId}=${tasks.id})`,query.taskId?eq(tasks.id,query.taskId):undefined,sql`not exists(select 1 from ${links} join ${assignments} on ${assignments.taskId}=${links.assignmentId} where ${links.taskId}=${tasks.id} and ${assignments.prepared}=true)`,query.q?sql`${tasks.title} ilike ${'%'+query.q.replace(/[\\%_]/g,'\\$&')+'%'}`:undefined)).orderBy(asc(tasks.dueDate),asc(tasks.id)).limit(101).offset(query.page*100);
 const groups=new Map<string,typeof rows[number]>();
 for(const t of rows){const guessed=t.autoKey?.startsWith('receiving-due:')?t.autoKey.slice(0,t.autoKey.lastIndexOf(':')):t.autoKey;if(guessed&&groups.has(guessed))continue;const source=await warehouseSourceHooks.resolve?.(db,t);if(source&&!source.cancelled&&!source.complete&&!groups.has(source.operationKey))groups.set(source.operationKey,t);}
 return{tasks:[...groups.values()].map(t=>({id:t.id,title:t.title,source:t.source,sourceId:t.sourceId,link:t.link,dueDate:t.dueDate,dueTime:t.dueTime,taskRevision:t.revision})),hasMore:rows.length>100};
}
async function linkAliases(db:AnyDb,t:typeof tasks.$inferSelect,operationKey:string,assignmentId:string){
 // Reminder keys include a recipient. Group only warehouse reminders for this exact source step.
 const possible=await db.select().from(tasks).where(and(eq(tasks.source,t.source),t.sourceId?eq(tasks.sourceId,t.sourceId):eq(tasks.id,t.id),warehouseTask(),sql`${tasks.autoKey} is not null`));
 for(const alias of possible){const s=await warehouseSourceHooks.resolve?.(db,alias);if(s?.operationKey!==operationKey)continue;
  if(alias.id!==assignmentId&&(await db.select({id:runs.taskId}).from(runs).where(eq(runs.taskId,alias.id)).limit(1)).length)fail('Công việc cùng phiếu đã có dữ liệu theo dõi. Giữ luồng hiện tại.');
  await db.insert(links).values({taskId:alias.id,assignmentId}).onConflictDoNothing();
 }
}
/** Event-triggered earmarking has no fabricated norms/timestamps/points. Real preparation remains an explicit approval. */
export async function assignFreshWarehouseTasks(db:AnyDb,ids:string[],now:string){
 if(!ids.length)return;
 await db.transaction(async tx=>{const d=tx as unknown as AnyDb;await warehouseDispatchLock(d);
  const rows=await d.select().from(tasks).where(and(inArray(tasks.id,ids),warehouseTask(),eq(tasks.status,'todo'))).orderBy(asc(tasks.id));
  for(const t of rows){const info=await assignmentRoster(d,t,now);if(!info||!info.recommended||info.source.complete)continue;
   const [prior]=await d.select().from(assignments).where(eq(assignments.operationKey,info.source.operationKey));
   const id=prior?.taskId??t.id,lead=prior?.leadId??info.recommended.id;
   if((await d.select({id:runs.taskId}).from(runs).where(eq(runs.taskId,t.id)).limit(1)).length)continue;
   const siblings=await d.select().from(tasks).innerJoin(runs,eq(runs.taskId,tasks.id)).where(and(eq(tasks.source,t.source),t.sourceId?eq(tasks.sourceId,t.sourceId):eq(tasks.id,t.id),warehouseTask()));
   let tracked=false;for(const sibling of siblings){if((await warehouseSourceHooks.resolve?.(d,sibling.tasks))?.operationKey===info.source.operationKey){tracked=true;break;}}if(tracked)continue;
   if(!prior)await d.insert(assignments).values({taskId:id,operationKey:info.source.operationKey,warehouseId:info.source.warehouseId,mode:'single',leadId:lead,createdAt:now,updatedAt:now,reason:info.recommended.status==='free'?'Tự đề xuất người rảnh':'Tự đề xuất theo kết quả đã xác nhận / số việc chờ'});
   await linkAliases(d,t,info.source.operationKey,id);
   if(t.assigneeId!==lead||t.assigneePosition)await d.update(tasks).set({assigneeId:lead,assigneePosition:null,updatedAt:now,revision:sql`${tasks.revision}+1`}).where(eq(tasks.id,t.id));
  }
 });
}
export async function prepareSourceAssignment(db:AnyDb,taskId:string,actorId:string,b:Record<string,any>,now:string){
 return db.transaction(async tx=>{const d=tx as unknown as AnyDb;await warehouseDispatchLock(d);
  const [initial]=await d.select().from(tasks).where(and(eq(tasks.id,taskId),warehouseTask(),sql`${tasks.autoKey} is not null`)).for('update');if(!initial)fail('Chọn công việc tự sinh thuộc Kho.',404);
  
  const mode=b.mode;if(!['single','team'].includes(mode))fail('Chọn giao một nhân viên hoặc cả team.',400);
  if(!Array.isArray(b.members)||!b.members.length||b.members.length>50||mode==='single'&&b.members.length!==1||mode==='team'&&b.members.length<2)fail('Chọn đủ thành viên thực hiện.',400);
  const entries=b.members.map((v:any)=>({memberId:String(v.memberId??''),part:String(v.part??'').trim().slice(0,300),minutes:Number(v.standardMinutes),units:v.units==null?1:Number(v.units)})).sort((a:any,b:any)=>a.memberId.localeCompare(b.memberId));
  const ids=entries.map((e:any)=>e.memberId);if(new Set(ids).size!==ids.length||entries.some((e:any)=>!e.part||!Number.isFinite(e.minutes)||e.minutes<=0||e.minutes>100000||!Number.isFinite(e.units)||e.units<=0||e.units>10000))fail('Thành viên, phần việc hoặc định mức không hợp lệ / ngoài kho được phân công.',400);
  const lead=String(b.leadId??ids[0]);if(!ids.includes(lead))fail('Người phụ trách chính phải thuộc team.',400);
  const reason=String(b.reason??'').trim().slice(0,1000);
  const requestedDue=String(b.dueAt??''),hash=sha256Hex(JSON.stringify({mode,lead,entries,reason,requestedDue}));
  const [linked]=await d.select({assignment:assignments}).from(links).innerJoin(assignments,eq(assignments.taskId,links.assignmentId)).where(eq(links.taskId,initial.id)).limit(1);
  if(linked?.assignment.prepared){if(linked.assignment.requestHash!==hash)fail('Công việc đã được phân công. Tải lại trước khi thay đổi.');return{ok:true,id:linked.assignment.taskId,existing:true};}
  const info=await assignmentRoster(d,initial,now);if(!info||info.source.cancelled||info.source.complete)fail('Phiếu nguồn đã hoàn tất, đã hủy hoặc chưa xác định đúng kho.');
  if(entries.some((e:any)=>!info.people.some(p=>p.id===e.memberId)))fail('Không được giao cho nhân viên ngoài kho / đã khóa.',403);
  if(lead!==info.recommended?.id&&!reason)fail('Ghi lý do khi đổi người được đề xuất.',400);
  const [prior]=await d.select().from(assignments).where(eq(assignments.operationKey,info.source.operationKey));
  if(prior?.prepared){if(prior.requestHash!==hash)fail('Công việc đã được phân công. Tải lại trước khi thay đổi.');return{ok:true,id:prior.taskId,existing:true};}
  if(Number(b.taskRevision)!==initial.revision)fail('Công việc vừa thay đổi. Tải lại đề xuất.');
  const root=prior?.taskId??initial.id,[parent]=await d.select().from(tasks).where(eq(tasks.id,root));if(!parent||parent.status!=='todo')fail('Chỉ phân công việc chưa bắt đầu.');
  const [oldRun]=await d.select().from(runs).where(eq(runs.taskId,root));if(oldRun)fail('Việc đã có dữ liệu theo dõi. Giữ luồng xử lý hiện tại.');
  const [config]=await d.select().from(settings).where(eq(settings.id,'default'));if(!config||!validCalendar(parseJson(config.calendar,null)))fail('Cài đặt ca làm trước khi giao định mức.',400);
  if(!parent.dueDate)fail('Phiếu nguồn chưa có hạn. Đặt hạn trước khi giao việc.',400);
  const originalDue=new Date(parent.dueDate+'T'+(parent.dueTime||'23:59')+':00+07:00').toISOString();
  const parsedDue=Date.parse(requestedDue||originalDue);if(!Number.isFinite(parsedDue)||parsedDue<=Date.parse(now))fail('Chọn hạn theo dõi từ lúc giao việc; không hồi tố điểm việc đã quá hạn.',400);
  const due=new Date(parsedDue).toISOString();if(due!==originalDue&&!reason)fail('Ghi lý do khi đặt hạn phần việc khác hạn phiếu gốc.',400);
  const closed=await d.select().from(months).where(and(inArray(months.memberId,ids),eq(months.month,vietnamMonth(due))));if(closed.length)fail('Có thành viên đã chốt hiệu suất tháng. Không ghi vào kỳ đã chốt.');
  if(prior)await d.update(assignments).set({mode,warehouseId:info.source.warehouseId,leadId:lead,prepared:true,requestHash:hash,reason,createdBy:actorId,updatedAt:now,revision:prior.revision+1}).where(eq(assignments.taskId,root));
  else await d.insert(assignments).values({taskId:root,operationKey:info.source.operationKey,warehouseId:info.source.warehouseId,mode,leadId:lead,prepared:true,requestHash:hash,reason,createdBy:actorId,createdAt:now,updatedAt:now});
  await linkAliases(d,initial,info.source.operationKey,root);
  const total=entries.reduce((n:number,e:any)=>n+e.units,0);
  for(const e of entries){const id=mode==='single'?root:'ww-part-'+sha256Hex(root+':'+e.memberId).slice(0,32),share=e.units/total;
   if(mode==='team'){
    await d.insert(tasks).values({id,title:parent.title+' · '+e.part,description:'Phần việc từ '+parent.title,source:parent.source,sourceId:parent.sourceId,link:parent.link,assigneeId:e.memberId,priority:parent.priority,createdBy:actorId,dueDate:parent.dueDate,dueTime:parent.dueTime,createdAt:now,updatedAt:now});
    await d.insert(parts).values({taskId:id,assignmentId:root,memberId:e.memberId,part:e.part,share});
   }
   await d.insert(runs).values({taskId:id,memberId:e.memberId,kind:info.source.kind,weight:share,standardMinutes:e.minutes,calendar:config.calendar,dueAt:due,queuedAt:now,offeredAt:null,reviewNote:'Phân công từ phiếu nguồn'+(mode==='team'?' · phần việc '+e.part:''),updatedAt:now});
  }
  await d.update(tasks).set({assigneeId:lead,assigneePosition:null,revision:sql`${tasks.revision}+1`,updatedAt:now}).where(eq(tasks.id,root));
  await dispatchWarehouseQueue(d,now);
  return{ok:true,id:root,existing:false,members:ids,mode};
 });
}
