/** Real local router/UI with synthetic payroll; checks actual KPI display without changing payroll overrides. */
import assert from 'node:assert/strict';import {createServer} from 'node:http';import {readFile,mkdir} from 'node:fs/promises';import {fileURLToPath} from 'node:url';
import {eq} from 'drizzle-orm';import {setupSalesPayroll} from '../../tests/helpers/sales-payroll-fixture.ts';import {employees} from '../../src/modules/staff/schema.ts';
import {kpiPercent,kpiAttainmentClass} from '../../trial-ui/dashboard.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright'),f=await setupSalesPayroll(),month=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Ho_Chi_Minh'}).slice(0,7);
assert.equal((await f.setPolicy(1,month)).status,200);assert.equal((await f.salary({fixedKpi:1})).status,200);
await f.db.update(employees).set({role:'manager'}).where(eq(employees.id,'emp'));
assert.equal((await f.call('/hr/members/mgr/salary',f.mgr,'PUT',{effectiveMonth:month,payrollGroup:'sale',kpiEnabled:true,baseSalary:1000000})).status,200);
assert.equal((await f.call('/hr/members/emp/inputs/'+month,f.mgr,'PUT',{kpiNewCustomers:3,kpiTransactions:0,kpiContracts:0,kpiRevenue:0})).status,200);
const data=(await f.call('/dashboard/kpi?from='+month+'&to='+month,f.mgr)).data,member=data.members.find(m=>m.id==='emp');
assert.equal(member.used,1);assert.ok(member.total>0&&member.total<1);assert.equal(member.adjustedBy,'fixed');
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out='/tmp/dashboard-actual-kpi-browser';await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/staff/')){
 const chunks=[];for await(const c of req)chunks.push(c);const token=req.headers.authorization?.replace(/^Bearer /,'');const r=await f.call(u.pathname.slice(10)+u.search,token?'__Host-bn-session='+token:'',req.method,chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined);
 res.writeHead(r.status,{'content-type':'application/json','server-timing':'region;desc="ap-northeast-2"'}).end(JSON.stringify(r.data));return;}
 const p=u.pathname==='/'?'/index.html':u.pathname;let b=await readFile(root+p);if(p.endsWith('.html'))b=Buffer.from(b.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.setHeader('content-type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':p.endsWith('.ttf')?'font/ttf':'text/html;charset=utf-8');res.end(b);
}catch(e){res.writeHead(404).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']}),user=(await f.call('/me',f.mgr)).data.user;
try{for(const width of [1440,390]){
 const context=await browser.newContext({viewport:{width,height:1100},locale:'vi-VN'});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 await context.addInitScript(({user,token})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user,token:f.mgr.split('=')[1]});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/#/dashboard');
 await page.locator('.dash-kpi-person').filter({hasText:member.name}).waitFor();await page.locator('.dash-kpi-person').filter({hasText:member.name}).click();
 assert.equal((await page.locator('.sidebar [data-nav=dashboard] span').textContent()).trim(),'Tổng quan');assert.equal(await page.locator('#breadcrumb').textContent(),'Tổng quan');assert.match(await page.title(),/^Tổng quan ·/);assert.equal(await page.locator('#view-dashboard h1').textContent(),'Tổng quan');
 const person=page.locator('.dash-kpi-person').filter({hasText:member.name});assert.equal(await person.locator('strong').textContent(),kpiPercent(member.total));
 assert.ok(Math.abs(await person.locator('.dash-kpi-bar i').evaluate(n=>parseFloat(n.style.width))-member.total*100)<0.00001);
 assert.equal(await page.locator('.dash-donut-value').textContent(),kpiPercent(member.total));assert.equal(await page.locator('.dash-donut-label').textContent(),'Tổng điểm KPI');
 assert.equal(await page.locator('.dash-kpi-table .is-total td').last().textContent(),kpiPercent(member.total));assert.ok(await page.locator('.dash-donut-value').evaluate((n,cls)=>n.classList.contains(cls),kpiAttainmentClass(member.total)));
 assert.match(await page.locator('.dash-kpi-notes').textContent(),/Bảng lương áp dụng KPI cố định/);assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:out+'/dashboard-'+width+'.png'});console.log('PASS '+width+'px: Tổng quan labels, actual KPI everywhere for fixed-100% manager, matching color/bar, explicit payroll note, no overflow/JS errors');await context.close();
}
const after=(await f.call('/dashboard/kpi?from='+month+'&to='+month,f.mgr)).data.members.find(m=>m.id==='emp');assert.equal(after.used,1);assert.equal(after.total,member.total);console.log('PASS payroll fixed setting preserved; performance total is independent');
}finally{await browser.close();server.close();await f.client.close();}
