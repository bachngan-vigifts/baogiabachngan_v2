import {test} from 'node:test';
import assert from 'node:assert/strict';
import {and,eq} from 'drizzle-orm';
import {homeFixture} from '../helpers/home-fixture.ts';
import {warehouses} from '../../src/modules/catalog/schema.ts';
import {warehouseSellers} from '../../src/modules/inventory/schema.ts';
import {salesOrders,packingSlips} from '../../src/modules/sales/schema.ts';
import {employees} from '../../src/modules/staff/schema.ts';
import {tasks} from '../../src/modules/tasks/schema.ts';
import {warehouseWorkAssignments as assignments,warehouseWorkParts as parts,warehouseWorkSourceLinks as links,warehouseWorkRuns as runs,warehouseWorkMonths as months} from '../../src/modules/warehouse-workspace/schema.ts';
import {recommendWarehouseMember} from '../../src/modules/warehouse-workspace/domain.ts';
import {reconcileTaskSet,packingTasksFor,type AutoTask} from '../../src/modules/tasks/api/auto-tasks.ts';
import {dispatchWarehouseQueue,warehouseDispatchLock} from '../../src/modules/warehouse-workspace/dispatch.ts';
const ok=(r:any,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};
import {sourceAssignmentFixture} from '../helpers/warehouse-source-assignment-fixture.ts';

test('recommendation: free precedes coefficient; busy uses verified completion then queue; missing data is explicit',()=>{
 const a={id:'a',status:'free',freeSince:'2026-01-01',coefficient:null,queueCount:0},b={...a,id:'b',status:'working',coefficient:1};
 assert.equal(recommendWarehouseMember([b,a])?.id,'a');
 assert.equal(recommendWarehouseMember([{...a,status:'working',coefficient:.8},{...b,coefficient:.9}])?.id,'b');
 assert.equal(recommendWarehouseMember([{...a,status:'working',queueCount:3},{...b,coefficient:null,queueCount:1}])?.id,'b');
 assert.equal(recommendWarehouseMember([]),null);
});
test('source work is reused, authorization is enforced, and duplicate single assignment preserves inventory/payroll',async()=>{
 const f=await sourceAssignmentFixture(),body=await f.request(),before=await f.client.query('select (select count(*) from stock_moves)::int stock,(select count(*) from hr_payslips)::int payroll');
 ok(await f.assign(body,f.cookies.wh),403);ok(await f.assign({...body,members:[{...body.members[0],memberId:'emp'}],leadId:'emp'}),403);
 ok(await f.assign({...body,taskRevision:-1}),409);
 const replies=await Promise.all([f.assign(body),f.assign(body)]);replies.forEach(r=>ok(r));assert.equal(replies.filter(r=>r.data.existing).length,1);
 assert.equal((await f.db.select().from(runs).where(eq(runs.taskId,f.id))).length,1);
 assert.equal((await f.db.select().from(tasks).where(eq(tasks.autoKey,'slip:source-slip'))).length,1);
 assert.deepEqual((await f.client.query('select (select count(*) from stock_moves)::int stock,(select count(*) from hr_payslips)::int payroll')).rows,before.rows);
 await f.db.update(packingSlips).set({status:'packed'}).where(eq(packingSlips.id,'source-slip'));
 assert.equal(ok(await f.assign(body)).existing,true,'lost-response retry remains safe after source completion');
});
test('team parts use one canonical source, normalize shares, and cannot be completed before the source document',async()=>{
 const f=await sourceAssignmentFixture(),body=await f.request('team');ok(await f.assign(body));
 const work=await f.db.select().from(parts).where(eq(parts.assignmentId,f.id));assert.equal(work.length,2);
 assert.equal(work.reduce((n,p)=>n+p.share,0),1);assert.equal((await f.db.select().from(runs)).reduce((n,r)=>n+r.weight,0),1);
 assert.equal((await f.db.select().from(assignments)).length,1);assert.equal((await f.db.select().from(links)).length,1);
 for(const p of work){const cookie=p.memberId==='wh'?f.cookies.wh:f.wh2;ok(await f.act(p.taskId,'start',cookie));ok(await f.act(p.taskId,'submit',cookie,{note:'Đã hoàn tất phần việc, có bàn giao'}));ok(await f.act(p.taskId,'confirm',f.cookies.mgr,{quality:'clean',note:'Kiểm đếm đủ'}),409);}
 await f.db.update(packingSlips).set({status:'packed'}).where(eq(packingSlips.id,'source-slip'));
 const wanted=await packingTasksFor(f.db,f.today,['source-slip']);await reconcileTaskSet(f.db,new Map(wanted.map(t=>[t.autoKey,t])),new Date(),eq(tasks.sourceId,'source-slip'));
 for(const p of work)ok(await f.act(p.taskId,'confirm',f.cookies.mgr,{quality:'clean',note:'Đã đối chiếu phiếu nguồn'}));
 for(const memberId of ['wh','wh2']){const board=ok(await f.call('/warehouse-workspace?member='+memberId,f.cookies.mgr));assert.equal(board.report.missing,0,'source parent must not be counted again');assert.equal(board.report.completedWeight,.5);}
 assert.equal((await f.db.select().from(tasks).where(eq(tasks.autoKey,'slip:source-slip'))).length,1);
});
test('busy employees receive queued parts, never a second active slot; source cancellation releases without awarding points',async()=>{
 const f=await sourceAssignmentFixture(),at=new Date().toISOString();
 for(const memberId of ['wh','wh2'])await f.db.insert(tasks).values({id:'busy-'+memberId,title:'Việc đang làm',assigneeId:memberId,status:'in_progress',startedAt:at,createdAt:at,updatedAt:at});
 const body=await f.request('team');ok(await f.assign(body));const work=await f.db.select().from(parts);
 for(const p of work){assert.equal((await f.row(p.taskId)).offeredAt,null);ok(await f.act(p.taskId,'start',p.memberId==='wh'?f.cookies.wh:f.wh2),409);}
 await f.db.update(packingSlips).set({status:'cancelled'}).where(eq(packingSlips.id,'source-slip'));
 await f.db.update(tasks).set({status:'done',completedAt:at}).where(eq(tasks.id,f.id));
 await f.db.transaction(async tx=>{await warehouseDispatchLock(tx as any);await dispatchWarehouseQueue(tx as any,new Date().toISOString());});
 for(const p of work)assert.equal((await f.row(p.taskId)).stage,'cancelled');
 assert.equal((await f.db.select().from(months)).length,0);
});
test('closed months and source changes reject preparation atomically; no arbitrary title or fabricated norm is accepted',async()=>{
 const f=await sourceAssignmentFixture(),body=await f.request('team'),snapshot=await f.db.select().from(tasks);
 ok(await f.assign({...body,members:body.members.map((p:any)=>({...p,standardMinutes:0}))}),400);
 await f.db.insert(months).values({memberId:body.members[0].memberId,month:new Date(Date.parse(body.dueAt)+7*3600000).toISOString().slice(0,7),snapshot:'{}',approvedBy:'mgr',approvedAt:new Date().toISOString()});
 ok(await f.assign(body),409);assert.equal((await f.db.select().from(parts)).length,0);assert.equal((await f.db.select().from(runs)).length,0);assert.equal((await f.db.select().from(tasks)).length,snapshot.length);
 await f.db.update(packingSlips).set({status:'cancelled'}).where(eq(packingSlips.id,'source-slip'));ok(await f.assign(body),409);
});

test('source reconciliation keeps the selected owner even when the producer proposes a different recipient',async()=>{
 const f=await sourceAssignmentFixture(),body=await f.request();ok(await f.assign(body));
 const wanted:AutoTask[]=await packingTasksFor(f.db,f.today,['source-slip']);assert.equal(wanted.length,1);wanted[0]!.assigneeId=body.leadId==='wh'?'wh2':'wh';
 await reconcileTaskSet(f.db,new Map(wanted.map(t=>[t.autoKey,t])),new Date(),eq(tasks.sourceId,'source-slip'));
 assert.equal((await f.db.select().from(tasks).where(eq(tasks.id,f.id)))[0]!.assigneeId,body.leadId);
 ok(await f.call('/warehouse-workspace/assignment-options',f.cookies.wh),403);
 f.env.sapoSyncToken='warehouse-assignment-test-token-000000000000';
 const denied=await f.call('/integrations/warehouse-work/reconcile',f.cookies.mgr,'POST',{});assert.equal(denied.status,401,'staff session cannot invoke server cron');
});


test('recipient aliases share one warehouse operation while manager tasks and distinct purchases stay separate',async()=>{
 const f=await sourceAssignmentFixture(),at=new Date().toISOString();
 const {incomingShipments}=await import('../../src/modules/suppliers/schema.ts');
 const {resolveWarehouseSource}=await import('../../src/app/warehouse-source.ts');
 const {assignFreshWarehouseTasks}=await import('../../src/modules/warehouse-workspace/assignment.ts');
 for(const id of ['po-alias-a','po-alias-b'])await f.db.insert(incomingShipments).values({id,ticketNumber:id,warehouse:'source-wh',arrivalDate:f.today,createdBy:'mgr',createdAt:at,updatedAt:at});
 const base={id:'resolve-fixture',assigneeId:null,assigneePosition:null,link:'#/purchases/po-alias-a',title:'Nhận hàng thử',source:'purchase' as const,sourceId:'po-alias-a',dueDate:f.today,createdAt:at,updatedAt:at};
 await f.db.insert(tasks).values(['wh','wh2','mgr'].map(id=>({...base,id:'alias-'+id,assigneeId:id,autoKey:'receiving-due:purchase:po-alias-a:supplier:'+f.today+':'+id})));
 await assignFreshWarehouseTasks(f.db,['alias-wh','alias-wh2','alias-mgr'],at);
 const aliases=await f.db.select().from(links).where(and(eq(links.assignmentId,'alias-wh')));
 assert.deepEqual(aliases.map(a=>a.taskId).sort(),['alias-wh','alias-wh2']);
 assert.equal((await f.db.select().from(links).where(eq(links.taskId,'alias-mgr'))).length,0,'manager review is not a warehouse alias');
 const a=await resolveWarehouseSource(f.db,{...base,autoKey:'po-sapo:po-alias-a'}),b=await resolveWarehouseSource(f.db,{...base,sourceId:'po-alias-b',autoKey:'po-sapo:po-alias-b'});
 assert.notEqual(a?.operationKey,b?.operationKey,'separate purchase receipt operations must not collapse');
});

test('assignment migration is repeatable and private; applying it again preserves source work',async()=>{
 const f=await sourceAssignmentFixture(),{readFile}=await import('node:fs/promises');
 const migration=await readFile(new URL('../../migrations/postgres/20261111061143_warehouse_source_assignment.sql',import.meta.url),'utf8');
 const before=(await f.db.select().from(assignments)).length;
 for(const statement of migration.split('--> statement-breakpoint'))if(statement.trim())await f.client.exec(statement);
 assert.equal((await f.db.select().from(assignments)).length,before);
 const tables=await f.client.query<{relrowsecurity:boolean}>("select relrowsecurity from pg_class where relname in ('warehouse_work_assignments','warehouse_work_source_links','warehouse_work_parts')");
 assert.equal(tables.rows.length,3);assert.ok(tables.rows.every(t=>t.relrowsecurity));
 const acl=await f.client.query("select 1 from information_schema.role_table_grants where table_name in ('warehouse_work_assignments','warehouse_work_source_links','warehouse_work_parts') and grantee in ('PUBLIC','anon','authenticated')");assert.equal(acl.rows.length,0);
});


test('source warehouse access is rechecked when a team member starts, not only when assigned',async()=>{
 const f=await sourceAssignmentFixture(),body=await f.request('team');ok(await f.assign(body));
 await f.db.delete(warehouseSellers).where(eq(warehouseSellers.warehouseId,'source-wh'));
 const work=await f.db.select().from(parts);for(const p of work)ok(await f.act(p.taskId,'start',p.memberId==='wh'?f.cookies.wh:f.wh2),403);
 assert.ok((await f.db.select().from(runs)).every(r=>!r.startedAt));
});
