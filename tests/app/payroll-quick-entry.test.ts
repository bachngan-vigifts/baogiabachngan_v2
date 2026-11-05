import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';

test('quick payroll toolbar exposes the existing Excel export and disables it during loading',async()=>{
 const {createPayrollQuickEntry}:any=await import(new URL('../../trial-ui/payroll-quick-entry.js',import.meta.url).href);
 const previousWindow=globalThis.window;
 try{
  (globalThis as any).window={addEventListener(){}};
  const quick=createPayrollQuickEntry({root:{addEventListener(){},querySelectorAll:()=>[]},esc:String});
  const data={month:'2026-10',rows:[],columns:{groups:{},labels:{}}};
  assert.match(quick.html(data),/<button[^>]*data-act="excel"[^>]*>Xuất file bảng lương<\/button>/);
  quick.setLoading(true);
  assert.match(quick.html(data),/<button[^>]*data-act="excel"[^>]*disabled[^>]*>Xuất file bảng lương<\/button>/);
 }finally{
  if(previousWindow===undefined)delete (globalThis as any).window;else globalThis.window=previousWindow;
 }
});

async function setup() {
  const s = await createTestDb(); await seedStaff(s.d1);
  const router = createAppRouter(), origin = 'https://trial.test';
  const call = async(path: string, cookie = '', method = 'GET', body?: unknown) => {
    const r = await router.handle(new Request(origin+'/api/staff'+path, { method, headers: { origin, cookie, 'content-type':'application/json' }, body:body===undefined?undefined:JSON.stringify(body) }), {db:s.db,passwordIterations:1000,sapoOrderPush:'off'});
    return {status:r.status,data:await r.json() as any,cookie:r.headers.get('set-cookie')?.split(';')[0]??''};
  };
  const mgr=(await call('/login','','POST',{email:'mgr@x.vn',password:PASSWORD})).cookie;
  const emp=(await call('/login','','POST',{email:'emp@x.vn',password:PASSWORD})).cookie;
  const board=async()=> (await call('/hr/payroll/2026-09',mgr)).data;
  const save=(rows: unknown[], cookie=mgr)=>call('/hr/payroll/2026-09/entries',cookie,'PUT',{rows});
  return {call,board,save,mgr,emp};
}

test('quick payroll: batch profile, days and advances recalculate correctly; manual adjustments survive and stale retries do not duplicate', async()=>{
  const f=await setup();const initial=await f.board(),row=initial.rows.find((r:any)=>r.member.id==='emp');
  assert.equal((await f.save([],f.emp)).status,403);
  assert.equal((await f.save([], '')).status,401);
  const patch={memberId:'emp',version:row.entry.version,profile:{baseSalary:5200000,capacityCoef:2,insurance:496650},inputs:{workDays:26,overtimeHours:1.5},adjustments:{advance:500000,bonus:100000}};
  assert.equal((await f.save([patch])).status,200);
  let b=await f.board(),saved=b.rows.find((r:any)=>r.member.id==='emp');
  assert.equal(saved.profile.hasProfile,true);assert.equal(saved.payslip.workDays,26);assert.equal(saved.entry.inputs.overtimeHours,1.5);
  assert.equal(saved.entry.adjustments.advance,500000);
  assert.equal((await f.save([patch])).status,409,'stale replay is blocked');
  assert.equal((await f.call('/hr/members/emp/adjustments',f.mgr,'POST',{month:'2026-09',kind:'advance',amount:200000,reason:'Ứng trước riêng'})).status,201);
  b=await f.board();saved=b.rows.find((r:any)=>r.member.id==='emp');
  const net=saved.payslip.net;
  assert.equal(saved.entry.existingAdjustments.advance,200000);
  assert.equal((await f.save([{memberId:'emp',version:saved.entry.version,adjustments:{advance:0}}])).status,200);
  saved=(await f.board()).rows.find((r:any)=>r.member.id==='emp');
  assert.equal(saved.entry.existingAdjustments.advance,200000);assert.equal(saved.payslip.net,net+500000);
  assert.equal((await f.save([{memberId:'emp',version:saved.entry.version,inputs:{workDays:null}}])).status,200);
  assert.equal((await f.board()).rows.find((r:any)=>r.member.id==='emp').entry.inputs.workDays,null);
});

test('quick payroll: invalid/stale/confirmed rows roll back the whole batch and preserve untouched inputs',async()=>{
  const f=await setup();let b=await f.board();const get=(id:string)=>b.rows.find((r:any)=>r.member.id===id);
  assert.equal((await f.save([{memberId:'emp',version:get('emp').entry.version,inputs:{workDays:24,kpiNewCustomers:9}}])).status,200);
  b=await f.board();
  assert.equal((await f.save([{memberId:'emp',version:get('emp').entry.version,inputs:{overtimeHours:2}},{memberId:'mgr',version:get('mgr').entry.version,inputs:{workDays:32}}])).status,400);
  b=await f.board();assert.equal(get('emp').entry.inputs.overtimeHours,0,'all writes rolled back');
  assert.equal((await f.save([{memberId:'emp',version:get('emp').entry.version,inputs:{overtimeHours:2}}])).status,200);
  b=await f.board();assert.equal(get('emp').entry.inputs.kpiNewCustomers,9,'patch preserves other fields');
  assert.equal((await f.save([{memberId:'emp',version:get('emp').entry.version,inputs:{kpiMerchDays:20,kpiTripDays:20}}])).status,400);
  assert.equal((await f.save([{memberId:'emp',version:get('emp').entry.version,inputs:{workDays:-1}}])).status,400);
  assert.equal((await f.save([{memberId:'emp',version:get('emp').entry.version,profile:{bankAccount:'evil'}}])).status,400);
  assert.equal((await f.save([{memberId:'emp',version:get('emp').entry.version},{memberId:'emp',version:get('emp').entry.version}])).status,400);
  assert.equal((await f.save([{memberId:'emp',version:get('emp').entry.version,profile:{baseSalary:5200000}}])).status,200);
  assert.equal((await f.call('/hr/members/emp/payslips/2026-09',f.mgr,'POST',{})).status,201);
  b=await f.board();
  assert.equal((await f.save([{memberId:'mgr',version:get('mgr').entry.version,inputs:{workDays:10}},{memberId:'emp',version:get('emp').entry.version,inputs:{workDays:10}}])).status,409);
  b=await f.board();assert.equal(get('mgr').entry.inputs.workDays,null);
});

test('Excel number parsing distinguishes automatic blanks, zero and decimal days',async()=>{
  const {parseQuickNumber,QUICK_COLUMNS}:any=await import(new URL('../../trial-ui/payroll-quick-entry.js',import.meta.url).href);
  const day=QUICK_COLUMNS.inputs[0],money=QUICK_COLUMNS.profile[0];
  assert.equal(parseQuickNumber('',day),null);assert.equal(parseQuickNumber('0',day),0);
  assert.equal(parseQuickNumber('24,5',day),24.5);assert.equal(parseQuickNumber('24.5',day),24.5);
  assert.equal(parseQuickNumber('4.758.000',money),4758000);assert.equal(parseQuickNumber('4,758,000',money),4758000);
  assert.equal(parseQuickNumber('Có',['mealAllowance','Cơm xăng','boolean']),true);
  assert.equal(parseQuickNumber('Không',['mealAllowance','Cơm xăng','boolean']),false);
  assert.throws(()=>parseQuickNumber('abc',day));assert.throws(()=>parseQuickNumber('-1',day));
});

test('quick payroll versions bind identical values to their month and reject cross-month writes', async()=>{
  const f=await setup();
  const october=(await f.call('/hr/payroll/2026-10',f.mgr)).data;
  const november=(await f.call('/hr/payroll/2026-11',f.mgr)).data;
  const a=october.rows.find((r:any)=>r.member.id==='emp'),b=november.rows.find((r:any)=>r.member.id==='emp');
  assert.deepEqual(a.entry.inputs,b.entry.inputs);
  assert.notEqual(a.entry.version,b.entry.version,'period must affect the version even when all source values match');
  const path='/hr/payroll/2026-11/entries';
  assert.equal((await f.call(path,f.mgr,'PUT',{rows:[{memberId:'emp',version:a.entry.version,inputs:{workDays:17}}]})).status,409);
  assert.equal((await f.call(path,f.mgr,'PUT',{rows:[{memberId:'emp',version:b.entry.version,month:'2026-10',inputs:{workDays:17}}]})).status,400);
  const saved=(await f.call('/hr/payroll/2026-11',f.mgr)).data.rows.find((r:any)=>r.member.id==='emp');
  assert.equal(saved.entry.inputs.workDays,null);
});

test('Vietnamese Excel thousands and decimal separators work for output rates, quantities and currency',async()=>{
  const {parseQuickNumber,QUICK_COLUMNS}:any=await import(new URL('../../trial-ui/payroll-quick-entry.js',import.meta.url).href);
  for(const key of ['outputRate','outputQty','baseSalary']) {
    const column=[...QUICK_COLUMNS.inputs,...QUICK_COLUMNS.profile].find((c:any)=>c[0]===key);
    for(const [raw,value] of [['15.000',15000],['1.234.567',1234567],['15.000,5',15000.5],['1,234,567.5',1234567.5],['24,5',24.5],['24.5',24.5],['0,005',0.005],['0.005',0.005],['1\u00a0234,5',1234.5]]) {
      assert.equal(parseQuickNumber(raw,column),value,`${key}: ${raw}`);
    }
    for(const bad of ['1.23.456','1,234,56','12.34,56','15,00,0','1e3','0x10','1 2','NaN','Infinity','-15.000']) assert.throws(()=>parseQuickNumber(bad,column),`${key}: reject ${bad}`);
  }
});

test('probation position saves through quick entry, ignores saved extras, snapshots correctly and can return to regular payroll',async()=>{
 const f=await setup();let row=(await f.board()).rows.find((r:any)=>r.member.id==='emp');
 assert.equal((await f.save([{memberId:'emp',version:row.entry.version,profile:{positionLabel:'Thử việc',baseSalary:5200000,capacityCoef:7,insurance:496650,phoneAllowance:250000},inputs:{workDays:24,overtimeHours:10},adjustments:{advance:500000,bonus:1000000,allowance:300000,deduction:100000}}])).status,200);
 row=(await f.board()).rows.find((r:any)=>r.member.id==='emp');assert.equal(row.profile.positionLabel,'THỬ VIỆC');assert.equal(row.payslip.gross,4800000);assert.equal(row.payslip.deductionTotal,600000,'tạm ứng 500k + vi phạm 100k vẫn trừ');assert.equal(row.payslip.net,4200000);
 assert.equal((await f.call('/hr/members/emp/payslips/2026-09',f.mgr,'POST',{})).status,201);
 row=(await f.board()).rows.find((r:any)=>r.member.id==='emp');assert.equal(row.payslip.status,'confirmed');assert.equal(row.payslip.net,4200000);
 assert.equal((await f.save([{memberId:'emp',version:row.entry.version,profile:{positionLabel:'SALE'}}])).status,409);
 const october=(await f.call('/hr/payroll/2026-10',f.mgr)).data.rows.find((r:any)=>r.member.id==='emp');
 assert.equal((await f.call('/hr/payroll/2026-10/entries',f.mgr,'PUT',{rows:[{memberId:'emp',version:october.entry.version,profile:{positionLabel:'SALE'},inputs:{workDays:26}}]})).status,200);
 const regular=(await f.call('/hr/payroll/2026-10',f.mgr)).data.rows.find((r:any)=>r.member.id==='emp');assert.ok(regular.payslip.income.find((l:any)=>l.key==='capacity').amount>0);
 assert.equal((await f.board()).rows.find((r:any)=>r.member.id==='emp').payslip.net,4200000,'phiếu tháng 9 đã chốt giữ nguyên');
});

test('monthly late/leave counters persist through both APIs, validate fractions and bounds and stay scoped by month',async()=>{
 const f=await setup();let row=(await f.board()).rows.find((r:any)=>r.member.id==='emp');
 assert.equal(row.entry.inputs.lateCount,0);assert.equal(row.entry.inputs.leaveHours,0);
 const save=(inputs:unknown)=>f.save([{memberId:'emp',version:row.entry.version,inputs}]);
 assert.equal((await save({lateCount:2,leaveHours:1.5})).status,200);
 row=(await f.board()).rows.find((r:any)=>r.member.id==='emp');assert.equal(row.entry.inputs.lateCount,2);assert.equal(row.entry.inputs.leaveHours,1.5);
 for(const inputs of [{lateCount:1.5},{lateCount:-1},{lateCount:1001},{leaveHours:-1},{leaveHours:745}])assert.equal((await save(inputs)).status,400);
 assert.equal((await f.call('/hr/members/emp/inputs/2026-09',f.mgr,'PUT',{workDays:24})).status,200);
 row=(await f.board()).rows.find((r:any)=>r.member.id==='emp');assert.equal(row.entry.inputs.lateCount,2);assert.equal(row.entry.inputs.leaveHours,1.5,'old form must preserve new indicators');
 const baselineNet=row.payslip.net;
 assert.equal((await f.call('/hr/members/emp/inputs/2026-09',f.mgr,'PUT',{workDays:24,lateCount:3,leaveHours:30})).status,200);
 assert.equal((await f.call('/hr/members/emp/inputs/2026-09',f.mgr,'PUT',{lateCount:0.5})).status,400);
 const october=(await f.call('/hr/payroll/2026-10',f.mgr)).data.rows.find((r:any)=>r.member.id==='emp');assert.equal(october.entry.inputs.lateCount,0);assert.equal(october.entry.inputs.leaveHours,0);
 assert.equal((await f.board()).rows.find((r:any)=>r.member.id==='emp').payslip.net,baselineNet,'counters must not invent a new monetary policy');
});


test('decimal typing can pause at a separator, while committed numbers and pasted values stay strict',async()=>{
 const {isQuickNumberPartial,parseQuickNumber,QUICK_COLUMNS}:any=await import(new URL('../../trial-ui/payroll-quick-entry.js',import.meta.url).href);
 const day=QUICK_COLUMNS.inputs.find((c:any)=>c[0]==='workDays');
 for(const separator of ['.',',']){
  assert.equal(isQuickNumberPartial('24'+separator,day),true);
  assert.throws(()=>parseQuickNumber('24'+separator,day),'unfinished value must not be silently saved or imported');
  assert.equal(isQuickNumberPartial('24'+separator+'5',day),false);assert.equal(parseQuickNumber('24'+separator+'5',day),24.5);
 }
 for(const invalid of ['abc','24..','24,,','24.,','-24.','24.a'])assert.equal(isQuickNumberPartial(invalid,day),false,invalid);
 assert.equal(isQuickNumberPartial('TV.',QUICK_COLUMNS.profile.find((c:any)=>c[0]==='positionLabel')),false);
 assert.equal(isQuickNumberPartial('1.',QUICK_COLUMNS.profile.find((c:any)=>c[0]==='mealAllowance')),false);
});
