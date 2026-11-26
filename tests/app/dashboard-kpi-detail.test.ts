import {test} from 'node:test';
import assert from 'node:assert/strict';
import {customers} from '../../src/modules/customers/schema.ts';
import {setupSalesPayroll} from '../helpers/sales-payroll-fixture.ts';

test('KPI detail matches all four current sources, validates scope and never leaks payroll',async()=>{
 const f=await setupSalesPayroll();
  await f.setPolicy(1);await f.salary();await f.care();
  const base='/dashboard/kpi/detail?from=2026-10&to=2026-10&month=2026-10&member=emp';
  const board=await f.call('/dashboard/kpi?from=2026-10&to=2026-10&refresh=1',f.mgr);
  const member=board.data.members.find((m:any)=>m.id==='emp');
  for(const p of member.parts){
   const r=await f.call(base+'&metric='+p.key,f.mgr);assert.equal(r.status,200,JSON.stringify(r.data));
   assert.equal(r.data.total,p.actual,p.key);assert.equal(r.data.rows.reduce((n:number,x:any)=>n+(x.amount??0),0),r.data.total);
   assert.ok(r.data.rows.length);assert.doesNotMatch(JSON.stringify(r.data),/baseSalary|gross"|"income|bank/);
   assert.equal((await f.call(base+'&metric='+p.key,f.emp)).status,200);
  }
  assert.equal((await f.call(base.replace('member=emp','member=mgr')+'&metric=revenue',f.emp)).status,403);
  assert.equal((await f.call(base+'&metric=salary',f.mgr)).status,400);
  assert.equal((await f.call(base+'&metric=revenue&page=-1',f.mgr)).status,400);
  assert.equal((await f.call(base.replace('month=2026-10','month=2026-09')+'&metric=revenue',f.mgr)).status,400);
  assert.equal((await f.call(base+'&metric=revenue&owner=mgr',f.mgr)).status,404);

  const [original]=await f.db.select().from(customers);
  await f.db.insert(customers).values(Array.from({length:51},(_,i)=>({...original,id:'detail-customer-'+i,createdBy:'emp',dataSource:'web',isRetail:false,approvalStatus:'approved',approvedAt:'2026-10-30T00:00:00Z',createdAt:'2026-10-30T00:00:00Z'})));
  const second=await f.call(base+'&metric=newCustomers&page=2',f.mgr);assert.equal(second.data.sourceCount,52);assert.equal(second.data.rows.length,2);assert.equal(second.data.total,52);
  await f.setPolicy(1,'2026-10',{appsheetKpiFrom:202610});
  const net=await f.call(base+'&metric=revenue',f.mgr);assert.equal(net.status,200);assert.equal(net.data.member.revenueBasis,'net-revenue');assert.equal(net.data.total,net.data.member.parts.find((p:any)=>p.key==='revenue').actual);

});
