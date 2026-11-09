/** Home stock summary with isolated real API; no production data or writes. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {eq} from 'drizzle-orm';
import {homeFixture} from '../../tests/helpers/home-fixture.ts';
import {products,warehouses,productStock,productMovements} from '../../src/modules/catalog/schema.ts';
import {stockBalances,stockMoves} from '../../src/modules/inventory/schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const f=await homeFixture(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out='/tmp/home-stock-value';await mkdir(out,{recursive:true});
const now=new Date().toISOString(),past=new Date(Date.now()-86400000).toISOString();
await f.db.update(warehouses).set({active:false});
await f.db.insert(warehouses).values([{id:'browser-wh',name:'KHO VIGIFTS',kind:'stock'},{id:'browser-ledger',name:'CỬA HÀNG MINH LONG',kind:'stock'},{id:'browser-empty',name:'Kho chưa đồng bộ',kind:'stock'}]);
await f.db.insert(products).values([{sku:'HOME-VALUE',name:'Sản phẩm kiểm thử',unit:'Cái',updatedAt:past},{sku:'HOME-MISSING',name:'Chưa có giá',unit:'Cái',updatedAt:past}]);
await f.db.insert(productStock).values([{sku:'HOME-VALUE',warehouseId:'browser-wh',quantity:10,updatedAt:past},{sku:'HOME-VALUE',warehouseId:'browser-ledger',quantity:999,updatedAt:past},{sku:'HOME-MISSING',warehouseId:'browser-wh',quantity:2,updatedAt:past}]);
await f.db.insert(productMovements).values({id:'home-cost',refKey:'home-cost',sku:'HOME-VALUE',kind:'purchase',qty:1,unit:'Cái',unitPrice:125000,occurredAt:past,recordedAt:past});
await f.db.insert(stockMoves).values({id:'home-opening',sku:'HOME-VALUE',warehouseId:'browser-ledger',qty:2,kind:'opening',refType:'opening',refId:'home-opening',createdBy:'mgr',createdAt:past});
await f.db.insert(stockBalances).values({sku:'HOME-VALUE',warehouseId:'browser-ledger',qty:2,updatedAt:now});
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
 let release;const held=new Promise(r=>release=r);await p.route('**/api/staff/admin/home-stock-value',async route=>{await held;await route.fallback();});
 await p.goto(origin+'/#/home');await p.waitForFunction(()=>document.querySelector('#view-home')?.dataset.ready==='true');assert.equal(await p.locator('[data-home-stock]').getAttribute('data-stock-state'),null,'slow inventory cannot delay task-ready Home');release();await p.locator('[data-home-stock][data-stock-state=ready]').waitFor();await p.unroute('**/api/staff/admin/home-stock-value');
 assert.equal(await p.locator('.home-stock-total strong').textContent(),'1.500.000 đ');assert.equal(await p.locator('.home-stock-card').count(),3);assert.match(await p.locator('[data-home-stock]').innerText(),/1 mã chưa có giá mua/);assert.match(await p.locator('[data-home-stock]').innerText(),/Chưa có dữ liệu tồn/);
 let fail=true;await p.route('**/api/staff/admin/home-stock-value',async route=>{if(fail){await route.fulfill({status:503,contentType:'application/json',body:'{"error":"Chưa tải được kiểm thử"}'});}else await route.fallback();});await p.locator('[data-stock-refresh]').click();await p.locator('[data-home-stock][data-stock-state=error]').waitFor();assert.equal(await p.locator('.home-stock-total').count(),0,'error is not a false zero');fail=false;await p.locator('[data-stock-refresh]').click();await p.locator('[data-home-stock][data-stock-state=ready]').waitFor();await p.unroute('**/api/staff/admin/home-stock-value');
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await p.locator('.main').evaluate(n=>n.scrollTo(0,0));await p.screenshot({path:out+'/manager-'+width+'.png',fullPage:true});await p.locator('[data-home-stock]').screenshot({path:out+'/stock-'+width+'.png'});
 // A late private valuation response cannot appear after logout and another employee logs in.
 let finish,seen;const waiting=new Promise(r=>finish=r),arrived=new Promise(r=>seen=r);await p.route('**/api/staff/admin/home-stock-value',async route=>{const token=f.cookies.mgr.split('=')[1],r=await f.call('/admin/home-stock-value','__Host-bn-session='+token);seen();await waiting;await route.fulfill({status:r.status,contentType:'application/json',body:JSON.stringify(r.data)});});await p.locator('[data-stock-refresh]').click();await arrived;
 await p.locator(width<768?'#account-button-m':'#account-button').click();await p.locator('#logout').click();await p.locator('#auth').waitFor({state:'visible'});finish();await p.locator('#email').fill('emp@x.vn');await p.locator('#password').fill('mat-khau-12345');await p.locator('#login-button').click();await p.waitForFunction(()=>document.querySelector('#view-home')?.dataset.ready==='true');assert.equal(await p.locator('[data-home-stock]').count(),0);assert.doesNotMatch(await p.locator('#view-home').innerText(),/1\.500\.000|KHO VIGIFTS/);assert.deepEqual(errors,[]);results.push({width,deferred:true,correctValues:true,errorRetry:true,accountBoundary:true,noOverflow:true,errors});await c.close();
}
 await writeFile(out+'/results.json',JSON.stringify(results,null,2));process.stdout.write(JSON.stringify(results)+'\n');
}finally{await browser.close();server.close();await Promise.allSettled([...f.background]);await f.client.close();}
