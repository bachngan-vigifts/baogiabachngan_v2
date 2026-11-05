import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setupSalesPayroll} from '../helpers/sales-payroll-fixture.ts';
import {createTestDb} from '../helpers/postgres.ts';

/** Chỉ tiêu KPI riêng từng nhân viên (hồ sơ lương): trống = mức chung; cùng cách tính ở phiếu lương, đối chiếu CRM, Tổng quan. */
async function sale(apply=1){const f=await setupSalesPayroll();await f.setPolicy(apply);await f.salary();assert.equal((await f.care()).status,201);return f;}
const own={kpiNewCustomersTarget:2,kpiTransactionsTarget:4,kpiContractsTarget:2,changeReason:'Sale mới, giảm chỉ tiêu'};
const slipKpi=async(f:any,month='2026-10')=>(await f.overview(f.mgr,month)).data.payroll.payslip.kpi;
const dashKpi=async(f:any,month='2026-10')=>(await f.call(`/dashboard/kpi?from=${month}&to=${month}`,f.mgr)).data.members.find((m:any)=>m.id==='emp');

test('để trống: dùng mức chung của tháng; chỉ tiêu riêng: phiếu lương, Tổng quan cùng số, có đánh dấu riêng',async()=>{
 const f=await sale(),shared=await slipKpi(f);
 assert.deepEqual([shared.targets.newCustomers,shared.targets.transactions,shared.targets.contracts],[96,260,8]);assert.equal(shared.targets.own.transactions,false);
 assert.equal(shared.points.transactions,1/260*0.3);
 assert.equal((await f.salary(own)).status,200);
 const k=await slipKpi(f);
 assert.deepEqual([k.targets.newCustomers,k.targets.transactions,k.targets.contracts],[2,4,2]);assert.deepEqual(k.targets.own,{newCustomers:true,transactions:true,contracts:true,revenue:false});
 assert.equal(k.points.newCustomers,1/2*0.1);assert.equal(k.points.transactions,1/4*0.3);assert.equal(k.points.contracts,1/2*0.1);
 const d=await dashKpi(f);assert.equal(d.used,k.used);
 assert.deepEqual(d.parts.map((p:any)=>[p.key,p.target,p.own]),[['newCustomers',2,true],['transactions',4,true],['contracts',2,true],['revenue',415_000_000,false]]);
});

test('chế độ đối chiếu CRM cũng dùng chỉ tiêu riêng',async()=>{
 const f=await sale(0);assert.equal((await f.salary(own)).status,200);
 const p=(await f.overview()).data.payroll.payslip;
 assert.equal(p.salesCrm.kpiApply,false);assert.equal(p.salesCrm.previewKpi.targets.transactions,4);assert.equal(p.salesCrm.previewKpi.points.transactions,1/4*0.3);
});

test('kiểm tra đầu vào: 0 / âm / chữ bị chặn; đổi chỉ tiêu phải có lý do; chỉ Sale tính KPI; nhân viên không sửa được',async()=>{
 const f=await sale();
 for(const v of [0,-1,'abc',2_000_000])assert.equal((await f.salary({...own,kpiTransactionsTarget:v})).status,400,String(v));
 assert.match((await f.salary({...own,kpiTransactionsTarget:0})).data.error,/lớn hơn 0/);
 const noReason=await f.salary({...own,changeReason:''});assert.equal(noReason.status,400);assert.match(noReason.data.error,/lý do/);
 assert.equal((await f.salary({revenueTarget:500_000_000})).status,400,'đổi chỉ tiêu DS cũng cần lý do');
 assert.equal((await f.salary({payrollGroup:'lock',kpiEnabled:false,contractBonusEnabled:false,kpiNewCustomersTarget:5,changeReason:'thử'})).status,400);
 assert.equal((await f.call('/hr/members/emp/salary',f.emp,'PUT',{effectiveMonth:'2026-10',...own})).status,403);
 assert.equal((await f.salary({baseSalary:2_000_000})).status,200,'đổi khoản khác không cần lý do');
});

test('chuyển tháng: không gửi thì giữ chỉ tiêu cũ, gửi trống thì về mức chung; tháng trước không đổi',async()=>{
 const f=await sale();assert.equal((await f.salary(own)).status,200);
 const nov=(extra={})=>f.call('/hr/members/emp/salary',f.mgr,'PUT',{effectiveMonth:'2026-11',payrollGroup:'sale',kpiEnabled:true,contractBonusEnabled:true,baseSalary:1_000_000,...extra});
 assert.equal((await nov()).status,200);
 assert.equal((await slipKpi(f,'2026-11')).targets.transactions,4,'kế thừa khi không gửi');
 assert.equal((await nov({kpiTransactionsTarget:'',changeReason:'Hết thời gian thử việc'})).status,200);
 const k=await slipKpi(f,'2026-11');assert.equal(k.targets.transactions,260);assert.equal(k.targets.own.transactions,false);assert.equal(k.targets.newCustomers,2);
 assert.equal((await slipKpi(f,'2026-10')).targets.transactions,4,'tháng 10 vẫn theo hồ sơ tháng 10');
});

test('phiếu đã chốt giữ chỉ tiêu lúc chốt; KPI cố định thay kết quả tính và được nêu rõ',async()=>{
 const f=await sale();assert.equal((await f.salary(own)).status,200);
 const before=await slipKpi(f);assert.equal((await f.confirm()).status,201);
 assert.equal((await f.salary({kpiTransactionsTarget:100,changeReason:'Đổi sau khi chốt'})).status,200);
 const after=await slipKpi(f);assert.equal(after.targets.transactions,4);assert.equal(after.used,before.used);
 assert.equal((await dashKpi(f)).parts.find((p:any)=>p.key==='transactions').target,4);
 const g=await sale();assert.equal((await g.salary({...own,fixedKpi:0.95})).status,200);
 const d=await dashKpi(g);assert.equal(d.used,0.95);assert.equal(d.adjustedBy,'fixed');assert.ok(d.total<0.95);assert.equal(d.parts[1].target,4);
});

test('nhật ký sửa hồ sơ lương: trước → sau, người sửa, lý do; không ghi số tài khoản; chỉ Manager xem',async()=>{
 const f=await sale();assert.equal((await f.salary({...own,bankAccount:'999888777'})).status,200);
 const h=await f.call('/hr/members/emp/salary-history',f.mgr);assert.equal(h.status,200);
 const [last]=h.data.items;assert.equal(last.reason,'Sale mới, giảm chỉ tiêu');assert.equal(last.effectiveMonth,'2026-10');assert.ok(last.by);
 assert.deepEqual(last.changes.kpiTransactionsTarget,{from:null,to:4});assert.equal(last.bankChanged,true);
 assert.doesNotMatch(JSON.stringify(h.data),/999888777/);
 assert.equal((await f.call('/hr/members/emp/salary-history',f.emp)).status,403);
});

test('cổng triển khai: báo lỗi khi chưa chạy migration chỉ tiêu riêng',async()=>{
 const {client}=await createTestDb(),gate=readFileSync('scripts/sql/assert-hr-member-kpi-targets.sql','utf8');
 await client.exec(gate);
 await client.exec('ALTER TABLE hr_salary_profiles DROP COLUMN kpi_contracts_target CASCADE;');
 await assert.rejects(()=>client.exec(gate),/20261105030000_hr_member_kpi_targets/);
});

test('phiếu chốt trước khi có chỉ tiêu riêng (bản chụp thiếu targets): đọc chỉ tiêu từ hồ sơ trong bản chụp, không lấy hồ sơ hiện tại',async()=>{
 const f=await sale();assert.equal((await f.salary(own)).status,200);assert.equal((await f.confirm()).status,201);
 const [slip]=(await f.client.query<{data:string}>("select data from hr_payslips where member_id='emp' and month='2026-10'")).rows;
 const data=JSON.parse(slip!.data);delete data.kpi.targets;
 await f.client.query("update hr_payslips set data=$1 where member_id='emp' and month='2026-10'",[JSON.stringify(data)]);
 assert.equal((await f.salary({kpiTransactionsTarget:100,changeReason:'Đổi sau khi chốt'})).status,200);
 const d=await dashKpi(f);assert.equal(d.status,'confirmed');assert.equal(d.parts.find((p:any)=>p.key==='transactions').target,4);assert.equal(d.parts.find((p:any)=>p.key==='transactions').own,true);
});
