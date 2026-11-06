import {contractTest as test,assert} from '../TEST_TEMPLATE.ts';
import {computeKpiCv} from '../../src/modules/hr/domain/kpi-cv.ts';
import {DEFAULT_PARAMS as P,validateParams} from '../../src/modules/hr/domain/params.ts';
import {EMPTY_INPUT,payrollPeriod} from '../../src/modules/hr/domain/payroll.ts';
import {setupSalesPayroll} from '../helpers/sales-payroll-fixture.ts';
import {salesOrders,salesOrderLines} from '../../src/modules/sales/schema.ts';
import {quotations} from '../../src/modules/quotes/schema.ts';
import {eq} from 'drizzle-orm';

test('AppSheet KPI caps three parts, compensates only merchandise days and lets revenue exceed 50%',()=>{
 const input={...EMPTY_INPUT,kpiNewCustomers:96,kpiTransactions:260,kpiContracts:8,kpiRevenue:830000000,kpiMerchDays:2,kpiTripDays:20};
 const k=computeKpiCv(input,P,415000000,0,'appsheet');
 assert.deepEqual(k.points,{newCustomers:0.1,transactions:0.3,contracts:0.1,revenue:1});assert.equal(k.used,1.5);assert.equal(k.basis?.extraDays,2);
 const work=computeKpiCv({...EMPTY_INPUT,kpiNewCustomers:0,kpiTransactions:0,kpiMerchDays:2,kpiTripDays:10},P,415000000,0,'appsheet');
 assert.equal(work.points.newCustomers,8/96*0.1);assert.equal(work.points.transactions,20/260*0.3);
 assert.equal(computeKpiCv({...input,kpiOverride:1},P,415000000,0,'appsheet').used,1);
 assert.equal(computeKpiCv(input,P,415000000,0).points.newCustomers,0.2,'legacy stays unchanged before activation');
});
test('payroll period is whole calendar month, closing 03–05 next month; Vietnam default crosses year correctly',async()=>{
 assert.deepEqual(payrollPeriod('2026-12'),{from:'2026-12-01',to:'2026-12-31',closeFrom:'2027-01-03',closeTo:'2027-01-05'});
 assert.equal(payrollPeriod('2028-02').to,'2028-02-29');
 const {defaultPayrollMonth}:any=await import(new URL('../../trial-ui/payroll.js',import.meta.url).href);
 assert.equal(defaultPayrollMonth(new Date('2027-01-02T17:00:00Z')),'2026-12');
 assert.equal(defaultPayrollMonth(new Date('2027-01-05T16:59:59Z')),'2026-12');
 assert.equal(defaultPayrollMonth(new Date('2027-01-05T17:00:00Z')),'2027-01');
});
async function setup(){const f=await setupSalesPayroll();
 const [line]=await f.db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId,'liq-order'));
 await f.db.insert(quotations).values({id:'appsheet-net-quote',creatorId:'emp',quoteNo:'BG-APP',quoteType:'HRC',customer:'Khách thử',data:JSON.stringify({rows:[{name:line!.name,sku:line!.sku,unit:line!.unit,qty:1,price:20000000,commission:{mode:'percent',value:5}}]}),createdAt:f.stamp,updatedAt:f.stamp});
 await f.db.update(salesOrders).set({quoteId:'appsheet-net-quote'}).where(eq(salesOrders.id,'liq-order'));
await f.setPolicy(1,'2026-10',{appsheetKpiFrom:202610,saleKpiNetFrom:202610});await f.salary({fixedKpi:null,contractBonusEnabled:false});return f;}
test('one canonical net source replaces stale saved counters; ranking and payslip match and snapshots survive future changes',async()=>{
 const f=await setup();await f.care();
 await f.call('/hr/members/emp/inputs/2026-10',f.mgr,'PUT',{kpiRevenue:999999999,revenue:888888888,kpiNewCustomers:99,kpiTransactions:999,kpiContracts:99,kpiMerchDays:2,kpiTripDays:10});
 const view=(await f.overview()).data.payroll.payslip;
 assert.equal(view.kpi.policy,'appsheet');assert.equal(view.kpi.basis.revenue,19000000);
 assert.deepEqual([view.kpi.basis.newCustomers,view.kpi.basis.transactions,view.kpi.basis.contracts],[1,1,1]);
 assert.equal(view.kpi.basis.extraDays,2);
 const dashboard=await f.call('/dashboard/kpi?from=2026-10&to=2026-10',f.mgr);
 const m=dashboard.data.members.find((m:any)=>m.id==='emp');assert.equal(m.used,view.kpi.used);assert.equal(m.parts.find((p:any)=>p.key==='revenue').actual,19000000);assert.equal(m.parts[0].extra,8);assert.equal(m.parts[0].max,0.1);
 assert.equal((await f.confirm()).status,201);
 await f.db.update(salesOrders).set({subtotal:100000000,total:108000000}).where(eq(salesOrders.id,'liq-order'));
 const frozen=(await f.call('/dashboard/kpi?from=2026-10&to=2026-10',f.mgr)).data.members.find((m:any)=>m.id==='emp');assert.equal(frozen.used,m.used);assert.equal(frozen.parts.find((p:any)=>p.key==='revenue').actual,19000000);
});
test('waiting/cancelled orders contribute no recognized revenue or valid contracts; fixed score is by profile, never name',async()=>{
 const f=await setup();await f.db.update(salesOrders).set({status:'draft'}).where(eq(salesOrders.id,'liq-order'));
 let k=(await f.overview()).data.payroll.payslip.kpi;assert.equal(k.basis.revenue,0);assert.equal(k.basis.contracts,0);
 await f.db.update(salesOrders).set({status:'cancelled'}).where(eq(salesOrders.id,'liq-order'));
 k=(await f.overview()).data.payroll.payslip.kpi;assert.equal(k.basis.revenue,0);
 await f.salary({fixedKpi:1});k=(await f.overview()).data.payroll.payslip.kpi;assert.equal(k.used,1);assert.equal(k.total,0);
});
test('missing commission provenance blocks new-policy settlement instead of silently accepting incomplete KPI',async()=>{
 const f=await setup();await f.db.update(salesOrders).set({channel:'crm',quoteId:null}).where(eq(salesOrders.id,'liq-order'));
 const view=(await f.overview()).data.payroll.payslip;assert.ok(view.kpiNetBasis.issues>0);assert.equal((await f.confirm()).status,409);
});


test('new policy cannot silently change the agreed weights or daily offsets; old periods keep legacy policy',async()=>{
 assert.match(validateParams({...P,appsheetKpiFrom:202611,kpiNewCustomersWeight:0.2})||'',/10\/30\/10\/50/);
 assert.match(validateParams({...P,appsheetKpiFrom:202611,kpiCustomersPerExtraDay:5})||'',/4 KH/);
 const f=await setupSalesPayroll();await f.setPolicy(0,'2026-10',{appsheetKpiFrom:202611,kpiNewCustomersOver:0.2});await f.salary();
 await f.call('/hr/members/emp/inputs/2026-10',f.mgr,'PUT',{kpiNewCustomers:200,kpiTransactions:0,kpiMerchDays:0,kpiTripDays:2});
 const k=(await f.overview()).data.payroll.payslip.kpi;assert.equal(k.policy,'legacy');assert.equal(k.points.newCustomers,0.2);assert.equal(k.basis.extraDays,2);
});


test('AppSheet net policy controls displayed bonus tier even when legacy net switch is off',async()=>{
 const f=await setup();await f.setPolicy(1,'2026-10',{appsheetKpiFrom:202610,saleKpiNetFrom:0});await f.salary({fixedKpi:1});
 const view=(await f.overview()).data.payroll.payslip;const m=(await f.call('/dashboard/kpi?from=2026-10&to=2026-10',f.mgr)).data.members.find((m:any)=>m.id==='emp');
 assert.equal(m.bonusRate,0.01);assert.equal(view.kpiNetBasis.rate,m.bonusRate);
});
