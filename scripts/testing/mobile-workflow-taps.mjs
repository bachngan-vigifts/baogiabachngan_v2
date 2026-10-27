/** Real local CRM router + fresh PGlite database; no production requests or carrier actions. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setup} from '../../tests/helpers/pos-fixture.ts';
import {customers} from '../../src/modules/customers/schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=process.env.UI_SOURCE||fileURLToPath(new URL('../../trial-ui/',import.meta.url));
const f=await setup(),ok=(r,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};
const customerId='design-customer';
await f.db.insert(customers).values({id:customerId,name:'CÔNG TY PHƯỚC ĐỨC',contact:'Anh Minh',phone:'0903123218',email:'minh@example.invalid',address:'12 Nguyễn Huệ, Cần Thơ',taxCode:'0101234567',customerCode:'BN-CUZN04196',search:'phuoc duc anh minh',sourceVersion:0,syncedAt:''});
async function quote(no){return ok(await f.call('/quotes',f.mgr,'POST',{type:'HRC',quoteNo:no,date:'2026-10-25',customer:'CÔNG TY PHƯỚC ĐỨC',customerId,contact:'Anh Minh',phone:'0903123218',vat:8,rows:[{sku:'00123',name:'Bộ trà Hoàng Cung 0.65L',unit:'Bộ',qty:2,price:185000,taxRate:8},{sku:'LY-X',name:'Khăn lụa Hoàng Cung',unit:'Cái',qty:1,price:85000,taxRate:8}]}),201);}
const draftQuote=await quote('HRC_BG_DRAFT_25102026');
const q=await quote('HRC_BG_001_25102026');ok(await f.call('/quotes/'+q.id+'/approve',f.mgr,'POST',{revision:1}));
const contract=ok(await f.call('/contracts',f.mgr,'POST',{quoteId:q.id,legalEntity:'BN',depositRate:30}),201);
const oq=await quote('HRC_BG_002_25102026');ok(await f.call('/quotes/'+oq.id+'/approve',f.mgr,'POST',{revision:1}));
const order=ok(await f.call('/orders',f.mgr,'POST',{quoteId:oq.id}),201);
for(const id of [contract.orderId,order.id])ok(await f.call('/orders/'+id+'/status',f.mgr,'PUT',{status:'confirmed',verified:true,costWarningsReviewed:true}));
ok(await f.call('/tasks',f.mgr,'POST',{title:'Gọi xác nhận đơn cho Anh Minh',assigneeId:'mgr',dueDate:'2026-10-25'}),201);
const cfg=ok(await f.call('/care/config',f.mgr));
ok(await f.call('/care',f.mgr,'POST',{customerId,contactName:'Anh Minh',remindBefore:'1d',type:cfg.types[0].key,content:'Gửi lại báo giá bộ trà, hẹn khách xác nhận',result:cfg.results[0].key,nextAt:new Date(Date.now()+864e5).toISOString().slice(0,10)}),201);
const user=ok(await f.call('/me',f.mgr)).user,token=f.mgr.split('=')[1];
const writes=[],reads=[];let failOrders=0;
const server=createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost'),path=u.pathname;
 if(path.startsWith('/api/staff/')){
  const route=u.pathname.slice('/api/staff'.length)+u.search;reads.push(route);
  if(failOrders&&route.startsWith('/orders?')){failOrders--;res.writeHead(503,{'content-type':'application/json'}).end(JSON.stringify({error:'Kết nối thử nghiệm bị gián đoạn'}));return;}
  let body;const chunks=[];for await(const chunk of req)chunks.push(chunk);if(chunks.length)body=JSON.parse(Buffer.concat(chunks).toString());
  if(req.method!=='GET')writes.push({path:route,method:req.method,body});
  const auth=req.headers.authorization?.replace(/^Bearer /,'')||'',r=await f.call(route,auth?'__Host-bn-session='+auth:'',req.method,body);
  const data={...r.data};if(r.cookie)data.sessionToken=r.cookie.split('=')[1];if(route==='/logout')data.sessionToken='';
  res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(data));return;
 }
 res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':'text/html;charset=utf-8');
 let data=await readFile(root+(path==='/'?'index.html':path));
 if(path==='/'||path==='/index.html')data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.end(data);
}catch(e){res.writeHead(500).end(String(e.message));}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const screenshotDir=process.env.MOBILE_SCREENSHOT_DIR||'/workspace/scratch/mobile-workflow/'+(process.env.AUDIT_PHASE||'before');await mkdir(screenshotDir,{recursive:true});
async function settle(page){await page.waitForTimeout(180);}
async function shot(page,name,width){await page.screenshot({path:screenshotDir+'/'+name+'-'+width+'.png',fullPage:false});}
async function goto(page,hash){await page.evaluate(h=>location.hash=h,hash);await settle(page);}
const nv=(await f.call('/me',f.emp)).data.user;
const seed=ok(await f.call('/quotes',f.emp,'POST',{type:'HRC',quoteNo:'HRC_NV_TAPS',date:'2026-10-26',customer:'Khách NV',owner:'Nhân viên kiểm thử',vat:8,rows:[{sku:'00123',name:'Ly sứ',unit:'Cái',qty:1,price:100000}]}),201);
let context=await browser.newContext({viewport:{width:390,height:844},locale:'vi-VN'});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
await context.addInitScript(({token,user})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));document.addEventListener('click',e=>{if(e.target.closest?.('a[href^="tel:"]'))e.preventDefault();});},{token:f.emp.split('=')[1],user:nv});
let page=await context.newPage();page.on('dialog',d=>d.accept());let workflow=0,data=0;const trace=[];
async function click(selector,kind='workflow'){
 const n=page.locator(selector).first();await n.waitFor({state:'attached'});
 if(!await n.isVisible()){
  const list=n.locator('xpath=ancestor::*[@popover][1]');if(await list.count()){
   const id=await list.getAttribute('id');await page.locator('[aria-controls="'+id+'"]').click();trace.push({kind,action:'open actions'});if(kind==='workflow')workflow++;else data++;
  }else{const trigger=n.locator('xpath=..').locator(':scope > .mobile-action-trigger');if(await trigger.count()){await trigger.click();trace.push({kind,action:'open actions'});if(kind==='workflow')workflow++;else data++;}}
 }
 await n.click();trace.push({kind,action:selector});if(kind==='workflow')workflow++;else data++;
}
async function arrive(hash){await page.goto(origin+'/index.html?audit='+Date.now()+hash);await page.locator('#workspace').waitFor({state:'visible'});await page.waitForTimeout(450);}
const results=[];
try{
 await arrive('#/quotes/'+seed.id);await page.locator('#line-list tr').first().waitFor();
 const hasCombined=await page.locator('#save-quote-m').textContent();
 if(hasCombined.includes('gửi duyệt'))await click('#save-quote-m');else await click('#submit-quote');
 await page.waitForFunction(()=>document.querySelector('#submit-quote').textContent==='Đã gửi duyệt');assert.equal((await f.call('/quotes/'+seed.id,f.emp)).data.approvalStatus,'pending');
 results.push({task:'send_approval_from_editor',workflow,data,trace:[...trace]});workflow=data=0;trace.length=0;
 await arrive('#/quotes');await click('[data-new-quote]');await page.waitForTimeout(250);
 if(await page.locator('#new-quote-dialog').isVisible())await click('#nq-create');
 await page.locator('#quote-form').waitFor({state:'visible'});await page.locator('#quote-form [name=customer]').fill('Khách tạo mới bằng mobile');
 await click('#add-line','data');const row=page.locator('#line-list tr[data-i]').first();await row.locator('[data-k=name]').fill('Túi giấy');await row.locator('[data-k=qty]').fill('2');await row.locator('[data-k=price]').fill('10000');
 await click('#save-quote-m');await page.waitForFunction(()=>/^#\/quotes\/(?!new)/.test(location.hash));
 if(!hasCombined.includes('gửi duyệt'))await click('#submit-quote');
 await page.waitForFunction(()=>document.querySelector('#submit-quote').textContent==='Đã gửi duyệt');
 const id=await page.evaluate(()=>location.hash.slice('#/quotes/'.length));assert.equal((await f.call('/quotes/'+id,f.emp)).data.approvalStatus,'pending');
 results.push({task:'create_quote_and_send',workflow,data,trace:[...trace]});
 await context.close();context=await browser.newContext({viewport:{width:390,height:844},locale:'vi-VN'});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 await context.addInitScript(({token,user})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));document.addEventListener('click',e=>{if(e.target.closest?.('a[href^="tel:"]'))e.preventDefault();});},{token,user});page=await context.newPage();page.on('dialog',d=>d.accept());
 function reset(){workflow=data=0;trace.length=0;}function record(task,verification){results.push({task,workflow,data,trace:[...trace],verification});}
 reset();await arrive('#/quotes/'+q.id);await click('#line-list tr:first-child .col-qty input');await page.locator('#line-list tr:first-child .col-qty input').fill('3');record('edit_line_qty','field edited; saving is separate');
 reset();await arrive('#/contracts');await click('#contracts-list [data-contract-docs-for]');await page.locator('dialog[open] [data-zip]').waitFor();const zip=page.waitForEvent('download',{timeout:12000});await click('dialog[open] [data-zip]');const zipFile=await zip;assert.ok(zipFile.suggestedFilename().endsWith('.zip'));record('contract_and_download','zip download emitted');await page.locator('dialog[open] [data-x]').first().click();
 reset();const measured=ok(await f.call('/tasks',f.mgr,'POST',{title:'Việc đo số chạm',assigneeId:'mgr'}),201);await arrive('#/tasks');await click('.task-row:has-text("Việc đo số chạm") [data-toggle]');await page.waitForTimeout(350);assert.equal((await f.call('/tasks/'+(measured.task?.id||measured.id),f.mgr)).data.task.status,'done');record('complete_task','backend status done');
 reset();await arrive('#/orders');await click('#view-orders .crm-filter-trigger');await page.locator('#orders-source').selectOption('pos');await click('#view-orders .crm-filter-foot .primary');record('filter_results','apply clicked after source selection (data entry excluded)');
 reset();await arrive('#/customers');await click('#customer-list a[href^="tel:"]');record('call_customer','tel link clicked; external phone app excluded');
 reset();await arrive('#/care');await click('#view-care [data-care-new]');const care=page.locator('dialog.care-dialog[open]');await care.locator('[name=customerQ]').fill('PHƯỚC');await care.locator('[data-suggest] button').first().waitFor();await click('dialog.care-dialog [data-suggest] button','data');await care.locator('[name=contactName]').fill('Anh Minh');await care.locator('[name=content]').fill('Đo thao tác ghi chăm sóc mobile');await click('dialog.care-dialog [data-save]');await care.waitFor({state:'hidden'});record('add_care','saved and dialog closed; input/selection excluded');
 reset();await arrive('#/products');await click('#product-export');const excel=page.waitForEvent('download',{timeout:12000});await click('dialog[open] [data-export]');const excelFile=await excel;assert.ok(excelFile.suggestedFilename().endsWith('.xlsx'));record('export_excel','xlsx download emitted');
 reset();await arrive('#/contracts/'+contract.orderId);await click(hasCombined.includes('gửi duyệt')?'#order-back':'[aria-label="Đóng chi tiết HĐKT"]');await page.waitForFunction(()=>location.hash==='#/contracts');record('close_document','returned to contracts list');
 console.log(JSON.stringify(results));await writeFile(screenshotDir+'/taps-'+(process.env.AUDIT_PHASE||'after')+'.json',JSON.stringify(results,null,2));
}catch(e){console.error('Failed at',page.url(),await page.locator('main>.view:not([hidden])').evaluateAll(ns=>ns.map(n=>[n.id,n.textContent.slice(0,250)])));throw e;}finally{await context.close();await browser.close();server.close();await f.client.close();}
