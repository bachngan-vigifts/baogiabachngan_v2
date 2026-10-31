/** Real local CRM/router/PGlite: discover salary settings and configure Sale Admin rewards, never production. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {eq} from 'drizzle-orm';
import {salesOrders,salesOrderLines} from '../../src/modules/sales/schema.ts';
import {quotations} from '../../src/modules/quotes/schema.ts';
import {setupSalesPayroll} from '../../tests/helpers/sales-payroll-fixture.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setupSalesPayroll(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url));
const server=createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/staff/')){
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined,token=req.headers.authorization?.replace(/^Bearer /,''),r=await f.call(u.pathname.slice('/api/staff'.length)+u.search,token?'__Host-bn-session='+token:'',req.method,body);res.writeHead(r.status,{'content-type':'application/json','server-timing':'local;dur=1'}).end(JSON.stringify(r.data));return;
 }
 const path=u.pathname==='/'?'/index.html':u.pathname;let data=await readFile(root+path);if(path.endsWith('.html'))data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':'text/html;charset=utf-8');res.end(data);
}catch(e){res.writeHead(500).end(String(e.message));}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),out='/workspace/scratch/staff-employment',results=[];await mkdir(out,{recursive:true});



async function pageFor(width,cookie){
 const context=await browser.newContext({viewport:{width,height:1050},locale:'vi-VN'});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());const user=(await f.call('/me',cookie)).data.user;
 await context.addInitScript(({user,token})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user,token:cookie.split('=')[1]});
 const page=await context.newPage(),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));return{context,page,errors};
}

try{
 await f.salary({kpiEnabled:false,contractBonusEnabled:false});
 const dep=(await f.call('/admin/members',f.mgr)).data.departments[0];
 for(const width of [1280,390]){
  console.log('viewport',width);
  await f.call('/admin/members/emp/employment',f.mgr,'PUT',{workCompany:null,workDepartmentId:null,isLeader:false});
  const {context,page,errors}=await pageFor(width,f.mgr);
  await page.goto(origin+'/#/staff');const row=page.locator('#member-list tr').filter({has:page.locator('[data-employment="emp"]')});await row.waitFor();console.log('staff loaded');
  await row.locator('[data-employment]').click();const dialog=page.locator('#member-employment-dialog');
  await dialog.locator('[name="workCompany"]').selectOption('VG');await dialog.locator('[name="workDepartmentId"]').selectOption(dep.id);await dialog.locator('[name="isLeader"]').check();
  await dialog.screenshot({path:out+'/form-'+width+'.png'});await dialog.getByRole('button',{name:'Lưu thông tin',exact:true}).click();await dialog.waitFor({state:'hidden'});console.log('saved');
  await row.getByText('Leader',{exact:true}).waitFor();assert.match(await row.innerText(),/VIGIFTS/);
  const member=(await f.call('/admin/members',f.mgr)).data.members.find(m=>m.id==='emp');assert.equal(member.workCompany,'VG');assert.equal(member.isLeader,true);assert.equal(member.approver,false);
  await page.goto(origin+'/#/members/emp?month=2026-10&tab=payroll');await page.locator('[data-act="print-slip"]').waitFor({state:'attached'});
  await page.evaluate(()=>window.print=()=>{});const printButton=page.locator('[data-act="print-slip"]');if(!await printButton.isVisible())await printButton.locator('..').locator('.mobile-action-trigger').click();await printButton.click();
  await page.waitForFunction(()=>document.querySelector('#print-sheet').innerText.includes('QUẢNG CÁO VIGIFTS'));
  assert.match(await page.locator('#print-sheet').innerText(),/Leader/);
  await page.goto(origin+'/#/payroll?month=2026-10');const excelButton=page.locator('[data-act="excel"]');await excelButton.waitFor({state:'attached'});if(!await excelButton.isVisible())await excelButton.locator('..').locator('.mobile-action-trigger').click();const download=page.waitForEvent('download',{timeout:45000});await excelButton.click();const file=await download;const path=out+'/payroll-'+width+'.xlsx';await file.saveAs(path);console.log('excel downloaded');
  const excel=JSON.parse(execFileSync('python3',['-c',"import zipfile,sys,json; z=zipfile.ZipFile(sys.argv[1]); w=z.read('xl/workbook.xml').decode(); t=z.read('xl/sharedStrings.xml').decode(); print(json.dumps({'vgSheet':'VG · Sale' in w,'vgIssuer':'QUẢNG CÁO VIGIFTS' in t}))",path],{encoding:'utf8'}));assert.ok(excel.vgSheet&&excel.vgIssuer);console.log('excel verified');
  assert.deepEqual(errors,[]);results.push({width,saved:true,leaderDoesNotGrantApproval:true,printedVigifts:true,excelIssuerVerified:true,errors});await context.close();
 }
 console.log(JSON.stringify(results));
}finally{await writeFile(out+'/results.json',JSON.stringify(results,null,2));await browser.close();server.close();await f.client.close();}
