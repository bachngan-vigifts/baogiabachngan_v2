/** Real local CRM/router; synthetic data and no external requests. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {splitDeliveryFixture} from '../../tests/helpers/split-delivery-fixture.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright'),f=await splitDeliveryFixture();
const out=process.env.REVIEW_DIR||'/tmp/split-delivery';await mkdir(out,{recursive:true});
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url));
const server=createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname.startsWith('/api/staff/')){
  const chunks=[];for await(const c of req)chunks.push(c);const token=req.headers.authorization?.replace(/^Bearer /,'')||'';
  const r=await f.call(u.pathname.slice('/api/staff'.length)+u.search,token?'__Host-bn-session='+token:'',req.method,chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined);
  res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;
 }
 const path=u.pathname==='/'?'/index.html':u.pathname;let data=await readFile(root+path);if(path.endsWith('.html'))data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.writeHead(200,{'content-type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html'}).end(data);
}catch{res.writeHead(404).end('Fixture resource unavailable');}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),results=[];
try{
 for(const [role,cookie]of [['manager',f.mgr],['owner',f.emp]])for(const width of [390,1440]){
  const user=(await f.call('/me',cookie)).data.user,token=cookie.split('=')[1],context=await browser.newContext({viewport:{width,height:1000},locale:'vi-VN',timezoneId:'Asia/Ho_Chi_Minh'});
  await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());await context.addInitScript(({user,token})=>{localStorage.setItem('bn-api-region-manual-off','1');localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user,token});
  const page=await context.newPage(),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/#/orders/'+f.id);
  const print=page.locator('#view-order [data-ship-print-for="'+f.id+'"]').first();await print.waitFor({state:'attached'});
  if(!await print.isVisible())await page.locator('#order-actions .mobile-action-trigger:visible').first().click();await print.click();
  const dialog=page.locator('dialog[open]').filter({has:page.getByRole('heading',{name:'In phiếu giao hàng',exact:true})});await dialog.waitFor();
  const choices=dialog.locator('[data-choice]'),options=await choices.locator('option').evaluateAll(ns=>ns.map(n=>({id:n.value,text:n.textContent}))),sheets=[];
  for(const [date,qty]of [['16/11/2026',170],['19/11/2026',80]]){
   const option=options.find(o=>o.id&&o.text.includes(date));assert.ok(option);await choices.selectOption(option.id);
   const row=dialog.locator('.paper tbody tr').filter({hasText:'Ly sứ kiểm thử'});assert.equal((await row.locator('td').nth(5).innerText()).trim(),'250');assert.equal((await row.locator('td').nth(6).innerText()).trim(),String(qty));
   await dialog.screenshot({path:out+`/${role}-${width}-${qty}.png`});sheets.push({date,qty,ordered:250});
  }
  await dialog.getByRole('button',{name:'Đóng',exact:true}).first().click();
  // Exercise the real source-planning module with the API and real DOM, without creating a new order/request.
  await page.evaluate(async({quoteId,origin})=>{const {initQuoteSourcing}=await import('/quote-sourcing.js');const host=document.createElement('dialog');host.className='modal xwide';const body=document.createElement('section');host.append(body);document.body.append(host);host.showModal();window.sourceFixture=await initQuoteSourcing({quoteId,host:body,api:async path=>{const r=await fetch(origin+'/api/staff'+path,{headers:{authorization:'Bearer '+localStorage.getItem('bn-v2-session')}});if(!r.ok)throw Error('Fixture API '+r.status);return r.json();},confirmBox:async()=>false});}, {quoteId:f.quoteId,origin});
  const planner=page.locator('dialog[open]').last();await planner.getByRole('combobox',{name:'Kho bán / kho xuất',exact:true}).selectOption('pos-wh');
  await planner.getByRole('combobox',{name:'Kho xin hàng 00123'}).selectOption('source-other');
  await planner.getByLabel('Ngày giao khách từ kho 00123',{exact:true}).fill('2026-11-16');await planner.getByLabel('Ngày giao khách nguồn bổ sung 00123 1',{exact:true}).fill('2026-11-19');
  const plan=await page.evaluate(()=>window.sourceFixture.read());assert.deepEqual(plan.stockPlan.map(p=>[p.qty,p.plannedDate]),[[170,'2026-11-16'],[80,'2026-11-19']]);
  await planner.screenshot({path:out+`/${role}-${width}-source-dates.png`});assert.ok(await planner.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'planner does not overflow');
  const timings=[];for(let i=0;i<5;i++){const start=performance.now();const r=await f.call('/orders/'+f.id,cookie);assert.equal(r.status,200);timings.push(performance.now()-start);}timings.sort((a,b)=>a-b);
  assert.deepEqual(errors,[]);results.push({role,width,sheets,sourcePlanDates:true,jsErrors:errors,orderMedianMs:Math.round(timings[2])});await context.close();
 }
}finally{await writeFile(out+'/results.json',JSON.stringify(results,null,2));await browser.close();await new Promise(r=>server.close(r));await f.client.close();}
console.log(JSON.stringify(results));
