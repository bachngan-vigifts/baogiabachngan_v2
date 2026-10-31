import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {mergeParams,validateParams,DEFAULT_PARAMS} from '../../src/modules/hr/domain/params.ts';
import {hrContractBonusEntries} from '../../src/modules/hr/contract-bonus-schema.ts';
import {hrPayrollSettings} from '../../src/modules/hr/schema.ts';
import {assertActivityKpiOpen} from '../../src/modules/hr/api/activity-lock.ts';
import {setupSalesPayroll} from '../helpers/sales-payroll-fixture.ts';
const amount=(slip:any,key:string)=>slip.income.find((l:any)=>l.key===key)?.amount||0;

test('reward-only settings allow the existing 20% KPI parameter; automatic Sale KPI still enforces 10%; legacy flags retain their meaning',()=>{
 assert.equal(validateParams({...DEFAULT_PARAMS,contractBonusApply:1,salesAutomationApply:0}),null);
 assert.match(validateParams({...DEFAULT_PARAMS,salesAutomationApply:1})!,/KH mới/);
 assert.match(validateParams({...DEFAULT_PARAMS,contractBonusApply:2})!,/thưởng HĐKT/);
 assert.equal(mergeParams({salesAutomationApply:1,kpiNewCustomersOver:0.1}).contractBonusApply,1);
 assert.equal(mergeParams({salesAutomationApply:1,contractBonusApply:0}).contractBonusApply,0);
 assert.equal(mergeParams({salesAutomationApply:0,contractBonusApply:1}).contractBonusApply,1);
});

test('Sale Admin saves star/liquidation policy with untouched 20% customer parameter, receives rewards without KPI and books each award once',async()=>{
 const f=await setupSalesPayroll();await f.client.query("update staff_members set position_id='sale-admin' where id='emp'");
 const saved=await f.setPolicy(0,'2026-10',{contractBonusApply:1,salesAutomationFrom:0,kpiNewCustomersOver:0.2});assert.equal(saved.status,200,JSON.stringify(saved.data));
 assert.equal((await f.salary({kpiEnabled:false})).status,200);assert.equal((await f.award()).status,200);
 const settings=(await f.call('/hr/settings?month=2026-10',f.mgr)).data.params;assert.equal(settings.kpiNewCustomersOver,0.2);assert.equal(settings.salesAutomationApply,0);assert.equal(settings.contractBonusApply,1);
 const p=(await f.overview()).data.payroll.payslip;assert.equal(p.kpi,null);assert.equal(p.salesCrm.kpiApply,false);assert.equal(p.salesCrm.bonusApply,true);assert.equal(amount(p,'contractBonus'),60000);assert.equal(amount(p,'kpiBonus'),0);
 assert.equal((await f.confirm()).status,201);const entries=await f.db.select().from(hrContractBonusEntries);assert.equal(entries.length,2);assert.equal(entries.reduce((n,r)=>n+r.amount,0),60000);
 assert.equal((await f.confirm()).status,409);assert.equal((await f.db.select().from(hrContractBonusEntries)).length,2);
 await assertActivityKpiOpen(f.db,'emp','2026-10');assert.equal((await f.call('/hr/settings',f.emp,'PUT',{effectiveMonth:'2026-10',params:settings})).status,403);
 assert.equal((await f.call('/hr/members/emp/payslips/2026-10/paid',f.mgr,'POST',{})).status,200);
 await f.setPolicy(0,'2026-10',{contractBonusApply:0,kpiNewCustomersOver:0.2});assert.equal(amount((await f.overview()).data.payroll.payslip,'contractBonus'),60000,'paid snapshot is immutable');
});

test('KPI-only settlement never reserves preview contract rewards; reward-only settlement never locks manual Sale KPI sources',async()=>{
 const f=await setupSalesPayroll();await f.salary();await f.care();
 assert.equal((await f.setPolicy(1,'2026-10',{contractBonusApply:0})).status,200);
 let p=(await f.overview()).data.payroll.payslip;assert.equal(p.salesCrm.kpiApply,true);assert.equal(p.salesCrm.bonusApply,false);assert.ok(p.kpi.points.transactions>0);assert.equal(amount(p,'contractBonus'),0);
 const board=(await f.call('/hr/payroll/2026-10',f.mgr)).data;
 assert.equal((await f.call('/hr/payroll/2026-10/confirm',f.mgr,'POST',{confirmationHash:board.confirmationHash})).status,200);
 assert.equal((await f.db.select().from(hrContractBonusEntries)).length,0);
 await assert.rejects(assertActivityKpiOpen(f.db,'emp','2026-10'),/đã chốt KPI/);
 assert.equal((await f.call('/hr/members/emp/payslips/2026-10',f.mgr,'DELETE')).status,200);
 assert.equal((await f.setPolicy(0,'2026-10',{contractBonusApply:1,salesAutomationFrom:0,kpiNewCustomersOver:0.2})).status,200);
 p=(await f.overview()).data.payroll.payslip;assert.equal(p.salesCrm.kpiApply,false);assert.equal(p.salesCrm.bonusApply,true);assert.equal(p.kpi.points.transactions,0,'manual inputs are not silently replaced by CRM');assert.equal(amount(p,'contractBonus'),50000);
 assert.equal((await f.confirm()).status,201);await assertActivityKpiOpen(f.db,'emp','2026-10');assert.equal((await f.db.select().from(hrContractBonusEntries)).length,1);
});

test('previously stored combined policy continues paying contract rewards without a new parameter or migration',async()=>{
 const f=await setupSalesPayroll();await f.salary();const legacy={...DEFAULT_PARAMS,salesAutomationFrom:202610,salesAutomationApply:1,kpiNewCustomersOver:0.1} as Record<string,number>;delete legacy.contractBonusApply;delete legacy.contractBonusFrom;
 await f.db.insert(hrPayrollSettings).values({effectiveMonth:'2026-10',params:JSON.stringify(legacy),updatedBy:'mgr',updatedAt:f.stamp});
 const p=(await f.overview()).data.payroll.payslip;assert.equal(p.salesCrm.bonusApply,true);assert.equal(amount(p,'contractBonus'),50000);
 assert.equal((await f.confirm()).status,201);assert.equal((await f.db.select().from(hrContractBonusEntries).where(eq(hrContractBonusEntries.memberId,'emp'))).length,1);
});
