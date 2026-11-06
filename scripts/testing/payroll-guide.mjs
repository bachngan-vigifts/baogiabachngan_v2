/** Illustrations and browser checks use isolated test DB only, never production payroll. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {eq,notInArray} from 'drizzle-orm';
import {setupSalesPayroll} from '../../tests/helpers/sales-payroll-fixture.ts';
import {employees} from '../../src/modules/staff/schema.ts';
import {salesOrders,salesContracts,salesOrderLines} from '../../src/modules/sales/schema.ts';
import {quotations} from '../../src/modules/quotes/schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setupSalesPayroll(),month='2026-11';
const policy=await f.setPolicy(1,month,{appsheetKpiFrom:202611,salesAutomationFrom:202611,contractBonusFrom:202611,saleKpiNetFrom:202611,bnSplit:1,lockSplit:2});assert.equal(policy.status,200);
const people=[['mgr','Quản trị minh họa','manager'],['emp','Sale minh họa','sale'],['new','Sale Admin minh họa','sale-admin'],['old','Cửa hàng trưởng ML minh họa','sales-ml'],['off','NVBH Lock minh họa','sales-lock']];
await f.db.update(employees).set({active:false}).where(notInArray(employees.id,people.map(p=>p[0])));
for(const [id,name,positionId]of people)await f.db.update(employees).set({name,positionId,active:true,isLeader:id==='old'}).where(eq(employees.id,id));
for(const [id,,positionId]of people.filter(p=>p[0]!=='mgr')){
 const salary=await f.call('/hr/members/'+id+'/salary',f.mgr,'PUT',{effectiveMonth:month,payrollGroup:id==='old'?'bn':id==='off'?'lock':'sale',positionLabel:id==='old'?'CỬA HÀNG TRƯỞNG':id==='off'?'NVBH':id==='new'?'SALE ADMIN':'SALE',baseSalary:5200000,capacityCoef:3,responsibilityMode:id==='off'?'per_day':'fixed',responsibility:id==='old'?1500000:1000000,mealAllowance:true,phoneAllowance:id==='off'?0:250000,attendanceBonus:200000,kpiEnabled:id==='emp',contractBonusEnabled:id==='new',teamBonus:['old','off'].includes(id),insurance:496650,revenueTarget:100000000,...(id==='emp'?{kpiNewCustomersTarget:10,kpiTransactionsTarget:20,kpiContractsTarget:2}:{}),changeReason:'Thiết lập minh họa trong tài liệu'});
 assert.equal(salary.status,200,JSON.stringify(salary.data));
 assert.equal((await f.call('/hr/members/'+id+'/inputs/'+month,f.mgr,'PUT',{workDays:24.5,overtimeHours:1.5,kpiMerchDays:2,kpiTripDays:3})).status,200);
}
const [line]=await f.db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId,'liq-order'));
await f.db.insert(quotations).values({id:'guide-quote',creatorId:'emp',quoteNo:'BG-MINH-HOA',quoteType:'HRC',customer:'Khách hàng minh họa',data:JSON.stringify({rows:[{name:line.name,sku:line.sku,unit:line.unit,qty:1,price:100000000,commission:{mode:'percent',value:5}}]}),createdAt:f.stamp,updatedAt:f.stamp});
await f.db.update(salesOrders).set({quoteId:'guide-quote',orderDate:'2026-11-05',subtotal:100000000,total:108000000}).where(eq(salesOrders.id,'liq-order'));
await f.db.update(salesOrderLines).set({unitPrice:100000000,amount:100000000}).where(eq(salesOrderLines.id,line.id));
await f.db.update(salesContracts).set({signedDate:'2026-11-05'}).where(eq(salesContracts.id,'liq-contract'));
await f.care({occurredAt:'2026-11-05'});
await f.call('/hr/months/'+month,f.mgr,'PUT',{bnRevenue:350000000,bnAvgRevenue:320000000,lockRevenue:320000000});
const initialTargets=(await f.call('/hr/revenue-targets/2026',f.mgr)).data;assert.equal((await f.call('/hr/revenue-targets/2026',f.mgr,'PUT',{version:initialTargets.version,reason:'Đăng ký minh họa',changes:[{memberId:'emp',month,amount:100000000}]})).status,200);
let releaseYear,holdYear=false;
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out=fileURLToPath(new URL('../../docs/testing/payroll-guide/',import.meta.url));await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/staff/')){const chunks=[];for await(const c of req)chunks.push(c);const token=req.headers.authorization?.replace(/^Bearer /,'');if(holdYear&&u.pathname==='/api/staff/hr/revenue-targets/2027'&&req.method==='GET')await new Promise(resolve=>{releaseYear=resolve;});const r=await f.call(u.pathname.slice(10)+u.search,token?'__Host-bn-session='+token:'',req.method,chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined);res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;}
const path=u.pathname==='/'?'/index.html':u.pathname;let bytes=await readFile(root+path);if(path.endsWith('.html'))bytes=Buffer.from(bytes.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.png')?'image/png':path.endsWith('.ttf')?'font/ttf':'text/html;charset=utf-8');res.end(bytes);}catch(e){res.writeHead(404).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1280,height:1000},locale:'vi-VN'});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());const user=(await f.call('/me',f.mgr)).data.user;
await context.addInitScript(({user,token})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user,token:f.mgr.split('=')[1]});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
const shot=async(name,locator,focus)=>{await page.locator('.toast').evaluateAll(ns=>ns.forEach(n=>n.remove()));
 if(focus){const box=await locator.boundingBox(),field=await focus.boundingBox();const y=Math.max(box.y,Math.min(field.y-145,box.y+box.height-480));await page.screenshot({path:out+name+'.png',clip:{x:box.x,y,width:box.width,height:Math.min(480,box.y+box.height-y)}});}
 else await locator.screenshot({path:out+name+'.png'});
};
const mark=async(selector)=>page.locator(selector).evaluateAll(ns=>ns.forEach(n=>{const target=n.closest('label')||n;target.style.outline='3px solid #dc2626';target.style.outlineOffset='3px';}));
try{
 await page.goto(origin+'/#/payroll?month='+month);await page.locator('#pr-quick').waitFor();assert.match(await page.locator('[data-payroll-period]').textContent(),/2026-11-01.*2026-11-30.*2026-12-03.*2026-12-05/);
 assert.equal(await page.locator('[data-member="emp"][data-key="revenue"]').count(),0,'recognized revenue is read-only');
 await mark('#pr-month,[data-tab="profiles"],[data-act="params"]');await shot('01-bang-luong',page.locator('#payroll-board'));
 await page.locator('[data-act="revenue-targets"]').click();const yearly=page.locator('dialog.revenue-targets-dialog[open]');await yearly.locator('[data-target]').first().waitFor();
 const annualRow=(await f.call('/hr/revenue-targets/2026',f.mgr)).data.rows.findIndex(r=>r.member.id==='emp');
 const jan=yearly.locator(`[data-row="${annualRow}"][data-month="2026-01"]`);
 await jan.fill('24.5');await yearly.locator('[data-reason]').fill('Đăng ký minh họa');await yearly.locator('[data-save]').click();assert.match(await yearly.locator('[data-error]').textContent(),/số tiền nguyên/);
 await jan.fill('120.000.000');await yearly.locator('[data-save]').click();await page.waitForFunction(()=>document.querySelector('dialog.revenue-targets-dialog [data-status]')?.textContent==='Đã tải dữ liệu');
 assert.equal((await f.call('/hr/revenue-targets/2026',f.mgr)).data.rows.find(r=>r.member.id==='emp').values['2026-01'],120000000);assert.equal(await jan.inputValue(),'120,000,000');
 const annualBox=await yearly.boundingBox();await page.screenshot({path:out+'02b-dang-ky-doanh-so-nam.png',clip:{x:annualBox.x,y:annualBox.y,width:Math.min(650,annualBox.width),height:Math.min(520,annualBox.height)}});
 await jan.fill('130.000.000');await yearly.locator('[data-year]').fill('2027');await yearly.locator('[data-year]').press('Tab');await page.locator('#confirm-dialog[open]').waitFor();await page.locator('#confirm-cancel').click();assert.equal(await yearly.locator('[data-year]').inputValue(),'2026');assert.equal(await jan.inputValue(),'130,000,000');
 await jan.fill('120.000.000');await yearly.locator('[data-reason]').focus();assert.equal(await yearly.locator('[data-save]').isDisabled(),true);
 await yearly.locator('[data-year]').fill('1999');await yearly.locator('[data-year]').press('Tab');assert.equal(await yearly.locator('[data-year]').inputValue(),'2026');
 holdYear=true;await yearly.locator('[data-year]').fill('2027');await yearly.locator('[data-year]').press('Tab');await yearly.locator('[data-status]').filter({hasText:'Đang tải năm 2027'}).waitFor();assert.equal(await jan.isDisabled(),true);assert.equal(await yearly.locator('[data-save]').isDisabled(),true);while(!releaseYear)await new Promise(r=>setTimeout(r,10));releaseYear();holdYear=false;
 await yearly.locator('[data-status]').filter({hasText:'Đã tải dữ liệu'}).waitFor();assert.equal(await yearly.locator(`[data-row="${annualRow}"][data-month="2027-01"]`).inputValue(),'');
 await yearly.locator('[data-year]').fill('2026');await yearly.locator('[data-year]').press('Tab');await yearly.locator(`[data-row="${annualRow}"][data-month="2026-01"]`).waitFor();
 await yearly.locator('[data-close]').first().click();

 for(const [id,name]of [['emp','sale'],['new','sale-admin'],['old','cua-hang-truong'],['off','nvbh']]){
  await page.goto(origin+'/#/members/'+id+'?month='+month+'&tab=payroll');await page.locator('[data-act="salary"]').first().click();const dlg=page.locator('dialog.modal[open]');await dlg.waitFor();
  if(id==='emp'){assert.equal(await dlg.locator('[data-revenue-goal]').getAttribute('readonly'),'');assert.match(await dlg.locator('[data-revenue-source]').textContent(),/đăng ký doanh số năm/);
   await dlg.locator('[name="phoneAllowance"]').fill('300.000');await dlg.locator('[data-open-revenue-targets]').click();const nested=page.locator('dialog.revenue-targets-dialog[open]');await nested.locator('[data-target]').first().waitFor();
   const goal=nested.locator(`[data-row="${annualRow}"][data-month="${month}"]`);await nested.locator('[data-reason]').fill('Điều chỉnh minh họa');
   for(const amount of ['110.000.000','100.000.000']){await goal.fill(amount);await nested.locator('[data-save]').click();await page.waitForFunction(expected=>document.querySelector('dialog.modal:not(.revenue-targets-dialog)[open] [data-revenue-goal]')?.value.includes(expected),amount);}
   await nested.locator('[data-close]').first().click();assert.equal(await dlg.locator('[name="phoneAllowance"]').inputValue(),'300.000');await mark('dialog[open] [name="effectiveMonth"],dialog[open] [name="payrollGroup"],dialog[open] [name="baseSalary"]');await shot('02-ho-so-chung',dlg);}
  const target=id==='emp'?'kpiEnabled':id==='new'?'contractBonusEnabled':id==='old'?'responsibilityMode':'teamBonus';await dlg.locator('[name="'+target+'"]').scrollIntoViewIfNeeded();
  await mark('dialog[open] [name="'+target+'"]');if(id==='emp')await mark('dialog[open] [name="fixedKpi"]');if(id==='new')assert.equal(await dlg.locator('[name="kpiEnabled"]').count(),0,'Sale Admin cannot enable KPI');
  await shot('03-'+name,dlg,dlg.locator('[name="'+target+'"]'));await dlg.locator('[data-x]').first().click();
 }
 await page.goto(origin+'/#/payroll?month='+month);await page.locator('[data-act="params"]').click();await page.locator('dialog[open] [name="appsheetKpiFrom"]').scrollIntoViewIfNeeded();await mark('dialog[open] [name="appsheetKpiFrom"],dialog[open] [name="salesAutomationApply"]');await shot('04-tham-so',page.locator('dialog.modal[open]'),page.locator('dialog[open] [name="appsheetKpiFrom"]'));await page.locator('dialog[open] [data-x]').first().click();
 await page.locator('[data-act="bonus-params"]').click();await mark('dialog[open] [name="contractBonusApply"]');await shot('05-thuong-admin',page.locator('dialog.modal[open]'));await page.locator('dialog[open] [data-x]').first().click();
 await page.goto(origin+'/#/dashboard?from=2026-11&to=2026-11');await page.locator('.dash-kpi-card').waitFor({timeout:10000}).catch(()=>{});
 const d=(await f.call('/dashboard/kpi?from='+month+'&to='+month,f.mgr)).data.members.find(m=>m.id==='emp');assert.equal(d.parts.find(p=>p.key==='revenue').actual,95000000);assert.ok(Math.abs(d.used-0.915)<1e-10);await shot('06-kpi',page.locator('.dash-kpi-card'));
 assert.equal((await f.confirm(month)).status,201);await page.goto(origin+'/#/payroll?month='+month);await page.locator('[data-act="revenue-targets"]').click();const lockedYear=page.locator('dialog.revenue-targets-dialog[open]');await lockedYear.locator('[data-target]').first().waitFor();assert.equal(await lockedYear.locator(`[data-row="${annualRow}"][data-month="${month}"]`).isDisabled(),true);assert.equal(await lockedYear.locator(`[data-row="${annualRow}"][data-month="2026-12"]`).isDisabled(),false);
 await page.setViewportSize({width:390,height:844});assert.equal(await lockedYear.locator('table').evaluate(el=>getComputedStyle(el).display),'table');assert.equal(await lockedYear.locator('tbody tr').first().evaluate(el=>getComputedStyle(el).display),'table-row');await page.setViewportSize({width:1280,height:1000});await lockedYear.locator('[data-close]').first().click();
 await writeFile(out+'results.json',JSON.stringify({illustrationDataOnly:true,policy:'appsheet',month,netRevenue:95000000,kpi:d.used,yearlyRegistration:true,yearSwitchLocked:true,lockedMonth:true,unsavedYearProtected:true,errors},null,2));assert.deepEqual(errors,[]);console.log('Payroll guide screenshots and browser checks PASS');
}finally{await browser.close();await new Promise(r=>server.close(r));}
