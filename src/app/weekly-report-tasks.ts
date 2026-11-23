// Composition adapter: report persistence and task writes share the caller's transaction.
// Business modules do not import each other through this adapter.
import {and,asc,eq,inArray,like,lte,notInArray,sql} from 'drizzle-orm';
import type {AnyDb} from '../core/db/client.ts';
import {tasks} from '../modules/tasks/schema.ts';
import {addDays} from '../modules/staff-reports/domain/weekly.ts';
import {workspaceActions,type WorkspaceFacts,type WorkspaceInputs} from '../modules/staff-reports/domain/workspace.ts';
const REPORT_TASK_PREFIX='weekly-report:';
/** Same transaction as the official report: retry/resubmit cannot create a second task for an entry. */
export async function syncWorkspaceActions(db:AnyDb,memberId:string,reportId:string,period:string,v:WorkspaceInputs,f:WorkspaceFacts,stamp:string){
 const actions=workspaceActions(reportId,v,f),prefix=REPORT_TASK_PREFIX+reportId+':';
 const old=await db.select().from(tasks).where(and(eq(tasks.sourceId,reportId),like(tasks.autoKey,prefix+'%'))),byKey=new Map(old.map(t=>[t.autoKey,t]));
 for(const a of actions){const prior=byKey.get(a.key),values={title:a.title,description:a.description,dueDate:a.dueDate,updatedAt:stamp};
  if(prior)await db.update(tasks).set({...values,revision:sql`${tasks.revision}+1`}).where(eq(tasks.id,prior.id));
  else await db.insert(tasks).values({id:crypto.randomUUID(),...values,autoKey:a.key,source:'manual',sourceId:reportId,link:`#/weekly-reports?month=${addDays(period,7).slice(0,7)}&week=${period}`,assigneeId:memberId,createdBy:memberId,status:'todo',priority:a.kind==='debt'?'high':'normal',createdAt:stamp}).onConflictDoNothing();
 }
 const keys=new Set(actions.map(a=>a.key));
 for(const task of old)if(!keys.has(task.autoKey!)&&['todo','in_progress'].includes(task.status))await db.update(tasks).set({status:'cancelled',completedAt:stamp,completedBy:memberId,updatedAt:stamp,revision:sql`${tasks.revision}+1`}).where(eq(tasks.id,task.id));
 return{opportunities:actions.filter(a=>a.kind==='opportunity').length,events:actions.filter(a=>a.kind==='event').length,tasks:actions.length};
}
export async function weeklyReportActions(db:AnyDb,memberId:string){
 return db.select({id:tasks.id,reportId:tasks.sourceId,key:tasks.autoKey,title:tasks.title,description:tasks.description,status:tasks.status,dueDate:tasks.dueDate,link:tasks.link}).from(tasks)
  .where(and(eq(tasks.assigneeId,memberId),like(tasks.autoKey,REPORT_TASK_PREFIX+'%'),notInArray(tasks.status,['done','cancelled']))).orderBy(asc(tasks.dueDate)).limit(100);
}

export async function weeklyEventReminders(db:AnyDb,memberId:string,today:string){
 const [row]=await db.select({count:sql<number>`count(*)`.mapWith(Number)}).from(tasks).where(and(eq(tasks.assigneeId,memberId),like(tasks.autoKey,'weekly-report:%:event:%'),inArray(tasks.status,['todo','in_progress']),lte(tasks.dueDate,today)));
 return{count:row?.count??0};
}
