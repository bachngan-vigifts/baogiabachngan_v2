import {test} from 'node:test';
import assert from 'node:assert/strict';
import {and,eq} from 'drizzle-orm';
import {sourceAssignmentFixture} from '../helpers/warehouse-source-assignment-fixture.ts';
import {tasks} from '../../src/modules/tasks/schema.ts';
import {employees,positionPermissions} from '../../src/modules/staff/schema.ts';
import {warehouses} from '../../src/modules/catalog/schema.ts';
import {warehouseSellers} from '../../src/modules/inventory/schema.ts';
import {salesOrders,packingSlips} from '../../src/modules/sales/schema.ts';
import {incomingShipments} from '../../src/modules/suppliers/schema.ts';
import {warehouseWorkAssignments as assignments,warehouseWorkParts as parts,warehouseWorkSourceLinks as links,warehouseWorkRuns as runs} from '../../src/modules/warehouse-workspace/schema.ts';
import {assignFreshWarehouseTasks} from '../../src/modules/warehouse-workspace/assignment.ts';
const ok=(r:any,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};

test('revoked packing permission removes warehouse members from recommendations and blocks an old prepared start',async()=>{
 const f=await sourceAssignmentFixture(),body=await f.request('team');ok(await f.assign(body));
 await f.db.delete(positionPermissions).where(and(eq(positionPermissions.positionId,'warehouse'),eq(positionPermissions.permission,'page.packing')));
 const work=await f.db.select().from(parts);
 for(const p of work)ok(await f.act(p.taskId,'start',p.memberId==='wh'?f.cookies.wh:f.wh2),403);
 assert.ok((await f.db.select().from(runs)).every(r=>r.startedAt===null));
});
test('source without a deadline accepts an explicit approved work deadline without modifying the document',async()=>{
 const f=await sourceAssignmentFixture();await f.db.update(tasks).set({dueDate:null,dueTime:null}).where(eq(tasks.id,f.id));
 await f.db.update(salesOrders).set({expectedDeliveryDate:null}).where(eq(salesOrders.id,'liq-order'));
 const body=await f.request();ok(await f.assign(body));assert.equal((await f.row(f.id)).dueAt,body.dueAt);
 assert.equal((await f.db.select().from(salesOrders).where(eq(salesOrders.id,'liq-order')))[0]!.expectedDeliveryDate,null);
});
test('team rework after source completion retains the original first-pass error and can resume only an already started part',async()=>{
 const f=await sourceAssignmentFixture(),body=await f.request('team');ok(await f.assign(body));const [part]=await f.db.select().from(parts);assert.ok(part);
 const cookie=part.memberId==='wh'?f.cookies.wh:f.wh2;ok(await f.act(part.taskId,'start',cookie));ok(await f.act(part.taskId,'submit',cookie,{note:'Đã làm phần việc'}));
 await f.db.update(packingSlips).set({status:'packed'}).where(eq(packingSlips.id,'source-slip'));await f.db.update(tasks).set({status:'done'}).where(eq(tasks.id,f.id));
 ok(await f.act(part.taskId,'reject',f.cookies.mgr,{note:'Sửa lại nhãn, không xuất kho thêm'}));
 ok(await f.act(part.taskId,'start',cookie));assert.equal((await f.row(part.taskId)).quality,'error');
 ok(await f.act(part.taskId,'submit',cookie,{note:'Đã sửa nhãn và đối chiếu'}));ok(await f.act(part.taskId,'confirm',f.cookies.mgr,{quality:'clean',note:'Đạt sau sửa'}));assert.equal((await f.row(part.taskId)).quality,'error');
});
test('a new warehouse recipient alias joins an already prepared single operation and is not scored twice',async()=>{
 const f=await sourceAssignmentFixture(),now=new Date().toISOString();
 await f.db.insert(incomingShipments).values({id:'po-audit',ticketNumber:'PO_AUDIT',warehouse:'source-wh',arrivalDate:f.today,createdAt:now,createdBy:'mgr',updatedAt:now});
 const t={title:'Nhận hàng thử',source:'purchase' as const,sourceId:'po-audit',dueDate:f.today,dueTime:'08:00',createdAt:now,updatedAt:now,link:'#/purchases/po-audit'};
 await f.db.insert(tasks).values({...t,id:'po-alias-wh',assigneeId:'wh',autoKey:'receiving-due:purchase:po-audit:ncc:'+f.today+':wh'});
 await assignFreshWarehouseTasks(f.db,['po-alias-wh'],now);
 const o=ok(await f.call('/warehouse-workspace/assignment-options?taskId=po-alias-wh',f.cookies.mgr)),b={...(await f.request()),leadId:o.recommended,taskRevision:o.tasks[0].taskRevision,members:[{memberId:o.recommended,part:'Kiểm đếm',standardMinutes:20,units:1}]};
 ok(await f.call('/warehouse-workspace/po-alias-wh/assign',f.cookies.mgr,'POST',b));
 await f.db.insert(tasks).values({...t,id:'po-alias-wh2',assigneeId:'wh2',autoKey:'receiving-due:purchase:po-audit:ncc:'+f.today+':wh2'});
 await assignFreshWarehouseTasks(f.db,['po-alias-wh2'],now);
 assert.equal((await f.db.select().from(links).where(eq(links.taskId,'po-alias-wh2')))[0]?.assignmentId,'po-alias-wh');
 assert.equal((await f.db.select().from(runs)).length,1);
});
test('unprepared earmark replaces a disabled employee instead of preserving an unusable owner',async()=>{
 const f=await sourceAssignmentFixture(),[prior]=await f.db.select().from(assignments).where(eq(assignments.taskId,f.id));assert.ok(prior);
 await f.db.update(employees).set({active:false}).where(eq(employees.id,prior.leadId));await assignFreshWarehouseTasks(f.db,[f.id],new Date().toISOString());
 const [after]=await f.db.select().from(assignments).where(eq(assignments.taskId,f.id));assert.notEqual(after!.leadId,prior.leadId);
 assert.equal((await f.db.select().from(tasks).where(eq(tasks.id,f.id)))[0]!.assigneeId,after!.leadId);
});
test('unconfigured source warehouse cannot be claimed or configured through legacy warehouse/task routes',async()=>{
 const f=await sourceAssignmentFixture(),at=new Date().toISOString();await f.db.insert(warehouses).values({id:'outside-wh',name:'Kho ngoài phân công',kind:'stock'});
 await f.db.update(salesOrders).set({warehouseId:'outside-wh'}).where(eq(salesOrders.id,'liq-order'));
 await f.db.delete(links).where(eq(links.assignmentId,f.id));await f.db.delete(assignments).where(eq(assignments.taskId,f.id));
 await f.db.update(tasks).set({assigneeId:null,assigneePosition:'warehouse'}).where(eq(tasks.id,f.id));const [t]=await f.db.select().from(tasks).where(eq(tasks.id,f.id));
 ok(await f.call('/warehouse-workspace/'+f.id+'/action',f.cookies.wh,'POST',{action:'claim',taskRevision:t!.revision}),403);
 ok(await f.call('/warehouse-workspace/'+f.id+'/action',f.cookies.mgr,'POST',{action:'configure',memberId:'wh',taskRevision:t!.revision,revision:0,kind:'packing',standardMinutes:30,note:'Thử luồng cũ'}),409);
 ok(await f.call('/tasks/'+f.id,f.cookies.wh,'PUT',{status:'in_progress',revision:t!.revision}),409);
 const board=ok(await f.call('/warehouse-workspace',f.cookies.wh));assert.ok(!board.rows.some((x:any)=>x.id===f.id));
 assert.equal((await f.db.select().from(runs)).length,0);
});

async function purchaseWork(f:Awaited<ReturnType<typeof sourceAssignmentFixture>>){
 const now=new Date().toISOString(),id='po-completion-audit';
 await f.db.insert(incomingShipments).values({id,ticketNumber:'PO_COMPLETION',warehouse:'source-wh',arrivalDate:f.today,createdAt:now,createdBy:'mgr',updatedAt:now});
 await f.db.insert(tasks).values({id:'po-completion-task',title:'Nhập Sapo thử',source:'purchase',sourceId:id,autoKey:'po-sapo:'+id,assigneePosition:'warehouse',dueDate:f.today,createdAt:now,updatedAt:now,link:'#/purchases/'+id});
 await assignFreshWarehouseTasks(f.db,['po-completion-task'],now);
 const o=ok(await f.call('/warehouse-workspace/assignment-options?taskId=po-completion-task',f.cookies.mgr)),b={...(await f.request()),leadId:o.recommended,taskRevision:o.tasks[0].taskRevision,members:[{memberId:o.recommended,part:'Đối chiếu phiếu nhập',standardMinutes:20,units:1}]};
 return{id:'po-completion-task',body:b};
}
test('source becoming unresolvable cannot fall back to a weaker receipt completion check',async()=>{
 const f=await sourceAssignmentFixture(),p=await purchaseWork(f);ok(await f.call('/warehouse-workspace/'+p.id+'/assign',f.cookies.mgr,'POST',p.body));
 const cookie=p.body.leadId==='wh'?f.cookies.wh:f.wh2;ok(await f.act(p.id,'start',cookie));ok(await f.act(p.id,'submit',cookie,{note:'Đã đối chiếu dữ liệu thử'}));
 await f.db.update(tasks).set({status:'done'}).where(eq(tasks.id,p.id));await f.db.update(warehouses).set({active:false}).where(eq(warehouses.id,'source-wh'));
 ok(await f.act(p.id,'confirm',f.cookies.mgr,{quality:'clean',note:'Thử từ chối khi không còn kho hợp lệ'}),409);
 assert.equal((await f.row(p.id)).stage,'submitted');
});
test('role matrix: only Manager assigns; each worker reads and mutates only their own team part',async()=>{
 const f=await sourceAssignmentFixture(),b=await f.request('team');
 ok(await f.call('/warehouse-workspace/assignment-options'),401);
 for(const role of ['emp','acct','counter','admin','restricted','ncc']){
  const cookie=(f.cookies as Record<string,string>)[role]!;ok(await f.call('/warehouse-workspace',cookie),403);ok(await f.assign(b,cookie),403);ok(await f.call('/warehouse-workspace/source-sync',cookie,'POST',{type:'packing',id:'source-slip'}),403);
 }
 ok(await f.assign(b));const work=await f.db.select().from(parts);
 for(const person of ['wh','wh2']){const cookie=person==='wh'?f.cookies.wh:f.wh2,own=work.find(p=>p.memberId===person)!,other=work.find(p=>p.memberId!==person)!;
  const board=ok(await f.call('/warehouse-workspace',cookie));assert.ok(board.rows.some((r:any)=>r.id===own.taskId));assert.ok(!board.rows.some((r:any)=>r.id===other.taskId));
  ok(await f.call('/warehouse-workspace?member='+other.memberId,cookie),403);
  for(const action of ['start','block','resume','submit','confirm','reject','cancel','reoffer','review-wait'])ok(await f.act(other.taskId,action,cookie,{note:'Thử quyền truy cập',quality:'clean'}),403);
  ok(await f.call('/tasks/'+own.taskId,cookie,'PUT',{status:'done'}),409);
 }
 await Promise.allSettled([...f.background]);
 const notifications=await f.client.query<{target_member_id:string}>("select target_member_id from staff_web_notifications where event_type='warehouse_work_assigned'");assert.deepEqual(notifications.rows.map(r=>r.target_member_id).sort(),['wh','wh2']);
});
test('locked/deleted workers are excluded and existing sessions cannot start work after being disabled',async()=>{
 const f=await sourceAssignmentFixture(),b=await f.request('team');ok(await f.assign(b));const work=await f.db.select().from(parts),p=work.find(p=>p.memberId==='wh2')!;
 await f.db.update(employees).set({active:false,deletedAt:new Date().toISOString()}).where(eq(employees.id,'wh2'));
 ok(await f.act(p.taskId,'start',f.wh2),401);ok(await f.call('/warehouse-workspace',f.wh2),401);
 const [source]=await f.db.select().from(tasks).where(eq(tasks.id,f.id));const {assignmentRoster}=await import('../../src/modules/warehouse-workspace/assignment.ts');const roster=await assignmentRoster(f.db,source!,new Date().toISOString());assert.ok(roster?.people.every(p=>p.id!=='wh2'));
});
test('transfer move uses the sending warehouse; receive uses destination and never borrows unrelated staff',async()=>{
 const f=await sourceAssignmentFixture(),now=new Date().toISOString(),{stockTransfers}=await import('../../src/modules/inventory/schema.ts');
 await f.db.insert(warehouses).values({id:'showroom-test',name:'Showroom thử',kind:'stock'});await f.db.insert(warehouseSellers).values({warehouseId:'showroom-test',positionId:'sales-lock'});
 await f.db.insert(stockTransfers).values({id:'transfer-audit',transferNo:'PCK_AUDIT',fromWarehouseId:'source-wh',toWarehouseId:'showroom-test',status:'approved',requestedBy:'emp',createdAt:now,updatedAt:now});
 ok(await f.call('/warehouse-workspace/source-sync',f.cookies.mgr,'POST',{type:'transfer',id:'transfer-audit'}));
 const [move]=await f.db.select().from(tasks).where(eq(tasks.autoKey,'transfer-move:transfer-audit'));assert.ok(move);
 const from=ok(await f.call('/warehouse-workspace/assignment-options?taskId='+move.id,f.cookies.mgr));assert.equal(from.warehouseId,'source-wh');assert.deepEqual(from.people.map((p:any)=>p.id).sort(),['wh','wh2']);
 await f.db.update(stockTransfers).set({status:'shipped'}).where(eq(stockTransfers.id,'transfer-audit'));ok(await f.call('/warehouse-workspace/source-sync',f.cookies.mgr,'POST',{type:'transfer',id:'transfer-audit'}));
 const received=await f.db.select().from(tasks).where(and(eq(tasks.sourceId,'transfer-audit'),eq(tasks.status,'todo')));const t=received.find(t=>t.autoKey?.startsWith('transfer-receive:'));assert.ok(t);
 const {resolveWarehouseSource}=await import('../../src/app/warehouse-source.ts');assert.equal((await resolveWarehouseSource(f.db,t))?.warehouseId,'showroom-test');
 const to=ok(await f.call('/warehouse-workspace/assignment-options?taskId='+t.id,f.cookies.mgr));assert.deepEqual(to.tasks,[],'a storefront receiving task must stay with its configured sales-lock recipient');assert.deepEqual(to.people,[]);assert.equal(to.recommended,null);
 const b=await f.request();ok(await f.call('/warehouse-workspace/'+t.id+'/assign',f.cookies.mgr,'POST',{...b,taskRevision:t.revision}),404);
});
test('different concurrent assignments do not mix a single run and team parts',async()=>{
 const f=await sourceAssignmentFixture(),single=await f.request(),team=await f.request('team');
 const result=await Promise.all([f.assign(single),f.assign(team)]);assert.deepEqual(result.map(r=>r.status).sort(),[200,409]);
 const work=await f.db.select().from(parts),run=await f.db.select().from(runs);assert.ok(work.length===0&&run.length===1||work.length===2&&run.length===2);assert.equal(run.reduce((n,r)=>n+r.weight,0),1);
});

test('single-source rework is offered again while preserving the completed source and original work clock',async()=>{
 const f=await sourceAssignmentFixture(),body=await f.request();ok(await f.assign(body));const cookie=body.leadId==='wh'?f.cookies.wh:f.wh2;
 ok(await f.act(f.id,'start',cookie));const startedAt=(await f.row(f.id)).startedAt;ok(await f.act(f.id,'submit',cookie,{note:'Đã bàn giao ban đầu'}));
 await f.db.update(packingSlips).set({status:'packed'}).where(eq(packingSlips.id,'source-slip'));await f.db.update(tasks).set({status:'done'}).where(eq(tasks.id,f.id));
 ok(await f.act(f.id,'reject',f.cookies.mgr,{note:'Dán lại nhãn, không phát sinh xuất kho'}));assert.ok((await f.row(f.id)).offeredAt);
 ok(await f.act(f.id,'start',cookie));assert.equal((await f.row(f.id)).startedAt,startedAt);assert.equal((await f.db.select().from(tasks).where(eq(tasks.id,f.id)))[0]!.status,'done');
 ok(await f.act(f.id,'submit',cookie,{note:'Đã kiểm tra nhãn lần hai'}));ok(await f.act(f.id,'confirm',f.cookies.mgr,{quality:'clean',note:'Đã sửa đúng'}));assert.equal((await f.row(f.id)).quality,'error');
});

test('missing source warehouse is reported to Manager instead of silently disappearing',async()=>{
 const f=await sourceAssignmentFixture();await f.db.update(salesOrders).set({warehouseId:null,shiftId:null}).where(eq(salesOrders.id,'liq-order'));
 const o=ok(await f.call('/warehouse-workspace/assignment-options?taskId='+f.id,f.cookies.mgr));assert.deepEqual(o.tasks,[]);assert.equal(o.blocked[0].id,f.id);assert.match(o.blocked[0].reason,/kho/i);
});
