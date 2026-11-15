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
const duplicate=ok(await f.call('/purchase-early-requests',f.cookies.mgr,'POST',{clientKey:crypto.randomUUID(),pickupDate:'2026-10-27',scope:{supplierId:'a'},lines:[{sku:'031106000',quantity:5}]}),201);
const dupSubmit=ok(await f.call('/purchase-early-requests/'+duplicate.id+'/submit',f.cookies.mgr,'POST',{revision:duplicate.request.revision}));
ok(await f.call('/purchase-early-request-lines/'+dupSubmit.request.lines[0].id+'/manager-confirm',f.cookies.mgr,'POST',{supplierId:'a'}));
const receipt=ok(await f.call('/purchase-orders/a1/receipts',f.cookies.kho,'POST',{clientKey:crypto.randomUUID(),earlyRequestId:made.id,createSapo:false,receivedDate:'2026-10-27',warehouse:'KHO NHẬN',lines:[{lineId:'line-a1',goodQty:8000,damagedQty:0}]}),201);
const stockBefore=(await f.client.query('select * from stock_moves order by id')).rows;
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
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),out='/workspace/scratch/early-partial-split';await mkdir(out,{recursive:true});
try{const context=await browser.newContext({viewport:{width:1280,height:900},locale:'vi-VN'});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());const user=ok(await f.call('/me',f.cookies.mgr)).user;await context.addInitScript(({token,user})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{token:f.cookies.mgr.split('=')[1],user});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/#/early-requests/'+made.id);
const card=id=>page.locator('.early-request-card').filter({has:page.locator('.early-order-link[href="#/purchases/'+id+'"]')});
await card('a1').getByText('Đã nhận hàng · giữ phiếu để đối soát').waitFor();assert.equal(await card('a1').getByRole('button',{name:'Huỷ phiếu',exact:true}).count(),0);
await page.getByRole('button',{name:'Tách thành 3 phiếu NCC',exact:true}).click();await page.getByRole('button',{name:'Xác nhận tách phiếu',exact:true}).click();await page.waitForFunction(id=>[...document.querySelectorAll('.early-request-card')].some(c=>c.dataset.requestId!==id),made.id);
await page.screenshot({path:out+'/detail-1280.png'});await page.setViewportSize({width:390,height:844});await page.screenshot({path:out+'/detail-390.png'});
for(const order of ['a2','b1']){await card(order).getByRole('button',{name:'Huỷ phiếu',exact:true}).click();await page.getByRole('button',{name:'Xác nhận huỷ phiếu',exact:true}).click();await card(order).waitFor({state:'detached'});}
assert.equal(await card('a1').count(),1);assert.equal(await card('a1').getAttribute('data-request-id'),made.id);assert.ok(page.url().includes(made.id));
const remaining=ok(await f.call('/purchase-early-requests?id='+made.id,f.cookies.mgr)).requests;assert.equal(remaining.length,1);assert.equal(remaining[0].lines[0].allocations[0].receivedQty,8000);assert.equal(remaining[0].lines[0].allocations[0].remainingToReceive,0);
assert.deepEqual((await f.client.query('select * from stock_moves order by id')).rows,stockBefore);assert.deepEqual(errors,[]);await page.screenshot({path:out+'/received-retained-390.png'});
await page.goto(origin+'/#/early-requests/'+duplicate.id);await page.getByText(/đã nhận đủ qua phiếu nhận khác/).waitFor();assert.equal(await page.locator('.early-request-card').getByRole('button',{name:'Nhận hàng',exact:true}).count(),0);await page.screenshot({path:out+'/shared-purchase-balance-390.png'});
const result={sharedPurchaseBalanceExplained:true,splitAfterReceipt:true,cancelUntouchedSiblings:true,originalReceivedIdPreserved:true,receivedQty:8000,remainingQty:0,stockUnchanged:true,noListCancel:true,errors};await writeFile(out+'/results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));await context.close();}finally{await browser.close();server.close();await f.client.close();}
