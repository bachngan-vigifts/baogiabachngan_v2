import {contractTest as test,assert} from '../TEST_TEMPLATE.ts';
import {setupSalesPayroll} from '../helpers/sales-payroll-fixture.ts';
import {employees} from '../../src/modules/staff/schema.ts';
import {hrRevenueTargets} from '../../src/modules/hr/revenue-target-schema.ts';
import {hrRevenueTargetRequests} from '../../src/modules/hr/revenue-target-request-schema.ts';
import {hrPayslips,hrSalaryProfiles} from '../../src/modules/hr/schema.ts';
import {eq} from 'drizzle-orm';

const ROOT='/hr/revenue-target-requests',own=ROOT+'/me/2026';
async function setup(){const f=await setupSalesPayroll();assert.equal((await f.salary({revenueTarget:1e8,changeReason:'Chỉ tiêu gốc'})).status,200);return f;}
async function send(f:any,values:Record<string,number|null>,extra:any={}){const state=(await f.call(own,f.emp)).data;return f.call(own,f.emp,'PUT',{version:state.version,values:{...state.values,...values},reason:'Đăng ký kế hoạch năm',...extra});}
const review=(f:any,id:string,revision:number,decision='approved',reason='Đã kiểm tra kế hoạch')=>f.call(ROOT+'/'+id+'/review',f.mgr,'POST',{revision,decision,reason});

test('Sale submits own plan; payroll stays unchanged until Manager approves, then uses approved month',async()=>{
 const f=await setup(),r=await send(f,{'2026-10':2e8});assert.equal(r.status,200);assert.equal(r.data.status,'pending');
 assert.equal((await f.db.select().from(hrRevenueTargets)).length,0);assert.equal((await f.overview()).data.payroll.profile.revenueTarget,1e8);
 assert.equal((await f.call('/hr/revenue-targets/2026',f.emp)).status,403);assert.equal((await f.call(ROOT,f.emp)).status,403);
 assert.equal((await f.call(ROOT+'/'+r.data.id+'/review',f.emp,'POST',{revision:r.data.revision,decision:'approved'})).status,403);
 assert.equal((await review(f,r.data.id,r.data.revision)).status,200);
 const view=(await f.overview()).data.payroll;assert.equal(view.profile.revenueTarget,2e8);assert.equal(view.payslip.kpi.targets.revenue,2e8);
 const [profile]=await f.db.select().from(hrSalaryProfiles).where(eq(hrSalaryProfiles.memberId,'emp'));assert.equal(profile!.revenueTarget,1e8);
 const state=(await f.call(own,f.emp)).data;assert.equal(state.pending,null);assert.equal(state.history[0].status,'approved');assert.equal(state.values['2026-10'],2e8);
});
test('self endpoints cannot read or write another person; non-Sale cannot submit',async()=>{
 const f=await setup();await f.db.update(employees).set({positionId:'sale'}).where(eq(employees.id,'new'));
 const r=await send(f,{'2026-10':2e8});
 const other=(await f.call(own,f.other)).data;assert.equal(other.member.id,'new');assert.equal(other.history.length,0);assert.equal(other.values['2026-10'],null);
 assert.equal((await f.call(ROOT+'/'+r.data.id,f.other)).status,403);
 assert.equal((await send(f,{'2026-10':3e8},{memberId:'new'})).status,400);
 assert.equal((await f.call(own+'?memberId=new',f.emp)).data.member.id,'emp');
 await f.db.update(employees).set({positionId:'accounting'}).where(eq(employees.id,'new'));assert.equal((await f.call(own,f.other)).status,403);
 assert.equal((await f.call(own,f.mgr)).status,403);assert.equal((await f.call(own,f.ncc)).status,403);
});
test('editing a pending request keeps one record and invalidates stale employee/Manager versions',async()=>{
 const f=await setup(),initial=(await f.call(own,f.emp)).data,r=await send(f,{'2026-10':2e8});
 assert.equal((await send(f,{'2026-10':3e8},{version:initial.version})).status,409);
 const updated=await send(f,{'2026-10':3e8});assert.equal(updated.status,200);assert.equal(updated.data.id,r.data.id);assert.equal(updated.data.revision,r.data.revision+1);
 assert.equal((await f.db.select().from(hrRevenueTargetRequests)).length,1);assert.equal((await review(f,r.data.id,r.data.revision)).status,409);
 assert.equal((await f.db.select().from(hrRevenueTargets)).length,0);assert.equal((await review(f,updated.data.id,updated.data.revision)).status,200);
 assert.equal((await review(f,updated.data.id,updated.data.revision)).status,409);
 assert.equal((await f.overview()).data.payroll.profile.revenueTarget,3e8);
});
test('Manager direct changes are never overwritten by an older pending request',async()=>{
 const f=await setup(),r=await send(f,{'2026-10':2e8}),current=(await f.call('/hr/revenue-targets/2026',f.mgr)).data;
 await f.call('/hr/revenue-targets/2026',f.mgr,'PUT',{version:current.version,reason:'Điều chỉnh kế hoạch đã duyệt',changes:[{memberId:'emp',month:'2026-10',amount:25e7}]});
 const detail=(await f.call(ROOT+'/'+r.data.id,f.mgr)).data;assert.equal(detail.canApprove,false);assert.deepEqual(detail.conflicts,['2026-10']);
 assert.equal((await review(f,r.data.id,r.data.revision)).status,409);assert.equal((await f.overview()).data.payroll.profile.revenueTarget,25e7);
 const updated=await send(f,{'2026-10':3e8});assert.equal((await review(f,r.data.id,updated.data.revision)).status,200);assert.equal((await f.overview()).data.payroll.profile.revenueTarget,3e8);
});
test('month closed after submission blocks the entire approval and keeps the confirmed snapshot',async()=>{
 const f=await setup(),r=await send(f,{'2026-10':2e8,'2026-11':3e8});assert.equal((await f.confirm()).status,201);
 const [before]=await f.db.select().from(hrPayslips).where(eq(hrPayslips.memberId,'emp'));
 assert.equal((await review(f,r.data.id,r.data.revision)).status,409);assert.equal((await f.db.select().from(hrRevenueTargets)).length,0);
 const [after]=await f.db.select().from(hrPayslips).where(eq(hrPayslips.memberId,'emp'));assert.equal(after!.data,before!.data);
 assert.equal((await review(f,r.data.id,r.data.revision,'rejected','Tháng này đã chốt lương')).status,200);
 assert.equal((await f.call(own,f.emp)).data.history[0].status,'rejected');
});
test('reject/withdraw never apply targets; Sale may send a new request after a decision',async()=>{
 const f=await setup(),r=await send(f,{'2026-10':2e8});assert.equal((await review(f,r.data.id,r.data.revision,'rejected','')).status,400);
 assert.equal((await review(f,r.data.id,r.data.revision,'rejected','Cần điều chỉnh kế hoạch')).status,200);
 let state=(await f.call(own,f.emp)).data;assert.equal(state.history[0].resolutionNote,'Cần điều chỉnh kế hoạch');assert.equal(state.pending,null);
 const next=await send(f,{'2026-10':3e8});assert.notEqual(next.data.id,r.data.id);state=(await f.call(own,f.emp)).data;
 assert.equal((await f.call(own+'/withdraw',f.emp,'POST',{version:state.version})).status,200);assert.equal((await review(f,next.data.id,next.data.revision)).status,409);
 assert.equal((await f.db.select().from(hrRevenueTargets)).length,0);assert.equal((await f.overview()).data.payroll.profile.revenueTarget,1e8);
});
test('role change after submission prevents approval but Manager can reject it',async()=>{
 const f=await setup(),r=await send(f,{'2026-10':2e8});await f.db.update(employees).set({positionId:'sales-lock'}).where(eq(employees.id,'emp'));
 assert.equal((await f.call(own,f.emp)).status,403);assert.equal((await f.call(ROOT+'/'+r.data.id,f.mgr)).data.canApprove,false);
 assert.equal((await review(f,r.data.id,r.data.revision)).status,409);assert.equal((await review(f,r.data.id,r.data.revision,'rejected','Nhân viên đã đổi chức vụ')).status,200);
 assert.equal((await f.db.select().from(hrRevenueTargets)).length,0);
});
test('self submission validates all months, money and reason before creating a request',async()=>{
 const f=await setup();assert.equal((await f.call(ROOT+'/me/2026-10',f.emp)).status,400);
 for(const amount of [0,-1,2.5,'200.000.000',1e13+1])assert.equal((await send(f,{'2026-10':amount} as any)).status,400);
 assert.equal((await send(f,{'2027-01':2e8})).status,400);assert.equal((await send(f,{'2026-10':2e8},{reason:''})).status,400);
 assert.equal((await send(f,{})).status,400);assert.equal((await f.db.select().from(hrRevenueTargetRequests)).length,0);
});
