/** Real local router/PGlite; no production calls, external mail, carrier or Sapo requests. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {eq} from 'drizzle-orm';
import {setupEarly} from '../../tests/helpers/purchase-early-fixture.ts';
import {products,warehouses} from '../../src/modules/catalog/schema.ts';
import {incomingShipments,supplierOrderEvents} from '../../src/modules/suppliers/schema.ts';
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
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),out='/workspace/scratch/early-list-actions';await mkdir(out,{recursive:true});
const results=[];
try{
 for(const width of [390,1280]){
  const context=await browser.newContext({viewport:{width,height:900},locale:'vi-VN'});
  await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
  const user=ok(await f.call('/me',f.cookies.mgr)).user;
  await context.addInitScript(({token,user})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{token:f.cookies.mgr.split('=')[1],user});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const draft=ok(await f.call('/purchase-early-requests',f.cookies.mgr,'POST',{clientKey:crypto.randomUUID(),pickupDate:'2026-10-27',lines:[{sku:'031106000',quantity:1}]}),201);
  const pending=width===390?made:ok(await f.call('/purchase-early-requests',f.cookies.mgr,'POST',{clientKey:crypto.randomUUID(),pickupDate:'2026-10-27',lines:[{sku:'031106000',quantity:2}]}),201);
  if(width!==390)ok(await f.call('/purchase-early-requests/'+pending.id+'/submit',f.cookies.mgr,'POST',{revision:pending.request.revision}));
  const stockBefore=(await f.client.query('select * from stock_moves order by id')).rows;
  for(const [request,label,confirm]of [[draft,'Xoá phiếu','Xác nhận xoá phiếu'],[pending,'Huỷ phiếu và xoá','Xác nhận huỷ và xoá']]){
   await page.goto(origin+'/#/early-requests?q='+request.id);
   const remove=page.locator('[data-early-list-remove="'+request.id+'"]');await remove.waitFor();assert.equal(await remove.isVisible(),true);assert.equal(await remove.textContent(),label);
   await page.screenshot({path:out+'/list-'+width+'-'+(request===draft?'draft':'submitted')+'.png'});
   const before=writes.length;await remove.click();await page.getByRole('button',{name:confirm,exact:true}).waitFor();assert.equal(writes.length,before,'opening confirmation cannot delete');
   await page.locator('.early-request-dialog').getByRole('button',{name:'Đóng',exact:true}).click();assert.equal(await remove.isVisible(),true);assert.equal(writes.length,before,'closing confirmation cannot delete');
   await remove.click();await page.screenshot({path:out+'/confirm-'+width+'-'+(request===draft?'draft':'submitted')+'.png'});
   await page.getByRole('button',{name:confirm,exact:true}).click();await page.waitForFunction(()=>document.querySelector('.early-page-index [role="status"]').textContent==='0 phiếu');
   assert.equal(await remove.count(),0);assert.ok(page.url().includes('q='+request.id),'keep current search after deletion');assert.equal(writes.length,before+1);
   assert.equal((await f.call('/purchase-early-requests',f.cookies.mgr)).data.requests.some(r=>r.id===request.id),false);
  }
  const blocked=ok(await f.call('/purchase-early-requests',f.cookies.mgr,'POST',{clientKey:crypto.randomUUID(),pickupDate:'2026-10-27',lines:[{sku:'031106000',quantity:1}]}),201);
  await f.db.insert(supplierOrderEvents).values({id:crypto.randomUUID(),shipmentId:blocked.request.lines[0].allocations[0].orderId,actorId:'mgr',at:new Date().toISOString(),action:'receive',data:JSON.stringify({earlyRequestId:blocked.id,receiptId:'historical-receipt'})});
  await page.goto(origin+'/#/early-requests?q='+blocked.id);await page.locator('[data-early-list-remove="'+blocked.id+'"]').click();await page.getByRole('button',{name:'Xác nhận xoá phiếu',exact:true}).click();await page.locator('.early-request-dialog [role="alert"]').filter({hasText:'đã phát sinh nhận hàng'}).waitFor();
  assert.equal((await f.call('/purchase-early-requests',f.cookies.mgr)).data.requests.some(r=>r.id===blocked.id),true);assert.deepEqual((await f.client.query('select * from stock_moves order by id')).rows,stockBefore);
  await page.locator('.early-request-dialog').getByRole('button',{name:'Đóng',exact:true}).click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.deepEqual(errors,[]);
  results.push({width,draftDelete:true,submittedCancelDelete:true,confirmationBeforeWrite:true,filtersRetained:true,receiptGuard:true,stockUnchanged:true,errors});await context.close();
 }
 const context=await browser.newContext();const user=ok(await f.call('/me',f.cookies.kho)).user;
 await context.addInitScript(({token,user})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{token:f.cookies.kho.split('=')[1],user});
 const page=await context.newPage();await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());await page.goto(origin+'/#/early-requests');await page.locator('.early-page-card').first().waitFor();assert.equal(await page.locator('[data-early-list-remove]').count(),0,'warehouse cannot delete');await context.close();
 console.log(JSON.stringify({results,warehouseCannotDelete:true}));await writeFile(out+'/results.json',JSON.stringify({results,warehouseCannotDelete:true},null,2));
}finally{await browser.close();server.close();await f.client.close();}
