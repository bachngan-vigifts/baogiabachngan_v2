/** Real local CRM router + fresh PGlite database; no production requests or carrier actions. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setup} from '../../tests/helpers/pos-fixture.ts';
import {customers} from '../../src/modules/customers/schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url));
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
const writes=[],reads=[];let failOrders=0,failQuoteSave=0;
const server=createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost'),path=u.pathname;
 if(path.startsWith('/api/staff/')){
  const route=u.pathname.slice('/api/staff'.length)+u.search;reads.push(route);
  if(failQuoteSave&&req.method==='PUT'&&/^\/quotes\/[^/?]+$/.test(route)){failQuoteSave--;for await(const chunk of req){}res.writeHead(503,{'content-type':'application/json'}).end(JSON.stringify({error:'Lưu thử nghiệm thất bại'}));return;}
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
const screenshotDir=process.env.MOBILE_SCREENSHOT_DIR||'/workspace/scratch/mobile-workflow/regression';await mkdir(screenshotDir,{recursive:true});
async function settle(page){await page.waitForTimeout(180);}
async function shot(page,name,width){await page.screenshot({path:screenshotDir+'/'+name+'-'+width+'.png',fullPage:false});}
async function goto(page,hash){await page.evaluate(h=>location.hash=h,hash);await settle(page);}
const employee=(await f.call('/me',f.emp)).data.user;
const made=ok(await f.call('/quotes',f.emp,'POST',{type:'HRC',quoteNo:'HRC_NV_MOBILE',date:'2026-10-26',customer:'Khách NV mobile',vat:8,rows:[{sku:'00123',name:'Ly sứ',unit:'Cái',qty:1,price:100000}]}),201);
const results=[];
async function arrive(page,hash){await page.goto(origin+'/index.html'+hash);await page.locator('#workspace').waitFor({state:'visible'});await page.waitForTimeout(450);}
try{for(const width of (process.env.REGRESSION_WIDTHS||'360,390,430,768,1280').split(',').map(Number)){
 const context=await browser.newContext({viewport:{width,height:844},locale:'vi-VN'});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 await context.addInitScript(({token,user})=>{if(!localStorage.getItem('bn-v2-session')){localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));}},{token,user});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await arrive(page,'#/orders');await page.locator('#orders-list tr.clickable').first().waitFor();
 if(width<=850){
  assert.equal(await page.locator('.crm-mobile-nav > *').count(),5);assert.deepEqual(await page.locator('.crm-mobile-nav > *').allTextContents(),['Công việc','Báo giá','Đơn hàng','Khách hàng','Thêm']);
  assert.equal(await page.locator('.crm-home-row').count(),0);await page.getByRole('button',{name:'Thêm',exact:true}).click();await page.locator('.crm-more-sheet[open]').waitFor();assert.ok(await page.locator('.crm-more-grid a').count()>5);await page.getByRole('button',{name:'Đóng Thêm',exact:true}).click();
  const before=reads.filter(p=>p.startsWith('/orders?')).length;
  await page.getByRole('button',{name:'Lọc đơn hàng',exact:true}).click();await page.locator('#orders-source').selectOption('pos');await page.waitForTimeout(250);
  assert.equal(reads.filter(p=>p.startsWith('/orders?')).length,before,'changing a filter must not query before Apply');
  await page.getByRole('button',{name:'Xóa lọc',exact:true}).click();assert.equal(reads.filter(p=>p.startsWith('/orders?')).length,before);
  await page.locator('#orders-source').selectOption('pos');await page.getByRole('button',{name:'Đóng bộ lọc',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#orders-source').value==='');
  await page.getByRole('button',{name:'Lọc đơn hàng',exact:true}).click();await page.locator('#orders-source').selectOption('pos');await page.locator('#view-orders .crm-filter-foot .primary').click();
  await page.waitForFunction(()=>document.querySelector('#orders-source').value==='pos');await page.waitForTimeout(300);assert.ok(reads.slice(before).some(p=>p.includes('source=pos')));
  // Real controls retain focus through observer scans and external refresh-like DOM changes.
  await page.getByRole('button',{name:'Lọc đơn hàng',exact:true}).click();await page.locator('#orders-from').focus();
  const parent=await page.locator('#orders-from').evaluate(n=>{n.dataset.focusParent=n.parentElement.tagName;return n.parentElement.tagName;});
  for(let i=0;i<5;i++){await page.evaluate(()=>{const n=document.createElement('span');n.textContent='refresh marker';document.querySelector('.crm-filter-fields').append(n);n.remove();});await page.waitForTimeout(30);}
  assert.equal(await page.locator('#orders-from').evaluate(n=>document.activeElement===n),true);assert.equal(await page.locator('#orders-from').evaluate(n=>n.parentElement.tagName),parent);await page.keyboard.press('Escape');
 }
 await arrive(page,'#/contracts/'+contract.orderId);await page.locator('#order-title').waitFor();await page.waitForTimeout(350);
 assert.equal(await page.locator('#view-order').count(),1);
 assert.equal(await page.locator('#view-order').evaluate(n=>n.parentElement.tagName),'MAIN');assert.equal(await page.locator('.crm-document-sheet').count(),0);assert.equal(await page.locator('#order-actions [data-contract-docs]').isVisible(),true);
 for(let i=0;i<5;i++){await page.evaluate(()=>dispatchEvent(new HashChangeEvent('hashchange')));await page.waitForTimeout(180);}
 assert.equal(await page.locator('#view-order').count(),1);assert.equal(await page.locator('#order-actions').count(),1);assert.equal(await page.locator('#order-actions [data-contract-docs]').count(),1);
 await arrive(page,'#/quotes/'+q.id);await page.locator('#line-list tr').first().waitFor();
 if(width<=850){assert.equal(await page.locator('#line-list tr').first().locator('.col-after').isVisible(),true);assert.equal(await page.locator('#save-quote-m').isVisible(),true);}
 await page.locator('#line-list tr').first().locator('.col-qty input').fill('3');await page.evaluate(()=>location.hash='#/tasks');await page.getByRole('button',{name:'Rời trang',exact:true}).click();await page.waitForFunction(()=>location.hash==='#/tasks');
 if(width<=850){await page.locator('#tasks-view [data-v=approvals]').waitFor();assert.equal(await page.locator('[data-mobile-task-modes]').count(),0);const tabs=await page.locator('#tasks-view button').evaluateAll(ns=>ns.filter(n=>n.getClientRects().length).map(n=>n.dataset.v));assert.deepEqual(tabs,['mine','created','approvals']);}
 await page.evaluate(()=>location.hash='#/customers');await page.locator('#customer-list tr').first().waitFor();await page.goBack();await page.waitForFunction(()=>location.hash==='#/tasks');await page.goForward();await page.waitForFunction(()=>location.hash==='#/customers');
 if(width<=850){
  await arrive(page,'#/care');await page.locator('#view-care [data-care-new]').click();const care=page.locator('dialog.care-dialog[open]');await care.waitFor();const search=care.locator('[name=customerQ]');await search.fill('PHƯỚC');await page.waitForTimeout(400);assert.equal(await search.evaluate(n=>document.activeElement===n),true);assert.equal(await search.inputValue(),'PHƯỚC');await care.getByRole('button',{name:'Đóng',exact:true}).click();
 }
 await arrive(page,'#/pos');await page.waitForTimeout(350);assert.equal(await page.locator('#view-pos .mobile-action-list,.pos-modal .mobile-action-list').count(),0);
 await arrive(page,'#/products');if(width<=850)assert.equal(await page.locator('#product-actions').isVisible(),false,'catalog mutators are desktop-only');
 await arrive(page,'#/inventory');if(width<=850)assert.equal(await page.getByRole('button',{name:'Phiếu điều chỉnh',exact:true}).isVisible(),false);
 if(width===390){
  await page.evaluate(({token,user})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{token:f.emp.split('=')[1],user:employee});
  await arrive(page,'#/quotes/'+made.id);await page.locator('#line-list tr').first().waitFor();failQuoteSave=1;await page.locator('#save-quote-m').click();await page.waitForFunction(()=>document.querySelector('#quote-error').textContent.includes('Lưu thử nghiệm thất bại'));assert.equal((await f.call('/quotes/'+made.id,f.emp)).data.approvalStatus,'draft','failed save must never submit for approval');await page.locator('#save-quote-m').click();
  await page.waitForFunction(()=>document.querySelector('#editor-approval').textContent.includes('Chờ')||document.querySelector('#submit-quote').textContent==='Đã gửi duyệt');
  assert.equal((await f.call('/quotes/'+made.id,f.emp)).data.approvalStatus,'pending');
 }
 assert.deepEqual(errors,[]);results.push({width,filtersDeferred:width<=850,focusStable:width<=850,contractRefresh5:true,history:true,posExcluded:true,errors});console.log(JSON.stringify(results.at(-1)));await context.close();
 }}finally{await writeFile(screenshotDir+'/results.json',JSON.stringify(results,null,2));await browser.close();server.close();await f.client.close();}
