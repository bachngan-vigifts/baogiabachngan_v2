import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setupSalesPayroll} from '../helpers/sales-payroll-fixture.ts';
const {payslipSheetHtml}:any=await import(new URL('../../trial-ui/payroll-ui.js',import.meta.url).href);

test('organizational fields are manager-only labels; salary issuer is frozen at confirmation',async()=>{
 const f=await setupSalesPayroll();await f.salary({kpiEnabled:false,contractBonusEnabled:false});
 const deps=(await f.call('/admin/members',f.mgr)).data.departments;
 assert.ok(deps.length);const dep=deps[0];
 const body={workCompany:'VG',workDepartmentId:dep.id,isLeader:true};
 assert.equal((await f.call('/admin/members/emp/employment',f.emp,'PUT',body)).status,403);
 assert.equal((await f.call('/admin/members/emp/employment',f.mgr,'PUT',{...body,workCompany:'unknown'})).status,400);
 assert.equal((await f.call('/admin/members/emp/employment',f.mgr,'PUT',{...body,workDepartmentId:'missing'})).status,400);
 assert.equal((await f.call('/admin/members/ncc/employment',f.mgr,'PUT',body)).status,404);
 assert.equal((await f.call('/admin/members/emp/employment',f.mgr,'PUT',body)).status,200);
 const member=(await f.call('/admin/members',f.mgr)).data.members.find((m:any)=>m.id==='emp');
 assert.equal(member.workCompany,'VG');assert.equal(member.isLeader,true);assert.equal(member.approver,false);assert.equal(member.positionId,'sale');
 let p=(await f.overview()).data.payroll.payslip;
 assert.deepEqual(p.employment,{company:'VG',department:dep.name,leader:true});
 assert.match(payslipSheetHtml({member,month:'2026-10',slip:p,standardDays:26}),/QUẢNG CÁO VIGIFTS/);
 assert.equal((await f.confirm()).status,201);
 assert.equal((await f.call('/admin/members/emp/employment',f.mgr,'PUT',{workCompany:'BN',workDepartmentId:null,isLeader:false})).status,200);
 p=(await f.overview()).data.payroll.payslip;assert.equal(p.employment.company,'VG');
 const next=(await f.overview(f.mgr,'2026-11')).data.payroll.payslip;assert.equal(next.employment.company,'BN');
 assert.equal((await f.call('/admin/members/mgr/employment',f.mgr,'PUT',body)).status,200,'manager can edit organizational labels on own record without changing own permissions');
});
