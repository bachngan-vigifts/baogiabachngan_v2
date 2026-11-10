import {contractTest as test} from '../TEST_TEMPLATE.ts';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {homeFixture} from '../helpers/home-fixture.ts';
import {tasks} from '../../src/modules/tasks/schema.ts';
import {warehouseWorkRuns as runs} from '../../src/modules/warehouse-workspace/schema.ts';
const calendar={days:[0,1,2,3,4,5,6],start:'00:00',end:'23:59',breakStart:'',breakEnd:''};
const ok=(r:any,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};
async function setup(){const f=await homeFixture(),at=new Date().toISOString();await f.client.query("insert into staff_members(id,name,email,role,position_id,active,created_at) values('wh2','Kho 2','wh2@x.vn','employee','warehouse',true,'2026-02-01T00:00:00Z')");
 ok(await f.call('/warehouse-workspace/settings',f.cookies.mgr,'PUT',{calendar,bonusBudget:1000000,revision:0,reason:'Kiểm tra điều phối'}));
 for(let i=0;i<5;i++)await f.db.insert(tasks).values({id:'dispatch-'+i,title:'Việc có thưởng '+i,assigneePosition:'warehouse',dueDate:f.today,createdAt:at,updatedAt:at});
 const run=async(id:string)=>(await f.db.select().from(runs).where(eq(runs.taskId,id)))[0]!;
 const act=async(id:string,action:string,extra:any={},who=f.cookies.mgr)=>f.call('/warehouse-workspace/'+id+'/action',who,'POST',{action,revision:(await run(id))?.revision||0,taskRevision:(await f.db.select().from(tasks).where(eq(tasks.id,id)))[0]!.revision,...extra});
 const configure=(id:string,memberId='auto')=>act(id,'configure',{memberId,kind:'manual',standardMinutes:30,note:'Định mức công việc đã duyệt'});
 return{...f,run,act,configure};}
test('dispatch holds one slot per free worker, blocked stays busy, completion frees before reward approval',async()=>{
 const f=await setup();ok(await f.configure('dispatch-0'));let first=await f.run('dispatch-0');assert.equal(first.memberId,'wh2'); // older createdAt wins
 ok(await f.configure('dispatch-1'));const second=await f.run('dispatch-1');assert.equal(second.memberId,'wh');
 ok(await f.configure('dispatch-2'));assert.equal((await f.run('dispatch-2')).memberId,null);ok(await f.act('dispatch-2','start',{},f.cookies.wh),409);
 ok(await f.configure('dispatch-3','wh'),409);
 ok(await f.act('dispatch-1','start',{},f.cookies.wh));ok(await f.act('dispatch-1','block',{note:'Chờ hàng đã báo Manager'},f.cookies.wh));
 const blocked=ok(await f.call('/warehouse-workspace',f.cookies.wh));assert.equal(blocked.availability.length,1);assert.equal(blocked.availability[0].status,'blocked');assert.ok(!JSON.stringify(blocked.availability).includes('Kho 2'));
 ok(await f.act('dispatch-1','resume',{},f.cookies.wh));ok(await f.act('dispatch-1','submit',{note:'Đã làm xong và bàn giao'},f.cookies.wh));
 assert.equal((await f.run('dispatch-1')).stage,'submitted');assert.equal((await f.run('dispatch-2')).memberId,'wh');assert.ok((await f.run('dispatch-2')).offeredAt);
 ok(await f.act('dispatch-2','start',{},f.cookies.wh));
 ok(await f.act('dispatch-1','reject',{note:'Kiểm tra lại đóng gói'}));assert.equal((await f.run('dispatch-1')).stage,'todo');assert.equal((await f.run('dispatch-1')).offeredAt,null);assert.equal((await f.run('dispatch-1')).quality,'error');assert.equal((await f.run('dispatch-2')).stage,'working');
 ok(await f.act('dispatch-2','submit',{note:'Đã hoàn thành việc tiếp theo'},f.cookies.wh));assert.ok((await f.run('dispatch-1')).offeredAt);
 const started=(await f.run('dispatch-1')).startedAt;ok(await f.act('dispatch-1','start',{},f.cookies.wh));assert.equal((await f.run('dispatch-1')).startedAt,started);
});
test('simultaneous direct dispatch cannot reserve two jobs for one employee; stale start and unauthorized dispatch rejected',async()=>{
 const f=await setup();const r=await Promise.all([f.configure('dispatch-0','wh'),f.configure('dispatch-1','wh')]);assert.deepEqual(r.map(r=>r.status).sort(),[200,409]);
 const id=r[0].status===200?'dispatch-0':'dispatch-1',revision=(await f.run(id)).revision;
 ok(await f.call('/warehouse-workspace/'+id+'/action',f.cookies.wh,'POST',{action:'start',revision}));
 ok(await f.call('/warehouse-workspace/'+id+'/action',f.cookies.wh,'POST',{action:'start',revision}),409);
 ok(await f.call('/warehouse-workspace/dispatch-queue',f.cookies.emp,'POST',{}),403);ok(await f.call('/warehouse-workspace/dispatch-queue',f.cookies.wh,'POST',{force:true}),403);
});
test('offers remind after five minutes, can be reassigned before acceptance and source-completed unaccepted work releases its slot',async()=>{
 const f=await setup();ok(await f.configure('dispatch-0','wh'));await f.db.update(runs).set({offeredAt:new Date(Date.now()-360000).toISOString()}).where(eq(runs.taskId,'dispatch-0'));
 let board=ok(await f.call('/warehouse-workspace?member=wh',f.cookies.mgr));assert.equal(board.availability.find((x:any)=>x.id==='wh').needsReminder,true);
 ok(await f.act('dispatch-0','reoffer',{memberId:'wh2',note:'Giao lại người đang rảnh'}));assert.equal((await f.run('dispatch-0')).memberId,'wh2');
 await f.db.update(tasks).set({status:'done',updatedAt:new Date().toISOString()}).where(eq(tasks.id,'dispatch-0'));
 board=ok(await f.call('/warehouse-workspace',f.cookies.mgr));assert.equal(board.availability.find((x:any)=>x.id==='wh2').status,'free');
});

test('legacy work already in progress blocks new rewarded dispatch without adopting old todo backlogs',async()=>{
 const f=await setup(),at=new Date().toISOString();
 await f.db.insert(tasks).values({id:'legacy-working',title:'Việc Kho đang làm ở Công việc',assigneeId:'wh',status:'in_progress',startedAt:at,createdAt:at,updatedAt:at});
 ok(await f.configure('dispatch-0','wh'),409);
 const before=ok(await f.call('/warehouse-workspace',f.cookies.wh));assert.equal(before.availability[0].status,'working');assert.equal(before.availability[0].job.taskId,'legacy-working');
 await f.db.update(tasks).set({status:'done',completedAt:at}).where(eq(tasks.id,'legacy-working'));ok(await f.configure('dispatch-0','wh'));
 ok(await f.configure('home-manager','auto'),404);
});
