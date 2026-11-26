import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setupNoCommissionKpi} from '../helpers/kpi-no-commission-fixture.ts';
import {quotations} from '../../src/modules/quotes/schema.ts';
test('dashboard and drilldown count all three no-commission orders before VAT; malformed declarations and source mismatches remain blocked',async()=>{
 const f=await setupNoCommissionKpi();
  const detail=async()=>{const r=await f.call(f.detailUrl,f.mgr);assert.equal(r.status,200);return r.data;};
  const initial=await detail();assert.equal(initial.total,41950000);assert.equal(initial.issues,0);assert.deepEqual(initial.rows.map((r:any)=>r.amount).sort((a:number,b:number)=>a-b),[3250000,8500000,30200000]);
  assert.equal(initial.member.parts.find((p:any)=>p.key==='revenue').actual,initial.total);
  const [q]=await f.db.select().from(quotations).where(eq(quotations.id,'no-commission-1'));const doc=JSON.parse(q!.data);
  const set=async(rows:any[])=>f.db.update(quotations).set({data:JSON.stringify({rows})}).where(eq(quotations.id,q!.id));
  for(const commission of [undefined,null,{value:0},{excluded:true},{mode:'amount',value:0}]){
   await set(doc.rows.map((r:any)=>({...r,commission})));assert.equal((await detail()).total,f.total);
  }
  await set([{...doc.rows[0],commission:{mode:'percent',value:5}},doc.rows[1]]);
  assert.equal((await detail()).total,f.total-1450000,'mixed no commission + percent');
  await set([doc.rows[0],{...doc.rows[1],commission:{mode:'amount',value:1000}}]);
  assert.equal((await detail()).total,f.total-80000,'mixed no commission + amount');
  for(const commission of [{},{mode:'percent'},{value:null},{value:'5'},{value:-1},{value:101},{mode:'oops',value:5},false,[],{value:5,excluded:'true'}]){
   await set([{...doc.rows[0],commission},doc.rows[1]]);const d=await detail();assert.equal(d.issues,1,JSON.stringify(commission));assert.equal(d.total,11750000);
  }
  for(const rows of [[],[doc.rows[0]],[{...doc.rows[0],sku:'WRONG'},doc.rows[1]],[{...doc.rows[0],name:'Wrong'},doc.rows[1]]]){
   await set(rows);assert.equal((await detail()).issues,1);
  }
  await f.db.update(quotations).set({data:'invalid json'}).where(eq(quotations.id,q!.id));assert.equal((await detail()).issues,1);
  await set(doc.rows);assert.equal((await f.confirm()).status,201);const frozen=(await f.overview()).data.payroll.payslip;
  await set([{...doc.rows[0],commission:{value:5}},doc.rows[1]]);
  assert.equal((await detail()).total,f.total-1450000);assert.deepEqual((await f.overview()).data.payroll.payslip,frozen,'closed payroll remains unchanged');
});
