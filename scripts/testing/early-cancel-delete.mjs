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
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),out='/workspace/scratch/early-cancel-delete';await mkdir(out,{recursive:true});
try{const context=await browser.newContext({viewport:{width:1280,height:900},locale:'vi-VN'});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());const user=ok(await f.call('/me',f.cookies.mgr)).user;await context.addInitScript(({token,user})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{token:f.cookies.mgr.split('=')[1],user});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/#/early-requests/'+made.id);const cancel=page.getByRole('button',{name:'Huỷ phiếu',exact:true}).first();const targetOrder=await cancel.evaluate(b=>b.closest('.early-request-card').querySelector('.early-order-link').getAttribute('href').split('/').pop());const selectedQuantity=submitted.request.lines.flatMap(l=>l.allocations).filter(a=>a.orderId===targetOrder).reduce((n,a)=>n+a.quantity,0);assert.equal(await cancel.evaluate(n=>getComputedStyle(n).color),'rgb(180, 35, 44)');await page.screenshot({path:out+'/detail-1280.png'});await page.setViewportSize({width:390,height:844});await page.screenshot({path:out+'/detail-390.png'});assert.equal(await cancel.isVisible(),true);await cancel.click();await page.getByRole('button',{name:'Xác nhận huỷ phiếu',exact:true}).waitFor();assert.equal((await f.call('/purchase-early-requests?id='+made.id,f.cookies.mgr)).data.requests.length,1);await page.screenshot({path:out+'/confirm-1280.png'});await page.getByRole('button',{name:'Xác nhận huỷ phiếu',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.early-request-card').length===2);const remaining=(await f.call('/purchase-early-requests?id='+made.id,f.cookies.mgr)).data.requests;assert.equal(remaining.length,2);assert.equal(remaining.reduce((n,r)=>n+r.lines.reduce((n,l)=>n+l.quantity,0),0),16000-selectedQuantity);await page.screenshot({path:out+'/remaining-390.png'});for(const count of [1,0]){await page.getByRole('button',{name:'Huỷ phiếu',exact:true}).first().click();await page.getByRole('button',{name:'Xác nhận huỷ phiếu',exact:true}).click();if(count)await page.waitForFunction(()=>document.querySelectorAll('.early-request-card').length===1);else await page.waitForFunction(()=>location.hash.split('?')[0]==='#/early-requests');}assert.deepEqual(errors,[]);console.log(JSON.stringify({cancelOneSlip:true,siblingsRetained:true,confirmedBeforeWrite:true,acceptedSupplierGroups:true,errors}));await context.close();}finally{await browser.close();server.close();await f.client.close();}
