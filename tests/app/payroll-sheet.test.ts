import { test } from 'node:test';
import assert from 'node:assert/strict';
const {payrollSheetHtml,PAYROLL_SHEET_COLUMNS}:any=await import(new URL('../../trial-ui/payroll-sheet.js',import.meta.url).href);
const esc=(value:unknown)=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
test('reference payroll sheet aligns grouped headers, mixed editable sources, totals and safe employee names',()=>{
 const r={member:{id:'a',name:'<img onerror=evil()>'},profile:{hasProfile:true,payrollGroup:'sale',positionLabel:'SALE',bankAccount:'',bankCode:''},
 previousCapacityCoef:6,payslip:{status:'estimate',gross:15060208,net:14251959,kpi:{used:1.1572},income:[{key:'salaryByDays',amount:4392000},{key:'capacity',amount:1400000},{key:'kpiBonus',amount:6818208}],deductions:[]}};
 const d={month:'2026-10',rows:[r],columns:{groups:{sale:'Sale & VP'},labels:{}}};
 const html=payrollSheetHtml({data:d,esc,money:(v:number)=>String(v),isDirty:()=>false,field:(_r:any,c:any)=>`<td data-test="${c.section}:${c.key}"></td>`});
 assert.equal((html.match(/<tr/g)||[]).length,4,'two header rows, one employee, one total row');
 const header=html.split('<thead>')[1].split('</thead>')[0];
 const headerWidth=[...header.split('<tr>')[1].split('</tr>')[0].matchAll(/<th\b([^>]*)>/g)].reduce((n,m)=>n+Number(/colspan="(\d+)"/.exec(m[1]!)?.[1]||1),0);
 assert.equal(headerWidth,3+PAYROLL_SHEET_COLUMNS.length);
 for(const section of ['profile:baseSalary','inputs:workDays','profile:capacityCoef','inputs:kpiOverride','adjustments:advance'])assert.ok(html.includes(section),section);
 for(const group of ['NĂNG LỰC','KPIs','PHỤ CẤP','CÁC KHOẢN TRỪ','TỔNG THU NHẬP','THỰC NHẬN','TK NHẬN LƯƠNG'])assert.ok(html.includes(group),group);
 assert.ok(html.includes('15060208'));assert.ok(html.includes('14251959'));assert.ok(html.includes('&lt;img onerror=evil()&gt;'));assert.ok(!html.includes('<img onerror='));
 const kpi=PAYROLL_SHEET_COLUMNS.find((c:any)=>c.key==='kpiOverride');assert.equal(kpi.scale,100,'percent display must be explicit, server retains ratio');
});

test('confirmed payroll QR uses snapshotted bank account when the current salary profile changes',async()=>{
 const {createTestDb}=await import('../helpers/postgres.ts');const {seedStaff,PASSWORD}=await import('../helpers/staff-fixture.ts');
 const {createAppRouter}=await import('../../src/app/router.ts');const s=await createTestDb();await seedStaff(s.d1);const router=createAppRouter();
 const call=async(path:string,cookie='',method='GET',body?:unknown)=>{
  const r=await router.handle(new Request('https://trial.test/api/staff'+path,{method,headers:{origin:'https://trial.test',cookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),{db:s.db,passwordIterations:1000,sapoOrderPush:'off'});
  return{status:r.status,data:await r.json() as any,cookie:r.headers.get('set-cookie')?.split(';')[0]??''};
 };
 const mgr=(await call('/login','','POST',{email:'mgr@x.vn',password:PASSWORD})).cookie;
 const salary=(bankAccount:string)=>call('/hr/members/emp/salary',mgr,'PUT',{effectiveMonth:'2026-10',baseSalary:5200000,bankCode:'vcb',bankAccount,bankHolder:'EMP'});
 assert.equal((await salary('111111')).status,200);
 await call('/hr/members/emp/inputs/2026-10',mgr,'PUT',{workDays:26});
 assert.equal((await call('/hr/members/emp/payslips/2026-10',mgr,'POST',{})).status,201);
 assert.equal((await salary('222222')).status,200);
 const r=(await call('/hr/payroll/2026-10',mgr)).data.rows.find((r:any)=>r.member.id==='emp');
 assert.equal(r.payslip.bank.account,'111111');assert.ok(r.qr.includes('111111'));assert.ok(!r.qr.includes('222222'));
});
