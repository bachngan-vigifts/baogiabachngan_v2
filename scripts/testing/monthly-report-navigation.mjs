/** Full CRM navigation with isolated API/PGlite. No production requests or writes. */
import assert from 'node:assert/strict';
import {mock} from 'node:test';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {eq} from 'drizzle-orm';
import {setupLiquidation} from '../../tests/helpers/liquidation-fixture.ts';
import {PASSWORD} from '../../tests/helpers/staff-fixture.ts';
import {employees} from '../../src/modules/staff/schema.ts';
const fixed=Date.parse('2026-11-08T09:00:00+07:00');mock.timers.enable({apis:['Date'],now:fixed});
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright'),f=await setupLiquidation();
await f.db.update(employees).set({positionId:'sale-admin'}).where(eq(employees.id,'new'));
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out=process.env.BROWSER_EVIDENCE_DIR||'/tmp/monthly-report-navigation',requests=[];await mkdir(out,{recursive:true});
const baseline=new Map(process.env.UI_BASELINE?['index.html','app.js','weekly-reports.js','mobile-design.js'].map(p=>['/'+p,execFileSync('git',['show',process.env.UI_BASELINE+':trial-ui/'+p])]):[]);
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://local');if(u.pathname.startsWith('/api/staff/')){
 const parts=[];for await(const c of req)parts.push(c);const body=parts.length?JSON.parse(Buffer.concat(parts).toString()):undefined,token=req.headers.authorization?.replace(/^Bearer /,'');requests.push({path:u.pathname,search:u.search,method:req.method});
 // Only the background startup request fails. Opening a reporting page can recover.
 if(u.pathname==='/api/staff/staff-reports/me'&&!u.searchParams.has('month')){res.writeHead(503,{'content-type':'application/json'}).end('{"error":"Synthetic startup outage"}');return;}
 const r=await f.call(u.pathname.slice(10)+u.search,token?'__Host-bn-session='+token:'',req.method,body);res.writeHead(r.status,{'content-type':'application/json','server-timing':'region;desc="ap-northeast-2"'}).end(JSON.stringify(r.data));return;}
 const path=u.pathname==='/'?'/index.html':u.pathname;let bytes=baseline.get(path)||await readFile(root+path);if(path.endsWith('.html'))bytes=Buffer.from(bytes.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));res.writeHead(200,{'content-type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.html')?'text/html':path.endsWith('.ttf')?'font/ttf':'application/octet-stream'}).end(bytes);
 }catch(e){res.writeHead(500).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),results=[];
try{for(const width of [1440,390])for(const [id,role]of [['emp','Sale'],['new','Sale Admin'],['mgr','Manager']]){
 const cookie=(await f.call('/login','','POST',{email:id+'@x.vn',password:PASSWORD})).cookie,user=(await f.call('/me',cookie)).data.user;
 const c=await browser.newContext({viewport:{width,height:1000},locale:'vi-VN'});await c.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());await c.addInitScript(({user,token})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user,token:cookie.split('=')[1]});
 const page=await c.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.clock.setFixedTime(new Date(fixed));const startup=page.waitForResponse(r=>r.url().endsWith('/staff-reports/me')&&r.status()===503);await page.goto(origin+'/#/flow');await startup;
 if(process.env.UI_BASELINE){assert.equal(await page.locator('[data-nav="weekly-reports"]').evaluate(n=>n.hidden),true);assert.equal(await page.locator('[data-nav="monthly-reports"]').count(),0);results.push({width,role,baselineMenuHidden:true,noMonthlyMenu:true});await c.close();continue;}
 assert.equal(await page.locator('[data-nav="monthly-reports"]').evaluate(n=>n.hidden),false);
 if(width<850){await page.locator('[data-mobile-nav-group="work"]').click();await page.locator('.crm-nav-sheet[open] [data-mobile-nav="monthly-reports"]').click();}else await page.locator('.sidebar [data-nav="monthly-reports"]').click();
 const view=page.locator('#view-monthly-reports');await view.locator('h1').filter({hasText:'Báo cáo tháng'}).waitFor();assert.equal(new URL(page.url()).hash,'#/monthly-reports');
 if(role==='Manager'){assert.equal(await view.locator('thead th').count(),3);assert.equal(await view.locator('thead th').filter({hasText:'Báo cáo tháng'}).count(),1);}
 else{assert.equal(await view.locator('[data-week]').count(),1);await view.locator('.wr-month').click();const dialog=page.locator('.wr-dialog[open]');await dialog.locator('[name="evaluation"]').waitFor();assert.equal(await dialog.getByRole('button',{name:'Nộp chính thức',exact:true}).count(),0,'in-progress month permits drafts only');await dialog.locator('[name="evaluation"]').fill('Bản nháp minh hoạ '+id+' '+width);await dialog.locator('[data-draft]').click();await dialog.waitFor({state:'hidden'});await view.locator('.wr-month').click();assert.equal(await page.locator('.wr-dialog [name="evaluation"]').inputValue(),'Bản nháp minh hoạ '+id+' '+width);await page.locator('.wr-dialog [data-x]').first().click();}
 await view.locator('#wr-month').fill('2026-10');await view.locator('#wr-month').dispatchEvent('change');await view.getByText(/Báo cáo tháng áp dụng từ tháng 11\/2026/).waitFor();assert.equal(new URL(page.url()).hash,'#/monthly-reports?month=2026-10');
 await view.locator('#wr-month').fill('2026-11');await view.locator('#wr-month').dispatchEvent('change');await view.locator('.wr-month, .wr-table').first().waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true);assert.deepEqual(errors,[]);await page.screenshot({path:out+'/'+width+'-'+id+'.png'});results.push({width,role,menuSurvivesStartupFailure:true,monthlyRoute:true,draftOnlyUntilMonthEnd:true,historicalMonthExplained:true,errors});await c.close();
}await writeFile(out+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));}finally{await browser.close();await new Promise(r=>server.close(r));await f.client.close();mock.timers.reset();}
