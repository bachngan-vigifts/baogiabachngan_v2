/** Real CRM router + isolated synthetic stock. No requests outside localhost. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {and,eq} from 'drizzle-orm';
import {setupWarehouseOps} from '../../tests/helpers/warehouse-approval-fixture.ts';
import {warehouses} from '../../src/modules/catalog/schema.ts';
import {stockBalances,stockMoves,inventoryAdjustments} from '../../src/modules/inventory/schema.ts';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const phase=process.argv[2]||'after',root=process.env.STOCKTAKE_UI_DIR||fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out='/tmp/stocktake-quick-'+phase;
await mkdir(out,{recursive:true});const f=await setupWarehouseOps(),requests=[];
await f.db.insert(warehouses).values([{id:'quick-other',name:'Kho B thử',kind:'stock',active:true,sortOrder:20},{id:'quick-private',name:'Kho riêng thử',kind:'stock',active:true,stockPrivate:true,sortOrder:21}]);
await postMoves(f.db,'mgr',[{sku:'00123',warehouseId:'quick-other',qty:23,kind:'opening',refType:'opening',refId:'quick-other-opening'},{sku:'00123',warehouseId:'quick-private',qty:999,kind:'opening',refType:'opening',refId:'quick-private-opening'}]);
const balance=async()=>(await f.db.select().from(stockBalances).where(and(eq(stockBalances.sku,'00123'),eq(stockBalances.warehouseId,'pos-wh'))))[0].qty;
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');
 if(u.pathname.startsWith('/api/staff/')){const chunks=[];for await(const c of req)chunks.push(c);const token=req.headers.authorization?.replace(/^Bearer /,''),path=u.pathname.slice('/api/staff'.length)+u.search;
  const started=performance.now(),r=await f.call(path,token?'__Host-bn-session='+token:'',req.method,chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined);requests.push({path,method:req.method,status:r.status,ms:performance.now()-started});
  res.writeHead(r.status,{'content-type':'application/json','cache-control':'no-store','server-timing':'region;desc="ap-northeast-2"'}).end(JSON.stringify(r.data));return;}
 const path=u.pathname==='/'?'/index.html':u.pathname;let data=await readFile(root+path);if(path==='/index.html')data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.writeHead(200,{'cache-control':'no-store','content-type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':'text/html;charset=utf-8'}).end(data);
}catch(e){res.writeHead(500).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),runs=[],flows=[];
async function contextFor(cookie,width){const context=await browser.newContext({viewport:{width,height:1050},locale:'vi-VN'}),user=(await f.call('/me',cookie)).data.user;
 await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());await context.addInitScript(({token,user})=>{if(location.origin==='null')return;localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));window.__metrics={lcp:null,cls:0};new PerformanceObserver(l=>window.__metrics.lcp=l.getEntries().at(-1).startTime).observe({type:'largest-contentful-paint',buffered:true});new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)window.__metrics.cls+=e.value;}).observe({type:'layout-shift',buffered:true});},{token:cookie.split('=')[1],user});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));return{context,page,errors};}
async function ready(p){await p.waitForFunction(()=>{const b=document.querySelector('#view-stocktake [aria-label="Tạo phiếu kiểm kê mới"]');return b&&!b.disabled;});}
async function accept(p){const dlg=p.locator('#confirm-dialog[open]'),ok=dlg.locator('#confirm-ok');await dlg.waitFor();assert.equal(await ok.isEnabled(),false);assert.match(await ok.textContent(),/\(3\)/);await p.waitForFunction(()=>!document.querySelector('#confirm-ok')?.disabled);await ok.click();}
async function add(p,count){const d=p.locator('dialog.stocktake-dialog[open]');await d.locator('[aria-label="Kho kiểm kê"]').selectOption('pos-wh');await d.locator('[aria-label="Lý do kiểm kê"]').fill('Kiểm kê thử đúng quy trình');await d.locator('[aria-label="Tìm sản phẩm kiểm kê"]').fill('00123');await d.locator('.transfer-search-result').filter({hasText:'00123'}).first().click();await d.locator('[aria-label="Thực đếm 00123"]').fill(String(count));await p.waitForFunction(()=>[...document.querySelectorAll('dialog.stocktake-dialog .stocktake-wh-stock')].some(n=>n.textContent==='23'));return d;}
try{
 if(phase!=='flows')for(const width of [1440,390])for(let run=1;run<=3;run++){
  const {context,page:p,errors}=await contextFor(f.mgr,width),cdp=await context.newCDPSession(p);await cdp.send('Network.enable');await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:40,downloadThroughput:1600000,uploadThroughput:750000});
  const before=requests.length,start=performance.now();await p.goto(origin+'/#/stocktake');await ready(p);const readyMs=performance.now()-start;await p.waitForTimeout(1000);
  const metrics=await p.evaluate(()=>{const n=performance.getEntriesByType('navigation')[0],r=performance.getEntriesByType('resource');return{ttfb:n.responseStart-n.requestStart,load:n.loadEventEnd-n.startTime,fcp:performance.getEntriesByName('first-contentful-paint')[0]?.startTime,lcp:window.__metrics.lcp,cls:window.__metrics.cls,jsBytes:r.filter(x=>new URL(x.name).pathname.endsWith('.js')).reduce((s,x)=>s+x.encodedBodySize,0),jsRequests:r.filter(x=>new URL(x.name).pathname.endsWith('.js')).length};});
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true);assert.deepEqual(errors,[]);runs.push({width,run,ready:readyMs,...metrics,apiRequests:requests.slice(before).length});console.log(width,run,Math.round(readyMs));await context.close();
 }
 if(phase==='after'||phase==='flows')for(const width of [1440,390]){
  const {context,page:p,errors}=await contextFor(f.emp,width);await p.goto(origin+'/#/stocktake');await ready(p);const beforeMoves=(await f.db.select().from(stockMoves)).length;
  await p.locator('[aria-label="Tạo phiếu kiểm kê mới"]').click();let d=await add(p,width===390?0:7);
  assert.equal(await d.getByText('Tồn Kho riêng thử',{exact:true}).count(),0);assert.equal(await d.locator('th').filter({hasText:'Kho B thử'}).count(),1);
  await d.getByRole('button',{name:'Sổ kho',exact:true}).click();const ledger=p.locator('dialog.stocktake-ledger[open]');await ledger.locator('[role=status]').filter({hasText:'phát sinh'}).waitFor();await ledger.locator('[aria-label="Kho xem sổ"]').selectOption('quick-other');await ledger.locator('tbody').getByText('23',{exact:true}).first().waitFor();await ledger.locator('.modal-head').getByRole('button',{name:'Đóng',exact:true}).click();
  assert.equal(await d.locator('[aria-label="Thực đếm 00123"]').inputValue(),width===390?'0':'7');assert.equal((await f.db.select().from(stockMoves)).length,beforeMoves,'search/preview/count input must not change ledger');
  const beforeReload=await p.evaluate(()=>performance.timeOrigin);let nativeBlocked=false;p.once('dialog',async dialog=>{assert.equal(dialog.type(),'beforeunload');nativeBlocked=true;await dialog.dismiss();});
  await p.reload({timeout:1500}).catch(e=>{assert.equal(nativeBlocked,true);assert.match(e.message,/ERR_ABORTED|interrupted|Timeout/);});
  assert.equal(await p.evaluate(()=>performance.timeOrigin),beforeReload,'dismissing native beforeunload must keep the original document');
  assert.equal(nativeBlocked,true,'refreshing an edited stocktake must trigger the browser exit warning');assert.equal(await d.isVisible(),true);
  await p.keyboard.press('Escape');await p.locator('#confirm-dialog[open]').waitFor();assert.equal(await p.locator('#confirm-ok').isEnabled(),false);assert.match(await p.locator('#confirm-ok').textContent(),/\(3\)/);await p.locator('#confirm-cancel').click();assert.equal(await d.isVisible(),true);
  await p.evaluate(()=>location.hash='#/products');await p.locator('#confirm-dialog[open]').waitFor();await p.locator('#confirm-cancel').click();
  assert.equal(new URL(p.url()).hash,'#/stocktake');assert.equal(await d.getByRole('button',{name:'Gửi Manager duyệt',exact:true}).isVisible(),true,'canceled navigation must not hide stocktake actions on mobile');
  await p.evaluate(()=>location.hash='#/products');await accept(p);await p.locator('#view-products').waitFor({state:'visible'});assert.equal(await p.locator('dialog.stocktake-dialog[open]').count(),0);
  await p.goto(origin+'/#/stocktake');await ready(p);await p.reload();await ready(p);await p.getByRole('button',{name:'Tiếp tục phiếu đang nhập',exact:true}).click();d=p.locator('dialog.stocktake-dialog[open]');assert.equal(await d.locator('[aria-label="Thực đếm 00123"]').inputValue(),width===390?'0':'7');
  await d.getByRole('button',{name:'‹ Danh sách phiếu',exact:true}).click();await accept(p);await p.locator('[aria-label="Tạo phiếu kiểm kê mới"]').click();await accept(p);d=p.locator('dialog.stocktake-dialog[open]');assert.equal(await d.locator('tbody tr').count(),0);assert.equal(await d.locator('[aria-label="Lý do kiểm kê"]').inputValue(),'');
  d=await add(p,width===390?0:7);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true);assert.equal(await d.evaluate(n=>n.scrollWidth<=n.clientWidth+2),true,'editor must not overflow horizontally');await p.screenshot({path:out+'/editor-'+width+'.png',fullPage:true});await d.getByRole('button',{name:'Gửi Manager duyệt',exact:true}).click();await p.waitForFunction(()=>!document.querySelector('dialog.stocktake-dialog')?.open);
  const pending=(await f.db.select().from(inventoryAdjustments).where(eq(inventoryAdjustments.status,'pending'))).at(-1);assert.ok(pending);assert.equal(await balance(),10,'submitting must only create a pending request');
  const reviewed=await f.call('/inventory/adjustments/'+pending.id+'/review',f.mgr,'POST',{decision:'approved'});assert.equal(reviewed.status,200,JSON.stringify(reviewed.data));assert.equal(await balance(),width===390?0:7);
  await postMoves(f.db,'mgr',[{sku:'00123',warehouseId:'pos-wh',qty:10-await balance(),kind:'adjust',refType:'adjustment',refId:'restore-fixture-'+width}]);
  assert.deepEqual(errors,[]);flows.push({width,modal:true,liveSearch:true,scopedWarehouseColumns:true,ledgerPreviewPreservesCount:true,countdown:true,nativeBeforeUnload:true,cancelPreservesDraft:true,navigationGuard:true,deviceResume:true,plusCreatesFresh:true,submitPendingOnly:true,managerPostsOnce:true});await context.close();
 }
 const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)],summary=[1440,390].map(width=>({width,...Object.fromEntries(['ready','ttfb','load','fcp','lcp','cls','jsBytes','jsRequests','apiRequests'].map(k=>[k,median(runs.filter(r=>r.width===width).map(r=>r[k]))]))}));
 await writeFile(out+'/results.json',JSON.stringify({phase,conditions:{runsPerViewport:3,coldContexts:true,latencyMs:40,downloadBps:1600000,source:'local isolated real API and fixture data, not production'},summary,runs,flows},null,2));console.log(JSON.stringify({summary,flows}));
}finally{await browser.close();await new Promise(r=>server.close(r));await f.client.close();}
