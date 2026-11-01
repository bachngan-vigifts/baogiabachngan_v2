/** Local CRM/router/PGlite regression: mobile flow navigation, overlays and staff API failures; no production data. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {eq} from 'drizzle-orm';
import {customers} from '../../src/modules/customers/schema.ts';
import {setupSalesPayroll} from '../../tests/helpers/sales-payroll-fixture.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setupSalesPayroll(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url));
const server=createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/staff/')){
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined,token=req.headers.authorization?.replace(/^Bearer /,''),r=await f.call(u.pathname.slice('/api/staff'.length)+u.search,token?'__Host-bn-session='+token:'',req.method,body);res.writeHead(r.status,{'content-type':'application/json','server-timing':'local;dur=1'}).end(JSON.stringify(r.data));return;
 }
 const path=u.pathname==='/'?'/index.html':u.pathname;let data=process.env.FLOW_PHASE==='before'&&['/flow-map.css','/flow-map.js','/mobile-design.js','/mobile-action-policy.js'].includes(path)?execFileSync('git',['show','aa6e04ccb12baa4f825e09da3040160e3d1a00b2:trial-ui'+path]):await readFile(root+path);if(path.endsWith('.html'))data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':'text/html;charset=utf-8');res.end(data);
}catch(e){res.writeHead(500).end(String(e.message));}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),out='/workspace/scratch/mobile-flow',results=[];await mkdir(out,{recursive:true});



async function pageFor(width,cookie){
 const context=await browser.newContext({viewport:{width,height:1050},locale:'vi-VN'});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());const user=(await f.call('/me',cookie)).data.user;
 await context.addInitScript(({user,token})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user,token:cookie.split('=')[1]});
 const page=await context.newPage(),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));return{context,page,errors};
}

try{
 await f.db.update(customers).set({approvalStatus:'pending',createdBy:'emp'}).where(eq(customers.id,'sales-customer'));
 if(process.env.FLOW_PHASE==='before'){
  const {context,page,errors}=await pageFor(390,f.mgr);await page.goto(origin+'/#/flow');await page.locator('.flow-node').first().waitFor({state:'attached'});await page.waitForTimeout(600);
  const report=await page.evaluate(()=>({viewport:innerWidth,page:document.documentElement.scrollWidth,board:document.querySelector('.flow-board').clientWidth,canvas:document.querySelector('.flow-board').scrollWidth,hiddenNodes:[...document.querySelectorAll('.flow-node')].filter(n=>getComputedStyle(n).display==='none').map(n=>n.dataset.node),nodes:document.querySelectorAll('.flow-node').length}));
  await page.screenshot({path:out+'/before-390.png',fullPage:true});results.push({phase:'before',...report,errors});await context.close();
 }else{
  const expected=(await f.call('/flow',f.mgr)).data.nodes;
  for(const width of [320,390,430,850,1280]){
   const {context,page,errors}=await pageFor(width,f.mgr);await page.goto(origin+'/#/flow');await page.locator('.flow-node').first().waitFor();await page.waitForTimeout(300);
   assert.equal(await page.locator('.flow-node:visible').count(),Object.keys(expected).length);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
   if(width<=850)assert.equal(await page.evaluate(()=>document.querySelector('.flow-board').scrollWidth>document.querySelector('.flow-board').clientWidth+1),false);
   for(const id of Object.keys(expected)){await page.locator('.flow-node[data-node="'+id+'"]').click();const panel=page.locator('.flow-panel');await panel.waitFor();assert.equal(await panel.locator('.flow-stat:visible').count(),expected[id].metrics.length);if(id==='customers'){assert.ok(await panel.locator('.flow-item-main:visible').count()>0);const approve=panel.locator('.flow-item-actions button').filter({hasText:/^Duyệt$/});assert.equal(await approve.count(),1);if(width<=850)await approve.waitFor({state:'hidden'});else assert.equal(await approve.isVisible(),true);}const close=panel.locator('.flow-panel-close');await close.click();await panel.waitFor({state:'hidden'});}
   await page.locator('.flow-stage').first().click();await page.locator('.flow-stage-card').first().waitFor();assert.ok(await page.locator('.flow-stage-card .flow-stat:visible').count()>0);await page.locator('.flow-panel-close').click();
   await page.screenshot({path:out+'/after-'+width+'.png',fullPage:true});await page.locator('[data-node="customers"]').click();await page.waitForFunction(()=>getComputedStyle(document.querySelector('.flow-panel')).opacity==='1');if(width<=850)assert.equal(await page.evaluate(()=>document.querySelector('.flow-panel').contains(document.elementFromPoint(25,25))),true,'panel overlays floating controls');await page.locator('.flow-panel').screenshot({path:out+'/panel-'+width+'.png'});await page.keyboard.press('Escape');await page.locator('.flow-panel').waitFor({state:'hidden'});
   if(width===390){await page.locator('[data-node="customers"]').click();await page.evaluate(()=>location.hash='#/flow?check=route');await page.locator('.flow-panel').waitFor({state:'hidden'});await page.locator('[data-node="customers"]').click();await page.evaluate(()=>document.querySelector('#workspace').hidden=true);await page.locator('.flow-panel').waitFor({state:'hidden'});await page.evaluate(()=>document.querySelector('#workspace').hidden=false);await page.setViewportSize({width:1280,height:1050});await page.waitForFunction(()=>document.querySelectorAll('.flow-edge').length>0);await page.setViewportSize({width:390,height:1050});assert.equal(await page.locator('.flow-node:visible').count(),Object.keys(expected).length);}
   assert.deepEqual(errors,[]);results.push({width,nodes:Object.keys(expected).length,allNodesAndStageDetailsWork:true,noOverflow:true,errors});await context.close();
  }
  const {context,page,errors}=await pageFor(390,f.mgr);await context.route('**/api/staff/admin/members',r=>r.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'Lỗi tải giả lập'})}));await page.goto(origin+'/#/staff');await page.locator('#member-load-error').waitFor();assert.equal(await page.locator('#member-empty').isVisible(),false);
  await context.unroute('**/api/staff/admin/members');await page.locator('#member-retry').click();await page.locator('#member-list tr').first().waitFor();await page.locator('#member-load-error').waitFor({state:'hidden'});assert.deepEqual(errors,[]);results.push({staffApiFailureShowsErrorNotEmpty:true,retryWorks:true});await context.close();
 }
 console.log(JSON.stringify(results));
}finally{await writeFile(out+'/'+(process.env.FLOW_PHASE==='before'?'before':'after')+'-results.json',JSON.stringify(results,null,2));await browser.close();server.close();await f.client.close();}
