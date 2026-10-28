/** Local real POS/router/PGlite. Slow catalog reproduces scanner/debounce races; camera decoder callback is simulated. No checkout. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setup} from '../../tests/helpers/pos-fixture.ts';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';
import {products,productPrices,productStock} from '../../src/modules/catalog/schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setup();await f.open();const user=(await f.call('/me',f.emp)).data.user;
await f.db.insert(products).values([{sku:'00456',name:'Ly thứ hai',unit:'cái',updatedAt:new Date().toISOString()},{sku:'00789',name:'Ly hết hàng',unit:'cái',updatedAt:new Date().toISOString()}]);
await f.db.insert(productPrices).values([{sku:'00456',policyId:'retail-vat',price:54000},{sku:'00789',policyId:'retail-vat',price:54000}]);
await f.db.insert(productStock).values({sku:'00456',warehouseId:'pos-wh',quantity:50,updatedAt:new Date().toISOString()});
await f.db.transaction(tx=>postMoves(tx,'mgr',[{sku:'00456',warehouseId:'pos-wh',qty:50,kind:'opening',refType:'opening',refId:'scan-fixture'}]));
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),calls=[];
const html=`<!doctype html><html class="app-shell"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/pos.css"><link rel="stylesheet" href="/typography.css"><link rel="stylesheet" href="/mobile-actions.css"><script type="module" src="/mobile-actions-init.js"></script><div class="workspace"><main class="main"><section id="view-pos"></section></main></div><script type="module">
import {initPos} from '/pos.js';
const api=async(path,method='GET',body)=>{const r=await fetch('/api'+path,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),data=await r.json();if(!r.ok)throw Object.assign(Error(data.error),{status:r.status});return data;};
window.pos=initPos({api,root:document.querySelector('#view-pos'),user:()=>(${JSON.stringify(user)}),toast:(message)=>console.log(message),confirmBox:async()=>true,go:hash=>location.hash=hash});await pos.load();window.ready=true;
</script>`;
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost'),path=u.pathname;
 if(path.startsWith('/api/')){let body;const chunks=[];for await(const chunk of req)chunks.push(chunk);if(chunks.length)body=JSON.parse(Buffer.concat(chunks).toString());
 calls.push({path:path.slice(4),method:req.method,body});if(path==='/api/pos/catalog'&&u.searchParams.get('q'))await new Promise(r=>setTimeout(r,u.searchParams.get('q')==='00123'?350:100));
 const r=await f.call(path.slice(4)+u.search,f.emp,req.method,body);res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;}
 if(path==='/barcode-camera.js'){res.setHeader('content-type','text/javascript');res.end('export async function startBarcodeCamera(video,onCode){window.cameraCode=onCode;return {stop(){}};}');return;}
 res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':'text/html');res.end(path==='/'?html:await readFile(root+path));
 }catch(e){res.writeHead(500).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const shot=process.env.POS_SCREENSHOT_DIR||'/workspace/scratch/pos-customer-checkout';await mkdir(shot,{recursive:true});
try{
 for(const width of [390,1280]){
  const context=await browser.newContext({viewport:{width,height:932},locale:'vi-VN'});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);await page.waitForFunction(()=>window.ready);
  const input=page.getByRole('searchbox',{name:'Tìm hoặc quét sản phẩm'});
  const scan=async code=>{await input.fill(code);await input.press('Enter');assert.equal(await input.inputValue(),'');assert.equal(await input.evaluate(n=>n===document.activeElement),true);};
  await scan('00123');await scan('00456');await page.waitForFunction(()=>document.querySelectorAll('.pos-line').length===2);
  const qty=sku=>page.locator('.pos-line').filter({has:page.locator('[aria-label="Bỏ '+(sku==='00123'?'Ly sứ':'Ly thứ hai')+' khỏi đơn"]')}).locator('.pos-qty input');
  await scan('00123');await page.waitForFunction(()=>document.querySelector('[aria-label="Bỏ Ly sứ khỏi đơn"]')?.closest('.pos-line').querySelector('.pos-qty input')?.value==='2');assert.equal(await qty('00123').inputValue(),'2');
  await input.fill('Ly thứ hai');await input.press('Enter');await page.waitForTimeout(250);assert.equal(await input.inputValue(),'Ly thứ hai');assert.equal(await qty('00456').inputValue(),'1');
  await input.fill('00789');await input.press('Enter');await page.waitForTimeout(250);assert.equal(await input.inputValue(),'00789');assert.equal(await page.locator('.pos-line').count(),2);
  await page.getByRole('button',{name:'Quét mã',exact:true}).click();await page.waitForFunction(()=>typeof window.cameraCode==='function');await page.evaluate(()=>window.cameraCode('00123'));assert.equal(await input.inputValue(),'');await page.waitForFunction(()=>document.querySelector('[aria-label="Bỏ Ly sứ khỏi đơn"]')?.closest('.pos-line').querySelector('.pos-qty input')?.value==='3');
  await page.waitForTimeout(250);assert.deepEqual(errors,[]);assert.equal(calls.filter(c=>c.path==='/pos/checkout').length,0);console.log(JSON.stringify({width,rapidScans:true,repeatQty:3,cameraCallback:true,emptyFocused:true,outOfStockSafe:true,nameSearchSafe:true,errors}));await context.close();
 }
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));await f.client.close();}
