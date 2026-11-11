/** Real local CRM/router/PGlite, synthetic Sale; no requests to production. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {eq} from 'drizzle-orm';
import {setupSalesPayroll} from '../../tests/helpers/sales-payroll-fixture.ts';
import {salesOrders,salesContracts,salesOrderLines} from '../../src/modules/sales/schema.ts';
import {quotations} from '../../src/modules/quotes/schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setupSalesPayroll(),month=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Ho_Chi_Minh'}).slice(0,7),out='/tmp/sale-kpi-document-count';await mkdir(out,{recursive:true});
await f.db.update(salesOrders).set({orderDate:month+'-07'}).where(eq(salesOrders.id,'liq-order'));
await f.db.update(salesContracts).set({status:'draft',signedDate:month+'-10'}).where(eq(salesContracts.id,'liq-contract'));
const [line]=await f.db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId,'liq-order'));
await f.db.insert(quotations).values({id:'count-browser-quote',creatorId:'emp',quoteNo:'BG-COUNT-TEST',quoteType:'HRC',customer:'Khách KPI kiểm thử',data:JSON.stringify({rows:[{name:line.name,sku:line.sku,unit:line.unit,qty:1,price:20000000,commission:{mode:'percent',value:0,excluded:true}}]}),createdAt:f.stamp,updatedAt:f.stamp});
await f.db.update(salesOrders).set({quoteId:'count-browser-quote'}).where(eq(salesOrders.id,'liq-order'));
const start=Number(month.replace('-',''));assert.equal((await f.setPolicy(1,month,{appsheetKpiFrom:start,salesAutomationFrom:start,saleKpiNetFrom:start})).status,200);assert.equal((await f.salary({fixedKpi:null})).status,200);
const root=new URL('../../trial-ui/',import.meta.url),server=createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname.startsWith('/api/staff/')){assert.equal(req.method,'GET');const token=req.headers.authorization?.replace(/^Bearer /,''),r=await f.call(u.pathname.slice('/api/staff'.length)+u.search,token?'__Host-bn-session='+token:'');res.writeHead(r.status,{'content-type':'application/json','server-timing':'local;dur=1'}).end(JSON.stringify(r.data));return;}
 const p=u.pathname==='/'?'/index.html':u.pathname;let b=await readFile(new URL('.'+p,root));if(p.endsWith('.html'))b=Buffer.from(b.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.setHeader('content-type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':p.endsWith('.ttf')?'font/ttf':'text/html; charset=utf-8');res.end(b);
}catch(e){res.writeHead(404).end(e.message);}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']}),results=[];
try{for(const who of ['manager','employee'])for(const width of [1440,390]){
 const cookie=who==='manager'?f.mgr:f.emp,user=(await f.call('/me',cookie)).data.user,c=await browser.newContext({viewport:{width,height:1050},locale:'vi-VN'});await c.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 await c.addInitScript(({user,token})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user,token:cookie.split('=')[1]});
 const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(origin+'/#/dashboard');await p.locator('.dash-kpi-table').first().waitFor();
 const row=p.locator('.dash-kpi-table tr').filter({has:p.getByText('Đơn hàng / HĐKT',{exact:true})});await row.waitFor();assert.equal(await row.locator('td').nth(1).locator('strong').textContent(),'1');assert.match(await row.locator('td').nth(1).textContent(),/chỉ tiêu 8/);assert.equal(await row.locator('td').nth(2).locator('strong').textContent(),'1,3%');
 assert.match(await p.locator('.dash-kpi-notes').textContent(),/kể cả HĐKT chưa ký/);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await p.waitForFunction(()=>document.querySelectorAll('#toasts .toast').length===0);assert.deepEqual(errors,[]);await p.locator('.dash-kpi-detail').screenshot({path:out+`/${who}-${width}.png`});results.push({who,width,actual:1,target:8,points:0.0125,errors});await c.close();
}await writeFile(out+'/results.json',JSON.stringify(results,null,2));console.log('PASS '+results.length+' desktop/mobile KPI scenarios');}
finally{await browser.close();server.close();await f.client.close();}
