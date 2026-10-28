/** Real local router/PGlite product history links; no business writes. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {eq} from 'drizzle-orm';
import {productDetailFixture} from '../../tests/helpers/product-detail-fixture.ts';
import {incomingShipments,supplierOrderSources} from '../../src/modules/suppliers/schema.ts';
import {salesOrders} from '../../src/modules/sales/schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright'),f=await productDetailFixture();f.mgr=f.cookies.mgr;f.emp=f.cookies.emp;
await f.db.update(salesOrders).set({quoteId:'quote-0'}).where(eq(salesOrders.id,'contract'));
await f.db.insert(supplierOrderSources).values({id:'source',shipmentId:'a1',lineId:'line-a1',sourceType:'quote',sourceId:'quote-0',sourceNo:'BG-000',customerName:'Khách thử',sku:f.sku,quantity:2,createdAt:'2026-10-28T00:00:00Z'});
await f.db.update(incomingShipments).set({supplierInternalOrderNumber:'NCC-123'}).where(eq(incomingShipments.id,'a1'));
const uiRoot=process.env.UI_ROOT||fileURLToPath(new URL('../../trial-ui/',import.meta.url)),writes=[];let loseResponse=false;
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/staff/')){
 const path=u.pathname.slice('/api/staff'.length)+u.search,chunks=[];for await(const c of req)chunks.push(c);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined;
 if(req.method!=='GET')writes.push({path,body});const token=req.headers.authorization?.replace(/^Bearer /,''),r=await f.call(path,token?'__Host-bn-session='+token:'',req.method,body);
 if(loseResponse&&path==='/purchase-early-requests/file'&&r.status===201){loseResponse=false;res.writeHead(503,{'content-type':'application/json'}).end(JSON.stringify({error:'Mất phản hồi thử nghiệm sau lưu'}));return;}
 const data={...r.data};if(r.cookie)data.sessionToken=r.cookie.split('=')[1];res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(data));return;
 }const path=u.pathname==='/'?'/index.html':u.pathname;let data=await readFile(uiRoot+path);if(path.endsWith('.html'))data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html;charset=utf-8');res.end(data);
}catch(e){res.writeHead(500).end(String(e.message));}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,out='/workspace/scratch/product-purchase-links';await mkdir(out,{recursive:true});const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),results=[];let debugPage;
async function session(width,role='mgr'){
 const context=await browser.newContext({viewport:{width,height:932},locale:'vi-VN'});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 const cookie=role==='mgr'?f.mgr:f.emp,user=(await f.call('/me',cookie)).data.user;
 await context.addInitScript(({user,token})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({user,session:token}));},{user,token:cookie.split('=')[1]});
 const page=await context.newPage(),errors=[];debugPage=page;page.on('pageerror',e=>errors.push(e.message));return{context,page,errors};
}
try{
 for(const width of [390,1280]){
  const {context,page,errors}=await session(width);await page.goto(origin+'/#/products/'+f.sku+'?tab=receipts');
  const receipt=page.locator('.pd-panel tbody tr').filter({hasText:'PNH-active'});await receipt.waitFor();assert.equal(await receipt.getByRole('link',{name:'PO-a1',exact:true}).getAttribute('href'),'#/purchases/a1');assert.equal(await receipt.getByRole('link',{name:'HĐKT HĐKT-fixture',exact:true}).getAttribute('href'),'#/contracts/contract');
  await page.goto(origin+'/#/products/'+f.sku+'?tab=purchases');const row=page.locator('.pd-panel tbody tr').filter({has:page.getByRole('link',{name:'PO-a1',exact:true})});await row.waitFor();assert.equal(await row.getByRole('link',{name:'Báo giá BG-000',exact:true}).getAttribute('href'),'#/quotes/quote-0');assert.equal(await row.getByRole('link',{name:'HĐKT HĐKT-fixture',exact:true}).getAttribute('href'),'#/contracts/contract');assert.ok((await row.textContent()).includes('Sinh từ:'));
  await page.goto(origin+'/#/orders/contract');await page.locator('#order-purchases a').filter({hasText:'PO-a1'}).waitFor();const po=page.locator('#order-purchases a').filter({hasText:'PO-a1'});assert.ok((await po.textContent()).includes('NCC-123'));assert.equal(await page.locator('#order-actions').getByRole('button',{name:'Đặt hàng NCC',exact:true}).count(),0);assert.deepEqual(errors,[]);results.push({width,purchaseLink:true,quoteAndContractOrigin:true,errors});await context.close();
 }
 assert.equal(writes.length,0);await writeFile(out+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}catch(e){if(debugPage&&!debugPage.isClosed())console.log((await debugPage.locator('body').innerText()).slice(-3000));throw e;}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));await f.client.close();}
