import {contractTest as test,assert} from '../TEST_TEMPLATE.ts';
import {beforeEach,afterEach,mock} from 'node:test';
import {eq} from 'drizzle-orm';
import {homeFixture} from '../helpers/home-fixture.ts';
import {tasks} from '../../src/modules/tasks/schema.ts';
import {warehouseWorkRuns as runs,warehouseWorkMonths as months} from '../../src/modules/warehouse-workspace/schema.ts';
const calendar={days:[1,2,3,4,5,6],start:'08:00',end:'17:00',breakStart:'12:00',breakEnd:'13:00'};
beforeEach(()=>mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-09T02:00:00Z')}));afterEach(()=>mock.timers.reset());
const check=(r:any,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};
async function setup(){const f=await homeFixture(),now=new Date().toISOString();await f.db.insert(tasks).values([{id:'ww-one',title:'Soạn hàng kiểm thử',assigneeId:'wh',dueDate:'2026-11-09',dueTime:'12:00',createdBy:'mgr',createdAt:now,updatedAt:now},{id:'ww-two',title:'Kiểm đếm',assigneeId:'wh',dueDate:'2026-11-09',createdBy:'mgr',createdAt:now,updatedAt:now}]);const act=(id:string,cookie:string,body:any)=>f.call('/warehouse-workspace/'+id+'/action',cookie,'POST',body);return {...f,cookies:{...f.cookies,mgr:f.cookies.mgr!,wh:f.cookies.wh!,emp:f.cookies.emp!,ncc:f.cookies.ncc!},act};}
test('warehouse workspace restricts data and settings, configures real tasks, serializes start/waits/review and never lets employees self-approve',async()=>{
 const f=await setup(),c=f.cookies;
 check(await f.call('/warehouse-workspace'),401);check(await f.call('/warehouse-workspace',c.ncc),403);check(await f.call('/warehouse-workspace',c.emp),403);
 check(await f.call('/warehouse-workspace?member=other',c.wh),403);
 let w=check(await f.call('/warehouse-workspace',c.wh));assert.ok(w.rows.some((x:any)=>x.id==='ww-one'));assert.ok(!JSON.stringify(w).includes('VIỆC RIÊNG KHÔNG ĐƯỢC LỘ'));assert.equal(w.report.score,null);
 check(await f.act('ww-one',c.wh,{action:'start',revision:0}),409);
 check(await f.call('/warehouse-workspace/settings',c.wh,'PUT',{calendar,revision:0,reason:'Ca làm'}),403);
 check(await f.call('/warehouse-workspace/settings',c.mgr,'PUT',{calendar,bonusBudget:1000000,revision:0,reason:'Thử định mức'}));
 check(await f.call('/warehouse-workspace/settings',c.mgr,'PUT',{calendar,revision:0,reason:'Cũ'}),409);
 check(await f.act('ww-one',c.wh,{action:'configure'}),403);
 for(const id of ['ww-one','ww-two'])check(await f.act(id,c.mgr,{action:'configure',memberId:id==='ww-one'?'wh':'auto',taskRevision:1,revision:0,kind:'picking',weight:2,standardMinutes:30,note:'Định mức được duyệt'}));
 const row=async(id:string)=>(await f.db.select().from(runs).where(eq(runs.taskId,id)))[0]!;
 check(await f.act('ww-one',c.wh,{action:'start',revision:(await row('ww-one')).revision}));
 check(await f.act('ww-two',c.wh,{action:'start',revision:(await row('ww-two')).revision}),409);
 check(await f.act('ww-one',c.wh,{action:'block',revision:(await row('ww-one')).revision,note:'Chờ hàng NCC'}));
 check(await f.act('ww-one',c.wh,{action:'resume',revision:(await row('ww-one')).revision}));
 check(await f.act('ww-one',c.wh,{action:'submit',revision:(await row('ww-one')).revision,note:'Đã kiểm đủ hàng, có phiếu đối chiếu'}));
 check(await f.act('ww-one',c.wh,{action:'confirm',revision:(await row('ww-one')).revision,quality:'clean',note:'Tự duyệt'}),403);
 check(await f.act('ww-one',c.mgr,{action:'confirm',revision:(await row('ww-one')).revision,quality:'clean',note:'Đã kiểm'}),409);
 const wait=JSON.parse((await row('ww-one')).waits)[0];check(await f.act('ww-one',c.mgr,{action:'review-wait',revision:(await row('ww-one')).revision,waitId:wait.id,decision:'approved',note:'NCC trễ, đã xác minh'}));
 check(await f.act('ww-one',c.mgr,{action:'confirm',revision:(await row('ww-one')).revision,quality:'clean',note:'Đủ hàng và đúng quy cách'}));
 assert.equal((await f.db.select().from(tasks).where(eq(tasks.id,'ww-one')))[0]!.status,'done');
 check(await f.act('ww-one',c.mgr,{action:'configure',memberId:'wh'}),409);
 const done=check(await f.call('/warehouse-workspace?tab=done',c.wh));assert.ok(done.rows.some((x:any)=>x.id==='ww-one'));assert.equal(done.counts.doneToday,1);assert.equal(check(await f.call('/warehouse-workspace?tab=todayDone',c.wh)).rows.length,1);assert.equal(check(await f.call('/warehouse-workspace?tab=overdue',c.wh)).rows.length,0);
});
test('warehouse month approval checks input fingerprint, snapshots results, freezes edits and does not create payroll or inventory writes',async()=>{
 const f=await setup(),c=f.cookies;const before=await f.client.query('select (select count(*)::int from stock_moves) as stock,(select count(*)::int from hr_payslips) as payroll');check(await f.call('/warehouse-workspace/settings',c.mgr,'PUT',{calendar,bonusBudget:1000000,revision:0,reason:'Thử ca'}));
 await f.db.insert(tasks).values({id:'ww-old',title:'Việc tháng trước',assigneeId:'wh',dueDate:'2026-10-09',status:'done',createdAt:'2026-10-09T01:00:00Z',updatedAt:'2026-10-09T01:30:00Z'});
 await f.db.insert(runs).values({taskId:'ww-old',memberId:'wh',kind:'manual',stage:'confirmed',weight:1,standardMinutes:30,calendar:JSON.stringify(calendar),dueAt:'2026-10-09T02:00:00Z',startedAt:'2026-10-09T01:00:00Z',submittedAt:'2026-10-09T01:30:00Z',quality:'clean',updatedAt:'2026-10-09T02:00:00Z'});
 const path='/warehouse-workspace?member=wh&month=2026-10',w=check(await f.call(path,c.mgr));assert.equal(w.report.score,100);assert.equal(w.report.bonusPreview,1000000);assert.equal(w.report.previewOnly,true);
 check(await f.call('/warehouse-workspace/approve-month',c.wh,'POST',{memberId:'wh',month:'2026-10',fingerprint:w.report.fingerprint}),403);
 check(await f.call('/warehouse-workspace/approve-month',c.mgr,'POST',{memberId:'wh',month:'2026-10',fingerprint:'stale'}),409);
 check(await f.call('/warehouse-workspace/approve-month',c.mgr,'POST',{memberId:'wh',month:'2026-10',fingerprint:w.report.fingerprint}));
 const closed=check(await f.call(path,c.wh));assert.equal(closed.report.locked,true);assert.equal((await f.db.select().from(months)).length,1);
 check(await f.act('ww-old',c.mgr,{action:'configure',memberId:'wh'}),409);
 check(await f.call('/warehouse-workspace/approve-month',c.mgr,'POST',{memberId:'wh',month:'2026-11'}),400);assert.deepEqual((await f.client.query('select (select count(*)::int from stock_moves) as stock,(select count(*)::int from hr_payslips) as payroll')).rows,before.rows);
});
test('warehouse queue counts before pagination and claiming one shared task is exclusive',async()=>{
 const f=await setup(),c=f.cookies,at=new Date().toISOString();await f.db.insert(tasks).values(Array.from({length:35},(_,i)=>({id:'queue-'+i,title:'Việc nhóm '+i,assigneePosition:'warehouse',dueDate:'2026-11-09',createdAt:at,updatedAt:at})));
 const q=check(await f.call('/warehouse-workspace',c.wh));assert.equal(q.rows.length,30);assert.equal(q.hasMore,true);assert.ok(q.counts.todo>=37);
 const attempts=await Promise.all([f.act('queue-0',c.wh,{action:'claim',taskRevision:1}),f.act('queue-0',c.wh,{action:'claim',taskRevision:1})]);assert.deepEqual(attempts.map(x=>x.status).sort(),[200,409]);assert.equal((await f.db.select().from(tasks).where(eq(tasks.id,'queue-0')))[0]!.assigneeId,'wh');
 assert.equal(check(await f.call('/warehouse-workspace?page=1',c.wh)).rows.length,q.counts.todo-30);
});
test('warehouse work cannot complete an auto source document, and rejected work keeps first-pass error without charging Manager waiting time',async()=>{
 const f=await setup(),c=f.cookies,at=new Date().toISOString();check(await f.call('/warehouse-workspace/settings',c.mgr,'PUT',{calendar,revision:0,reason:'Ca làm'}));
 await f.db.insert(tasks).values({id:'ww-source',title:'Nhận hàng nguồn',source:'purchase',autoKey:'po-receive:ww-source',assigneeId:'wh',dueDate:'2026-11-09',createdAt:at,updatedAt:at});
 const row=async(id:string)=>(await f.db.select().from(runs).where(eq(runs.taskId,id)))[0]!;
 const act=async(id:string,action:string,body:any={})=>f.act(id,c.mgr,{action,revision:(await row(id)).revision,...body});
 for(const id of ['ww-source','ww-one'])check(await f.act(id,c.mgr,{action:'configure',memberId:'auto',taskRevision:1,revision:0,kind:'manual',weight:1,standardMinutes:30,note:'Căn cứ định mức'}));
 check(await act('ww-source','start'));check(await act('ww-source','submit',{note:'Đã đối soát phiếu'}));check(await act('ww-source','confirm',{quality:'clean',note:'Đủ chứng từ'}),409);
 assert.equal((await f.db.select().from(tasks).where(eq(tasks.id,'ww-source')))[0]!.status,'in_progress');
 check(await act('ww-one','start'));mock.timers.tick(600000);check(await act('ww-one','submit',{note:'Kết quả lần đầu'}));mock.timers.tick(1200000);
 check(await act('ww-one','reject',{note:'Cần kiểm lại một dòng hàng'}));check(await act('ww-one','start'));mock.timers.tick(300000);check(await act('ww-one','submit',{note:'Đã sửa dòng hàng và bàn giao'}));
 check(await act('ww-one','confirm',{quality:'clean',note:'Đã sửa, ghi nhận lỗi lần đầu'}));const r=await row('ww-one');assert.equal(r.quality,'error');const {elapsed}=await import('../../src/modules/warehouse-workspace/domain.ts');assert.equal(elapsed(r,new Date().toISOString())?.minutes,15);
});
test('tracked warehouse work cannot be deleted or edited through legacy Tasks and Manager cancellation preserves its record',async()=>{
 const f=await setup(),c=f.cookies;check(await f.call('/warehouse-workspace/settings',c.mgr,'PUT',{calendar,revision:0,reason:'Ca làm'}));
 await f.db.update(tasks).set({createdBy:'wh'}).where(eq(tasks.id,'ww-one'));
 check(await f.act('ww-one',c.mgr,{action:'configure',memberId:'wh',taskRevision:1,revision:0,kind:'manual',weight:1,standardMinutes:30,note:'Căn cứ định mức'}));
 check(await f.call('/tasks/ww-one',c.wh,'DELETE'),409);
 check(await f.call('/tasks/ww-one',c.wh,'PUT',{status:'cancelled',revision:2}),409);
 check(await f.call('/tasks/ww-one',c.mgr,'PUT',{dueDate:'2027-01-01',revision:2}),409);
 let [r]=await f.db.select().from(runs).where(eq(runs.taskId,'ww-one'));
 check(await f.act('ww-one',c.mgr,{action:'cancel',revision:r!.revision,note:'Không còn nhu cầu thực hiện'}));
 [r]=await f.db.select().from(runs).where(eq(runs.taskId,'ww-one'));assert.equal(r!.stage,'cancelled');assert.equal((await f.db.select().from(tasks).where(eq(tasks.id,'ww-one')))[0]!.status,'cancelled');
});
test('closing a warehouse score month freezes the score but does not prevent unfinished operational work from completing later',async()=>{
 const f=await setup(),c=f.cookies;check(await f.call('/warehouse-workspace/settings',c.mgr,'PUT',{calendar,bonusBudget:0,revision:0,reason:'Ca làm'}));
 for(const [id,done] of [['ww-closed-done',true],['ww-closed-late',false]] as const){
  await f.db.insert(tasks).values({id,title:id,assigneeId:'wh',dueDate:'2026-10-09',status:done?'done':'in_progress',createdAt:'2026-10-09T01:00:00Z',updatedAt:'2026-10-09T01:30:00Z'});
  await f.db.insert(runs).values({taskId:id,memberId:'wh',kind:'manual',stage:done?'confirmed':'working',weight:1,standardMinutes:30,calendar:JSON.stringify(calendar),dueAt:'2026-10-09T02:00:00Z',startedAt:'2026-10-09T01:00:00Z',submittedAt:done?'2026-10-09T01:30:00Z':null,quality:done?'clean':null,updatedAt:'2026-10-09T02:00:00Z'});
 }
 const path='/warehouse-workspace?member=wh&month=2026-10',before=check(await f.call(path,c.mgr));assert.equal(before.report.score,72.5);
 check(await f.call('/warehouse-workspace/approve-month',c.mgr,'POST',{memberId:'wh',month:'2026-10',fingerprint:before.report.fingerprint}));
 let [r]=await f.db.select().from(runs).where(eq(runs.taskId,'ww-closed-late'));check(await f.act('ww-closed-late',c.wh,{action:'submit',revision:r!.revision,note:'Hoàn tất công việc trễ sang tháng sau'}));
 [r]=await f.db.select().from(runs).where(eq(runs.taskId,'ww-closed-late'));check(await f.act('ww-closed-late',c.mgr,{action:'confirm',revision:r!.revision,quality:'clean',note:'Đã đối soát và hoàn tất công việc'}));
 const after=check(await f.call(path,c.mgr));assert.equal(after.report.score,before.report.score);assert.equal(after.report.fingerprint,before.report.fingerprint);assert.equal(after.report.locked,true);assert.equal((await f.db.select().from(tasks).where(eq(tasks.id,'ww-closed-late')))[0]!.status,'done');
});

test('current-month demo is repeatable and read-only, validates Manager/worker/month, and does not relax official closing',async()=>{
 const f=await setup(),c=f.cookies,endpoint='/warehouse-workspace/approve-month',body={memberId:'wh',month:'2026-11',demo:true};
 const before=await f.client.query('select (select count(*) from warehouse_work_months)::int as months,(select count(*) from stock_moves)::int as stock,(select count(*) from hr_payslips)::int as payroll');
 check(await f.call(endpoint,'','POST',body),401);for(const role of ['wh','emp','ncc'])check(await f.call(endpoint,c[role as keyof typeof c],'POST',body),403);
 for(const override of [{month:'2026-10'},{month:'2026-12'},{month:'2026-13'},{memberId:'emp'},{memberId:'missing'},{demo:'true'}])check(await f.call(endpoint,c.mgr,'POST',{...body,...override}),400);
 check(await f.call(endpoint,c.mgr,'POST',{...body,demo:false}),400);
 const first=check(await f.call(endpoint,c.mgr,'POST',body));assert.equal(first.demo,true);assert.equal(first.previewOnly,true);assert.equal(first.report.locked,false);assert.equal(first.report.score,null);assert.equal('tasks' in first.report,false,'demo returns no raw task records');
 check(await f.call('/warehouse-workspace/settings',c.mgr,'PUT',{calendar,bonusBudget:1000000,revision:0,reason:'Quỹ demo'}));
 await f.db.insert(tasks).values({id:'ww-demo-scored',title:'Việc hoàn tất để demo',assigneeId:'wh',dueDate:'2026-11-09',status:'done',createdAt:'2026-11-09T01:00:00Z',updatedAt:'2026-11-09T01:30:00Z'});
 await f.db.insert(runs).values({taskId:'ww-demo-scored',memberId:'wh',kind:'manual',stage:'confirmed',weight:1,standardMinutes:30,calendar:JSON.stringify(calendar),dueAt:'2026-11-09T02:00:00Z',startedAt:'2026-11-09T01:00:00Z',submittedAt:'2026-11-09T01:30:00Z',quality:'clean',updatedAt:'2026-11-09T02:00:00Z'});
 const scored=check(await f.call(endpoint,c.mgr,'POST',body));assert.equal(scored.report.score,100);assert.equal(scored.report.bonusPreview,1000000);
 check(await f.call('/warehouse-workspace/settings',c.mgr,'PUT',{calendar,bonusBudget:2000000,revision:1,reason:'Đổi quỹ chạy lại demo'}));
 const again=check(await f.call(endpoint,c.mgr,'POST',body));assert.equal(again.report.bonusPreview,2000000);assert.equal(again.report.locked,false);assert.notEqual(again.report.fingerprint,scored.report.fingerprint);
 assert.equal(check(await f.call('/warehouse-workspace?member=wh&month=2026-11',c.mgr)).report.locked,false);
 assert.deepEqual((await f.client.query('select (select count(*) from warehouse_work_months)::int as months,(select count(*) from stock_moves)::int as stock,(select count(*) from hr_payslips)::int as payroll')).rows,before.rows);
});

test('Manager employee filter excludes shared and other employee work, team mode is separate, and worker claiming scope stays intact',async()=>{
 const f=await setup(),c=f.cookies,at=new Date().toISOString();
 await f.client.query("insert into staff_members(id,email,name,phone,role,position_id,active,created_at) values ('wh-filter','wh-filter@x.vn','Kho kiểm thử 2','','employee','warehouse',true,$1)",[at]);
 for(const [id,assignee,status]of [['filter-own','wh','todo'],['filter-other','wh-filter','todo'],['filter-run-owner','wh','todo'],['filter-team',null,'todo'],['filter-cancelled','wh-filter','cancelled']]as const)await f.db.insert(tasks).values({id,title:id,assigneeId:assignee,assigneePosition:'warehouse',status,dueDate:'2026-11-08',createdBy:'mgr',createdAt:at,updatedAt:at});
 await f.db.insert(runs).values({taskId:'filter-run-owner',memberId:'wh-filter',kind:'manual',stage:'todo',weight:1,standardMinutes:30,calendar:JSON.stringify(calendar),dueAt:'2026-11-08T02:00:00Z',updatedAt:at});
 const list=async(q:string,cookie=c.mgr)=>check(await f.call('/warehouse-workspace?'+q,cookie));
 const first=await list('member=wh');assert.ok(first.rows.some((r:any)=>r.id==='filter-own'));assert.ok(!first.rows.some((r:any)=>['filter-other','filter-team','filter-run-owner','home-team'].includes(r.id)));
 const other=await list('member=wh-filter');assert.deepEqual(other.rows.map((r:any)=>r.id).sort(),['filter-other','filter-run-owner']);assert.equal(other.counts.todo,2);assert.equal(other.counts.overdue,2);assert.equal(other.memberId,'wh-filter');assert.equal(other.report.eligible,2);
 const team=await list('scope=team');assert.equal(team.scope,'team');assert.equal(team.memberId,'');assert.equal(team.report,null);assert.deepEqual(team.rows.map((r:any)=>r.id).sort(),['filter-team','home-team']);assert.equal(team.counts.todo,2);assert.equal(team.counts.overdue,1);
 assert.deepEqual((await list('member=wh-filter&tab=overdue')).rows.map((r:any)=>r.id).sort(),['filter-other','filter-run-owner']);
 const worker=await list('',c.wh);assert.ok(worker.rows.some((r:any)=>r.id==='filter-own'));assert.ok(worker.rows.some((r:any)=>r.id==='filter-team'));assert.ok(!worker.rows.some((r:any)=>['filter-other','filter-run-owner'].includes(r.id)));
 check(await f.call('/warehouse-workspace?scope=team',c.wh),403);check(await f.call('/warehouse-workspace?member=wh-filter',c.wh),403);check(await f.call('/warehouse-workspace?scope=bad',c.mgr),400);check(await f.call('/warehouse-workspace?scope=team&member=wh',c.mgr),400);
 const expected=other.rows.map((r:any)=>r.id);assert.deepEqual((await list('member=wh-filter')).rows.map((r:any)=>r.id),expected,'repeat employee switch does not retain the shared queue');
});

test('warehouse tasks default to one workload point when omitted or blank, without inventing standard minutes or changing existing weights',async()=>{
 const f=await setup(),c=f.cookies;check(await f.call('/warehouse-workspace/settings',c.mgr,'PUT',{calendar,revision:0,reason:'Ca thử điểm mặc định'}));
 const configure={action:'configure',memberId:'wh',taskRevision:1,revision:0,kind:'picking',standardMinutes:30,note:'Thời gian theo thao tác thực tế'};
 check(await f.act('ww-one',c.mgr,configure));check(await f.act('ww-two',c.mgr,{...configure,memberId:'auto',weight:''}));
 const row=async(id:string)=>(await f.db.select().from(runs).where(eq(runs.taskId,id)))[0]!;
 assert.equal((await row('ww-one')).weight,1);assert.equal((await row('ww-two')).weight,1);
 check(await f.act('ww-one',c.mgr,{...configure,taskRevision:2,revision:1,weight:2}));assert.equal((await row('ww-one')).weight,2,'an explicit existing weight is retained until the Manager changes it');
 for(const weight of [0,-1,'bad',10001])check(await f.act('ww-two',c.mgr,{...configure,memberId:'auto',taskRevision:2,revision:1,weight}),400);
 check(await f.act('ww-two',c.mgr,{...configure,memberId:'auto',taskRevision:2,revision:1,standardMinutes:undefined}),400);
 assert.equal((await row('ww-one')).weight,2);assert.equal((await row('ww-two')).standardMinutes,30);
});
