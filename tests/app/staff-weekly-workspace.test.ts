import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {eq,like} from 'drizzle-orm';
import {setupLiquidation} from '../helpers/liquidation-fixture.ts';
import {PASSWORD} from '../helpers/staff-fixture.ts';
import {workspaceSchema} from '../../src/modules/staff-reports/domain/workspace.ts';
import {staffWeeklyReports,staffWeeklyReportVersions} from '../../src/modules/staff-reports/schema.ts';
import {tasks} from '../../src/modules/tasks/schema.ts';
import {weeklyReportTaskSources} from '../../src/modules/tasks/api/auto-tasks.ts';
const good=()=>workspaceSchema.parse({workspaceVersion:2,overview:'Chăm sóc các khối khách',sectors:['bank','agri','aqua'].map(key=>({key,actions:'Gọi khách và gửi mẫu',result:'potential'})),priority:'Chốt các báo giá đã gửi',planTasks:[0,1,2].map(n=>({id:'plan-row-'+n,title:'Việc trọng tâm '+n,customer:'Khách thử',date:'2026-12-10'})),selfScore:4,opportunities:[{id:'opportunity-row-1',customer:'Khách thử',sector:'bank',amount:100,need:'100 ca sứ',occasion:'Hội nghị',dueDate:'2026-12-10'}],events:[{id:'event-row-1',customer:'Khách thử',occasion:'Hội nghị khách hàng',date:'2027-01-20',type:'conference',note:'Cần gửi mẫu'}]});
async function fixture(t:TestContext){const f=await setupLiquidation();t.mock.timers.enable({apis:['Date'],now:new Date('2026-12-07T02:00:00Z').getTime()});const login=async(email:string)=>(await f.call('/login','','POST',{email,password:PASSWORD})).cookie;return{...f,emp:await login('emp@x.vn'),mgr:await login('mgr@x.vn'),other:await login('new@x.vn')};}
test('autosave compare-and-set rejects a stale tab and legacy downgrade without losing the saved draft',async t=>{
 const f=await fixture(t),period='2026-11-30';
 const a=await f.call('/staff-reports/draft',f.emp,'PUT',{period,expectedDraftAt:null,inputs:good()});assert.equal(a.status,200,JSON.stringify(a.data));
 const stale=await f.call('/staff-reports/draft',f.emp,'PUT',{period,expectedDraftAt:null,inputs:{...good(),overview:'Sai bản cũ'}});assert.equal(stale.status,409);
 const b=await f.call('/staff-reports/draft',f.emp,'PUT',{period,expectedDraftAt:a.data.updatedAt,inputs:{...good(),overview:'Cập nhật đúng phiên bản'}});assert.equal(b.status,200);assert.notEqual(b.data.updatedAt,a.data.updatedAt);
 assert.equal((await f.call('/staff-reports/draft',f.emp,'PUT',{period,inputs:{nextWeekPlan:'App cũ'}})).status,409);
 const read=await f.call('/staff-reports/week?period='+period,f.emp);assert.equal(read.data.draft.inputs.overview,'Cập nhật đúng phiên bản');assert.equal((await f.call('/staff-reports/week?period='+period+'&memberId=emp',f.other)).status,403);
});
test('official submission atomically persists new features and actions, retries do not duplicate them, stale versions cannot overwrite',async t=>{
 const f=await fixture(t),period='2026-11-30',inputs=good();
 const draft=await f.call('/staff-reports/draft',f.emp,'PUT',{period,expectedDraftAt:null,inputs});
 const body={period,clientKey:crypto.randomUUID(),expectedVersion:0,expectedDraftAt:draft.data.updatedAt,inputs};
 const sent=await f.call('/staff-reports',f.emp,'POST',body);assert.equal(sent.status,201,JSON.stringify(sent.data));
 const created=await f.db.select().from(tasks).where(like(tasks.autoKey,'weekly-report:%'));assert.equal(created.length,5);assert.equal(created.find(r=>r.autoKey?.includes(':event:'))!.dueDate,'2026-12-06');assert(created.every(r=>r.assigneeId==='emp'));
 assert.equal((await f.call('/staff-reports',f.emp,'POST',body)).data.replayed,true);assert.equal((await f.db.select().from(tasks).where(like(tasks.autoKey,'weekly-report:%'))).length,5);
 assert.equal((await f.call('/staff-reports',f.emp,'POST',{...body,inputs:{...inputs,overview:'Khác nội dung cùng mã'}})).status,409);
 const updated={...body,clientKey:crypto.randomUUID(),expectedVersion:1,expectedDraftAt:null,inputs:{...inputs,overview:'Bản hai đầy đủ'}};
 const second=await f.call('/staff-reports',f.emp,'POST',updated);assert.equal(second.status,200,JSON.stringify(second.data));assert.equal(second.data.version,2);
 assert.equal((await f.call('/staff-reports',f.emp,'POST',body)).data.replayed,true,'old command remains a replay after a newer revision');assert.equal((await f.db.select().from(staffWeeklyReportVersions)).length,2);
 assert.equal((await f.call('/staff-reports',f.emp,'POST',{...updated,clientKey:crypto.randomUUID(),expectedVersion:1})).status,409);
 assert.equal((await f.call('/staff-reports/actions?memberId=emp',f.other)).status,403);assert.equal((await f.call('/staff-reports/actions',f.emp)).data.actions.length,5);
 const reminders=await f.call('/staff-reports/me',f.emp);assert.equal(reminders.data.eventReminders.count,1);
 const wanted=await weeklyReportTaskSources(f.db);assert.equal(wanted.length,5,'source reconciliation preserves report follow-ups');
 const event=created.find(r=>r.autoKey?.includes(':event:'))!;await f.db.update(tasks).set({status:'done',completedBy:'emp'}).where(eq(tasks.id,event.id));assert.equal((await f.call('/staff-reports/me',f.emp)).data.eventReminders.count,0);
 const stored=await f.db.select().from(staffWeeklyReports);assert.equal(stored[0]!.submittedAt,'2026-12-07T02:00:00.000Z','resubmission preserves the first official timestamp');
});
test('server rejects incomplete new forms and linked data outside the employee facts without creating follow-ups',async t=>{
 const f=await fixture(t),body={period:'2026-11-30',clientKey:crypto.randomUUID(),expectedVersion:0,expectedDraftAt:null,inputs:{...good(),quoteFollowups:{foreign:{feedback:'Không phải báo giá của tôi',probability:1,signThisWeek:true}}}};
 assert.equal((await f.call('/staff-reports',f.emp,'POST',body)).status,400);assert.equal((await f.db.select().from(tasks).where(like(tasks.autoKey,'weekly-report:%'))).length,0);
 assert.equal((await f.call('/staff-reports',f.emp,'POST',{...body,clientKey:crypto.randomUUID(),inputs:{...good(),sectors:[]}})).status,400);
 assert.equal((await f.call('/staff-reports/draft',f.other,'PUT',{period:'2026-11-30',inputs:good()})).status,403);
});

test('a follow-up write failure rolls back the report and retains the draft for a safe retry',async t=>{
 const f=await fixture(t),period='2026-11-30',inputs=good();
 const draft=await f.call('/staff-reports/draft',f.emp,'PUT',{period,expectedDraftAt:null,inputs});
 await f.client.query("create function test_block_report_task() returns trigger language plpgsql as $$ begin if new.auto_key like 'weekly-report:%' then raise exception 'test-only failure'; end if; return new; end $$");
 await f.client.query("create trigger test_report_task_failure before insert on tasks for each row execute function test_block_report_task()");
 const body={period,clientKey:crypto.randomUUID(),expectedVersion:0,expectedDraftAt:draft.data.updatedAt,inputs};
 assert.equal((await f.call('/staff-reports',f.emp,'POST',body)).status,500);
 assert.equal((await f.db.select().from(staffWeeklyReports)).length,0);assert.equal((await f.db.select().from(tasks).where(like(tasks.autoKey,'weekly-report:%'))).length,0);
 assert.equal((await f.call('/staff-reports/week?period='+period,f.emp)).data.draft.inputs.workspaceVersion,2);
 await f.client.query('drop trigger test_report_task_failure on tasks');await f.client.query('drop function test_block_report_task()');
 assert.equal((await f.call('/staff-reports',f.emp,'POST',body)).status,201);
});
