/** Local router/PGlite + real CHT report popup. No production data or network. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {setup} from '../../tests/helpers/pos-fixture.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setup(),root=new URL('../../trial-ui/',import.meta.url),out=process.env.STORE_TIMING_SCREENSHOTS||'/tmp/crm-store-timing';await mkdir(out,{recursive:true});
const period='2026-11-07',draft=(await f.call(`/store/reports/draft?registerId=${f.registerId}&kind=daily&period=${period}`,f.mgr)).data;
assert.ok(draft.facts,JSON.stringify(draft));
const server=createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname==='/fixture'){res.setHeader('content-type','application/json');res.end(JSON.stringify(draft));return;}
 if(u.pathname.startsWith('/api/')){assert.equal(req.method,'GET');const r=await f.call(u.pathname.slice(4)+u.search,f.mgr);res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;}
 const p=u.pathname;let bytes=process.env.STORE_REPORT_BASELINE==='1'&&p==='/store-reports.js'?execFileSync('git',['show','HEAD:trial-ui/store-reports.js']):await readFile(new URL('.'+(p==='/'?'/index.html':p),root));
 if(p==='/')bytes=Buffer.from(bytes.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,''));
 res.setHeader('content-type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(bytes);
}catch(e){res.writeHead(500).end(String(e.message));}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),results=[];
try{for(const width of [1440,390]){
 const c=await browser.newContext({viewport:{width,height:900},timezoneId:'America/Los_Angeles'});await c.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());const page=await c.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.countdownTimers=new Set();const start=window.setInterval.bind(window),stop=window.clearInterval.bind(window);window.setInterval=(fn,ms,...args)=>{const id=start(fn,ms,...args);if(ms===30000)countdownTimers.add(id);return id;};window.clearInterval=id=>{countdownTimers.delete(id);return stop(id);};});
 await page.goto(origin);
 await page.evaluate(async()=>{
  document.querySelector('#auth').hidden=true;document.querySelector('#workspace').hidden=false;
  const{installDialogLayouts}=await import('/dialog-layout.js');installDialogLayouts();const{initStoreReports}=await import('/store-reports.js');
  const root=document.createElement('section');root.style.background='#f4f6f9';document.querySelector('.main').append(root);
  window.fixture=await(await fetch('/fixture')).json();window.mode='pending';
  const api=async path=>{
   if(path.startsWith('/store/reports/draft?')){const d=structuredClone(fixture);d.canReview=false;d.canEdit=true;d.canSubmit=true;d.versions=[];
    d.report=mode==='draft'?null:{id:'timing-test',submittedAt:'2026-11-07T02:15:00Z',review:mode==='late'?'pending':mode,state:{state:mode==='late'?'late':'on_time'},data:{facts:d.facts,inputs:{},meta:{factsAt:'2026-11-07T02:15:00Z'}}};return d;}
   const r=await fetch('/api'+path),v=await r.json();if(!r.ok)throw Error(v.error||v.message);return v;
  };
  window.ui=initStoreReports({api,root,toast:()=>{},esc:s=>String(s),go:()=>{},money:String,confirmBox:async()=>false,userId:()=> 'mgr'});await ui.show('month=2026-11');
 });
 for(const mode of ['pending','ok','late','draft']){
  await page.evaluate(async({mode,registerId,period})=>{window.mode=mode;await ui.openReport(registerId,'daily',period);},{mode,registerId:f.registerId,period});
  const d=page.locator('.store-dialog[open]');await d.waitFor();const text=await d.locator('[data-countdown]').textContent();if(mode==='pending')await page.screenshot({path:out+`/submitted-on-time-${width}.png`});
  assert.equal(text,mode==='draft'?'Chưa nộp – đã quá hạn':mode==='late'?'Đã nộp trễ':'Đã nộp đúng hạn');
  assert.equal(await page.evaluate(()=>countdownTimers.size),mode==='draft'?1:0,'submitted reports must not run an overdue countdown');
  if(mode==='pending'){assert.match(await d.locator('.modal-body').textContent(),/09:15/);await page.screenshot({path:out+`/submitted-on-time-${width}.png`});}
  await d.locator('[data-x]').first().click();await d.waitFor({state:'detached'});assert.equal(await page.evaluate(()=>countdownTimers.size),0,'close cleans up timer');results.push({width,mode,text,timerCleaned:true});
 }
 assert.deepEqual(errors,[]);await c.close();
}await writeFile(out+'/results.json',JSON.stringify(results,null,2));console.log('PASS '+results.length+' CHT submission timing cases');}
finally{await browser.close();server.close();await f.client.close();}
