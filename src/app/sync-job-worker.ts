import { and, asc, eq, gt, gte, isNull, inArray, like, or } from 'drizzle-orm';
import { tickSyncJob, SyncJobDeferred, type SyncStep } from '../core/jobs/sync-jobs.ts';
import { syncJobs } from '../core/db/schema.ts';
import { json, type Router, type RouteContext } from '../core/http/router.ts';
import { AppError } from '../core/errors.ts';
import type { StaffEnv } from '../modules/staff/api/auth-routes.ts';
import { readPullState, runPull, SAPO_PULL_PHASES } from '../modules/integrations/api/sapo-pull.ts';
import { sapoInventoryDocs } from '../modules/integrations/schema.ts';
import { syncPosGhnPage } from '../modules/sales/api/pos-ghn-sync.ts';
import { packingSlips } from '../modules/sales/schema.ts';
import { stockTransfers } from '../modules/inventory/schema.ts';
import { incomingShipments } from '../modules/suppliers/schema.ts';
import { purchaseEarlyRequests } from '../modules/suppliers/early-request-schema.ts';
import { tasks } from '../modules/tasks/schema.ts';
import { RULES, reconcileTaskSet, type AutoTask } from '../modules/tasks/api/auto-tasks.ts';
import { assignFreshWarehouseTasks } from '../modules/warehouse-workspace/assignment.ts';
import { warehouseDispatchLock, dispatchWarehouseQueue } from '../modules/warehouse-workspace/dispatch.ts';
import { vietnamDate } from '../modules/sales/domain/sales.ts';

async function sapoStep(c: RouteContext<StaffEnv>, state: Record<string, unknown>): Promise<SyncStep> {
  const phase = Number(state.phase ?? 0), name = SAPO_PULL_PHASES[phase];
  if (!name) throw new Error('Invalid Sapo cursor');
  const result = await runPull(c,'durable-job',name).catch(error=>{if(error instanceof AppError&&error.code==='SAPO_PULL_RUNNING')throw new SyncJobDeferred(30_000);throw error;});
  if (!result.ok) throw new Error('Sapo step failed');
  const cursor = (await readPullState(c.env.db)).cursors?.[name];
  // Match legacy per-cycle quotas (3000 incremental / 1500 rotating stock / 1000 docs), but checkpoint each small page.
  const phaseSteps=Number(state.phaseSteps??0)+1, quota=name==='stock'?30:name==='customers'||name==='products'?60:name==='staff'?1:100;
  const hasMore = name==='stock' ? result.results?.stock?.wrapped===0 : name!=='staff' && result.results?.[name]?.unavailable!==1 && (cursor?.offset ?? ((cursor?.page ?? 1)-1)*250)>0;
  const more=hasMore&&phaseSteps<quota, next=more?phase:phase+1;
  return {state:{phase:next,phaseSteps:more?phaseSteps:0},result:{...result},done:next>=SAPO_PULL_PHASES.length};
}
const sources = [
  {filter:eq(packingSlips.status,'sent'),table:packingSlips, rules:['packingSlips'], prefixes:['slip:']},
  {filter:inArray(stockTransfers.status,['pending','approved','shipped']),table:stockTransfers, rules:['stockTransfers'], prefixes:['transfer-move:','transfer-receive:']},
  {filter:and(eq(incomingShipments.approvalStatus,'approved'),isNull(incomingShipments.cancelledAt)),table:incomingShipments, rules:['receivingReminders','supplierPurchases'], prefixes:['receiving-due:purchase:','po-sapo:']},
  {filter:and(eq(purchaseEarlyRequests.status,'submitted'),isNull(purchaseEarlyRequests.deletedAt)),table:purchaseEarlyRequests, rules:['receivingReminders'], prefixes:['receiving-due:early:']},
  {filter:eq(sapoInventoryDocs.kind,'purchase_order'),table:sapoInventoryDocs, rules:['purchaseReceive'], prefixes:['purchase:']},
];
async function warehouseStep(env:StaffEnv,state:Record<string,unknown>):Promise<SyncStep> {
  const phase=Number(state.phase??0), after=String(state.after??''), source=sources[phase];
  if(!source){
    const now=new Date().toISOString();
    const offered=await env.db.transaction(async tx=>{await warehouseDispatchLock(tx);return dispatchWarehouseQueue(tx,now);});
    return{state,result:{checked:Number(state.checked??0),offered:offered.length},done:true};
  }
  // Include open orphan tasks so deleted/completed sources still close correctly. Never close a different source/page.
  const prefix=or(...source.prefixes.map(p=>like(tasks.autoKey,p+'%')));
  const [docs,previous]=await Promise.all([
    env.db.select({id:source.table.id}).from(source.table).where(and(source.filter,gt(source.table.id,after))).orderBy(asc(source.table.id)).limit(1),
    env.db.select({id:tasks.sourceId}).from(tasks).where(and(prefix,gt(tasks.sourceId,after),inArray(tasks.status,['todo','in_progress']))).orderBy(asc(tasks.sourceId)).limit(1),
  ]);
  const id=[docs[0]?.id,previous[0]?.id].filter((id):id is string=>!!id).sort()[0];
  if(!id)return{state:{...state,phase:phase+1,after:''},result:{checked:Number(state.checked??0),offered:0},done:false};
  const now=new Date(),today=vietnamDate(now).iso,wanted=new Map<string,AutoTask>();
  // Failure aborts the step before reconciliation: a missing rule result must never close work.
  for(const name of source.rules)for(const task of await RULES[name]!(env.db,today,now,id))if(source.prefixes.some(p=>task.autoKey.startsWith(p)))wanted.set(task.autoKey,task);
  const result=await reconcileTaskSet(env.db,wanted,now,and(prefix,eq(tasks.sourceId,id)));
  const linked=await env.db.select({id:tasks.id}).from(tasks).where(and(prefix,eq(tasks.sourceId,id),eq(tasks.status,'todo')));
  await assignFreshWarehouseTasks(env.db,linked.map(t=>t.id),now.toISOString());
  return{state:{...state,after:id,checked:Number(state.checked??0)+1},result:{checked:Number(state.checked??0)+1,offered:0,created:result.created,closed:result.closed},done:false};
}
export function registerSyncJobWorker(router:Router<StaffEnv>){
  router.post('/integrations/sync-jobs/tick',async c=>{
    if(!c.env.durableSyncJobs)throw new AppError(503,'Chưa bật worker đồng bộ.','SYNC_WORKER_DISABLED');
    return json(await tickSyncJob(c.env.db,(kind,state)=>kind==='sapo'?sapoStep(c,state):kind==='ghn'?syncPosGhnPage(c.env,state):warehouseStep(c.env,state)));
  },'sapo-sync');
  router.get('/admin/sync-jobs',async c=>{
    const rows=await c.env.db.select({jobId:syncJobs.key,kind:syncJobs.kind,status:syncJobs.status,errorCode:syncJobs.errorCode,updatedAt:syncJobs.updatedAt}).from(syncJobs).where(inArray(syncJobs.kind,['sapo','ghn','warehouse'])).limit(10);
    return json({jobs:rows});
  },'admin');
}
