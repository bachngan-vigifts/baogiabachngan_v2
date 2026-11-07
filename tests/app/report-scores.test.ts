import {assert} from '../TEST_TEMPLATE.ts';
import {test,type TestContext} from 'node:test';
import {eq,and} from 'drizzle-orm';
import {setupLiquidation} from '../helpers/liquidation-fixture.ts';
import {PASSWORD} from '../helpers/staff-fixture.ts';
import {employees} from '../../src/modules/staff/schema.ts';
import {staffWeeklyReports} from '../../src/modules/staff-reports/schema.ts';
import {hrPayslips} from '../../src/modules/hr/schema.ts';
import {reportScoreView} from '../../src/core/contracts/report-scores.ts';
import {customers} from '../../src/modules/customers/schema.ts';

const ok=(r:any,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};
const periods=['2026-10-26','2026-11-02','2026-11-09','2026-11-16','2026-11-23'];
async function setup(t:TestContext,at='2026-12-10T09:00:00+07:00'){
 const f=await setupLiquidation();t.mock.timers.enable({apis:['Date'],now:Date.parse(at)});
 await f.db.update(employees).set({positionId:'sale-admin'}).where(eq(employees.id,'new'));
 await f.db.update(employees).set({positionId:'accounting'}).where(eq(employees.id,'old'));
 await f.client.query("update staff_credentials set password_hash=(select password_hash from staff_credentials where member_id='emp') where member_id='old'");
 const login=async(email:string)=>(await f.call('/login','','POST',{email,password:PASSWORD})).cookie;
 const mgr=await login('mgr@x.vn'),emp=await login('emp@x.vn'),admin=await login('new@x.vn'),accounting=await login('old@x.vn');
 const salary=async(id='emp',extra={})=>ok(await f.call('/hr/members/'+id+'/salary',mgr,'PUT',{effectiveMonth:'2026-10',payrollGroup:'sale',baseSalary:5_000_000,responsibilityMode:'fixed',responsibility:1_000_000,kpiEnabled:false,contractBonusEnabled:false,...extra}));
 // refresh=1: các bước đọc lại ngay sau khi sửa báo cáo / chốt lương (bỏ bản tính sẵn 30 phút).
 const scores=(who=mgr,q='')=>f.call('/dashboard/report-scores?from=2026-11&to=2026-11&refresh=1'+q,who);
 const overview=(who=mgr)=>f.call('/members/emp/overview?month=2026-11',who);
 return {...f,mgr,emp,admin,accounting,salary,scores,overview};
}
async function seed(f:Awaited<ReturnType<typeof setup>>,memberId='emp'){
 const entries=[['2026-11-09T02:00:00Z','ok'],['2026-11-16T15:00:00Z','pending'],['2026-11-23T02:00:00Z','rejected'],['2026-12-01T05:00:00Z','excused']];
 await f.db.insert(staffWeeklyReports).values(entries.map(([stamp,review],i)=>({id:'score-'+memberId+'-'+i,memberId,period:periods[i+1]!,data:'{}',submittedAt:stamp!,updatedAt:stamp!,clientKey:'key-'+i,review:review as 'ok'|'pending'|'rejected'|'excused'})));
}
test('weekly and monthly scores match across dashboard, personal and company payroll; five weeks use the best four without exposing salary',async t=>{
 const f=await setup(t);await f.salary();await f.salary('new');await seed(f);await seed(f,'new');
 const board=ok(await f.scores()),person=ok(await f.overview()).payroll;
 assert.equal(board.members.length,3);assert.ok(board.members.every((m:any)=>['sale','sale-admin'].includes(m.positionId)));assert.equal(board.scope,'company');
 const score=board.members.find((m:any)=>m.id==='emp');assert.deepEqual(score.basis.weeks.map((w:any)=>w.score),[1,1,0.5,0,1]);assert.equal(score.basis.points,3.5);assert.equal(score.basis.required,5);assert.equal(score.source,'live');
 assert.equal(score.basis.monthly.period,'2026-11');assert.equal(score.basis.monthly.score,0);
 assert.deepEqual(score.basis,person.reportScores.basis);assert.deepEqual(score.basis,person.payslip.weeklyReportBasis);
 const payroll=ok(await f.call('/hr/payroll/2026-11',f.mgr));assert.deepEqual(payroll.rows.find((r:any)=>r.member.id==='emp').reportScores.basis,score.basis);
 assert.doesNotMatch(JSON.stringify(board),/baseSalary|gross|"net"|"income"|bankAccount|responsibility|reviewNote|nextWeekPlan/);
 assert.equal(ok(await f.scores(f.admin)).members[0].id,'new');
});
test('report points are private even with company dashboard permission; manager filters and month validation follow the current scope',async t=>{
 const f=await setup(t);await seed(f);
 assert.deepEqual(ok(await f.scores(f.emp)).members.map((m:any)=>m.id),['emp']);
 assert.equal((await f.scores(f.emp,'&owner=new')).status,403);
 assert.equal((await f.scores(f.accounting,'&owner=emp')).status,403);
 assert.deepEqual(ok(await f.scores(f.accounting)).members,[]);
 assert.deepEqual(ok(await f.scores(f.mgr,'&owner=emp')).members.map((m:any)=>m.id),['emp']);
 assert.deepEqual(ok(await f.scores(f.mgr,'&group=sale-admin')).members.map((m:any)=>m.id),['new']);
 assert.equal((await f.scores('')).status,401);
 assert.equal((await f.scores(f.mgr,'&month=2026-12')).status,400);
 assert.equal((await f.call('/dashboard/report-scores?from=2026-13&to=2026-13',f.mgr)).status,400);
 assert.deepEqual(ok(await f.call('/dashboard/report-scores?from=2026-10&to=2026-10',f.emp)).members,[]);
});
test('settled payroll and dashboard keep saved scores when reports change; legacy snapshots show unavailable rather than live points',async t=>{
 const f=await setup(t);await f.salary();await seed(f);
 const current=ok(await f.overview());ok(await f.call('/hr/members/emp/payslips/2026-11',f.mgr,'POST',{confirmationHash:current.payroll.confirmationHash}),201);
 await f.db.update(staffWeeklyReports).set({review:'rejected'}).where(eq(staffWeeklyReports.memberId,'emp'));
 const dashboard=ok(await f.scores(f.mgr,'&owner=emp')).members[0],self=ok(await f.overview(f.emp));
 assert.equal(dashboard.source,'snapshot');assert.equal(dashboard.basis.points,3.5);assert.deepEqual(self.reportScores.basis,dashboard.basis);assert.equal(self.payroll.reportScores.source,'snapshot');
 const [slip]=await f.db.select().from(hrPayslips).where(eq(hrPayslips.memberId,'emp'));const data=JSON.parse(slip!.data);delete data.weeklyReportBasis;delete data.reportScoreBasis;
 await f.db.update(hrPayslips).set({data:JSON.stringify(data)}).where(and(eq(hrPayslips.memberId,'emp'),eq(hrPayslips.month,'2026-11')));
 const legacy=ok(await f.scores(f.mgr,'&owner=emp')).members[0];assert.equal(legacy.source,'unavailable');assert.equal(legacy.basis,null);assert.equal(ok(await f.overview()).payroll.reportScores.basis,null);
});
test('an employee can see own report scores before salary opens without receiving salary or peer scores',async t=>{
 const f=await setup(t,'2026-11-06T09:00:00+07:00');await f.salary();
 const self=ok(await f.overview(f.emp));assert.equal(self.payroll,null);assert.equal(self.access.salaryOpensOn,'2026-11-10');assert.equal(self.reportScores.basis.points,1);assert.equal(self.reportScores.source,'live');
 assert.doesNotMatch(JSON.stringify(self.reportScores),/income|deductions|baseSalary|bank|gross|"net"/);
 const other=await f.overview(f.admin);assert.ok(other.status===403||other.data.reportScores===null);
});

test('monthly score is included once across dashboard and payroll, drives the /5 responsibility, and strips private report content',async t=>{
 const f=await setup(t);await f.salary();await seed(f);
 ok(await f.call('/hr/members/emp/inputs/2026-11',f.mgr,'PUT',{workDays:26}));
 await f.db.insert(staffWeeklyReports).values({id:'monthly-score',memberId:'emp',period:'2026-11',data:'{"inputs":{"evaluation":"Private report"}}',submittedAt:'2026-12-02T02:00:00Z',updatedAt:'2026-12-02T02:00:00Z',clientKey:'monthly-score-key',review:'ok'});
 const score=ok(await f.scores(f.mgr,'&owner=emp')).members[0];
 assert.equal(score.basis.required,5);assert.equal(score.basis.points,4.5);assert.equal(score.basis.monthly.score,1);
 const own=ok(await f.overview(f.emp));assert.deepEqual(own.reportScores.basis,score.basis);
 assert.equal(own.payroll.payslip.income.find((l:any)=>l.key==='responsibility').amount,900000);
 assert.match(own.payroll.payslip.income.find((l:any)=>l.key==='responsibility').note,/4,5\/5/);
 assert.doesNotMatch(JSON.stringify(score),/Private report|reviewNote|evaluation|bonus|salary|bank/);
 await f.db.update(staffWeeklyReports).set({review:'rejected'}).where(eq(staffWeeklyReports.id,'monthly-score'));
 const changed=ok(await f.scores(f.mgr,'&owner=emp')).members[0];assert.equal(changed.basis.points,3.5);assert.equal(changed.basis.monthly.score,0);
});

test('legacy /4 snapshots remain /4 without borrowing a live monthly row; monthly DTO validates period and strips salary',async t=>{
 const f=await setup(t);await f.salary();await seed(f);
 const current=ok(await f.overview());ok(await f.call('/hr/members/emp/payslips/2026-11',f.mgr,'POST',{confirmationHash:current.payroll.confirmationHash}),201);
 const [row]=await f.db.select().from(hrPayslips).where(eq(hrPayslips.memberId,'emp'));
 const data=JSON.parse(row!.data),legacy={points:3.5,required:4,weeks:data.reportScoreBasis.weeks};
 data.reportScoreBasis=legacy;data.weeklyReportBasis=legacy;
 await f.db.update(hrPayslips).set({data:JSON.stringify(data)}).where(and(eq(hrPayslips.memberId,'emp'),eq(hrPayslips.month,'2026-11')));
 const view=ok(await f.scores(f.mgr,'&owner=emp')).members[0];
 assert.equal(view.source,'snapshot');assert.equal(view.basis.required,4);assert.equal(view.basis.points,3.5);assert.equal(view.basis.monthly,undefined);
 const monthly={period:'2026-11',deadline:'2026-12-02T03:00:00Z',state:'on_time',review:'ok',score:1,salary:9000,reviewNote:'private'};
 const dto=reportScoreView('2026-11','confirmed',{points:1,required:5,weeks:[],monthly});
 assert.equal(dto.basis?.monthly?.score,1);assert.doesNotMatch(JSON.stringify(dto),/salary|reviewNote|private/);
 assert.equal(reportScoreView('2026-11','confirmed',{points:1,required:5,weeks:[],monthly:{...monthly,period:'2026-12'}}).source,'unavailable');
});

test('weekly/monthly new-customer facts keep the approved-profile KPI from #518 without requiring an order',async t=>{
 const f=await setup(t);
 const base={search:'khach',syncedAt:'',sourceVersion:0,contact:'',phone:'',email:'',address:'',taxCode:'',customerCode:''};
 await f.db.insert(customers).values([
  {...base,id:'profile-new',name:'Khách mới được duyệt',createdBy:'emp',createdAt:'2026-11-03T01:00:00Z',approvedAt:'2026-11-05T01:00:00Z',approvalStatus:'approved',dataSource:'web'},
  {...base,id:'profile-pending',name:'Khách chờ duyệt',createdBy:'emp',createdAt:'2026-11-03T01:00:00Z',approvalStatus:'pending',dataSource:'web'},
  {...base,id:'profile-peer',name:'Khách đồng nghiệp',createdBy:'new',createdAt:'2026-11-03T01:00:00Z',approvedAt:'2026-11-05T01:00:00Z',approvalStatus:'approved',dataSource:'web'},
 ]);
 const week=ok(await f.call('/staff-reports/week?period=2026-11-02',f.emp));
 const month=ok(await f.call('/staff-reports/week?period=2026-11',f.emp));
 assert.equal(week.facts.newCustomers,1);assert.equal(month.facts.newCustomers,1);
 assert.equal((await f.call('/staff-reports/week?period=2026-11&memberId=new',f.emp)).status,403);
});
test('score DTO strips unexpected snapshot fields; UI labels preserve pending, exempt, rejected, half points and unavailable',async()=>{
 const w={period:'2026-11-02',deadline:'2026-11-09T03:00:00Z',state:'on_time',review:'pending',score:0.5};
 const dto=reportScoreView('2026-11','confirmed',{points:0.5,required:4,weeks:[{...w,bankAccount:'secret'}],salary:9000});assert.doesNotMatch(JSON.stringify(dto),/bankAccount|salary/);
 assert.equal(reportScoreView('2026-11','confirmed',{points:NaN,required:4,weeks:[]}).source,'unavailable');
 const ui=await import(new URL('../../trial-ui/report-scores.js',import.meta.url).href);
 assert.equal(ui.reportScoreText(dto),'0,5 / 4 điểm');assert.equal(ui.reportScoreText({basis:null}),'Chưa có bản lưu điểm');
 assert.equal(ui.reportWeekLabel(w),'Chờ duyệt · Đúng hạn');assert.equal(ui.reportWeekLabel({...w,review:'rejected'}),'Chưa đạt');assert.equal(ui.reportWeekLabel({...w,state:'missing',review:'excused'}),'Miễn');assert.equal(ui.reportWeekLabel({...w,state:'not_due',review:null}),'Chưa tới hạn');assert.equal(ui.scoreNumber(null),'—');
});

test('probation report points remain visible and freeze with payroll without adding responsibility pay',async t=>{
 const f=await setup(t);await f.salary('emp',{positionLabel:'THỬ VIỆC'});await seed(f);ok(await f.call('/hr/members/emp/inputs/2026-11',f.mgr,'PUT',{workDays:26}));
 const before=ok(await f.overview());assert.equal(before.reportScores.basis.points,3.5);assert.equal(before.reportScores.applied,false);assert.equal(before.payroll.payslip.weeklyReportBasis,undefined);assert.ok(before.payroll.payslip.income.filter((l:any)=>l.amount).every((l:any)=>l.key==='salaryByDays'));
 ok(await f.call('/hr/members/emp/payslips/2026-11',f.mgr,'POST',{confirmationHash:before.payroll.confirmationHash}),201);await f.db.update(staffWeeklyReports).set({review:'rejected'}).where(eq(staffWeeklyReports.memberId,'emp'));const score=ok(await f.scores(f.mgr,'&owner=emp')).members[0];assert.equal(score.source,'snapshot');assert.equal(score.basis.points,3.5);assert.equal(score.applied,false);
});
