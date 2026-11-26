import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setupSalesPayroll} from '../helpers/sales-payroll-fixture.ts';
import {salesOrders,salesOrderLines} from '../../src/modules/sales/schema.ts';
import {quotations} from '../../src/modules/quotes/schema.ts';
import {hrContractBonusEntries} from '../../src/modules/hr/contract-bonus-schema.ts';
import {DEFAULT_PARAMS} from '../../src/modules/hr/domain/params.ts';
import {netKpiBonusRate} from '../../src/modules/hr/domain/payroll.ts';
const amount=(s:any,key:string)=>s.income.find((l:any)=>l.key===key)?.amount||0;
async function sale(){
 const f=await setupSalesPayroll();
 const [line]=await f.db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId,'liq-order'));
 const row={name:line!.name,sku:line!.sku,unit:line!.unit,qty:1,price:100000000,commission:{mode:'percent',value:5}};
 await f.db.insert(quotations).values({id:'net-quote',creatorId:'emp',quoteNo:'BG-NET',quoteType:'B2B',customer:'Khách kiểm thử',data:JSON.stringify({rows:[row]}),createdAt:f.stamp,updatedAt:f.stamp});
 await f.db.update(salesOrders).set({quoteId:'net-quote',subtotal:100000000,tax:8000000,total:108000000}).where(eq(salesOrders.id,'liq-order'));
 await f.db.update(salesOrderLines).set({qty:1,unitPrice:100000000,amount:100000000}).where(eq(salesOrderLines.id,line!.id));
 assert.equal((await f.setPolicy(1,'2026-10',{saleKpiNetFrom:202610})).status,200);assert.equal((await f.salary()).status,200);
 return{...f,row};
}
test('net KPI reward thresholds include 120% in 1%; only strictly above receives 1.2%',()=>{
 for(const [k,r]of [[0.59999,0],[0.6,0.005],[0.89999,0.005],[0.9,0.01],[1.2,0.01],[1.20001,0.012],[1.3,0.012]])assert.equal(netKpiBonusRate(DEFAULT_PARAMS,k!),r);
 assert.equal(netKpiBonusRate(DEFAULT_PARAMS,null),0);assert.equal(netKpiBonusRate(DEFAULT_PARAMS,1.2+Number.EPSILON),0.01);
});
test('Sale rewards use subtotal less customer commission, never VAT totals or star awards; stored payslip freezes basis',async()=>{
 const f=await sale();
 for(const [k,expected]of [[0.59999,0],[0.6,475000],[0.9,950000],[1.2,950000],[1.20001,1140000]]){
  assert.equal((await f.call('/hr/members/emp/inputs/2026-10',f.mgr,'PUT',{kpiOverride:k})).status,200);
  const p=(await f.overview()).data.payroll.payslip;assert.equal(p.kpiNetBasis.netRevenue,95000000);assert.equal(p.kpiNetBasis.issues,0);assert.equal(amount(p,'kpiBonus'),expected);assert.equal(amount(p,'contractBonus'),0);assert.equal(p.salesCrm.awards.length,0);
 }
 assert.equal((await f.confirm()).status,201);assert.equal((await f.db.select().from(hrContractBonusEntries)).length,0);
 await f.db.update(quotations).set({data:JSON.stringify({rows:[{...f.row,commission:{mode:'amount',value:30000000}}]})}).where(eq(quotations.id,'net-quote'));
 const frozen=(await f.overview()).data.payroll.payslip;assert.equal(amount(frozen,'kpiBonus'),1140000);assert.equal(frozen.kpiNetBasis.netRevenue,95000000);
});
test('unverified commission blocks individual and whole-board settlement; explicit commission exemption is accepted',async()=>{
 const f=await sale();await f.call('/hr/members/emp/inputs/2026-10',f.mgr,'PUT',{kpiOverride:1.3});
 await f.db.update(quotations).set({data:JSON.stringify({rows:[{...f.row,commission:{mode:'percent'}}]})}).where(eq(quotations.id,'net-quote'));
 const p=(await f.overview()).data.payroll.payslip;assert.equal(p.kpiNetBasis.issues,1);assert.equal((await f.confirm()).data.code,'KPI_NET_UNVERIFIED');
 const batch=await f.call('/hr/payroll/2026-10/confirm',f.mgr,'POST',{});assert.equal(batch.status,409);assert.equal(batch.data.code,'KPI_NET_UNVERIFIED');
 await f.db.update(quotations).set({data:JSON.stringify({rows:[{...f.row,commission:{excluded:true}}]})}).where(eq(quotations.id,'net-quote'));
 assert.equal(amount((await f.overview()).data.payroll.payslip,'kpiBonus'),1200000);
 assert.equal((await f.confirm()).status,201);
});
test('Sale Admin retains star and liquidation rewards without any KPI or net-revenue requirement',async()=>{
 const f=await setupSalesPayroll();await f.client.query("update staff_members set position_id='sale-admin' where id='emp'");
 await f.setPolicy(1,'2026-10',{saleKpiNetFrom:202610});assert.equal((await f.salary({kpiEnabled:false})).status,200);await f.award();
 const p=(await f.overview()).data.payroll.payslip;assert.equal(p.kpi,null);assert.equal(p.kpiNetBasis,undefined);assert.equal(amount(p,'kpiBonus'),0);assert.equal(amount(p,'contractBonus'),60000);assert.equal((await f.confirm()).status,201);
});

test('manual KPI still requires fresh net-revenue confirmation if source commission changes before settlement',async()=>{
 const f=await sale();await f.setPolicy(0,'2026-10',{saleKpiNetFrom:202610});await f.call('/hr/members/emp/inputs/2026-10',f.mgr,'PUT',{kpiOverride:1.3});
 const before=(await f.overview()).data.payroll;assert.equal(before.payslip.salesCrm.apply,false);
 await f.db.update(quotations).set({data:JSON.stringify({rows:[{...f.row,commission:{mode:'amount',value:10000000}}]})}).where(eq(quotations.id,'net-quote'));
 const stale=await f.call('/hr/members/emp/payslips/2026-10',f.mgr,'POST',{confirmationHash:before.confirmationHash});assert.equal(stale.status,409);assert.equal(stale.data.code,'PAYROLL_CHANGED');
 assert.equal((await f.confirm()).status,201);assert.equal(amount((await f.overview()).data.payroll.payslip,'kpiBonus'),1080000);
});

test('net commission matches canonical order rows: ignores blank placeholders and recognizes manual service lines',async()=>{
 const f=await sale();await f.call('/hr/members/emp/inputs/2026-10',f.mgr,'PUT',{kpiOverride:1.3});
 await f.db.update(salesOrderLines).set({sku:''}).where(eq(salesOrderLines.orderId,'liq-order'));
 await f.db.update(quotations).set({data:JSON.stringify({rows:[{name:' ',qty:1,price:0},{...f.row,manualLine:true,sku:'SERVICE-LABEL',commission:{excluded:true}},{...f.row,qty:0}]})}).where(eq(quotations.id,'net-quote'));
 const p=(await f.overview()).data.payroll.payslip;assert.equal(p.kpiNetBasis.issues,0);assert.equal(p.kpiNetBasis.netRevenue,100000000);assert.equal(amount(p,'kpiBonus'),1200000);assert.equal((await f.confirm()).status,201);
});

test('below 60% has no KPI reward: incomplete commission does not block the unrelated base salary',async()=>{
 const f=await sale();await f.salary({mealAllowance:false,contractBonusEnabled:false});
 await f.call('/hr/members/emp/inputs/2026-10',f.mgr,'PUT',{workDays:26,kpiOverride:0.5});
 await f.db.update(quotations).set({data:JSON.stringify({rows:[{...f.row,commission:{mode:'percent'}}]})}).where(eq(quotations.id,'net-quote'));
 const p=(await f.overview()).data.payroll.payslip;assert.equal(p.kpiNetBasis.issues,1);assert.equal(p.kpiNetBasis.rate,0);assert.equal(amount(p,'kpiBonus'),0);assert.equal(amount(p,'salaryByDays'),1000000);assert.equal((await f.confirm()).status,201);
});
