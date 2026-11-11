/** Local, warmed browser comparison only (routing disables HTTP cache). Synthetic data; external requests are blocked. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const root=resolve(process.env.CRM_ROOT||'.'),{homeFixture}=await import(pathToFileURL(root+'/tests/helpers/home-fixture.ts').href),f=await homeFixture();
const {chromium}=await import('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const handler=[];
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/staff/')){const chunks=[];for await(const c of req)chunks.push(c);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined,token=req.headers.authorization?.replace(/^Bearer /,''),start=performance.now(),r=await f.call(u.pathname.slice(10)+u.search,token?'__Host-bn-session='+token:'',req.method,body);
 if(u.pathname==='/api/staff/warehouse-workspace')handler.push(performance.now()-start);
 res.writeHead(r.status,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify({...r.data,...(r.cookie?{sessionToken:/__Host-bn-session=([a-f0-9]{64})/.exec(r.cookie)?.[1]||''}:{})}));return;}
 const path=u.pathname==='/'?'/index.html':u.pathname;let bytes=await readFile(root+'/trial-ui'+path);if(path.endsWith('.html'))bytes=Buffer.from(bytes.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.writeHead(200,{'content-type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':path.endsWith('.png')?'image/png':'text/html','cache-control':'max-age=300'}).end(bytes);
 }catch(e){res.writeHead(500).end(String(e.message));}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']}),context=await browser.newContext({viewport:{width:390,height:844},locale:'vi-VN'}),page=await context.newPage();
await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
await page.addInitScript(()=>{window.__metrics={lcp:0,cls:0};new PerformanceObserver(l=>{for(const e of l.getEntries())window.__metrics.lcp=e.startTime;}).observe({type:'largest-contentful-paint',buffered:true});new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)window.__metrics.cls+=e.value;}).observe({type:'layout-shift',buffered:true});});
try{
 await page.goto(origin+'/#/kho');await page.locator('#email').fill('mgr@x.vn');await page.locator('#password').fill('mat-khau-12345');await page.locator('#login-button').click();await page.locator('#workspace').waitFor({state:'visible'});await page.goto(origin+'/#/kho');await page.locator('.ww-page').waitFor();
 const trials=[];for(let i=0;i<3;i++){handler.length=0;const start=performance.now();await page.reload({waitUntil:'load'});await page.locator('.ww-page').waitFor();const ready=performance.now()-start;await page.waitForTimeout(500);
 const result=await page.evaluate(()=>{const n=performance.getEntriesByType('navigation')[0],f=performance.getEntriesByName('first-contentful-paint')[0];return{loadMs:n.loadEventEnd,ttfbMs:n.responseStart,fcpMs:f?.startTime??null,lcpMs:window.__metrics.lcp||null,cls:window.__metrics.cls};});trials.push({...result,readyMs:ready,workspaceHandlerMs:handler[0]??null});}
 const median=Object.fromEntries(Object.keys(trials[0]).map(k=>[k,trials.map(t=>t[k]).sort((a,b)=>a-b)[1]]));assert.ok(trials.every(t=>t.workspaceHandlerMs!=null));
 const result={root,conditions:'3 warmed browser reloads; HTTP cache disabled by routing; Chromium; 390x844; localhost/PGlite; identical homeFixture; no throttling; external requests blocked; not production metrics',trials,median};if(process.env.PERF_OUT)await writeFile(process.env.PERF_OUT,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();await new Promise(r=>server.close(r));await Promise.allSettled([...f.background]);await f.client.close();}
