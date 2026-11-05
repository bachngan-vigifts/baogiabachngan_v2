import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setupSalesPayroll} from '../helpers/sales-payroll-fixture.ts';

/** Tổng quan doanh số › Điểm KPI Sale: đúng số của phiếu lương, đúng quyền, không trả tiền lương. */
const kpi=(f:any,who:string,q='')=>f.call('/dashboard/kpi?from=2026-10&to=2026-10'+q,who);
async function sale(){const f=await setupSalesPayroll();await f.setPolicy(1);await f.salary();assert.equal((await f.care()).status,201);return f;}

test('KPI trên tổng quan bằng KPI phiếu lương; từng phần có thực tế, chỉ tiêu, điểm; không có số tiền lương',async()=>{
 const f=await sale(),r=await kpi(f,f.mgr),slip=(await f.overview()).data.payroll.payslip.kpi;
 assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.month,'2026-10');assert.equal(r.data.scope,'company');
 const [m]=r.data.members;assert.equal(r.data.members.length,1,'chỉ người bật KPI Sale');
 assert.equal(m.id,'emp');assert.equal(m.used,slip.used);assert.equal(m.total,slip.total);assert.equal(m.source,'crm');assert.equal(m.status,'estimate');
 assert.deepEqual(m.parts.map((p:any)=>[p.key,p.actual,p.target,p.points]),[
  ['newCustomers',1,96,slip.points.newCustomers],['transactions',1,260,slip.points.transactions],['contracts',1,8,slip.points.contracts],['revenue',21_600_000,415_000_000,slip.points.revenue]]);
 assert.equal(m.parts.reduce((s:number,p:any)=>s+p.points,0).toFixed(12),m.total.toFixed(12));
 assert.doesNotMatch(JSON.stringify(r.data),/baseSalary|gross|net"|"income|bank/i);
});

test('quyền: nhân viên chỉ xem KPI của mình; Manager lọc theo người; tháng phải nằm trong kỳ',async()=>{
 const f=await sale();
 const own=await kpi(f,f.emp);assert.equal(own.status,200);assert.equal(own.data.scope,'self');assert.deepEqual(own.data.members.map((m:any)=>m.id),['emp']);
 assert.equal((await kpi(f,f.emp,'&owner=emp')).status,200);
 assert.equal((await kpi(f,f.emp,'&owner=mgr')).status,403);
 assert.equal((await kpi(f,f.mgr,'&owner=emp')).data.scope,'self');
 assert.equal((await kpi(f,f.mgr,'&owner=mgr')).data.members.length,0,'Manager không bật KPI Sale');
 assert.equal((await f.call('/dashboard/kpi?from=2026-09&to=2026-10&month=2026-11',f.mgr)).status,400);
 assert.equal((await f.call('/dashboard/kpi?from=2026-09&to=2026-10&month=2026-09',f.mgr)).data.month,'2026-09');
 assert.equal((await f.call('/dashboard/kpi?from=2026-10&to=2026-10','')).status,401);
});

test('KPI chốt tay hiện rõ là điều chỉnh; phiếu đã chốt dùng bản chụp lúc chốt',async()=>{
 const f=await sale();
 assert.equal((await f.call('/hr/members/emp/inputs/2026-10',f.mgr,'PUT',{kpiOverride:0.95})).status,200);
 const [m]=(await kpi(f,f.mgr)).data.members;assert.equal(m.used,0.95);assert.equal(m.adjustedBy,'override');assert.ok(m.total<0.95);assert.ok(m.bonusRate>0);
 const done=await f.confirm();assert.equal(done.status,201,JSON.stringify(done.data));
 assert.equal((await f.call('/hr/members/emp/inputs/2026-10',f.mgr,'PUT',{kpiOverride:0.5})).status,409,'phiếu đã chốt không sửa số liệu');
 const [after]=(await kpi(f,f.mgr)).data.members;assert.equal(after.status,'confirmed');assert.equal(after.used,0.95);
});

test('biểu đồ tròn: lát theo điểm từng phần; dưới 100% thêm phần "Chưa đạt"; vượt 100% chia theo tổng; UI không dùng innerHTML',async()=>{
 const ui:any=await import(new URL('../../trial-ui/dashboard.js',import.meta.url).href);
 const parts=(a:number,b:number,c:number,d:number)=>[['newCustomers',a],['transactions',b],['contracts',c],['revenue',d]].map(([key,points])=>({key,label:key,points}));
 const low=ui.kpiSlices({parts:parts(0.05,0.15,0,0.2)});
 assert.deepEqual(low.map((s:any)=>s.key),['newCustomers','transactions','revenue','missing'],'phần 0 điểm không vẽ');
 assert.equal(low.at(-1).value.toFixed(6),'0.600000');assert.equal(low.at(-1).to,1);assert.equal(low[0].from,0);
 const high=ui.kpiSlices({parts:parts(0.1,0.3,0.1,0.7)});
 assert.equal(high.some((s:any)=>s.key==='missing'),false);assert.equal(high.at(-1).to,1);assert.equal(Number((high[3].to-high[3].from).toFixed(6)),Number((0.7/1.2).toFixed(6)));
 assert.equal(ui.kpiPercent(1.048),'104,8%');
 const {readFileSync}=await import('node:fs');assert.doesNotMatch(readFileSync(new URL('../../trial-ui/dashboard.js',import.meta.url),'utf8'),/innerHTML/);
});
