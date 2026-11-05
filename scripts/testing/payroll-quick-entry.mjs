/** Local browser regression against actual CRM/router + PostgreSQL WASM, never production. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setupSalesPayroll} from '../../tests/helpers/sales-payroll-fixture.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setupSalesPayroll(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url));
await f.call('/hr/members/emp/salary',f.mgr,'PUT',{effectiveMonth:'2026-09',baseSalary:5200000,capacityCoef:6});
await f.salary({baseSalary:5200000,capacityCoef:7,kpiEnabled:false,contractBonusEnabled:false});
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
  const paste=async(selector,text)=>page.waitForFunction(({selector,text})=>{
    const node=document.querySelector(selector);if(!node||node.disabled||document.getElementById('payroll-board').inert)return false;
    const transfer=new DataTransfer();transfer.setData('text/plain',text);node.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:transfer}));return true;
  },{selector,text});
  await page.goto(origin+'/#/payroll?month=2026-10');
  await page.locator('#pr-quick').waitFor();
  assert.equal(await page.locator('.pr-quick-table thead').evaluate(n=>getComputedStyle(n).display),'table-header-group');
  assert.equal(await page.locator('.pr-quick-table tbody').evaluate(n=>getComputedStyle(n).display),'table-row-group');
  assert.equal(await page.locator('.pr-sheet thead tr').count(),2);
  for(const title of ['NĂNG LỰC','KPIs','PHỤ CẤP','CÁC KHOẢN TRỪ']) assert.equal(await page.locator('.pr-sheet thead').getByRole('columnheader',{name:title,exact:true}).count(),1);
  assert.equal(await page.locator('[data-member="emp"][data-key="kpiOverride"]').getAttribute('data-scale'),'100');
  // Regression: real key events pause at the decimal separator before typing the fraction.
  const workDays=page.locator('[data-member="emp"][data-key="workDays"]');
  let saves=0;page.on('request',r=>{if(r.method()==='PUT'&&r.url().endsWith('/entries'))saves++;});
  for(const separator of ['.',',']){
    await workDays.fill('');await workDays.pressSequentially('25'+separator+'5');
    assert.equal(await workDays.inputValue(),'25'+separator+'5','continuous typing must preserve the decimal separator');
    assert.equal(await workDays.getAttribute('data-quick-pending'),null);
    await page.locator('[data-quick-save]').click();await page.waitForFunction(()=>document.querySelector('[data-quick-count]')?.textContent==='');
    assert.equal((await f.call('/hr/payroll/2026-10',f.mgr)).data.rows.find(r=>r.member.id==='emp').entry.inputs.workDays,25.5);
    await workDays.fill('');await workDays.pressSequentially('24');await workDays.pressSequentially(separator);
    assert.equal(await workDays.inputValue(),'24'+separator);
    assert.equal(await workDays.getAttribute('aria-invalid'),null,'pausing after separator must not report an error');
    assert.equal(await workDays.getAttribute('data-quick-pending'),'true');
    assert.ok(!(await page.locator('[data-quick-status]').textContent()).includes('không hợp lệ'));
    const before=saves;
    // Even a synthetic click without blur must not save the earlier integer prefix.
    await page.locator('[data-quick-save]').evaluate(n=>n.click());
    assert.equal(saves,before);
    await workDays.press('Tab');assert.equal(await workDays.getAttribute('aria-invalid'),'true','unfinished input is invalid on leaving the cell');
    await page.locator('[data-quick-save]').click();assert.equal(saves,before);
    await workDays.focus();await workDays.press('End');await workDays.pressSequentially('5');
    assert.equal(await workDays.getAttribute('aria-invalid'),null);assert.equal(await workDays.getAttribute('data-quick-pending'),null);
    assert.equal(await workDays.inputValue(),'24'+separator+'5');
    await page.locator('[data-quick-save]').click();await page.waitForFunction(()=>document.querySelector('[data-quick-count]')?.textContent==='');
    const saved=(await f.call('/hr/payroll/2026-10',f.mgr)).data.rows.find(r=>r.member.id==='emp');
    assert.equal(saved.entry.inputs.workDays,24.5);assert.equal(saved.payslip.workDays,24.5);
    assert.equal(saved.payslip.income.find(l=>l.key==='salaryByDays').amount,Math.round(saved.payslip.baseSalary*24.5/26));
  }
  await workDays.fill('24..5');const invalidSaves=saves;
  await page.locator('[data-quick-save]').click();assert.equal(saves,invalidSaves,'global native-validity styling must not let malformed values save');
  await page.locator('[data-quick-mode]').selectOption('profile');assert.equal(await page.locator('[data-quick-mode]').inputValue(),'sheet');
  await workDays.fill('24.5');
  // Template download and real XLSX import: drafts remain reviewable until Save.
  const downloaded=page.waitForEvent('download');await page.locator('[data-quick-template]').click();
  const template=await downloaded;assert.equal(template.suggestedFilename(),'Mau-bang-luong-2026-10.xlsx');
  const bytes=await page.evaluate(async()=>{
    const {buildPayrollTemplate,payrollFileColumns}=await import('/payroll-file.js');
    const token=localStorage.getItem('bn-v2-session'),d=await (await fetch('/api/staff/hr/payroll/2026-10',{headers:{Authorization:'Bearer '+token}})).json();
    const wb=await buildPayrollTemplate(d),ws=wb.getWorksheet('Nhập lương');
    if(ws.columnCount!==11||wb.getWorksheet('_KyLuong').state!=='veryHidden')throw Error('Template must have eleven visible columns and hidden bindings');
    const employeeIndex=d.rows.filter(r=>r.payslip.status==='estimate').findIndex(r=>r.member.id==='emp')+2;
    const put=(key,value)=>{ws.getCell(employeeIndex,3+payrollFileColumns().findIndex(f=>f.column[0]===key)).value=value;};
    put('workDays',24);put('lateCount',2);put('leaveHours',1.5);put('advance',500000);put('insurance',499650);put('deduction',100000);put('phone_advance',308099);put('outputQty',24);put('overtimeHours',3.5);
    return Array.from(new Uint8Array(await wb.xlsx.writeBuffer()));
  });
  await template.saveAs(out+'/Mau-bang-luong-'+width+'.xlsx');
  await page.locator('[data-quick-file]').setInputFiles({name:'luong.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(bytes)});
  await page.waitForFunction(()=>document.querySelector('[data-quick-count]')?.textContent.includes('1 người'));
  assert.equal(await page.locator('[data-member="emp"][data-key="workDays"]').inputValue(),'24');
  assert.equal(await page.locator('[data-member="emp"][data-key="insurance"]').inputValue(),'499,650');
  await page.locator('[data-quick-save]').click();await page.waitForFunction(()=>document.querySelector('[data-quick-count]')?.textContent==='');
  const imported=(await f.call('/hr/payroll/2026-10',f.mgr)).data.rows.find(r=>r.member.id==='emp');
  assert.equal(imported.entry.inputs.lateCount,2);assert.equal(imported.entry.inputs.leaveHours,1.5);assert.equal(imported.entry.inputs.outputQty,24);assert.equal(imported.entry.adjustments.deduction,100000);assert.equal(imported.entry.adjustments.phone_advance,308099);
  // Position is still editable in the CRM, outside the simplified file.
  await page.locator('[data-member="emp"][data-key="positionLabel"]').fill('THỬ VIỆC');
  await page.locator('[data-quick-save]').click();await page.waitForFunction(()=>document.querySelector('[data-quick-count]')?.textContent==='');
  const probation=(await f.call('/hr/payroll/2026-10',f.mgr)).data.rows.find(r=>r.member.id==='emp');assert.equal(probation.payslip.net,Math.round(imported.entry.profile.baseSalary*24/26));assert.equal(probation.payslip.deductionTotal,0);
  await page.locator('[data-member="emp"][data-key="positionLabel"]').fill('SALE');
  await page.locator('[data-quick-save]').click();await page.waitForFunction(()=>document.querySelector('[data-quick-count]')?.textContent==='');
  // The reference sheet supports editing different sources on one row without switching modes.
  assert.equal((await f.call('/hr/payroll/2026-10',f.mgr)).data.rows.find(r=>r.member.id==='emp').previousCapacityCoef,6);
  await paste('[data-member="emp"][data-key="baseSalary"]','5.400.000\t23');
  await page.locator('[data-member="emp"][data-key="kpiOverride"]').fill('115,72');
  await page.locator('[data-member="emp"][data-key="baseSalary"]').fill('5.400.000');
  await page.locator('[data-member="emp"][data-key="advance"]').fill('100000');
  await page.locator('[data-quick-save]').click();await page.waitForFunction(()=>document.querySelector('[data-quick-count]')?.textContent==='');
  let sheet=(await f.call('/hr/payroll/2026-10',f.mgr)).data.rows.find(r=>r.member.id==='emp');
  assert.equal(sheet.entry.inputs.workDays,23);assert.equal(sheet.entry.inputs.kpiOverride,1.1572);assert.equal(sheet.entry.profile.baseSalary,5400000);assert.equal(sheet.entry.adjustments.advance,100000);
  await page.screenshot({path:out+'/sheet-'+width+'.png',fullPage:true});
  await page.locator('[data-quick-mode]').selectOption('inputs');
  const days=page.locator('[data-member="emp"][data-key="workDays"]');
  await paste('[data-member="emp"][data-key="workDays"]',width===1440?'24,5\t1,5\n26\t0':'25\t2\n26\t0');
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
  await paste('[data-member="emp"][data-key="outputQty"]','15.000\n');
  await page.locator('[data-quick-mode]').selectOption('profile');
  await paste('[data-member="emp"][data-key="outputRate"]','15.000\n');
  await page.locator('[data-quick-save]').click();await page.waitForFunction(()=>document.querySelector('[data-quick-count]')?.textContent==='');
  const parsed=(await f.call('/hr/payroll/2026-10',f.mgr)).data.rows.find(r=>r.member.id==='emp');
  assert.equal(parsed.entry.inputs.outputQty,15000);assert.equal(parsed.entry.profile.outputRate,15000);
  assert.deepEqual(errors,[]);results.push({width,monthRacePassed:true,lateResponsePassed:true,failedLoadPassed:true,groupedRate:15000,groupedQuantity:15000,errors});await context.close();
 }
 await writeFile(out+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}finally{await browser.close();server.close();await f.client.close();}
