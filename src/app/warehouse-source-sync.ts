import {and,eq,inArray,isNull,like,or,sql} from 'drizzle-orm';
import type {StaffEnv} from '../modules/staff/api/auth-routes.ts';
import {tasks} from '../modules/tasks/schema.ts';
import {packingSlips} from '../modules/sales/schema.ts';
import {incomingShipments,supplierReceipts} from '../modules/suppliers/schema.ts';
import {packingTasksFor,reconcileTaskSet,transferTasks,type AutoTask} from '../modules/tasks/api/auto-tasks.ts';
import {receivingReminderTasks} from '../modules/tasks/api/receiving-reminders.ts';
import {vietnamDate} from '../modules/sales/domain/sales.ts';
import {assignFreshWarehouseTasks,warehouseAssignees} from '../modules/warehouse-workspace/assignment.ts';
/** Narrow, repeatable event reconciliation; never scans or closes unrelated rules. */
export async function syncWarehouseSource(env:StaffEnv,type:string,id:string){
 const now=new Date(),today=vietnamDate(now).iso;let wanted:AutoTask[]=[],scope;
 if(type==='packing'){
  const slips=await env.db.select({id:packingSlips.id}).from(packingSlips).where(or(eq(packingSlips.id,id),eq(packingSlips.orderId,id)));
  if(!slips.length)return[];const ids=slips.map(s=>s.id);wanted=await packingTasksFor(env.db,today,ids);scope=and(eq(tasks.source,'packing'),inArray(tasks.sourceId,ids),like(tasks.autoKey,'slip:%'));
 }else if(type==='transfer'){wanted=await transferTasks(env.db,today,id);scope=and(eq(tasks.source,'transfer'),eq(tasks.sourceId,id));}
 else if(type==='purchase'||type==='early'){
  wanted=await receivingReminderTasks(env.db,now,id);
  if(type==='purchase'){
   const [p]=await env.db.select().from(incomingShipments).where(eq(incomingShipments.id,id));
   if(p?.approvalStatus==='approved'&&!p.cancelledAt){const [r]=await env.db.select({n:sql<number>`count(*)`.mapWith(Number)}).from(supplierReceipts).where(and(eq(supplierReceipts.shipmentId,id),isNull(supplierReceipts.cancelledAt),inArray(supplierReceipts.sapoStatus,['pending','failed'])));
    if(r?.n)wanted.push({autoKey:'po-sapo:'+id,source:'purchase',sourceId:id,link:'#/purchases/'+id,title:'Nhập kho Sapo '+p.ticketNumber,description:r.n+' phiếu nhận chưa nhập Sapo',assigneeId:null,assigneePosition:'warehouse',priority:'high',dueDate:today});
   }
  }
  scope=and(eq(tasks.source,'purchase'),eq(tasks.sourceId,id),or(like(tasks.autoKey,'receiving-due:%'),like(tasks.autoKey,'po-sapo:%')));
 }else return[];
 await reconcileTaskSet(env.db,new Map(wanted.map(t=>[t.autoKey,t])),now,scope);
 const rows=wanted.length?await env.db.select({id:tasks.id}).from(tasks).where(inArray(tasks.autoKey,wanted.map(t=>t.autoKey))):[];
 await assignFreshWarehouseTasks(env.db,rows.map(t=>t.id),now.toISOString());
 const linked=await warehouseAssignees(env.db,rows.map(t=>t.id));return [...new Set([...linked.values()].map(a=>a.canonicalId))];
}

/** Five-minute repair also creates missed source tasks, without needing an open browser. */
export async function reconcileWarehouseSources(env:StaffEnv){
 const {RULES}=await import('../modules/tasks/api/auto-tasks.ts'),now=new Date(),today=vietnamDate(now).iso;
 const prefixes=['slip:','transfer-move:','transfer-receive:','receiving-due:','po-sapo:','purchase:'],wanted=new Map<string,AutoTask>();let failed=false;
 for(const name of ['packingSlips','stockTransfers','receivingReminders','supplierPurchases','purchaseReceive']){
  const rule=RULES[name];if(!rule)continue;
  try{for(const t of await rule(env.db,today,now))if(prefixes.some(p=>t.autoKey.startsWith(p)))wanted.set(t.autoKey,t);}catch(e){failed=true;console.error('warehouse source rule failed',name,e instanceof Error?e.message:e);}
 }
 const result=await reconcileTaskSet(env.db,wanted,now,or(...prefixes.map(prefix=>like(tasks.autoKey,prefix+'%'))),failed);
 await assignFreshWarehouseTasks(env.db,result.fresh.map(t=>t.id),now.toISOString());
 return{created:result.created,closed:result.closed};
}
