/** Local browser regression against actual CRM/router + PostgreSQL WASM, never production. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setupSalesPayroll} from '../../tests/helpers/sales-payroll-fixture.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setupSalesPayroll(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url));
await f.salary({baseSalary:5200000,kpiEnabled:false,contractBonusEnabled:false});
const server=createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname.startsWith('/api/staff/')){
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined,token=req.headers.authorization?.replace(/^Bearer /,'');
  const r=await f.call(u.pathname.slice('/api/staff'.length)+u.search,token?'__Host-bn-session='+token:'',req.method,body);
  res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;
 }
 const path=u.pathname==='/'?'/index.html':u.pathname;let bytes=await readFile(root+path);
 if(path.endsWith('.html'))bytes=Buffer.from(bytes.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':'text/html;charset=utf-8');res.end(bytes);
}catch(e){res.writeHead(500).end(e.message);}}).listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,out='/workspace/scratch/payroll-quick-entry';await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),results=[];
try{
 for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:1000},locale:'vi-VN'});
  await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
  const user=(await f.call('/me',f.mgr)).data.user;
  await context.addInitScript(({user,token})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user,token:f.mgr.split('=')[1]});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/#/payroll?month=2026-10');
  await page.locator('#pr-quick').waitFor();
  assert.equal(await page.locator('.pr-quick-table thead').evaluate(n=>getComputedStyle(n).display),'table-header-group');
  assert.equal(await page.locator('.pr-quick-table tbody').evaluate(n=>getComputedStyle(n).display),'table-row-group');
  const days=page.locator('[data-member="emp"][data-key="workDays"]');
  await days.evaluate((node,text)=>{const transfer=new DataTransfer();transfer.setData('text/plain',text);node.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:transfer}));},width===1440?'24,5\t1,5\n26\t0':'25\t2\n26\t0');
  await page.locator('[data-quick-mode]').selectOption('adjustments');
  await page.locator('[data-member="emp"][data-key="advance"]').fill(width===1440?'500000':'600000');
  await page.locator('[data-quick-save]').click();
  await page.waitForFunction(()=>document.querySelector('[data-quick-count]')?.textContent==='');
  const board=(await f.call('/hr/payroll/2026-10',f.mgr)).data,r=board.rows.find(r=>r.member.id==='emp');
  assert.equal(r.entry.inputs.workDays,width===1440?24.5:25);assert.equal(r.entry.inputs.overtimeHours,width===1440?1.5:2);assert.equal(board.rows.find(r=>r.member.id==='mgr').entry.inputs.workDays,26);assert.equal(r.entry.adjustments.advance,width===1440?500000:600000);
  await page.locator('[data-quick-mode]').selectOption('inputs');
  assert.equal(await page.locator('[data-member="emp"][data-key="workDays"]').inputValue(),width===1440?'24,5':'25');
  await page.locator('[data-quick-search]').fill(user.name);assert.equal(await page.locator('[data-quick-row]:not([hidden])').count(),1);
  await page.locator('[data-quick-search]').fill('');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'table scroll stays within page');
  await page.screenshot({path:out+'/payroll-'+width+'.png',fullPage:true});
  // P1 regression: block an intentionally delayed next-month response, then try to edit the old October node.
  await days.fill('17');
  const oldDays=await days.elementHandle();
  let release,started;
  const gate=new Promise(resolve=>{release=resolve;}),pending=new Promise(resolve=>{started=resolve;});
  const novemberURL='**/api/staff/hr/payroll/2026-11';
  await context.route(novemberURL,async route=>{started();await gate;await route.continue();});
  await page.evaluate(()=>{location.hash='#/payroll?month=2026-11';});await pending;
  assert.equal(await page.locator('#payroll-board').getAttribute('aria-busy'),'true');
  assert.equal(await oldDays.evaluate(n=>n.disabled),true,'old month must be locked synchronously');
  assert.equal(await page.locator('.pr-quick-value').count(),0,'no editable old-month cells while loading');
  await oldDays.evaluate(n=>{n.value='19';n.dispatchEvent(new Event('input',{bubbles:true}));});
  release();await page.locator('#pr-quick[data-payroll-month="2026-11"]').waitFor();
  assert.equal(await days.inputValue(),'','October draft must not enter November');
  await page.locator('[data-quick-save]').click();
  assert.equal((await f.call('/hr/payroll/2026-11',f.mgr)).data.rows.find(r=>r.member.id==='emp').entry.inputs.workDays,null);
  await context.unroute(novemberURL);
  await page.evaluate(()=>{location.hash='#/payroll?month=2026-10';});await page.locator('#pr-quick[data-payroll-month="2026-10"]').waitFor();
  assert.equal(await days.inputValue(),'17','October draft stays with October, detached edits are ignored');
  await page.locator('[data-quick-save]').click();await page.waitForFunction(()=>document.querySelector('[data-quick-count]')?.textContent==='');
  assert.equal((await f.call('/hr/payroll/2026-10',f.mgr)).data.rows.find(r=>r.member.id==='emp').entry.inputs.workDays,17);
  assert.equal((await f.call('/hr/payroll/2026-11',f.mgr)).data.rows.find(r=>r.member.id==='emp').entry.inputs.workDays,null);
  // A late November response must not replace a newer December board.
  let resumeLate,lateStarted;
  const lateGate=new Promise(resolve=>{resumeLate=resolve;}),latePending=new Promise(resolve=>{lateStarted=resolve;});
  await context.route(novemberURL,async route=>{lateStarted();await lateGate;await route.continue();});
  await page.evaluate(()=>{location.hash='#/payroll?month=2026-11';});await latePending;
  await page.evaluate(()=>{location.hash='#/payroll?month=2026-12';});await page.locator('#pr-quick[data-payroll-month="2026-12"]').waitFor();
  const lateResponse=page.waitForResponse(response=>response.url().endsWith('/hr/payroll/2026-11'));
  resumeLate();await (await lateResponse).finished();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await page.locator('#pr-quick').getAttribute('data-payroll-month'),'2026-12');
  await context.unroute(novemberURL);
  // Failure while switching never re-enables a stale board; retry can recover.
  await context.route(novemberURL,route=>route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'Test month load failure'})}));
  await page.evaluate(()=>{location.hash='#/payroll?month=2026-11';});
  await page.getByRole('heading',{name:'Không mở được bảng lương'}).waitFor();
  assert.equal(await page.locator('.pr-quick-value').count(),0);
  await context.unroute(novemberURL);
  await page.evaluate(()=>{location.hash='#/payroll?month=2026-10';});await page.locator('#pr-quick[data-payroll-month="2026-10"]').waitFor();
  assert.equal(await days.inputValue(),'17');
  // P1 regression: Vietnamese grouped rate and quantity must persist as 15000, not 15.
  await page.locator('[data-member="emp"][data-key="outputQty"]').evaluate(node=>{const transfer=new DataTransfer();transfer.setData('text/plain','15.000\n');node.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:transfer}));});
  await page.locator('[data-quick-mode]').selectOption('profile');
  await page.locator('[data-member="emp"][data-key="outputRate"]').evaluate(node=>{const transfer=new DataTransfer();transfer.setData('text/plain','15.000\n');node.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:transfer}));});
  await page.locator('[data-quick-save]').click();await page.waitForFunction(()=>document.querySelector('[data-quick-count]')?.textContent==='');
  const parsed=(await f.call('/hr/payroll/2026-10',f.mgr)).data.rows.find(r=>r.member.id==='emp');
  assert.equal(parsed.entry.inputs.outputQty,15000);assert.equal(parsed.entry.profile.outputRate,15000);
  assert.deepEqual(errors,[]);results.push({width,monthRacePassed:true,lateResponsePassed:true,failedLoadPassed:true,groupedRate:15000,groupedQuantity:15000,errors});await context.close();
 }
 await writeFile(out+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}finally{await browser.close();server.close();await f.client.close();}
