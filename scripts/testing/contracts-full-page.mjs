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
const screenshotDir='/workspace/scratch/contracts-full-page';await mkdir(screenshotDir,{recursive:true});const results=[];
try{for(const width of [360,390,430,768,1280]){
 const context=await browser.newContext({viewport:{width,height:844},locale:'vi-VN'});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 await context.addInitScript(({token,user})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{token,user});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/#/contracts');await page.locator('#contracts-list a').first().waitFor();await page.locator('#contracts-list a[href="#/contracts/'+contract.orderId+'"]').click();await page.locator('#order-title').filter({hasText:contract.contractNo}).waitFor();await page.waitForTimeout(350);
 assert.equal(await page.locator('#view-order').evaluate(n=>n.parentElement.tagName),'MAIN');assert.equal(await page.locator('.crm-document-sheet,.crm-document-section').count(),0);assert.equal(await page.locator('#view-contracts').isVisible(),false);assert.equal(await page.locator('#order-actions [data-contract-docs]').isVisible(),true);
 for(let i=0;i<5;i++){await page.evaluate(()=>dispatchEvent(new HashChangeEvent('hashchange')));await page.waitForTimeout(200);}assert.equal(await page.locator('#view-order').count(),1);assert.equal(await page.locator('#order-actions [data-contract-docs]').count(),1);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await page.screenshot({path:screenshotDir+'/contract-'+width+'.png'});
 await page.locator('#order-back').click();await page.waitForFunction(()=>location.hash==='#/contracts');await page.goBack();await page.waitForFunction(()=>location.hash.includes('/contracts/'));await page.waitForTimeout(250);assert.equal(await page.locator('#view-order').isVisible(),true);
 await page.setViewportSize({width:width===1280?390:1280,height:844});await page.waitForTimeout(300);assert.equal(await page.locator('#view-order').evaluate(n=>n.parentElement.tagName),'MAIN');assert.equal(await page.locator('.crm-document-sheet').count(),0);assert.deepEqual(errors,[]);results.push({width,fullPage:true,refresh5:true,back:true,resize:true});await context.close();
}console.log(JSON.stringify(results));}finally{await writeFile(screenshotDir+'/results.json',JSON.stringify(results,null,2));await browser.close();server.close();await f.client.close();}
