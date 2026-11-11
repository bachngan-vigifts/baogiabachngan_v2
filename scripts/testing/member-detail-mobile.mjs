/** Real CRM router, synthetic staff/customer documents; browser traffic is local and read-only. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {eq} from 'drizzle-orm';
import {setupSalesPayroll} from '../../tests/helpers/sales-payroll-fixture.ts';
import {customers} from '../../src/modules/customers/schema.ts';
import {quotations} from '../../src/modules/quotes/schema.ts';
import {salesOrders,salesOrderLines,paymentSchedules,customerPayments} from '../../src/modules/sales/schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const phase=process.argv[2]||'after',root=process.env.MEMBER_UI_DIR||fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out='/tmp/member-detail-mobile-'+phase;
await mkdir(out,{recursive:true});const f=await setupSalesPayroll();await f.salary();
const longName='CÔNG TY CỔ PHẦN REGENT VIỆT NAM VÀ CÁC ĐỐI TÁC THƯƠNG MẠI QUỐC TẾ',no='DH_001_31102026_LONG_DOCUMENT_NUMBER';
await f.db.update(customers).set({name:longName,phone:'0901234567'}).where(eq(customers.id,'sales-customer'));
await f.db.insert(quotations).values({id:'mobile-quote',creatorId:'emp',assigneeId:'emp',quoteNo:'BG_001_31102026_LONG_REFERENCE',quoteType:'B2B',customer:longName,quoteDate:'2026-10-31',approvalStatus:'approved',createdAt:f.stamp,updatedAt:f.stamp,data:JSON.stringify({customer:longName,customerId:'sales-customer',type:'B2B',vat:8,rows:[{name:'Hàng kiểm thử',qty:1,price:1234567890}]})});
await f.db.insert(salesOrders).values({id:'mobile-order',orderNo:no,customerId:'sales-customer',customerName:longName,quoteType:'B2B',ownerId:'emp',createdBy:'emp',orderDate:'2026-10-31',status:'confirmed',subtotal:1234567890,total:1234567890,createdAt:f.stamp,updatedAt:f.stamp});
await f.db.insert(salesOrderLines).values({id:'mobile-line',orderId:'mobile-order',lineNo:1,sku:'',name:'Dòng không tồn kho',qty:1,unitPrice:1234567890,amount:1234567890});
await f.db.insert(paymentSchedules).values({id:'mobile-balance',orderId:'mobile-order',kind:'balance',amount:1234567890,dueDate:'2026-10-31',createdAt:f.stamp});
await f.db.insert(customerPayments).values({id:'mobile-receipt',orderId:'mobile-order',customerId:'sales-customer',amount:100000,method:'transfer',reference:'Mã chuyển khoản rất dài để kiểm tra bố cục trên điện thoại',paidAt:'2026-10-31',createdBy:'emp',createdAt:f.stamp});
const writes=[],requests=[];
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/staff/')){
 if(req.method!=='GET'){writes.push(req.url);res.writeHead(405).end();return;}
 const path=u.pathname.slice('/api/staff'.length)+u.search,token=req.headers.authorization?.replace(/^Bearer /,'');requests.push(path);const r=await f.call(path,token?'__Host-bn-session='+token:'');
 res.writeHead(r.status,{'content-type':'application/json','cache-control':'no-store','server-timing':'region;desc="ap-northeast-2"'}).end(JSON.stringify(r.data));return;}
 const path=u.pathname==='/'?'/index.html':u.pathname;let data=await readFile(root+path);if(path.endsWith('.html'))data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.writeHead(200,{'cache-control':'no-store','content-type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':'text/html;charset=utf-8'}).end(data);
}catch(e){res.writeHead(500).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),runs=[],cases=[];
async function open(width,cookie=f.mgr,throttle=false){const user=(await f.call('/me',cookie)).data.user,c=await browser.newContext({viewport:{width,height:932},locale:'vi-VN'});await c.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());await c.addInitScript(({token,user})=>{if(location.origin==='null')return;localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));window.__perf={lcp:null,cls:0};new PerformanceObserver(l=>window.__perf.lcp=l.getEntries().at(-1).startTime).observe({type:'largest-contentful-paint',buffered:true});new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)window.__perf.cls+=e.value;}).observe({type:'layout-shift',buffered:true});},{token:cookie.split('=')[1],user});const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));if(throttle){const d=await c.newCDPSession(p);await d.send('Network.enable');await d.send('Network.emulateNetworkConditions',{offline:false,latency:40,downloadThroughput:1600000,uploadThroughput:750000});}return{c,p,errors};}
try{
 for(const width of [1440,430])for(let run=1;run<=3;run++){
  const {c,p,errors}=await open(width,f.mgr,true),start=performance.now(),count=requests.length;await p.goto(origin+'/#/members/emp?month=2026-10');await p.locator('#member-detail .cd-tab-body tbody tr').first().waitFor();const ready=performance.now()-start;await p.waitForTimeout(600);
  const metrics=await p.evaluate(()=>{const n=performance.getEntriesByType('navigation')[0],r=performance.getEntriesByType('resource');return{ttfb:n.responseStart-n.requestStart,load:n.loadEventEnd-n.startTime,fcp:performance.getEntriesByName('first-contentful-paint')[0]?.startTime,lcp:window.__perf.lcp,cls:window.__perf.cls,jsRequests:r.filter(x=>new URL(x.name).pathname.endsWith('.js')).length,jsBytes:r.filter(x=>new URL(x.name).pathname.endsWith('.js')).reduce((s,x)=>s+x.encodedBodySize,0)};});runs.push({width,run,ready,...metrics,openingApis:requests.length-count});assert.deepEqual(errors,[]);await c.close();
 }
 if(phase!=='before')for(const width of [320,360,390,430,768,850,1440]){
  const {c,p,errors}=await open(width);await p.goto(origin+'/#/members/emp?month=2026-10');await p.locator('#member-detail .cd-tab-body tbody tr').first().waitFor();
  for(const tab of ['customers','quotes','orders','contracts','payments','debts']){
   await p.locator('#member-detail .cd-tabs [data-tab="'+tab+'"]').click();await p.locator('#member-detail .cd-tab-body tbody tr').first().waitFor();
   assert.equal(await p.locator('#member-detail .cd-tabs [data-tab="'+tab+'"]').getAttribute('aria-selected'),'true');
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,tab+' page overflow '+width);
   if(width<=850){assert.equal(await p.locator('.md-related-table').evaluate(t=>t.scrollWidth<=t.clientWidth+1),true,tab+' table overflow '+width);const row=p.locator('.md-related-table tbody tr').first();assert.equal(await row.evaluate(el=>getComputedStyle(el).display),'grid');
    assert.equal(await row.locator('td').first().evaluate(el=>el.getBoundingClientRect().width>innerWidth*.5),true,tab+' first cell too narrow');
    assert.equal(await row.evaluate(el=>[...el.children].every(cell=>{const a=el.getBoundingClientRect(),b=cell.getBoundingClientRect();return b.left>=a.left-1&&b.right<=a.right+1;})),true,tab+' cell escapes card');
    assert.equal(await p.locator('#member-detail .cd-tabs [data-tab="'+tab+'"]').evaluate(el=>{const a=el.parentElement.getBoundingClientRect(),b=el.getBoundingClientRect();return b.left>=a.left-1&&b.right<=a.right+1;}),true,'selected tab hidden');
   } else assert.equal(await p.locator('.md-related-table').evaluate(el=>getComputedStyle(el).display),'table');
   if(tab==='customers'){assert.ok((await p.locator('.cd-tab-body').textContent()).includes(longName));assert.equal(await p.locator('.md-related-table tbody tr').first().locator('td').first().evaluate(el=>el.getBoundingClientRect().height<200),true);}
   if(width===430||width===1440)await p.locator('#member-detail .cd-tabs-card').screenshot({path:out+'/'+tab+'-'+width+'.png'});
  }
  for(const tab of ['attendance','payroll']){await p.locator('#member-detail .cd-tabs [data-tab="'+tab+'"]').click();assert.equal(await p.locator('#member-detail .cd-tabs [data-tab="'+tab+'"]').getAttribute('aria-selected'),'true');assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);}
  assert.deepEqual(errors,[]);cases.push({width,relatedTabs:6,payrollAndAttendance:true});await c.close();
 }
 if(phase!=='before'){
  const {c,p,errors}=await open(430,f.emp);await p.goto(origin+'/#/members/emp?month=2026-10');await p.locator('.md-related-table tbody tr').first().waitFor();assert.equal(await p.locator('[data-act="salary"]').count(),0);await p.locator('.md-related-table tbody tr a').first().click();await p.waitForURL('**/#/customers/sales-customer');assert.deepEqual(errors,[]);await c.close();
  assert.equal((await f.overview(f.other)).status,403);
 }
 assert.equal(writes.length,0);
 const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)],summary=[1440,430].map(width=>{const subset=runs.filter(r=>r.width===width);return{width,...Object.fromEntries(Object.keys(subset[0]).filter(k=>!['width','run'].includes(k)).map(k=>[k,median(subset.map(r=>r[k]))]))};});
 await writeFile(out+'/results.json',JSON.stringify({phase,conditions:{runsPerViewport:3,latencyMs:40,downloadBps:1600000,source:'local CRM API and synthetic data; not production'},summary,runs,cases,writes},null,2));console.log(JSON.stringify({summary,cases}));
}finally{await browser.close();await new Promise(r=>server.close(r));await f.client.close();}
