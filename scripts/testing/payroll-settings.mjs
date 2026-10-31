/** Real local CRM/router/PGlite: discover salary settings and configure Sale Admin rewards, never production. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setupSalesPayroll} from '../../tests/helpers/sales-payroll-fixture.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setupSalesPayroll(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url));
const server=createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/staff/')){
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined,token=req.headers.authorization?.replace(/^Bearer /,''),r=await f.call(u.pathname.slice('/api/staff'.length)+u.search,token?'__Host-bn-session='+token:'',req.method,body);res.writeHead(r.status,{'content-type':'application/json','server-timing':'local;dur=1'}).end(JSON.stringify(r.data));return;
 }
 const path=u.pathname==='/'?'/index.html':u.pathname;let data=await readFile(root+path);if(path.endsWith('.html'))data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':'text/html;charset=utf-8');res.end(data);
}catch(e){res.writeHead(500).end(String(e.message));}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),out='/workspace/scratch/payroll-settings',results=[];await mkdir(out,{recursive:true});



async function pageFor(width,cookie){
 const context=await browser.newContext({viewport:{width,height:1050},locale:'vi-VN'});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());const user=(await f.call('/me',cookie)).data.user;
 await context.addInitScript(({user,token})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user,token:cookie.split('=')[1]});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));return{context,page,errors};
}
try{
 await f.client.query("update staff_members set position_id='sale-admin' where id='emp'");await f.award();
 for(const width of [1280,390]){
  assert.equal((await f.setPolicy(0,'2026-10',{salesAutomationFrom:0,contractBonusFrom:0,kpiHighRate:0.011,kpiNewCustomersOver:0.2})).status,200);
  assert.equal((await f.salary({kpiEnabled:false,contractBonusEnabled:false})).status,200);
  const {context,page,errors}=await pageFor(width,f.mgr);
  await page.goto(origin+'/#/payroll?month=2026-10');const board=page.locator('#payroll-board');
  await board.getByRole('heading',{name:'Thưởng sao / thanh lý — Sale Admin'}).waitFor();assert.match(await board.innerText(),/Chưa bật tính thưởng từ CRM/);
  await board.getByRole('button',{name:'Cài đặt lương nhân viên',exact:true}).click();await board.getByRole('heading',{name:'Cài đặt lương nhân viên'}).waitFor();
  const employeeRow=board.locator('tbody tr').filter({has:page.locator('a[href^="#/members/emp?"]')});await employeeRow.getByRole('link',{name:'Cài đặt lương',exact:true}).click();
  const member=page.locator('#member-detail');await member.locator('[data-act="salary"]').first().waitFor();await member.locator('[data-act="salary"]').first().click();
  const salary=page.locator('dialog[open]').filter({has:page.locator('input[name="contractBonusEnabled"]')});assert.equal(await salary.locator('[name="kpiEnabled"],[name="fixedKpi"]').count(),0);
  await salary.locator('[name="baseSalary"]').fill('2000000');await salary.locator('[name="contractBonusEnabled"]').check();await page.locator('#toasts .toast').waitFor({state:'hidden'}).catch(()=>{});await salary.screenshot({path:out+'/salary-'+width+'.png'});await salary.getByRole('button',{name:'Lưu hồ sơ lương',exact:true}).click();await salary.waitFor({state:'detached'});
  let view=(await f.overview()).data.payroll;assert.equal(view.profile.baseSalary,2000000);assert.equal(view.profile.contractBonusEnabled,true);assert.equal(view.profile.kpiEnabled,false);
  await page.goto(origin+'/#/payroll?month=2026-10');await board.locator('[data-act="bonus-params"]').waitFor();await board.locator('[data-act="bonus-params"]').click();
  const policy=page.locator('.pr-params[open]');assert.equal(await policy.locator('[name="standardDays"],[name="salesAutomationFrom"],[name="salesAutomationApply"],[name="kpiNewCustomersOver"]').count(),0);await policy.locator('[name="contractBonusFrom"]').fill('2026-10');await policy.locator('[name="contractBonusApply"]').selectOption('0');await policy.screenshot({path:out+'/policy-'+width+'.png'});await policy.getByRole('button',{name:'Lưu tham số',exact:true}).click();await policy.waitFor({state:'detached'});
  const params=(await f.call('/hr/settings?month=2026-10',f.mgr)).data.params;assert.equal(params.kpiHighRate,0.011);assert.equal(params.kpiNewCustomersOver,0.2);assert.equal(params.salesAutomationApply,0);assert.equal(params.contractBonusFrom,202610);assert.equal(params.salesAutomationFrom,0);
  view=(await f.overview()).data.payroll;assert.equal(view.payslip.salesCrm.apply,false);assert.equal(view.payslip.income.find(l=>l.key==='contractBonus').amount,0);
  await board.locator('[data-act="bonus-params"]').click();await policy.locator('[name="contractBonusApply"]').selectOption('1');await policy.getByRole('button',{name:'Lưu tham số',exact:true}).click();await policy.waitFor({state:'detached'});
  view=(await f.overview()).data.payroll;assert.equal(view.payslip.income.find(l=>l.key==='contractBonus').amount,60000);assert.equal(view.payslip.kpi,null);assert.equal(view.payslip.salesCrm.kpiApply,false);assert.equal(view.payslip.salesCrm.bonusApply,true);
  await board.locator('[data-tab="sale"]').first().click();await board.locator('[data-bonus-member="emp"]').first().waitFor();await page.waitForFunction(()=>document.querySelectorAll('#toasts .toast').length===0);await board.screenshot({path:out+'/rewards-'+width+'.png'});await board.locator('[data-bonus-member="emp"]').first().click();const detail=page.locator('.contract-bonus-dialog[open]');assert.equal(await detail.locator('h2').innerText(),'Thưởng HĐKT');assert.match(await detail.innerText(),/Thưởng sao/);assert.match(await detail.innerText(),/Thưởng thanh lý/);assert.doesNotMatch(await detail.innerText(),/KPI đề xuất/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.deepEqual(errors,[]);results.push({width,salarySaved:true,profileRewardEnabled:true,adminKpi:null,customerKpiCapUnchanged:0.2,kpiCrmStartUnchanged:0,star:50000,liquidation:10000,total:60000,shadowDoesNotPay:true,otherParamsPreserved:true,errors});await context.close();
 }
 const self=await pageFor(390,f.emp);await self.page.goto(origin+'/#/members/emp?month=2026-10&tab=payroll');await self.page.locator('#member-detail h1').waitFor();assert.equal(await self.page.locator('#member-detail [data-act="salary"]').count(),0);assert.equal((await f.call('/hr/settings?month=2026-10',f.emp)).status,403);assert.deepEqual(self.errors,[]);await self.context.close();console.log(JSON.stringify({results,selfCannotEditSalary:true}));
}finally{await writeFile(out+'/results.json',JSON.stringify(results,null,2));await browser.close();server.close();await f.client.close();}
