/** Real XLSX download/import through the local CRM, using synthetic payroll data only. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setupSalesPayroll} from '../../tests/helpers/sales-payroll-fixture.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setupSalesPayroll(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),writes=[];
await f.salary({baseSalary:5200000,kpiEnabled:false,contractBonusEnabled:false});
let board=(await f.call('/hr/payroll/2026-10',f.mgr)).data;
const locked=board.rows.find(r=>r.member.id!=='emp').member.id;
assert.equal((await f.call(`/hr/members/${locked}/salary`,f.mgr,'PUT',{effectiveMonth:'2026-10',payrollGroup:'sale',baseSalary:5200000,kpiEnabled:false,contractBonusEnabled:false})).status,200);
const profile=(await f.call(`/members/${locked}/overview?month=2026-10`,f.mgr)).data;
assert.equal((await f.call(`/hr/members/${locked}/payslips/2026-10`,f.mgr,'POST',{confirmationHash:profile.payroll.confirmationHash})).status,201);
board=(await f.call('/hr/payroll/2026-10',f.mgr)).data;
assert.notEqual(board.rows.find(r=>r.member.id===locked).payslip.status,'estimate');
const server=createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname.startsWith('/api/staff/')){
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const token=req.headers.authorization?.replace(/^Bearer /,'');
  if(req.method!=='GET')writes.push({method:req.method,path:u.pathname});
  const r=await f.call(u.pathname.slice('/api/staff'.length)+u.search,token?'__Host-bn-session='+token:'',req.method,chunks.length?JSON.parse(Buffer.concat(chunks)):undefined);
  res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;
 }
 const path=u.pathname==='/'?'/index.html':u.pathname;let bytes=await readFile(root+path);
 if(path.endsWith('.html'))bytes=Buffer.from(bytes.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html;charset=utf-8');res.end(bytes);
}catch{res.writeHead(500).end('Local QA error');}}).listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,out='/tmp/payroll-template-qa';await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:1000},locale:'vi-VN'});
  await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
  const user=(await f.call('/me',f.mgr)).data.user;
  await context.addInitScript(({user,token})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user,token:f.mgr.split('=')[1]});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/#/payroll?month=2026-10');await page.locator('#pr-quick').waitFor();
  const selected=board.rows.find(r=>r.member.id==='emp');
  await page.locator('[data-quick-search]').fill(selected.member.name);
  await page.locator('[data-quick-group]').selectOption(selected.profile.payrollGroup);
  assert.equal(await page.locator('[data-quick-row]:not([hidden])').count(),1);
  const pending=page.waitForEvent('download');await page.locator('[data-quick-template]').click();const download=await pending;
  assert.equal(download.suggestedFilename(),'Mau-bang-luong-2026-10.xlsx');const file=out+'/template-'+width+'.xlsx';await download.saveAs(file);
  const bytes=Array.from(await readFile(file));
  const result=await page.evaluate(async bytes=>{
   const wb=new ExcelJS.Workbook();await wb.xlsx.load(new Uint8Array(bytes));const ws=wb.getWorksheet('Nhập lương'),meta=wb.getWorksheet('_KyLuong');
   return {names:Array.from({length:ws.rowCount-1},(_,i)=>ws.getCell(i+2,2).value),ids:Array.from({length:meta.rowCount-1},(_,i)=>meta.getCell(i+2,2).value),columns:ws.columnCount};
  },bytes);
  assert.deepEqual(result.names,board.rows.map(r=>r.member.name));assert.deepEqual(result.ids,board.rows.map(r=>r.member.id));assert.equal(result.columns,11);
  const exportPending=page.waitForEvent('download');await page.locator('#pr-quick [data-act="excel"]').click();const exported=await exportPending;
  assert.equal(exported.suggestedFilename(),'Bang-luong-T10-2026.xlsx');
  const reportFile=out+'/payroll-'+width+'.xlsx';await exported.saveAs(reportFile);
  const report=await page.evaluate(async bytes=>{
   const wb=new ExcelJS.Workbook();await wb.xlsx.load(new Uint8Array(bytes));
   return wb.worksheets.map(ws=>({name:ws.name,rows:ws.getSheetValues()}));
  },Array.from(await readFile(reportFile)));
  assert.equal(report.length,1);assert.equal(report[0].name,'Bảng lương');
  for(const row of board.rows){
   assert.ok(report.some(ws=>ws.rows.some(cells=>cells?.[2]===row.member.name&&cells.includes(row.payslip.net))),'export includes salary and net amount for '+row.member.id);
  }
  const topPending=page.waitForEvent('download');await page.locator('[data-act="excel"]').first().click();const topExport=await topPending;
  const topFile=out+'/payroll-top-'+width+'.xlsx';await topExport.saveAs(topFile);
  const topSheets=await page.evaluate(async bytes=>{const wb=new ExcelJS.Workbook();await wb.xlsx.load(new Uint8Array(bytes));return wb.worksheets.map(ws=>ws.name);},Array.from(await readFile(topFile)));
  assert.deepEqual(topSheets,['Bảng lương'],'both export buttons use the same single-sheet layout');
  const before=writes.length;await page.locator('[data-quick-file]').setInputFiles(file);
  await page.waitForFunction(()=>document.body.textContent.includes('Đã nhập 0 nhân viên'));
  assert.equal(writes.length,before,'downloading and importing a blank template never saves salary');assert.deepEqual(errors,[]);
  const days=page.locator('.pr-quick-value[data-member="emp"][data-key="workDays"]');await days.fill('20');await days.press('Tab');
  let unexpectedDownload=false;page.on('download',()=>{unexpectedDownload=true;});
  await page.locator('#pr-quick [data-act="excel"]').click();
  await page.waitForFunction(()=>document.body.textContent.includes('Lưu thay đổi ở tab Nhập nhanh'));
  assert.equal(unexpectedDownload,false,'unsaved drafts block report export');assert.equal(writes.length,before);
  await context.close();console.log('PASS '+width+': filtered screen exports full month roster including locked employee, blank XLSX imports without salary writes');
 }
}finally{await browser.close();server.close();await f.client.close();}
