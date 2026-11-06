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
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out=fileURLToPath(new URL('../../docs/testing/payroll-guide/',import.meta.url));await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/staff/')){const chunks=[];for await(const c of req)chunks.push(c);const token=req.headers.authorization?.replace(/^Bearer /,'');const r=await f.call(u.pathname.slice(10)+u.search,token?'__Host-bn-session='+token:'',req.method,chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined);res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;}
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
 for(const [id,name]of [['emp','sale'],['new','sale-admin'],['old','cua-hang-truong'],['off','nvbh']]){
  await page.goto(origin+'/#/members/'+id+'?month='+month+'&tab=payroll');await page.locator('[data-act="salary"]').first().click();const dlg=page.locator('dialog.modal[open]');await dlg.waitFor();
  if(id==='emp'){await mark('dialog[open] [name="effectiveMonth"],dialog[open] [name="payrollGroup"],dialog[open] [name="baseSalary"]');await shot('02-ho-so-chung',dlg);}
  const target=id==='emp'?'kpiEnabled':id==='new'?'contractBonusEnabled':id==='old'?'responsibilityMode':'teamBonus';await dlg.locator('[name="'+target+'"]').scrollIntoViewIfNeeded();
  await mark('dialog[open] [name="'+target+'"]');if(id==='emp')await mark('dialog[open] [name="fixedKpi"]');if(id==='new')assert.equal(await dlg.locator('[name="kpiEnabled"]').count(),0,'Sale Admin cannot enable KPI');
  await shot('03-'+name,dlg,dlg.locator('[name="'+target+'"]'));await dlg.locator('[data-x]').first().click();
 }
 await page.goto(origin+'/#/payroll?month='+month);await page.locator('[data-act="params"]').click();await page.locator('dialog[open] [name="appsheetKpiFrom"]').scrollIntoViewIfNeeded();await mark('dialog[open] [name="appsheetKpiFrom"],dialog[open] [name="salesAutomationApply"]');await shot('04-tham-so',page.locator('dialog.modal[open]'),page.locator('dialog[open] [name="appsheetKpiFrom"]'));await page.locator('dialog[open] [data-x]').first().click();
 await page.locator('[data-act="bonus-params"]').click();await mark('dialog[open] [name="contractBonusApply"]');await shot('05-thuong-admin',page.locator('dialog.modal[open]'));await page.locator('dialog[open] [data-x]').first().click();
 await page.goto(origin+'/#/dashboard?from=2026-11&to=2026-11');await page.locator('.dash-kpi-card').waitFor({timeout:10000}).catch(()=>{});
 const d=(await f.call('/dashboard/kpi?from='+month+'&to='+month,f.mgr)).data.members.find(m=>m.id==='emp');assert.equal(d.parts.find(p=>p.key==='revenue').actual,95000000);assert.ok(Math.abs(d.used-0.915)<1e-10);await shot('06-kpi',page.locator('.dash-kpi-card'));
 await writeFile(out+'results.json',JSON.stringify({illustrationDataOnly:true,policy:'appsheet',month,netRevenue:95000000,kpi:d.used,errors},null,2));assert.deepEqual(errors,[]);console.log('Payroll guide screenshots and browser checks PASS');
}finally{await browser.close();await new Promise(r=>server.close(r));}
