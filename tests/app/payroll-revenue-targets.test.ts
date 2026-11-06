import {contractTest as test,assert} from '../TEST_TEMPLATE.ts';
import {setupSalesPayroll} from '../helpers/sales-payroll-fixture.ts';
import {hrSalaryProfiles,hrPayslips} from '../../src/modules/hr/schema.ts';
import {hrRevenueTargets} from '../../src/modules/hr/revenue-target-schema.ts';
import {auditLogs} from '../../src/core/db/schema.ts';
import {and,eq} from 'drizzle-orm';

async function setup(){const f=await setupSalesPayroll();assert.equal((await f.salary({revenueTarget:100_000_000,changeReason:'Chỉ tiêu ban đầu'})).status,200);return f;}
const board=(f:any,year='2026')=>f.call('/hr/revenue-targets/'+year,f.mgr);
async function save(f:any,changes:any[],version?:string,year='2026'){
  return f.call('/hr/revenue-targets/'+year,f.mgr,'PUT',{version:version??(await board(f,year)).data.version,reason:'Đăng ký kế hoạch doanh số',changes});
}
test('target entry distinguishes Vietnamese/English thousands and rejects fractional or ambiguous money',async()=>{
  const {parseRevenueTarget}:any=await import(new URL('../../trial-ui/revenue-targets.js',import.meta.url).href);
  for(const s of ['200.000.000','200,000,000','200000000'])assert.equal(parseRevenueTarget(s),200_000_000);
  assert.equal(parseRevenueTarget(''),null);
  for(const s of ['0','-1','24.5','24,5','1e8','NaN','Infinity','15.00.000'])assert.throws(()=>parseRevenueTarget(s));
});
test('annual registration supplies the exact payroll/KPI month, with no inheritance across month or year',async()=>{
  const f=await setup();
  assert.equal((await save(f,[{memberId:'emp',month:'2026-10',amount:200_000_000},{memberId:'emp',month:'2026-11',amount:300_000_000}])).status,200);
  const oct=(await f.overview()).data.payroll;
  assert.equal(oct.profile.revenueTarget,200_000_000);assert.equal(oct.profile.revenueTargetSource,'registration');assert.equal(oct.profile.legacyRevenueTarget,100_000_000);
  assert.equal(oct.payslip.kpi.targets.revenue,200_000_000);
  const dash=(await f.call('/dashboard/kpi?from=2026-10&to=2026-10',f.mgr)).data.members.find((m:any)=>m.id==='emp');
  assert.equal(dash.parts.find((p:any)=>p.key==='revenue').target,200_000_000);
  assert.equal((await f.overview(f.mgr,'2026-11')).data.payroll.profile.revenueTarget,300_000_000);
  assert.equal((await f.overview(f.mgr,'2026-12')).data.payroll.profile.revenueTarget,100_000_000);
  assert.equal((await f.overview(f.mgr,'2027-10')).data.payroll.profile.revenueTarget,100_000_000);
  assert.equal((await save(f,[{memberId:'emp',month:'2026-10',amount:null}])).status,200);
  assert.equal((await f.overview()).data.payroll.profile.revenueTarget,100_000_000);
});
test('yearly target never leaks into inherited salary profile when quick entry or salary form saves other fields',async()=>{
  const f=await setup();await save(f,[{memberId:'emp',month:'2026-10',amount:200_000_000}]);
  const payroll=(await f.call('/hr/payroll/2026-10',f.mgr)).data,row=payroll.rows.find((r:any)=>r.member.id==='emp');
  const result=await f.call('/hr/payroll/2026-10/entries',f.mgr,'PUT',{rows:[{memberId:'emp',month:'2026-10',version:row.entry.version,profile:{phoneAllowance:250000}}]});
  assert.equal(result.status,200,JSON.stringify(result.data));
  let [stored]=await f.db.select().from(hrSalaryProfiles).where(and(eq(hrSalaryProfiles.memberId,'emp'),eq(hrSalaryProfiles.effectiveMonth,'2026-10')));assert.equal(stored!.revenueTarget,100_000_000);
  assert.equal((await f.salary({capacityCoef:4})).status,200);
  [stored]=await f.db.select().from(hrSalaryProfiles).where(and(eq(hrSalaryProfiles.memberId,'emp'),eq(hrSalaryProfiles.effectiveMonth,'2026-10')));assert.equal(stored!.revenueTarget,100_000_000);
  assert.equal((await f.overview()).data.payroll.profile.revenueTarget,200_000_000);
  assert.equal((await f.salary({revenueTarget:2e8,changeReason:'Giao diện cũ gửi lại chỉ tiêu đang xem'})).status,409);
  assert.equal((await f.salary({effectiveMonth:'2026-11',revenueTarget:2e8,changeReason:'Giao diện cũ chuyển tháng'})).status,409);
  await save(f,[{memberId:'emp',month:'2026-10',amount:null}]);
  assert.equal((await f.salary({revenueTarget:2e8,changeReason:'Cửa sổ cũ lưu sau khi bỏ đăng ký'})).status,409);
  assert.equal((await f.overview(f.mgr,'2026-11')).data.payroll.profile.revenueTarget,100_000_000);
});
test('annual target save is manager-only, optimistic and atomic; audit captures before/after/reason',async()=>{
  const f=await setup(),initial=await board(f);
  assert.equal(initial.data.months.length,12);assert.equal(initial.data.rows.find((r:any)=>r.member.id==='emp').values['2026-10'],null);
  assert.equal((await f.call('/hr/revenue-targets/2026',f.emp)).status,403);
  assert.equal((await f.call('/hr/revenue-targets/2026',f.emp,'PUT',{version:initial.data.version,changes:[{memberId:'emp',month:'2026-10',amount:2e8}],reason:'Không được phép'})).status,403);
  assert.equal((await save(f,[{memberId:'emp',month:'2026-10',amount:2e8}],initial.data.version)).status,200);
  assert.equal((await save(f,[{memberId:'emp',month:'2026-11',amount:3e8}],initial.data.version)).status,409);
  const bad=await save(f,[{memberId:'emp',month:'2026-11',amount:3e8},{memberId:'missing',month:'2026-12',amount:4e8}]);assert.equal(bad.status,404);
  assert.equal((await board(f)).data.rows.find((r:any)=>r.member.id==='emp').values['2026-11'],null);
  const logs=await f.db.select().from(auditLogs).where(eq(auditLogs.action,'hr-revenue-target-update'));assert.equal(logs.length,1);const audit=JSON.parse(logs[0]!.data);assert.equal(audit.from,null);assert.equal(audit.to,2e8);assert.match(audit.reason,/Đăng ký/);
});
test('invalid year, cross-year rows, duplicates, zero/negative/fractional/string amounts are rejected',async()=>{
  const f=await setup();assert.equal((await board(f,'2026-11')).status,400);
  for(const amount of [0,-1,1.5,'150.000',1e13+1])assert.equal((await save(f,[{memberId:'emp',month:'2026-10',amount}])).status,400);
  assert.equal((await save(f,[{memberId:'emp',month:'2027-01',amount:2e8}])).status,400);
  assert.equal((await save(f,[{memberId:'emp',month:'2026-10',amount:2e8},{memberId:'emp',month:'2026-10',amount:3e8}])).status,400);
  assert.equal((await f.db.select().from(hrRevenueTargets)).length,0);
});
test('confirmed month target is frozen; batch cannot partially change an open month and a locked month',async()=>{
  const f=await setup();await save(f,[{memberId:'emp',month:'2026-10',amount:2e8}]);assert.equal((await f.confirm()).status,201);
  const [before]=await f.db.select().from(hrPayslips).where(eq(hrPayslips.memberId,'emp'));
  const result=await save(f,[{memberId:'emp',month:'2026-11',amount:3e8},{memberId:'emp',month:'2026-10',amount:4e8}]);assert.equal(result.status,409);
  const current=(await board(f)).data.rows.find((r:any)=>r.member.id==='emp');assert.ok(current.lockedMonths.includes('2026-10'));assert.equal(current.values['2026-11'],null);assert.equal(current.values['2026-10'],2e8);
  const [after]=await f.db.select().from(hrPayslips).where(eq(hrPayslips.memberId,'emp'));assert.equal(after!.data,before!.data);
  assert.equal((await f.overview()).data.payroll.payslip.kpi.targets.revenue,2e8);
});
test('quarterly target sums the three registered monthly goals, falling back separately for missing months',async()=>{
  const f=await setup();await save(f,[{memberId:'emp',month:'2026-10',amount:2e8},{memberId:'emp',month:'2026-12',amount:4e8}]);
  assert.equal((await f.call('/hr/months/2026-12',f.mgr,'PUT',{payQuarterBonus:true})).status,200);
  const b=(await f.call('/hr/payroll/2026-12',f.mgr)).data;assert.equal(b.quarter.rows.find((r:any)=>r.memberId==='emp').target,7e8);
});
test('changing or deleting a registered target invalidates previously reviewed payroll, including legacy months',async()=>{
  const f=await setup();await f.setPolicy(0,'2026-09',{saleKpiNetFrom:0,salesAutomationFrom:0,contractBonusFrom:0});
  await f.salary({effectiveMonth:'2026-09',revenueTarget:1e8,changeReason:'Chỉ tiêu ban đầu'});
  await save(f,[{memberId:'emp',month:'2026-09',amount:2e8}]);
  let before=(await f.overview(f.mgr,'2026-09')).data.payroll;
  await save(f,[{memberId:'emp',month:'2026-09',amount:3e8}]);
  assert.equal((await f.call('/hr/payroll/2026-09/confirm',f.mgr,'POST',{confirmationHash:before.confirmationHash})).status,409);
  assert.equal((await f.call('/hr/members/emp/payslips/2026-09',f.mgr,'POST',{confirmationHash:before.confirmationHash})).status,409);
  before=(await f.overview(f.mgr,'2026-09')).data.payroll;
  await save(f,[{memberId:'emp',month:'2026-09',amount:null}]);
  assert.equal((await f.call('/hr/members/emp/payslips/2026-09',f.mgr,'POST',{confirmationHash:before.confirmationHash})).status,409);
  assert.equal((await f.confirm('2026-09')).status,201);
});
