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
const routes=[['quotes','#/quotes'],['quote-new','#/quotes/new'],['contracts','#/contracts'],['contract-detail','#/contracts/'+contract.orderId],['tasks','#/tasks'],['orders','#/orders'],['order-detail','#/orders/'+order.id],['customers','#/customers'],['customer-detail','#/customers/'+customerId],['care','#/care'],['pos','#/pos'],['deliveries','#/deliveries'],['packing','#/packing'],['receivables','#/receivables'],['cash','#/cash'],['cashbook','#/cashbook'],['purchases','#/purchases'],['receiving','#/receiving'],['suppliers','#/suppliers'],['incoming','#/purchases?mode=incoming'],['kho','#/kho'],['stock-moves','#/stock-moves'],['inventory','#/inventory'],['transfers','#/transfers'],['products','#/products'],['staff','#/members'],['payroll','#/payroll'],['permissions','#/permissions'],['flow','#/flow'],['dashboard','#/dashboard']];
const report=[];
try{for(const width of (process.env.AUDIT_WIDTHS||'390,1280').split(',').map(Number)){
 const context=await browser.newContext({viewport:{width,height:844},locale:'vi-VN'});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 await context.addInitScript(({token,user})=>{document.addEventListener('click',e=>{if(e.target.closest?.('a[href^="tel:"]'))e.preventDefault();});localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{token,user});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/index.html#/tasks');await page.locator('#workspace').waitFor({state:'visible'});
 for(const [name,hash] of routes){
  await page.evaluate(h=>location.hash=h,hash);await page.waitForTimeout(650);await page.waitForLoadState('networkidle');
  await page.screenshot({path:screenshotDir+'/'+name+'-'+width+'.png'});
  const facts=await page.evaluate(()=>{
   const shown=n=>!!n.getClientRects().length&&!n.closest('[hidden]');const view=[...document.querySelectorAll('main>.view')].find(shown);
   return {hash:location.hash,view:view?.id,overflow:document.documentElement.scrollWidth>innerWidth+1,nav:[...document.querySelectorAll('.crm-mobile-nav a,.crm-mobile-nav button')].filter(shown).map(n=>n.textContent.trim()),homeRows:[...document.querySelectorAll('.crm-home-row')].filter(shown).length,taskSelect:!!document.querySelector('[data-mobile-task-modes]'),orderParent:document.querySelector('#view-order')?.parentElement.className,menus:[...document.querySelectorAll('.mobile-action-list')].filter(n=>view?.contains(n)).map(n=>[...n.querySelectorAll('button,a')].map(b=>b.textContent.trim()))};
  });report.push({name,width,...facts});console.log(JSON.stringify({name,width,overflow:facts.overflow}));
 }
 // Record actual click paths to the first daily action; typing is not counted as a tap.
 const taps=[];let extraTaps=0;async function task(name,route,steps){await page.goto(origin+'/index.html'+route);await page.waitForTimeout(650);let count=0;extraTaps=0;try{for(const step of steps){await step();count++;}taps.push({name,taps:count+extraTaps});}catch(e){taps.push({name,taps:count,blocked:String(e.message).split('\n')[0]});}await page.keyboard.press('Escape');}
 async function click(selector){const n=page.locator(selector).first();if(!await n.isVisible()){const menu=n.locator('xpath=ancestor::*[@popover][1]');if(await menu.count()){const id=await menu.getAttribute('id');await page.locator('[aria-controls="'+id+'"]').click();extraTaps++;}}await n.click({timeout:2000});}
 await task('create_quote','#/quotes',[()=>click('[data-new-quote]')]);
 await task('edit_line_qty','#/quotes/'+q.id,[()=>click('#line-list tr:first-child .col-qty input')]);
 await task('send_for_approval','#/quotes/'+draftQuote.id,[()=>click('#submit-quote')]);
 await task('contract_and_docs','#/contracts',[()=>click('#contracts-list a'),()=>click('[data-contract-docs]')]);
 await task('complete_task','#/tasks',[()=>click('.task-row [data-toggle]')]);
 await task('filter_results','#/orders',[()=>click('#view-orders .crm-filter-trigger'),()=>click('#view-orders .crm-filter-foot .primary')]);
 await task('call_customer','#/customers',[()=>click('#customer-list a[href^="tel:"]')]);
 await task('add_care','#/care',[()=>click('#view-care [data-care-new]')]);
 await task('export_excel','#/products',[()=>click('#product-export')]);
 await task('close_document','#/contracts/'+contract.orderId,[()=>click(width<=850?'#order-back':'[aria-label="Đóng chi tiết HĐKT"]')]);
 report.push({width,taps,errors});await context.close();
 }}finally{await writeFile(screenshotDir+'/audit.json',JSON.stringify(report,null,2));await browser.close();server.close();await f.client.close();}
