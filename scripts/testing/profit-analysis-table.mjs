/** Full CRM profit table + real isolated API. Synthetic orders/costs, no production writes. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {profitDateFixture} from '../../tests/helpers/profit-date-fixture.ts';
import {salesLineCosts} from '../../src/modules/sales/line-cost-schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright'),f=await profitDateFixture();
await f.db.update(salesLineCosts).set({confidence:'estimate',source:'purchase'});
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out='/tmp/profit-analysis-table',queries=[];await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://local');if(u.pathname.startsWith('/api/staff/')){assert.equal(req.method,'GET','browser must not change financial data');const path=u.pathname.slice(10)+u.search,token=req.headers.authorization?.replace(/^Bearer /,'');if(u.pathname.endsWith('/profit'))queries.push(path);const r=await f.call(path,token?'__Host-bn-session='+token:'');res.writeHead(r.status,{'content-type':'application/json','server-timing':'region;desc="ap-northeast-2"'}).end(JSON.stringify(r.data));return;}
 const path=u.pathname==='/'?'/index.html':u.pathname;let bytes=await readFile(root+path);if(path.endsWith('.html'))bytes=Buffer.from(bytes.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));res.writeHead(200,{'content-type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.html')?'text/html':path.endsWith('.ttf')?'font/ttf':'application/octet-stream'}).end(bytes);
 }catch(e){res.writeHead(500).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),user=(await f.call('/me',f.mgr)).data.user,results=[];
try{for(const width of [1138,390]){
 const c=await browser.newContext({viewport:{width,height:1000},locale:'vi-VN',acceptDownloads:true});await c.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());await c.addInitScript(({user,token})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));Date.now=()=>Date.parse('2026-11-07T03:00:00Z');},{user,token:f.mgr.split('=')[1]});
 const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(origin+'/#/profit');const analysis=p.locator('[data-pf-analysis]');await analysis.waitFor();
 const ready=()=>p.waitForFunction(()=>!document.querySelector('#view-profit').hasAttribute('aria-busy')&&!document.querySelector('#view-profit').hasAttribute('data-pf-stale'));
 await ready();assert.equal(await p.locator('#pf-costs').inputValue(),'all');assert.equal(await analysis.evaluate(el=>el.parentElement.firstElementChild===el),true,'analysis is directly below filters');assert.ok((await analysis.boundingBox()).y>=(await p.locator('.pf-head').boundingBox()).y);
 async function values(){assert.equal(await analysis.locator('td[data-label="Giá vốn hàng bán"]').filter({hasText:'3.500.000'}).count(),1);assert.equal(await analysis.locator('td[data-label="CP trực tiếp"]').filter({hasText:/^0$/}).count(),1);assert.match(await analysis.locator('td[data-label="LN gộp"]').first().textContent(),/3\.500\.000/);}
 await values();await p.getByRole('status').filter({hasText:'giá ước tính / tham chiếu'}).waitFor();
 for(const tab of ['customers','products','branches']){await analysis.locator('[data-tab='+tab+']').click();await values();}
 await analysis.locator('[data-tab=series]').click();assert.equal(await analysis.locator('.pf-chart').count(),1);assert.equal(await analysis.locator('th').filter({hasText:'Giá vốn hàng bán'}).count(),1);
 await analysis.locator('[data-tab=owners]').click();
 await p.locator('#pf-costs').selectOption('confirmed');await ready();assert.equal(new URL(queries.at(-1),origin).searchParams.get('costs'),'confirmed');assert.equal((await analysis.locator('td[data-label="Giá vốn hàng bán"]').first().textContent()).trim(),'—');assert.equal((await analysis.locator('td[data-label="LN gộp"]').first().textContent()).trim(),'—');
 const download=p.waitForEvent('download');await p.locator('#pf-csv').click();const csv=await readFile(await(await download).path(),'utf8'),row=csv.trim().split('\n')[1].split(',');assert.deepEqual(row.slice(3,6),['','',''],'unknown financial values must not become zero in CSV');
 await analysis.locator('[data-tab=series]').click();assert.equal(await analysis.locator('.pf-chart').count(),0);await analysis.getByText(/Chưa đủ giá vốn theo bộ lọc/).waitFor();
 await p.locator('#pf-costs').selectOption('all');await ready();assert.equal(await analysis.locator('.pf-chart').count(),1);
 await p.locator('[data-grain=day]').click();await ready();await analysis.locator('[data-tab=owners]').click();assert.match(await analysis.locator('td[data-label="Giá vốn hàng bán"]').first().textContent(),/500\.000/);assert.match(await analysis.locator('td[data-label="LN gộp"]').first().textContent(),/500\.000/);
 assert.deepEqual(errors,[]);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true);await p.screenshot({path:out+'/'+width+'.png'});results.push({width,analysisUnderFilters:true,costAndDirectColumns:true,estimatesVisibleAndLabelled:true,confirmedFilterStillWorks:true,unknownNotZero:true,csvUnknownBlank:true,dateFiltersRetained:true,errors});await c.close();
}await writeFile(out+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));}finally{await browser.close();await new Promise(r=>server.close(r));await f.client.close();}
