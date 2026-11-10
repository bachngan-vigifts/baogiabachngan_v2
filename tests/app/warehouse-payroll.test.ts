import {contractTest as test} from '../TEST_TEMPLATE.ts';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {homeFixture} from '../helpers/home-fixture.ts';
import {tasks} from '../../src/modules/tasks/schema.ts';
import {warehouseWorkRuns as runs,warehouseWorkMonths as months} from '../../src/modules/warehouse-workspace/schema.ts';
import {staffCostOf} from '../../src/app/staff-cost.ts';
const calendar={days:[0,1,2,3,4,5,6],start:'00:00',end:'23:59',breakStart:'',breakEnd:''},month='2026-10';
const ok=(r:any,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};
async function setup(){const f=await homeFixture();
 ok(await f.call('/warehouse-workspace/settings',f.cookies.mgr,'PUT',{calendar,bonusBudget:1000000,revision:0,reason:'Kiểm thử thưởng tháng'}));
 ok(await f.call('/hr/members/wh/salary',f.cookies.mgr,'PUT',{effectiveMonth:month,payrollGroup:'sale',positionLabel:'KHO',baseSalary:5000000}));
 ok(await f.call('/hr/members/wh/inputs/'+month,f.cookies.mgr,'PUT',{workDays:26}));
 await f.db.insert(tasks).values({id:'bonus-job',title:'Việc đã xác nhận',assigneeId:'wh',status:'done',dueDate:'2026-10-15',createdAt:'2026-10-15T01:00:00Z',updatedAt:'2026-10-15T01:30:00Z'});
 await f.db.insert(runs).values({taskId:'bonus-job',memberId:'wh',stage:'confirmed',kind:'manual',calendar:JSON.stringify(calendar),weight:1,standardMinutes:30,dueAt:'2026-10-15T03:00:00Z',startedAt:'2026-10-15T01:00:00Z',submittedAt:'2026-10-15T01:30:00Z',confirmedAt:'2026-10-15T01:35:00Z',quality:'clean',updatedAt:'2026-10-15T01:35:00Z'});
 const board=async()=>ok(await f.call('/hr/payroll/'+month,f.cookies.mgr));
 const report=async()=>ok(await f.call('/warehouse-workspace?member=wh&month='+month,f.cookies.mgr)).report;
 const approve=async()=>f.call('/warehouse-workspace/approve-month',f.cookies.mgr,'POST',{memberId:'wh',month,fingerprint:(await report()).fingerprint});
 const slip='/hr/members/wh/payslips/'+month;
 const fingerprint=async()=>ok(await f.call('/members/wh/overview?month='+month,f.cookies.mgr)).payroll.confirmationHash;
 return{...f,board,report,approve,slip,fingerprint};}
test('approved warehouse amount enters one payroll line, employee overview and profit staff cost; snapshots and payment remain immutable',async()=>{
 const f=await setup(),beforeHash=await f.fingerprint(),before=await f.board(),own=(b:any)=>b.rows.find((r:any)=>r.member.id==='wh').payslip;
 assert.equal(own(before).income.some((l:any)=>l.key==='warehouseBonus'),false);
 assert.equal(ok(await f.approve()).previewOnly,false);const b=await f.board(),p=own(b);assert.equal(p.net-own(before).net,1000000);assert.equal(p.warehouseBonusBasis.amount,1000000);assert.equal(b.columns.income.sale.filter((x:string)=>x==='warehouseBonus').length,1);
 ok(await f.call(f.slip,f.cookies.mgr,'POST',{confirmationHash:beforeHash}),409);
 const overview=ok(await f.call('/members/wh/overview?month='+month,f.cookies.wh));assert.equal(overview.payroll.payslip.net,p.net);assert.equal(overview.payroll.payslip.income.find((l:any)=>l.key==='warehouseBonus').amount,1000000);
 assert.equal((await staffCostOf(f.db,month)).find(c=>c.memberId==='wh')!.bonus,1000000);
 ok(await f.call(f.slip,f.cookies.mgr,'POST',{confirmationHash:await f.fingerprint()}),201);ok(await f.approve(),409);
 const config=ok(await f.call('/warehouse-workspace?member=wh',f.cookies.mgr)).config;
 ok(await f.call('/warehouse-workspace/settings',f.cookies.mgr,'PUT',{calendar,bonusBudget:9000000,revision:config.revision,reason:'Đổi quỹ tháng sau'}));assert.equal(own(await f.board()).net,p.net);
 ok(await f.call(f.slip,f.cookies.mgr,'DELETE'));const reopened=await f.board();assert.equal(own(reopened).net,p.net);assert.equal(own(reopened).income.filter((l:any)=>l.key==='warehouseBonus').length,1);
 ok(await f.call(f.slip,f.cookies.mgr,'POST',{confirmationHash:await f.fingerprint()}),201);ok(await f.call(f.slip+'/paid',f.cookies.mgr,'POST',{}));ok(await f.call(f.slip+'/paid',f.cookies.mgr,'POST',{}),404);ok(await f.call(f.slip,f.cookies.mgr,'DELETE'),409);assert.equal(own(await f.board()).net,p.net);
});
test('warehouse approval refuses a frozen payroll, unknown budget and unapproved results; legacy preview does not pay',async()=>{
 const f=await setup(),board=await f.board();ok(await f.call(f.slip,f.cookies.mgr,'POST',{confirmationHash:await f.fingerprint()}),201);ok(await f.approve(),409);assert.equal((await f.db.select().from(months)).length,0);
 ok(await f.call(f.slip,f.cookies.mgr,'DELETE'));
 await f.client.query('update warehouse_work_settings set bonus_budget=null');ok(await f.approve(),409);
 await f.client.query('update warehouse_work_settings set bonus_budget=1000000');await f.db.update(runs).set({stage:'submitted'}).where(eq(runs.taskId,'bonus-job'));ok(await f.approve(),409);
 await f.db.insert(months).values({memberId:'wh',month,snapshot:JSON.stringify({score:100,bonusPreview:1000000,previewOnly:true}),approvedBy:'mgr',approvedAt:new Date().toISOString()});
 const p=(await f.board()).rows.find((r:any)=>r.member.id==='wh').payslip;assert.equal(p.income.some((l:any)=>l.key==='warehouseBonus'),false);
});
test('concurrent warehouse approval and payroll confirmation cannot omit an approved award from a frozen slip',async()=>{
 const f=await setup(),hash=await f.fingerprint(),r=await Promise.all([f.approve(),f.call(f.slip,f.cookies.mgr,'POST',{confirmationHash:hash})]);
 // Either confirmation wins and approval is refused, or approval wins and stale payroll is refused.
 if(r[0].status===200){assert.equal(r[1].status,409);assert.equal((await f.db.select().from(months)).length,1);}else{assert.equal(r[0].status,409);assert.equal(r[1].status,201);assert.equal((await f.db.select().from(months)).length,0);}
});
