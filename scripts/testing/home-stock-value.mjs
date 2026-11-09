/** Home stock summary with isolated real API; no production data or writes. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {eq} from 'drizzle-orm';
import {homeFixture} from '../../tests/helpers/home-fixture.ts';
import {products,warehouses,productStock,productMovements,pricePolicies,productPrices} from '../../src/modules/catalog/schema.ts';
import {incomingShipments,incomingShipmentLines,suppliers,supplierReceipts,supplierReceiptLines} from '../../src/modules/suppliers/schema.ts';
import {stockBalances,stockMoves} from '../../src/modules/inventory/schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const f=await homeFixture(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out='/tmp/home-stock-filters';await mkdir(out,{recursive:true});
const now=new Date().toISOString(),past=new Date(Date.now()-86400000).toISOString();
await f.db.update(warehouses).set({active:false});
await f.db.insert(warehouses).values([{id:'browser-wh',name:'KHO VIGIFTS',kind:'stock'},{id:'browser-ledger',name:'CỬA HÀNG MINH LONG',kind:'stock'},{id:'browser-empty',name:'Kho chưa đồng bộ',kind:'stock'}]);
await f.db.insert(products).values([{sku:'HOME-VALUE',name:'Sản phẩm kiểm thử',unit:'Cái',updatedAt:past},{sku:'HOME-MISSING',name:'Chưa có giá',unit:'Cái',updatedAt:past}]);
await f.db.insert(productStock).values([{sku:'HOME-VALUE',warehouseId:'browser-wh',quantity:10,updatedAt:past},{sku:'HOME-VALUE',warehouseId:'browser-ledger',quantity:999,updatedAt:past},{sku:'HOME-MISSING',warehouseId:'browser-wh',quantity:2,updatedAt:past}]);
await f.db.insert(productMovements).values({id:'home-cost',refKey:'home-cost',sku:'HOME-VALUE',kind:'purchase',qty:1,unit:'Cái',unitPrice:125000,occurredAt:past,recordedAt:past});
await f.db.insert(stockMoves).values({id:'home-opening',sku:'HOME-VALUE',warehouseId:'browser-ledger',qty:2,kind:'opening',refType:'opening',refId:'home-opening',createdBy:'mgr',createdAt:past});
await f.db.insert(stockBalances).values({sku:'HOME-VALUE',warehouseId:'browser-ledger',qty:2,updatedAt:now});
await f.db.insert(pricePolicies).values({id:'browser-retail',name:'Giá bán lẻ + VAT',sortOrder:0});
await f.db.insert(productPrices).values({sku:'HOME-VALUE',policyId:'browser-retail',price:250000});
await f.db.insert(warehouses).values({id:'browser-supplier-wh',name:'Tồn tại NCC thử',kind:'supplier'});
await f.db.insert(productStock).values({sku:'HOME-VALUE',warehouseId:'browser-supplier-wh',quantity:3,updatedAt:past});
await f.db.insert(suppliers).values(['a','b'].map(id=>({id:'browser-ncc-'+id,name:'NCC thử '+id,nameKey:'browser-ncc-'+id,createdBy:'mgr',createdAt:past,updatedAt:past})));
for(const [id,approval,sku,quantity,price,supplier,warehouse,confirmation]of [['incoming','approved','HOME-VALUE',5,80000,'a','browser-wh','confirmed'],['pending','pending','HOME-VALUE',2,100000,'a','browser-wh','pending'],['imported','approved','NOT-CATALOGUED',1,50000,'b','Địa chỉ chưa gán kho','pending']]){
 await f.db.insert(incomingShipments).values({id:'browser-'+id,ticketNumber:'B-'+id,source:'supplier-order',approvalStatus:approval,submittedAt:past,supplierId:'browser-ncc-'+supplier,supplierName:'NCC thử '+supplier,warehouse,supplierStatus:confirmation,createdBy:'mgr',createdAt:past,updatedAt:past});
 await f.db.insert(incomingShipmentLines).values({id:'browser-line-'+id,shipmentId:'browser-'+id,lineNo:1,sku,unit:'Cái',quantity,price,purchaseDiscount:id==='incoming'?10:null,confirmedPurchaseDiscount:id==='incoming'?20:null,printFee:id==='incoming'?1000:0,promisedDate:f.yesterday});
}
await f.db.insert(supplierReceipts).values({id:'browser-received',receiptNo:'B-RC',shipmentId:'browser-incoming',receivedDate:f.today,receivedBy:'mgr',clientKey:'b-rc',createdAt:past});
await f.db.insert(supplierReceiptLines).values({receiptId:'browser-received',lineId:'browser-line-incoming',sku:'HOME-VALUE',goodQty:1,damagedQty:1});
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://local');if(u.pathname.startsWith('/api/staff/')){
 const chunks=[];for await(const x of req)chunks.push(x);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined,token=req.headers.authorization?.replace(/^Bearer /,'');
 const r=await f.call(u.pathname.slice(10)+u.search,token?'__Host-bn-session='+token:'',req.method,body);
 res.writeHead(r.status,{'content-type':'application/json','cache-control':'no-store','server-timing':'region;desc="ap-northeast-2"'}).end(JSON.stringify({...r.data,...(r.cookie?{sessionToken:/__Host-bn-session=([a-f0-9]{64})/.exec(r.cookie)?.[1]||''}:{})}));return;}
 const path=u.pathname==='/'?'/index.html':u.pathname;let bytes=await readFile(root+path);if(path.endsWith('.html'))bytes=Buffer.from(bytes.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.writeHead(200,{'content-type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':'text/html'}).end(bytes);
 }catch(e){res.writeHead(500).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']}),results=[];
try{for(const width of [1440,390]){
 f.cookies.mgr=(await f.call('/login','','POST',{email:'mgr@x.vn',password:'mat-khau-12345'})).cookie;
 const c=await browser.newContext({viewport:{width,height:1000},locale:'vi-VN'});await c.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());await c.addInitScript(token=>{if(!localStorage.getItem('bn-v2-session'))localStorage.setItem('bn-v2-session',token);},f.cookies.mgr.split('=')[1]);const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 let release;const held=new Promise(r=>release=r);await p.route('**/api/staff/admin/home-stock-value**',async route=>{await held;await route.fallback();});
 await p.goto(origin+'/#/home');await p.waitForFunction(()=>document.querySelector('#view-home')?.dataset.ready==='true');assert.notEqual(await p.locator('[data-home-stock]').getAttribute('data-stock-state'),'ready','slow inventory cannot delay task-ready Home');release();await p.locator('[data-home-stock][data-stock-state=ready]').waitFor();await p.unroute('**/api/staff/admin/home-stock-value**');
 assert.equal(await p.locator('.home-stock-total strong').textContent(),'3.000.000 đ');assert.equal(await p.locator('.home-stock-card').count(),3);assert.match(await p.locator('[data-home-stock]').innerText(),/1 mã thiếu giá niêm yết/);assert.match(await p.locator('[data-home-stock]').innerText(),/Chưa có dữ liệu tồn/);

 const choose=async(key,value)=>{await p.locator('[data-stock-filter='+key+']').selectOption(value);await p.locator('[data-home-stock][data-stock-state=ready]').waitFor();};
 const total=async value=>assert.equal(await p.locator('.home-stock-total strong').textContent(),value);
 assert.equal(await p.locator('[data-stock-filter=priceBasis]').inputValue(),'list');await choose('priceBasis','purchase');await total('1.500.000 đ');
 await p.locator('.home-stock-details summary').click();await choose('warehouseId','browser-wh');await total('1.250.000 đ');await p.locator('[data-stock-reset]').click();await p.locator('[data-home-stock][data-stock-state=ready]').waitFor();await total('1.500.000 đ');
 await choose('stockType','incoming');await total('310.000 đ');assert.match(await p.locator('[data-home-stock]').innerText(),/Chưa xác định kho nhận/);await choose('supplierId','browser-ncc-a');await total('260.000 đ');await choose('confirmation','confirmed');await choose('due','late');await total('260.000 đ');
 await p.locator('[data-home-stock]').screenshot({path:out+'/incoming-'+width+'.png'});
 await choose('priceBasis','list');await total('1.000.000 đ');await choose('stockType','ordered');await total('500.000 đ');assert.equal(await p.locator('[data-stock-filter=supplierId]').inputValue(),'');await choose('priceBasis','purchase');await total('200.000 đ');assert.match(await p.locator('[data-home-stock]').innerText(),/chưa duyệt/);
 await choose('stockType','supplier');await total('375.000 đ');assert.equal(await p.locator('[data-stock-filter=supplierId]').isVisible(),false);await choose('priceBasis','list');await total('750.000 đ');
 await choose('stockType','physical');await total('3.000.000 đ');
 // A slower purchase-price response cannot overwrite the newer list-price filter, and old amounts clear while loading.
 let late,arrivedLate;const holdLate=new Promise(r=>late=r),gotLate=new Promise(r=>arrivedLate=r);await p.route('**/api/staff/admin/home-stock-value**',async route=>{if(new URL(route.request().url()).searchParams.get('priceBasis')==='purchase'){arrivedLate();await holdLate;}await route.fallback();});
 await p.locator('[data-stock-filter=priceBasis]').selectOption('purchase');await gotLate;assert.equal(await p.locator('.home-stock-total').count(),0);await choose('priceBasis','list');late();await p.waitForTimeout(150);await total('3.000.000 đ');await p.unroute('**/api/staff/admin/home-stock-value**');
 await p.locator('.home-stock-details summary').click();await p.locator('[data-home-stock]').screenshot({path:out+'/list-'+width+'.png'});
 let fail=true;await p.route('**/api/staff/admin/home-stock-value**',async route=>{if(fail){await route.fulfill({status:503,contentType:'application/json',body:'{"error":"Chưa tải được kiểm thử"}'});}else await route.fallback();});await p.locator('[data-stock-refresh]').click();await p.locator('[data-home-stock][data-stock-state=error]').waitFor();assert.equal(await p.locator('.home-stock-total').count(),0,'error is not a false zero');fail=false;await p.locator('[data-stock-refresh]').click();await p.locator('[data-home-stock][data-stock-state=ready]').waitFor();await p.unroute('**/api/staff/admin/home-stock-value**');
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await p.locator('.main').evaluate(n=>n.scrollTo(0,0));await p.screenshot({path:out+'/manager-'+width+'.png',fullPage:true});await p.locator('[data-home-stock]').screenshot({path:out+'/stock-'+width+'.png'});
 // A late private valuation response cannot appear after logout and another employee logs in.
 let finish,seen;const waiting=new Promise(r=>finish=r),arrived=new Promise(r=>seen=r);await p.route('**/api/staff/admin/home-stock-value**',async route=>{const token=f.cookies.mgr.split('=')[1],r=await f.call('/admin/home-stock-value'+new URL(route.request().url()).search,'__Host-bn-session='+token);seen();await waiting;await route.fulfill({status:r.status,contentType:'application/json',body:JSON.stringify(r.data)});});await p.locator('[data-stock-refresh]').click();await arrived;
 await p.locator(width<768?'#account-button-m':'#account-button').click();await p.locator('#logout').click();await p.locator('#auth').waitFor({state:'visible'});finish();await p.locator('#email').fill('emp@x.vn');await p.locator('#password').fill('mat-khau-12345');await p.locator('#login-button').click();await p.waitForFunction(()=>document.querySelector('#view-home')?.dataset.ready==='true');assert.equal(await p.locator('[data-home-stock]').count(),0);assert.doesNotMatch(await p.locator('#view-home').innerText(),/3\.000\.000|KHO VIGIFTS/);assert.deepEqual(errors,[]);results.push({width,deferred:true,correctValues:true,sourceAndDetailFilters:true,latestFilterWins:true,errorRetry:true,accountBoundary:true,noOverflow:true,errors});await c.close();
}
 await writeFile(out+'/results.json',JSON.stringify(results,null,2));process.stdout.write(JSON.stringify(results)+'\n');
}finally{await browser.close();server.close();await Promise.allSettled([...f.background]);await f.client.close();}
