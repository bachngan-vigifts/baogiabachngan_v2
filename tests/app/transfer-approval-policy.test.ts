import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq,and} from 'drizzle-orm';
import {setupWarehouseWork} from '../helpers/warehouse-work-fixture.ts';
import {employees,credentials} from '../../src/modules/staff/schema.ts';
import {hashPassword} from '../../src/core/auth/password.ts';
import {PASSWORD} from '../helpers/staff-fixture.ts';
import {tasks} from '../../src/modules/tasks/schema.ts';
import {webNotifications} from '../../src/modules/notifications/schema.ts';
import {stockMoves,warehouseSellers} from '../../src/modules/inventory/schema.ts';
import {remindPendingTransfers} from '../../src/modules/inventory/api/transfer-routes.ts';
import {transferCanApprove} from '../../src/modules/inventory/domain/transfer-approval.ts';

test('pure approval matrix: counterpart positions only; Manager is the sole exception',()=>{
 const positions=['sale-admin','sales-lock','sales-ml','sale','warehouse','accounting'];
 for(const requesterPosition of positions)for(const actorPosition of positions){
  const expected=requesterPosition==='sale-admin'?['sales-lock','sales-ml'].includes(actorPosition):['sales-lock','sales-ml'].includes(requesterPosition)&&actorPosition==='sale-admin';
  assert.equal(transferCanApprove({id:'actor',role:'employee',positionId:actorPosition},{id:'requester',role:'employee',positionId:requesterPosition}),expected,requesterPosition+' -> '+actorPosition);
 }
 assert.equal(transferCanApprove({id:'same',role:'employee',positionId:'sale-admin'},{id:'same',role:'employee',positionId:'sales-lock'}),false);
 assert.equal(transferCanApprove({id:'same',role:'manager'},{id:'same',role:'manager',positionId:'manager'}),true);
});

test('API actions, approve/reject, tasks, notifications, reminder and generic inbox use counterpart positions',async()=>{
 const f=await setupWarehouseWork(),cookies={...f.cookies};
 const pw=await hashPassword(PASSWORD,1000);
 for(const [id,positionId] of [['lock','sales-lock'],['ml','sales-ml'],['sa2','sale-admin']] as const){
  await f.db.insert(employees).values({id,name:'NV '+id,email:id+'@x.vn',role:'employee',positionId,active:true,createdAt:new Date().toISOString()});
  await f.db.insert(credentials).values({memberId:id,passwordHash:pw,version:0});
  cookies[id]=(await f.call('/login','','POST',{email:id+'@x.vn',password:PASSWORD})).cookie;
 }
 for(const id of ['kt','emp','sa'])await f.db.update(employees).set({canApprove:true}).where(eq(employees.id,id));
 const before=JSON.stringify(await f.db.select().from(stockMoves));
 const create=async(actor:string)=>f.ok(await f.call('/stock-transfers',cookies[actor],'POST',{clientKey:crypto.randomUUID(),fromWarehouseId:'from',toWarehouseId:'to',reason:'Chuyển qua bán',lines:[{sku:'031106000',qty:1}]}),201);
 const sa=await create('sa'),lock=await create('lock'),ml=await create('ml');
 for(const [request,allowed] of [[sa,['lock','ml']],[lock,['sa','sa2']],[ml,['sa','sa2']]] as const){
  for(const actor of ['sa','sa2','lock','ml','emp','kt','kho','mgr']){
   const expected=actor==='mgr'||(allowed as readonly string[]).includes(actor);
   const view=f.ok(await f.call('/stock-transfers/'+request.id,cookies[actor]));assert.equal(view.actions.approve,expected,request.requestedBy+' / '+actor);assert.equal(view.actions.reject,expected);
  }
 }
 const notes=await f.db.select().from(webNotifications).where(eq(webNotifications.eventType,'transfer_pending'));
 const recipients=(id:string)=>notes.filter(n=>n.dataJson.includes(id)).map(n=>n.targetMemberId).sort();
 assert.deepEqual(recipients(sa.id),['lock','mgr','ml']);assert.deepEqual(recipients(lock.id),['mgr','sa','sa2']);
 const assignees=await f.db.select().from(tasks).where(and(eq(tasks.source,'transfer'),eq(tasks.sourceId,sa.id)));assert.deepEqual(assignees.map(t=>t.assigneeId).sort(),['lock','ml']);
 const inbox=f.ok(await f.call('/approvals',cookies.sa));assert.deepEqual(new Set(inbox.items.filter((i:any)=>i.kind==='transfer').map((i:any)=>i.id)),new Set([lock.id,ml.id]));assert.equal(inbox.counts.transfer,2);
 assert.equal(f.ok(await f.call('/approvals',cookies.kt)).counts.transfer,0);assert.equal(f.ok(await f.call('/approvals',cookies.emp)).counts.transfer,0);
 for(const actor of ['sa2','emp','kt','kho']){
  assert.equal((await f.call('/stock-transfers/'+sa.id+'/approve',cookies[actor],'POST',{})).status,403);
  assert.equal((await f.call('/stock-transfers/'+sa.id+'/reject',cookies[actor],'POST',{reason:'Không đồng ý'})).status,403);
 }
 const stamp=Date.parse(sa.createdAt);await remindPendingTransfers({db:f.db} as any,new Date(stamp+61*60000));
 const reminders=await f.db.select().from(webNotifications).where(eq(webNotifications.eventType,'transfer_pending_reminder'));
 assert.deepEqual(reminders.filter(n=>n.dataJson.includes(sa.id)).map(n=>n.targetMemberId).sort(),['lock','mgr','ml']);
 assert.equal((await f.call('/stock-transfers/'+sa.id+'/approve',cookies.lock,'POST',{revision:sa.revision})).status,200);
 assert.ok((await f.db.select().from(tasks).where(and(eq(tasks.source,'transfer'),eq(tasks.sourceId,sa.id)))).filter(t=>t.autoKey?.startsWith('transfer-approve:')).every(t=>t.status==='done'));
 assert.equal((await f.call('/stock-transfers/'+lock.id+'/reject',cookies.sa,'POST',{reason:'Kho đang kiểm kê'})).status,200);
 assert.equal((await f.call('/stock-transfers/'+ml.id+'/approve',cookies.mgr,'POST',{})).status,200);
 assert.equal(JSON.stringify(await f.db.select().from(stockMoves)),before,'approval does not move stock');
 const other=await create('emp');assert.equal((await f.call('/stock-transfers/'+other.id+'/approve',cookies.sa,'POST',{})).status,403);assert.equal((await f.call('/stock-transfers/'+other.id+'/approve',cookies.mgr,'POST',{})).status,200);
 await f.db.insert(warehouseSellers).values({warehouseId:'private',positionId:'sale-admin'});
 const hidden=f.ok(await f.call('/stock-transfers',cookies.sa,'POST',{clientKey:crypto.randomUUID(),fromWarehouseId:'private',toWarehouseId:'to',reason:'Kho riêng',lines:[{sku:'031106000',qty:1}]}),201);
 assert.equal((await f.call('/stock-transfers/'+hidden.id,cookies.lock)).status,404);
 const hiddenNotes=await f.db.select().from(webNotifications).where(eq(webNotifications.eventType,'transfer_pending'));assert.deepEqual(hiddenNotes.filter(n=>n.dataJson.includes(hidden.id)).map(n=>n.targetMemberId),['mgr']);
 const hiddenTasks=await f.db.select().from(tasks).where(and(eq(tasks.source,'transfer'),eq(tasks.sourceId,hidden.id)));assert.equal(hiddenTasks[0]!.assigneePosition,'manager');
});
