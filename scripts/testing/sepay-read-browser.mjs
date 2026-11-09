/** Synthetic bank data + real CRM router; every browser request outside localhost is blocked. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setupSepay} from '../../tests/helpers/sepay-fixture.ts';
import {customerPayments} from '../../src/modules/sales/schema.ts';
import {sepayTransactions} from '../../src/modules/integrations/schema.ts';
import {vietnamDate} from '../../src/modules/sales/domain/sales.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const phase=process.argv[2]||'after',root=process.env.SEPAY_UI_DIR||fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out='/tmp/sepay-read-'+phase;
await mkdir(out,{recursive:true});
const f=await setupSepay(),day=vietnamDate().iso,requests=[];let providerCalls=0,providerFail=false;
f.env.sepayApiToken='FAKE_BROWSER_SEPAY_TOKEN';
f.env.sepayApiFetch=async input=>{providerCalls++;if(providerFail)return new Response('private provider text',{status:401});
 return Response.json(new URL(String(input)).pathname.endsWith('/count')?{status:200,count_transactions:1}:{status:200,transactions:[{id:'browser-sepay-read',account_number:'123456',transaction_date:day+' 00:30:00',transaction_content:'Khách kiểm thử gửi tiền',amount_in:'100000.00',amount_out:'0.00'}]});};
const server=createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://local');
 if(u.pathname.startsWith('/api/staff/')){
  const chunks=[];for await(const c of req)chunks.push(c);const path=u.pathname.slice('/api/staff'.length)+u.search,token=req.headers.authorization?.replace(/^Bearer /,'');
  requests.push({path,method:req.method});const result=await f.call(path,token?'__Host-bn-session='+token:'',req.method,chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined);
  res.writeHead(result.status,{'content-type':'application/json','cache-control':'no-store','server-timing':'region;desc="ap-northeast-2"'}).end(JSON.stringify(result.data));return;
 }
 const path=u.pathname==='/'?'/index.html':u.pathname;
 let body=await readFile(root+path);if(path==='/index.html')body=Buffer.from(body.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.writeHead(200,{'cache-control':'no-store','content-type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':'text/html;charset=utf-8'}).end(body);
}catch(e){res.writeHead(500).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),runs=[];
const user=(await f.call('/me',f.mgr)).data.user;
try{for(const width of [1440,390])for(let run=1;run<=3;run++){
 await f.db.delete(sepayTransactions);
 await f.incoming('Giao dịch có sẵn để đo cùng dữ liệu',1000,{id:'initial-existing',transactionDate:day+' 00:20:00'});
 const context=await browser.newContext({viewport:{width,height:1000},locale:'vi-VN'});
 await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 await context.addInitScript(({token,user})=>{if(location.origin==='null')return;localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));
  window.__perf={lcp:null,cls:0};new PerformanceObserver(l=>{window.__perf.lcp=l.getEntries().at(-1).startTime;}).observe({type:'largest-contentful-paint',buffered:true});
  new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)window.__perf.cls+=e.value;}).observe({type:'layout-shift',buffered:true});
 },{token:f.mgr.split('=')[1],user});
 const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 const cdp=await context.newCDPSession(p);await cdp.send('Network.enable');await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:40,downloadThroughput:1600000,uploadThroughput:750000});
 const before=requests.length,beforeProvider=providerCalls,t=performance.now();
 await p.goto(origin+'/#/sepay?from='+day+'&to='+day+'&status=all');await p.waitForFunction(()=>document.querySelector('[data-count]')?.textContent.includes('giao dịch'));
 const ready=performance.now()-t;await p.waitForTimeout(800);
 const metrics=await p.evaluate(()=>{const n=performance.getEntriesByType('navigation')[0],r=performance.getEntriesByType('resource');return{ttfb:n.responseStart-n.requestStart,load:n.loadEventEnd-n.startTime,fcp:performance.getEntriesByName('first-contentful-paint')[0]?.startTime,lcp:window.__perf.lcp,cls:window.__perf.cls,jsRequests:r.filter(x=>new URL(x.name).pathname.endsWith('.js')).length,jsBytes:r.filter(x=>new URL(x.name).pathname.endsWith('.js')).reduce((s,x)=>s+x.encodedBodySize,0)};});
 assert.equal(providerCalls,beforeProvider,'opening the page never reads SePay automatically');
 const openingApis=requests.slice(before).length;
 if(phase==='after'||phase==='auto'){
  const pulls=requests.filter(r=>r.path==='/sepay/pull-today').length,start=performance.now();
  await p.locator('[data-pull]').waitFor({state:'visible'});assert.equal(await p.locator('[data-pull]').isEnabled(),true);
  await p.locator('[data-pull]').evaluate(b=>{b.click();b.click();});
  await p.locator('[data-pull-notice]').filter({hasText:'Chưa tạo phiếu thu.'}).waitFor();await p.locator('[data-row]').first().waitFor();
  assert.equal(requests.filter(r=>r.path==='/sepay/pull-today').length,pulls+1,'double click cannot start two imports');
  metrics.pullReady=performance.now()-start;
  assert.equal((await f.db.select().from(sepayTransactions)).length,2);assert.equal((await f.db.select().from(customerPayments)).length,0);
  if(run===3){providerFail=true;await p.locator('[data-pull]').click();await p.locator('[data-pull-notice]').filter({hasText:'Chưa xác nhận được đợt'}).waitFor();
   assert.equal(await p.locator('[data-pull]').isEnabled(),true);providerFail=false;await p.locator('[data-pull]').click();await p.locator('[data-pull-notice]').filter({hasText:'Chưa tạo phiếu thu.'}).waitFor();}
 }
 if(phase==='auto'&&run===3){
  const providersBefore=providerCalls,currentHash=await p.evaluate(()=>location.hash);
  await f.incoming('Giao dịch mới kiểm tra tự cập nhật',2000,{id:'auto-'+width,transactionDate:day+' 00:40:00'});
  const listed=requests.filter(r=>r.path.startsWith('/sepay/transactions?')).length;
  await p.waitForTimeout(32_000);
  await p.locator('[data-list]').filter({hasText:'Giao dịch mới kiểm tra tự cập nhật'}).waitFor();
  assert.ok(requests.filter(r=>r.path.startsWith('/sepay/transactions?')).length>listed);
  assert.equal(providerCalls,providersBefore,'visible heartbeat reads CRM only, never SePay');
  assert.equal(await p.evaluate(()=>location.hash),currentHash,'automatic refresh preserves filters');
  assert.equal((await f.db.select().from(customerPayments)).length,0);
  await p.locator('[data-open]').first().click();
  await p.locator('[data-detail] h2').waitFor();
  const afterDetail=requests.filter(r=>r.path.startsWith('/sepay/transactions?')).length;
  await p.waitForTimeout(31_000);
  assert.equal(requests.filter(r=>r.path.startsWith('/sepay/transactions?')).length,afterDetail,'reconciliation detail blocks automatic redraw');
  metrics.autoRefresh=true;metrics.detailPreserved=true;
 }
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true);assert.deepEqual(errors,[]);
 if(run===3)await p.screenshot({path:out+'/'+width+'.png',fullPage:true});
 runs.push({width,run,ready,...metrics,openingApis,errors});console.log(width,run,Math.round(ready));await context.close();
}
const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)],summary=[1440,390].map(width=>({width,...Object.fromEntries(['ready','ttfb','load','fcp','lcp','cls','jsRequests','jsBytes','openingApis'].map(k=>[k,median(runs.filter(r=>r.width===width).map(r=>r[k]))]))}));
await writeFile(out+'/results.json',JSON.stringify({phase,conditions:{browser:'Chromium',coldContexts:true,runsPerViewport:3,latencyMs:40,downloadBps:1600000,source:'isolated real CRM API + synthetic SePay, not production'},summary,runs},null,2));console.log(JSON.stringify(summary));
}finally{await browser.close();await new Promise(r=>server.close(r));await f.client.close();}
