/** Real local router/UI with synthetic payroll; checks actual KPI display without changing payroll overrides. */
import assert from 'node:assert/strict';import {createServer} from 'node:http';import {readFile,mkdir} from 'node:fs/promises';import {fileURLToPath} from 'node:url';
import {eq} from 'drizzle-orm';import {setupSalesPayroll} from '../../tests/helpers/sales-payroll-fixture.ts';import {employees} from '../../src/modules/staff/schema.ts';
import {kpiPercent,kpiAttainmentClass} from '../../trial-ui/dashboard.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright'),f=await setupSalesPayroll(),month='2026-10';
await f.setPolicy(1);await f.salary();await f.care();
if(process.env.KPI_PENDING_ADMIN){await f.db.update(employees).set({positionId:'sale-admin'}).where(eq(employees.id,'emp'));await f.setPolicy(1,month,{saleKpiNetFrom:202610});}
const data=(await f.call('/dashboard/kpi?from='+month+'&to='+month,f.mgr)).data,member=data.members.find(m=>m.id==='emp');
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out='/workspace/artifacts/kpi-detail';await mkdir(out,{recursive:true});
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
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.clock.setFixedTime(new Date('2026-10-31T12:00:00+07:00'));await page.goto(origin+'/#/dashboard');
 await page.locator('.dash-kpi-drilldown').first().waitFor();
 if(process.env.KPI_PENDING_ADMIN)assert.match(await page.locator('.dash-kpi-table').textContent(),/Chưa đủ dữ liệu/);
 for(const part of member.parts){
  await page.getByRole('button',{name:'Xem chi tiết '+part.label+' của '+member.name,exact:true}).click();
  const dialog=page.locator('.dash-kpi-popup');await dialog.locator('tbody tr').first().waitFor();
  assert.equal(await dialog.locator('tbody tr').count(),1);assert.match(await dialog.textContent(),/Tổng CRM hiện tại/);
  assert.ok(await dialog.evaluate(n=>n.getBoundingClientRect().width<=innerWidth));
  await page.screenshot({path:out+'/'+width+'-'+part.key+'.png'});await dialog.getByRole('button',{name:'Đóng',exact:true}).click();assert.equal(await dialog.count(),0);
 }
 assert.deepEqual(errors,[]);console.log('PASS '+width+'px: all four KPI buttons open current source rows, close correctly, no JS errors');await context.close();

}
}finally{await browser.close();server.close();await f.client.close();}
