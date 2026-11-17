import {and,asc,desc,eq,gte,inArray,like,lte,ne,notInArray,sql} from 'drizzle-orm';
import type {AnyDb} from '../../../core/db/client.ts';
import {tasks} from '../../tasks/schema.ts';
import type {AutoTask} from '../../tasks/api/auto-tasks.ts';
import {staffWeeklyReports} from '../schema.ts';
import {salesOrders} from '../../sales/schema.ts';
import {quotations} from '../../quotes/schema.ts';
import {customers,customerStaff} from '../../customers/schema.ts';
import {orderLinesFromQuote,quoteTotal} from '../../sales/domain/sales.ts';
import {addDays,shiftMonths} from '../domain/weekly.ts';
import {workspaceActions,workspaceForecast,sectorOf,SECTOR_LABELS,type WorkspaceFacts,type WorkspaceInputs} from '../domain/workspace.ts';

export const REPORT_TASK_PREFIX='weekly-report:';
const parse=(raw:string)=>{try{return JSON.parse(raw);}catch{return{};}};
/** Bounded owner-scoped reads. The old report and payroll facts keep their original basis. */
export async function weeklyWorkspaceFacts(db:AnyDb,memberId:string,period:string){
 const to=addDays(period,6),month=to.slice(0,7),lastYear=shiftMonths(month,-12),quoteOwner=sql`coalesce(${quotations.assigneeId},${quotations.creatorId})`,quoteDay=sql`coalesce(nullif(${quotations.quoteDate},''),substr(${quotations.createdAt},1,10))`;
 const counted=and(eq(salesOrders.ownerId,memberId),notInArray(salesOrders.status,['cancelled','draft']));
 const [open,prior,totals,monthly,idle,production]=await Promise.all([
  db.select({id:quotations.id,quoteNo:quotations.quoteNo,customer:quotations.customer,data:quotations.data,date:quotations.quoteDate})
   .from(quotations).where(and(eq(quoteOwner,memberId),gte(quoteDay,addDays(period,-90)),lte(quoteDay,to),sql`not exists(select 1 from sales_orders o where o.quote_id=${quotations.id} and o.status not in ('draft','cancelled'))`)).orderBy(desc(quotations.createdAt)).limit(201),
  db.select({id:staffWeeklyReports.id,data:staffWeeklyReports.data}).from(staffWeeklyReports).where(and(eq(staffWeeklyReports.memberId,memberId),eq(staffWeeklyReports.period,addDays(period,-7)))).limit(1),
  db.select({current:sql<number>`coalesce(sum(case when ${salesOrders.orderDate}>=${period} then ${salesOrders.subtotal} else 0 end),0)`.mapWith(Number),previous:sql<number>`coalesce(sum(case when ${salesOrders.orderDate}<${period} then ${salesOrders.subtotal} else 0 end),0)`.mapWith(Number)})
   .from(salesOrders).where(and(counted,gte(salesOrders.orderDate,addDays(period,-7)),lte(salesOrders.orderDate,to))),
  db.select({customer:salesOrders.customerName,type:customers.customerType,total:salesOrders.total}).from(salesOrders).leftJoin(customers,eq(customers.id,salesOrders.customerId)).where(and(counted,gte(salesOrders.orderDate,month+'-01'),lte(salesOrders.orderDate,to))),
  db.select({id:customers.id,name:customers.name,total:sql<number>`sum(${salesOrders.total})`.mapWith(Number),lastDate:sql<string>`max(${salesOrders.orderDate})`}).from(salesOrders).innerJoin(customers,eq(customers.id,salesOrders.customerId))
   .where(and(counted,eq(customers.approvalStatus,'approved'),gte(salesOrders.orderDate,lastYear+'-01'),lte(salesOrders.orderDate,addDays(shiftMonths(lastYear,1)+'-01',-1)),sql`exists(select 1 from ${customerStaff} s where s.customer_id=${customers.id} and s.member_id=${memberId})`,sql`not exists(select 1 from sales_orders current_order where current_order.customer_id=${customers.id} and current_order.status not in ('draft','cancelled') and current_order.order_date>=${month.slice(0,4)+'-01-01'} and current_order.order_date<=${to})`))
   .groupBy(customers.id,customers.name).orderBy(desc(sql`sum(${salesOrders.total})`)).limit(50),
  db.select({id:salesOrders.id,orderNo:salesOrders.orderNo,customerName:salesOrders.customerName,status:salesOrders.status,plannedDate:salesOrders.expectedDeliveryDate}).from(salesOrders)
   .where(and(eq(salesOrders.ownerId,memberId),notInArray(salesOrders.status,['draft','cancelled','delivered']))).orderBy(asc(salesOrders.expectedDeliveryDate)).limit(50),
 ]);
 const old=prior[0]?parse(prior[0].data).inputs:null;
 const commitments=old?.workspaceVersion===2?(old.planTasks||[]).map((p:{id:string;title:string;date:string;customer:string})=>({...p})):old?.nextWeekPlan?[{id:'legacy-'+prior[0]!.id,title:old.nextWeekPlan,date:'',customer:''}]:[];
 const industries=new Map<string,{industry:string;label:string;revenue:number}>();
 const labels:Record<string,string>={...SECTOR_LABELS,other:'Khác / chưa phân khối'};
 for(const row of monthly){const key=sectorOf(row.type,row.customer);const group=industries.get(key)||{industry:key,label:labels[key]||labels.other!,revenue:0};group.revenue+=row.total;industries.set(key,group);}
 const quotes=open.slice(0,200).map(q=>{let items='';try{items=orderLinesFromQuote(JSON.parse(q.data)).slice(0,2).map(l=>l.name).join(' + ');}catch{}return{id:q.id,quoteNo:q.quoteNo,customer:q.customer,total:quoteTotal(q.data),items,date:q.date,won:false};});
 return{openQuotes:quotes,openQuotesLimited:open.length>200,commitments,netRevenue:totals[0]?.current??0,previousNetRevenue:totals[0]?.previous??0,idleCustomers:idle,monthIndustries:[...industries.values()].sort((a,b)=>b.revenue-a.revenue),production};
}
export function workspaceFactView(f:WorkspaceFacts&{openQuotes?:WorkspaceFacts['quotes'];production?:WorkspaceFacts['deliveries']}){return{...f,quotes:f.openQuotes||f.quotes,deliveries:f.production||f.deliveries};}
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
/** These manually completed follow-ups remain wanted; a generic source reconciliation must not close them. */
export async function weeklyReportTaskSources(db:AnyDb):Promise<AutoTask[]>{
 const rows=await db.select().from(tasks).where(and(eq(tasks.source,'manual'),like(tasks.autoKey,REPORT_TASK_PREFIX+'%'),inArray(tasks.status,['todo','in_progress'])));
 return rows.map(t=>({autoKey:t.autoKey!,source:'manual',sourceId:t.sourceId!,title:t.title,description:t.description,link:t.link,assigneeId:t.assigneeId,priority:t.priority,dueDate:t.dueDate,dueTime:t.dueTime}));
}
export async function weeklyReportActions(db:AnyDb,memberId:string){
 return db.select({id:tasks.id,reportId:tasks.sourceId,key:tasks.autoKey,title:tasks.title,description:tasks.description,status:tasks.status,dueDate:tasks.dueDate,link:tasks.link}).from(tasks)
  .where(and(eq(tasks.assigneeId,memberId),like(tasks.autoKey,REPORT_TASK_PREFIX+'%'),notInArray(tasks.status,['done','cancelled']))).orderBy(asc(tasks.dueDate)).limit(100);
}
export function frozenWorkspaceForecast(v:WorkspaceInputs,f:WorkspaceFacts){return workspaceForecast(v,f.quotes);}

export async function weeklyEventReminders(db:AnyDb,memberId:string,today:string){
 const [row]=await db.select({count:sql<number>`count(*)`.mapWith(Number)}).from(tasks).where(and(eq(tasks.assigneeId,memberId),like(tasks.autoKey,'weekly-report:%:event:%'),inArray(tasks.status,['todo','in_progress']),lte(tasks.dueDate,today)));
 return{count:row?.count??0};
}
