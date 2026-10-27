/** Real local router/PGlite; no production calls, external mail, carrier or Sapo requests. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {eq} from 'drizzle-orm';
import {setupEarly} from '../../tests/helpers/purchase-early-fixture.ts';
import {products,warehouses} from '../../src/modules/catalog/schema.ts';
import {incomingShipments} from '../../src/modules/suppliers/schema.ts';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setupEarly(),ok=(r,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};
await f.db.insert(products).values({sku:'031106000',name:'Bộ trà 0.7 L Jasmine Trắng Ngà (031106000)',unit:'Cái',updatedAt:'2026-10-01T00:00:00Z'});
await f.db.insert(warehouses).values({id:'receive',name:'KHO NHẬN',kind:'stock'});
await postMoves(f.db,'mgr',[{sku:'031106000',warehouseId:'receive',qty:1,kind:'opening',refType:'opening',refId:'opening'}]);
for(const id of ['a1','a2','b1'])await f.db.update(incomingShipments).set({supplierInternalOrderNumber:'DDLT-'+id}).where(eq(incomingShipments.id,id));
const made=ok(await f.call('/purchase-early-requests',f.cookies.mgr,'POST',{clientKey:crypto.randomUUID(),pickupDate:'2026-10-27',lines:[{sku:'031106000',quantity:16000}]}),201);
const submitted=ok(await f.call('/purchase-early-requests/'+made.id+'/submit',f.cookies.mgr,'POST',{revision:made.request.revision}));
for(const supplierId of ['a','b'])ok(await f.call('/purchase-early-request-lines/'+submitted.request.lines[0].id+'/manager-confirm',f.cookies.mgr,'POST',{supplierId}));
ok(await f.call('/purchase-orders/a1/receipts',f.cookies.mgr,'POST',{clientKey:crypto.randomUUID(),earlyRequestId:made.id,createSapo:false,receivedDate:'2026-10-27',warehouse:'KHO NHẬN',lines:[{lineId:'line-a1',goodQty:4,damagedQty:0}]}),201);
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),reads=[],writes=[];
const server=createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/staff/')){
  const path=u.pathname.slice('/api/staff'.length)+u.search;reads.push(path);if(req.method!=='GET')writes.push(path);
  const chunks=[];for await(const c of req)chunks.push(c);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined;
  const token=req.headers.authorization?.replace(/^Bearer /,'');const r=await f.call(path,token?'__Host-bn-session='+token:'',req.method,body);res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;
 }
 const path=u.pathname==='/'?'/index.html':u.pathname==='/supplier'?'/supplier.html':u.pathname;
 let data=await readFile(root+path);if(path.endsWith('.html'))data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':'text/html;charset=utf-8');res.end(data);
}catch(e){res.writeHead(500).end(String(e.message));}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),out=process.env.SUPPLIER_SCREENSHOT_DIR||'/workspace/scratch/page-back';await mkdir(out,{recursive:true});const results=[];
try{for(const width of [360,390,430,768,1280]){
 const context=await browser.newContext({viewport:{width,height:844},locale:'vi-VN'});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());const user=ok(await f.call('/me',f.cookies.mgr)).user;
 await context.addInitScript(({token,user})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{token:f.cookies.mgr.split('=')[1],user});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/?back-case=history#/tasks');await page.locator('#workspace').waitFor({state:'visible'});
 const go=async hash=>{await page.evaluate(h=>location.hash=h,hash);await page.waitForTimeout(200);};
 await go('#/pos');await go('#/inventory');await page.getByRole('button',{name:'Trở lại Bán hàng nhanh',exact:true}).click();await page.waitForFunction(()=>location.hash==='#/pos');
 await page.goForward();await page.waitForFunction(()=>location.hash==='#/inventory');await page.locator('#page-back').click();await page.waitForFunction(()=>location.hash==='#/pos');await page.locator('#page-back').click();await page.waitForFunction(()=>location.hash==='#/tasks');
 await page.goto(origin+'/?back-case=direct#/purchases/a1');await page.locator('.pur-drawer h2').waitFor();assert.equal(await page.locator('#page-back').textContent(),'‹ Đơn mua NCC');await page.locator('#page-back').click();await page.waitForFunction(()=>location.hash==='#/purchases');
 await go('#/quotes');await go('#/quotes/new');await page.locator('#quote-form [name=customer]').fill('Bản nháp kiểm tra nút trở lại');await page.locator('#page-back').click();await page.locator('#confirm-dialog[open]').waitFor();await page.locator('#confirm-cancel').click();assert.equal(await page.evaluate(()=>location.hash),'#/quotes/new');assert.equal(await page.locator('#quote-form [name=customer]').inputValue(),'Bản nháp kiểm tra nút trở lại');
 await page.locator('#page-back').click();await page.locator('#confirm-dialog[open]').waitFor();await page.locator('#confirm-ok').click();await page.waitForFunction(()=>location.hash==='#/quotes');
 for(const route of ['tasks','quotes','orders','contracts','customers','care','pos','deliveries','packing','receivables','cash','cashbook','purchases','receiving','suppliers','early-requests','kho','stock-moves','inventory','transfers','products','stock-lookup','stock-requests','staff','payroll','permissions','flow','dashboard']){
  await go('#/'+route);assert.equal(await page.locator('#page-back').count(),1);assert.equal(await page.locator('#page-back').isVisible(),true);assert.equal(await page.evaluate(()=>document.querySelector('.topbar').scrollWidth>document.querySelector('.topbar').clientWidth+1),false,'header overflow '+route);
 }
 await go('#/pos');await page.screenshot({path:out+'/pos-'+width+'.png'});await go('#/inventory');await page.screenshot({path:out+'/inventory-'+width+'.png'});
 for(let i=0;i<5;i++){await page.evaluate(()=>dispatchEvent(new HashChangeEvent('hashchange')));await page.waitForTimeout(50);}assert.equal(await page.locator('#page-back').count(),1);assert.deepEqual(errors,[]);results.push({width,routes:28,history:true,dirtyCancel:true,dirtyAccept:true,deepLinkFallback:true,errors});await context.close();
}console.log(JSON.stringify(results));}finally{await writeFile(out+'/results.json',JSON.stringify(results,null,2));await browser.close();server.close();await f.client.close();}
