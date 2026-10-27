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
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),out=process.env.SUPPLIER_SCREENSHOT_DIR||'/workspace/scratch/supplier-navigation';await mkdir(out,{recursive:true});const results=[];
try{for(const width of [390,1280])for(const role of ['mgr','ncc']){
 const context=await browser.newContext({viewport:{width,height:844},locale:'vi-VN'});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 const user=ok(await f.call('/me',f.cookies[role])).user;await context.addInitScript(({token,user})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{token:f.cookies[role].split('=')[1],user});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));const before=reads.length;await page.goto(origin+'/supplier?request='+made.id);await page.locator('.early-request-card').waitFor();await page.waitForTimeout(200);
 assert.equal(await page.locator('#supplier-back').isVisible(),true);
 if(role==='mgr'){
  assert.equal(await page.locator('.early-product-link').first().getAttribute('href'),'/#/products?sku=031106000');assert.ok(await page.locator('a[href="/#/purchases/a1"]').count());
  await page.getByRole('button',{name:'Xem chi tiết',exact:true}).click();await page.locator('.supplier-detail-content a[href="/#/purchases/a1"]').waitFor();await page.screenshot({path:out+'/detail-orders-'+width+'.png'});
  await page.getByRole('tab',{name:'Phiếu xin hàng',exact:true}).click();await page.locator('.supplier-detail-content a[href="/#/early-requests/'+made.id+'"]').waitFor();await page.locator('.supplier-detail-content').getByText(/16\.000 Cái/).waitFor();
  await page.getByRole('tab',{name:'Tồn kho',exact:true}).click();await page.locator('.supplier-detail-content').getByText('KHO NHẬN: 5',{exact:true}).waitFor();await page.screenshot({path:out+'/detail-stock-'+width+'.png'});await page.getByRole('button',{name:'Đóng',exact:true}).click();
 }else{assert.equal(await page.getByRole('button',{name:'Xem chi tiết',exact:true}).count(),0);assert.equal(await page.locator('.early-product-link').count(),0);assert.ok(!reads.slice(before).some(p=>p.startsWith('/purchase-orders')||p.startsWith('/products')));}
 await page.screenshot({path:out+'/portal-'+role+'-'+width+'.png'});
 if(role==='mgr'){
  await page.locator('#supplier-back').click();await page.locator('.early-request-card strong>a[href="#/purchases/a1"]').waitFor();await page.locator('.early-request-card strong>a[href="#/purchases/a1"]').click();
  await page.getByRole('button',{name:'Xem phiếu xin hàng đã nhận của 031106000',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Xem phiếu xin hàng đã nhận của 031106000',exact:true}).textContent(),'4');
  await page.getByRole('button',{name:'Xem phiếu xin hàng đã nhận của 031106000',exact:true}).click();await page.locator('.supplier-detail-dialog a[href="#/early-requests/'+made.id+'"]').waitFor();await page.screenshot({path:out+'/received-'+width+'.png'});await page.locator('.supplier-detail-dialog a[href="#/early-requests/'+made.id+'"]').click();await page.locator('.early-request-card strong>a[href="#/purchases/a1"]').waitFor();assert.equal(await page.locator('.supplier-detail-dialog[open]').count(),0);
 }
 assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);results.push({width,role,linked:true,errors});await context.close();
}assert.deepEqual(writes,[],'browser navigation never writes business data');console.log(JSON.stringify(results));}finally{await writeFile(out+'/results.json',JSON.stringify(results,null,2));await browser.close();server.close();await f.client.close();}
