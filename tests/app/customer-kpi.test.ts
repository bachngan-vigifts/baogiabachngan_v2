import {contractTest as test,assert} from '../TEST_TEMPLATE.ts';
import {createTestDb} from '../helpers/postgres.ts';
import {seedStaff} from '../helpers/staff-fixture.ts';
import {setupSalesPayroll} from '../helpers/sales-payroll-fixture.ts';
import {customers,customerStaff} from '../../src/modules/customers/schema.ts';
import {newCustomerFacts} from '../../src/modules/customers/api/kpi-facts.ts';
import {customerCreateFixture} from '../helpers/customer-fixture.ts';
import {vietnamToday} from '../../src/modules/customers/domain/anniversary.ts';
import {salesOrders} from '../../src/modules/sales/schema.ts';
import {eq} from 'drizzle-orm';

test('new customer KPI counts approved business profiles once for creator with Vietnam approval-month boundaries and legacy fallback',async()=>{
 const f=await createTestDb();await seedStaff(f.d1);
 const base={name:'Khách giả lập',contact:'Liên hệ',phone:'',email:'',address:'',search:'',sourceVersion:0,syncedAt:'',createdBy:'emp',createdAt:'2026-10-15T01:00:00Z',approvedBy:'mgr',approvedAt:'2026-11-10T01:00:00Z',approvalStatus:'approved' as const,dataSource:'web'};
 await f.db.insert(customers).values([
  {...base,id:'no-order'},
  {...base,id:'month-start',approvedAt:'2026-10-31T17:00:00.000Z'},
  {...base,id:'month-end',approvedAt:'2026-11-30T16:59:59.999Z'},
  {...base,id:'legacy',createdAt:'2026-11-02T01:00:00Z',approvedAt:null,dataSource:null},
  {...base,id:'before-start',approvedAt:'2026-10-31T16:59:59.999Z'},
  {...base,id:'next-month',approvedAt:'2026-11-30T17:00:00.000Z'},
  {...base,id:'old-approved',approvedAt:'2026-10-10T01:00:00Z'},
  {...base,id:'pending',approvalStatus:'pending',approvedAt:null},
  {...base,id:'rejected',approvalStatus:'rejected',approvedAt:null,rejectReason:'Không hợp lệ',rejectedBy:'mgr',rejectedAt:'2026-11-10T01:00:00Z'},
  {...base,id:'retail',isRetail:true},
  {...base,id:'appsheet',dataSource:'appsheet'},
  {...base,id:'sapo',dataSource:'sapo'},
  {...base,id:'no-creator',createdBy:null},
  {...base,id:'no-created-date',createdAt:''},
  {...base,id:'other-creator',createdBy:'new'},
 ]);
 await f.db.insert(customerStaff).values([
  {customerId:'no-order',memberId:'mgr',role:'owner',createdBy:'mgr',createdAt:base.createdAt},
  {customerId:'no-order',memberId:'emp',role:'shared',createdBy:'mgr',createdAt:base.createdAt},
 ]);
 const counts=await newCustomerFacts(f.db,'2026-11-01','2026-12-01');
 assert.deepEqual([...counts.entries()].sort(),[['emp',4],['new',1]],'no order required; owner/shared joins cannot duplicate or transfer credit');
 assert.equal((await newCustomerFacts(f.db,'2026-12-01','2027-01-01')).get('emp'),1,'late approval counts in December, not backdated to creation month');
});

test('approved customer without an order contributes the same KPI to payroll and dashboard; locked snapshots stay unchanged',async()=>{
 const f=await setupSalesPayroll();await f.setPolicy(1,'2026-10',{appsheetKpiFrom:202610});await f.salary({contractBonusEnabled:false});
 // The fixture already has a confirmed order: it alone must no longer generate a new customer.
 await f.db.update(customers).set({approvalStatus:'pending',approvedAt:null,approvedBy:null}).where(eq(customers.id,'sales-customer'));
 const first=(await f.overview()).data.payroll.payslip;assert.equal(first.kpi.basis.newCustomers,0);
 // No order is needed for the new profile. Remove the unrelated fixture order
 // from the payroll period's eligible orders before testing snapshot locking.
 await f.db.update(salesOrders).set({status:'cancelled'}).where(eq(salesOrders.id,'liq-order'));
 const add=async(id:string)=>f.db.insert(customers).values({id,name:'Khách chưa mua '+id,contact:'Liên hệ giả lập',phone:'',email:'',address:'',search:'',sourceVersion:0,syncedAt:'',dataSource:'web',createdBy:'emp',createdAt:f.stamp,approvalStatus:'approved',approvedBy:'mgr',approvedAt:f.stamp});
 await add('created-approved');
 await f.db.insert(customerStaff).values({customerId:'created-approved',memberId:'mgr',role:'owner',createdBy:'mgr',createdAt:f.stamp});
 const current=(await f.overview()).data.payroll.payslip;
 assert.equal(current.kpi.basis.newCustomers,1);assert.equal(current.kpi.points.newCustomers,1/96*0.1);
 const dashboard=(await f.call('/dashboard/kpi?from=2026-10&to=2026-10',f.mgr)).data.members.find((m:any)=>m.id==='emp');
 assert.equal(dashboard.parts.find((p:any)=>p.key==='newCustomers').actual,1);assert.equal(dashboard.used,current.kpi.used);
 const confirmed=await f.confirm();assert.equal(confirmed.status,201,JSON.stringify(confirmed.data));
 await add('later-approved');
 assert.equal((await newCustomerFacts(f.db,'2026-10-01','2026-11-01')).get('emp'),2);
 const locked=(await f.overview()).data.payroll.payslip;
 assert.equal(locked.kpi.basis.newCustomers,1);assert.equal(locked.net,current.net);assert.equal(locked.kpi.used,current.kpi.used);
 const frozen=(await f.call('/dashboard/kpi?from=2026-10&to=2026-10',f.mgr)).data.members.find((m:any)=>m.id==='emp');
 assert.equal(frozen.parts.find((p:any)=>p.key==='newCustomers').actual,1,'ranking reads the locked snapshot too');
});

test('normal create/approve APIs credit the employee once only after approval, without any sales order',async()=>{
 const f=await setupSalesPayroll(),from=vietnamToday().slice(0,7)+'-01',end=new Date(from+'T00:00:00Z');end.setUTCMonth(end.getUTCMonth()+1);const next=end.toISOString().slice(0,10);
 const before=(await newCustomerFacts(f.db,from,next)).get('emp')??0;
 const created=await f.call('/customers',f.emp,'POST',customerCreateFixture({name:'Khách KPI chưa mua',contact:'Liên hệ thử nghiệm'}));
 assert.equal(created.status,201,JSON.stringify(created.data));assert.equal(created.data.approvalStatus,'pending');
 assert.equal((await newCustomerFacts(f.db,from,next)).get('emp')??0,before);
 assert.equal((await f.call('/customers/'+created.data.id+'/approve',f.mgr,'POST',{})).status,200);
 assert.equal((await newCustomerFacts(f.db,from,next)).get('emp'),before+1);
 assert.equal((await f.call('/customers/'+created.data.id+'/approve',f.mgr,'POST',{})).status,404);
 assert.equal((await newCustomerFacts(f.db,from,next)).get('emp'),before+1);
});
