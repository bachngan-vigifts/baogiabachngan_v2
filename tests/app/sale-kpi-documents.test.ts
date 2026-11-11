import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setupSalesPayroll} from '../helpers/sales-payroll-fixture.ts';
import {salesPayrollFacts} from '../../src/modules/sales/api/payroll-facts.ts';
import {salesOrders,salesContracts,salesOrderLines} from '../../src/modules/sales/schema.ts';
import {quotations} from '../../src/modules/quotes/schema.ts';
import {reportCache} from '../../src/core/db/schema.ts';
import {reportCacheKey} from '../../src/core/cache/report-cache.ts';

type Fixture=Awaited<ReturnType<typeof setupSalesPayroll>>;
const facts=(f:Fixture,month='2026-10')=>salesPayrollFacts(f.db,month,[],false,{approvedOnly:true});
const count=(f:Awaited<ReturnType<typeof facts>>,id='emp')=>f.members.get(id)?.contracts??0;
const order=(f:Fixture,id:string,extra:Partial<typeof salesOrders.$inferInsert>={})=>f.db.insert(salesOrders).values({
 id,orderNo:'KPI-'+id,quoteType:'HRC',customerName:'Khách kiểm thử KPI',ownerId:'emp',createdBy:'emp',
 orderDate:'2026-10-15',status:'confirmed',subtotal:100,total:108,createdAt:f.stamp,updatedAt:f.stamp,...extra,
});

test('KPI: HĐKT chưa ký của đơn đã duyệt được tính; đơn và HĐKT không cộng trùng; loại nháp/huỷ/POS, gán đúng người',async()=>{
 const f=await setupSalesPayroll();
 await f.db.update(salesContracts).set({status:'draft',signedDate:'2026-10-31'}).where(eq(salesContracts.id,'liq-contract'));
 let actual=await facts(f);assert.equal(count(actual),1,'tái hiện HĐKT đã duyệt nhưng chưa ký');
 assert.equal(actual.contracts.find(k=>k.contractId==='liq-contract')?.status,'draft','KPI không tự đánh dấu hợp đồng đã ký');
 await f.db.update(salesContracts).set({status:'signed'}).where(eq(salesContracts.id,'liq-contract'));
 assert.equal(count(await facts(f)),1,'ký thêm HĐKT không tăng lần hai');
 await f.db.update(salesContracts).set({status:'cancelled'}).where(eq(salesContracts.id,'liq-contract'));
 assert.equal(count(await facts(f)),1,'đơn đã duyệt còn hiệu lực vẫn chỉ tính một lần');
 await f.db.update(salesContracts).set({status:'signed'}).where(eq(salesContracts.id,'liq-contract'));
 for(const status of ['draft','cancelled'] as const){
  await f.db.update(salesOrders).set({status}).where(eq(salesOrders.id,'liq-order'));
  assert.equal(count(await facts(f)),0,'không dùng HĐKT ký để hợp thức hoá đơn chưa duyệt/đã huỷ');
 }
 for(const status of ['confirmed','delivering','delivered','draft','cancelled'] as const)await order(f,'standalone-'+status,{status});
 await order(f,'pos',{channel:'pos',status:'delivered'});await order(f,'next-month',{orderDate:'2026-11-01'});await order(f,'other-owner',{ownerId:'mgr'});
 actual=await facts(f);assert.equal(count(actual),3);assert.equal(count(actual,'mgr'),1);
 const locked=await f.db.transaction(tx=>salesPayrollFacts(tx,'2026-10',[],true,{approvedOnly:true}));
 assert.equal(count(locked),3,'nguồn dùng khi chốt lương đọc cùng quy tắc với bản xem trước');
});

test('KPI theo ngày đơn: ký HĐKT tháng sau không chuyển tháng/cộng trùng; tháng thưởng vẫn theo ngày ký',async()=>{
 const f=await setupSalesPayroll();
 await f.db.update(salesContracts).set({signedDate:'2026-11-02'}).where(eq(salesContracts.id,'liq-contract'));
 assert.equal(count(await facts(f,'2026-10')),1);const nov=await facts(f,'2026-11');assert.equal(count(nov),0);
 assert.equal(nov.contracts.find(k=>k.contractId==='liq-contract')?.signedDate,'2026-11-02','không đổi nguồn ngày ký cho thưởng sao');
 await order(f,'first',{orderDate:'2026-10-01'});await order(f,'before',{orderDate:'2026-09-30'});await order(f,'after',{orderDate:'2026-11-01'});
 assert.equal(count(await facts(f,'2026-10')),2);assert.equal(count(await facts(f,'2026-11')),1);
});

test('hơn 1.000 chứng từ vẫn đếm đầy đủ, không phụ thuộc phân trang danh sách',async()=>{
 const f=await setupSalesPayroll();
 await f.db.insert(salesOrders).values(Array.from({length:1101},(_,i)=>({id:'bulk-'+i,orderNo:'BULK-'+i,quoteType:'HRC' as const,customerName:'Khách giả lập',ownerId:'emp',createdBy:'emp',orderDate:'2026-10-15',status:'confirmed' as const,subtotal:100,total:108,createdAt:f.stamp,updatedAt:f.stamp})));
 assert.equal(count(await facts(f)),1102);
});

test('AppSheet KPI, hồ sơ nhân viên và Tổng quan cùng đếm đơn/HĐKT đã duyệt; phiếu đã chốt giữ bản chụp',async()=>{
 const f=await setupSalesPayroll();
 const [line]=await f.db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId,'liq-order'));
 await f.db.insert(quotations).values({id:'count-kpi-quote',creatorId:'emp',quoteNo:'BG-COUNT',quoteType:'HRC',customer:'Khách kiểm thử',data:JSON.stringify({rows:[{name:line!.name,sku:line!.sku,unit:line!.unit,qty:1,price:20000000,commission:{mode:'percent',value:0,excluded:true}}]}),createdAt:f.stamp,updatedAt:f.stamp});
 await f.db.update(salesOrders).set({quoteId:'count-kpi-quote'}).where(eq(salesOrders.id,'liq-order'));
 await f.db.update(salesContracts).set({status:'draft',signedDate:null}).where(eq(salesContracts.id,'liq-contract'));
 assert.equal((await f.setPolicy(1,'2026-10',{appsheetKpiFrom:202610,saleKpiNetFrom:202610})).status,200);
 assert.equal((await f.salary({fixedKpi:null})).status,200);
 await f.call('/hr/members/emp/inputs/2026-10',f.mgr,'PUT',{kpiContracts:99});
 const overview=await f.overview(),slip=overview.data.payroll.payslip;
 assert.equal(overview.data.payroll.systemFacts.contracts,1);assert.equal(slip.kpi.basis.contracts,1);assert.equal(slip.kpi.points.contracts,1/8*0.1);
 // A deploy must not keep serving the former signed-contract-only result for 30 minutes.
 await f.db.insert(reportCache).values({key:reportCacheKey('dashboard-kpi','mgr:manager:all',new URLSearchParams('from=2026-10&to=2026-10')),scope:'dashboard-kpi',data:JSON.stringify({month:'2026-10',members:[]}),computedAt:new Date().toISOString(),computedBy:'mgr'});
 const fresh=await f.call('/dashboard/kpi?from=2026-10&to=2026-10',f.mgr);assert.equal(fresh.data.cache.hit,false);assert.equal(fresh.data.members.find((m:any)=>m.id==='emp').parts.find((p:any)=>p.key==='contracts').actual,1);
 assert.equal((await f.call('/dashboard/kpi?from=2026-10&to=2026-10',f.mgr)).data.cache.hit,true,'giữ cache cho lượt xem sau, không tính lại liên tục');
 const dashboard=()=>f.call('/dashboard/kpi?from=2026-10&to=2026-10&refresh=1',f.mgr);
 const result=await dashboard();assert.equal(result.status,200);const k=result.data.members.find((m:any)=>m.id==='emp').parts.find((p:any)=>p.key==='contracts');
 assert.equal(k.label,'Đơn hàng / HĐKT');assert.equal(k.actual,1);assert.equal(k.points,slip.kpi.points.contracts);
 const self=await f.call('/dashboard/kpi?from=2026-10&to=2026-10&refresh=1',f.emp);assert.deepEqual(self.data.members.map((m:any)=>m.id),['emp']);
 assert.doesNotMatch(JSON.stringify(self.data),/baseSalary|"gross"|"income"|bank/);
 const confirmed=await f.confirm();assert.equal(confirmed.status,201,JSON.stringify(confirmed.data));
 await order(f,'after-snapshot');assert.equal(count(await facts(f)),2);
 assert.equal((await f.overview()).data.payroll.payslip.kpi.basis.contracts,1,'không tính lại lương đã chốt');
 assert.equal((await dashboard()).data.members.find((m:any)=>m.id==='emp').parts.find((p:any)=>p.key==='contracts').actual,1);
});
