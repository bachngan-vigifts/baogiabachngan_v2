/** Full CRM + Catalogue with isolated real APIs; no production credentials/data. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setup} from '../../tests/helpers/pos-fixture.ts';
import {customers} from '../../src/modules/customers/schema.ts';
import {catalogueQuotes} from '../../src/modules/catalog/catalogue-library-schema.ts';
import {createCatalogueSecurity} from '../../catalogue-server/security.mjs';
import {libraryProxy} from '../../catalogue-server/library.mjs';
import {defaultState,validateProduct} from '../../trial-ui/catalogue/core.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const f=await setup(),at=new Date().toISOString(),root=process.env.CATALOGUE_CRM_UI_DIR||fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out='/workspace/artifacts/catalogue-merge',requests=[];await mkdir(out,{recursive:true});
await f.db.insert(customers).values(['a','b'].map((key,i)=>({id:'catalogue-browser-'+key,name:'Công ty cùng tên',contact:'Người liên hệ',phone:'090123000'+i,email:'',address:'Địa chỉ thử',search:'cong ty cung ten 090123000'+i,sourceVersion:0,syncedAt:at,approvalStatus:'approved',createdAt:at})));
const bridge=async(url,options={})=>{const u=new URL(url),token=(options.headers?.Authorization||'').replace(/^Bearer /,'');const r=await f.call(u.pathname.split('/api/staff')[1]+u.search,token?'__Host-bn-session='+token:'',options.method||'GET',options.body?JSON.parse(options.body):undefined);requests.push({path:u.pathname.split('/api/staff')[1],method:options.method||'GET'});return new Response(JSON.stringify(r.data),{status:r.status,headers:{'content-type':'application/json'}});};
const secure=createCatalogueSecurity({fetcher:bridge});
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://local');if(u.pathname.startsWith('/api/staff/')||u.pathname.startsWith('/catalogue/api/')){const chunks=[];for await(const c of req)chunks.push(c);const body=chunks.length?Buffer.concat(chunks).toString():undefined;const r=u.pathname.startsWith('/catalogue/api/')?await secure(new Request('http://'+req.headers.host+u.pathname+u.search,{method:req.method,headers:req.headers,body}),{},request=>libraryProxy(request,bridge)):await bridge('https://test'+u.pathname+u.search,{method:req.method,headers:{Authorization:req.headers.authorization||''},body});res.writeHead(r.status,{'content-type':'application/json','server-timing':'region;desc="ap-northeast-2"'}).end(await r.text());return;}
 const path=u.pathname==='/'?'/index.html':u.pathname==='/catalogue/'?'/catalogue/index.html':u.pathname;let bytes=await readFile(root+path);if(path==='/index.html')bytes=Buffer.from(bytes.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':path.endsWith('.png')?'image/png':'text/html;charset=utf-8');res.end(bytes);
}catch(e){res.writeHead(404).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,user=(await f.call('/me',f.mgr)).data.user,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),results=[];

const sourceIds=[];
for(const [brand,count,regular]of [['A Brand',5,100000],['Z Brand',3,500000]]){
 const s=defaultState();s.meta.title='COMPOSE '+brand;s.products=Array.from({length:count},(_,i)=>validateProduct({id:'p'+i,name:brand+' product '+i,sku:'000'+i,brand,category:'Bộ trà',regular,discount:12,fee:15000,qty:i+1}));s.selected=s.products.map(p=>p.id);const id=crypto.randomUUID();sourceIds.push(id);const r=await f.call('/catalogue-quotes',f.mgr,'POST',{id,clientKey:crypto.randomUUID(),state:s});assert.equal(r.status,200,JSON.stringify(r.data));
}

try{for(const width of [1440,390]){
 const context=await browser.newContext({viewport:{width,height:1050},locale:'vi-VN',acceptDownloads:true,isMobile:width<500,hasTouch:width<500});
 await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 await context.addInitScript(({user,token})=>{if(location.origin==='null')return;localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user,token:f.mgr.split('=')[1]});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/catalogue/');await page.waitForFunction(()=>window.vigifts).catch(async e=>{await page.screenshot({path:out+'/failed-'+width+'.png'});console.error(await page.locator('body').innerText(),errors);throw e;});
 await page.locator('[data-action="nav"][data-view="drafts"]').click();await page.locator(`[data-merge-pick="${sourceIds[0]}"]`).check();
 await page.locator('[data-quote-search]').fill('Z Brand');await page.locator(`[data-merge-pick="${sourceIds[1]}"]`).waitFor();await page.waitForTimeout(450);await page.locator(`[data-merge-pick="${sourceIds[1]}"]`).check();await page.locator('[data-quote="merge"]').click();
 await page.locator('.quote-merge-dialog').waitFor();await page.screenshot({path:out+'/merge-dialog-'+width+'.png',fullPage:true});
 if(width===1440){
  await page.locator('.quote-merge-dialog [data-close]').first().click();assert.equal((await page.evaluate(()=>vigifts.getState())).selected.length,0,'cancel preserves current document');
  await page.route('**/catalogue/api/quotes?id='+sourceIds[1],route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Lỗi thử khi đọc nguồn thứ hai'})}));
  await page.locator('[data-quote="merge"]').click();await page.locator('.quote-merge-dialog button[type="submit"]').click();await page.locator('#toast').filter({hasText:'Lỗi thử'}).waitFor();assert.equal((await page.evaluate(()=>vigifts.getState())).selected.length,0,'partial fetch never replaces draft');
  await page.unroute('**/catalogue/api/quotes?id='+sourceIds[1]);await page.locator('[data-quote="merge"]').click();
 }
 await page.locator('.quote-merge-dialog [name="title"]').fill('COMBINED '+width);await page.locator('.quote-merge-dialog button[type="submit"]').click();await page.locator('#quote-page-sort').waitFor();
 let s=await page.evaluate(()=>vigifts.getState());assert.equal(s.selected.length,8);assert.equal(s.cloudQuote,null);assert.equal(s.products[0].regular,100000);assert.equal(s.products[5].regular,500000);assert.equal(new Set(s.selected).size,8);
 const all=await page.evaluate(()=>vigifts.getSlides());assert.equal(all.flatMap(p=>p.items||[]).length,8);assert.equal(all.length,5);
 await page.locator('#quote-page-sort').selectOption('price-desc');assert.equal((await page.evaluate(()=>vigifts.getSlides().filter(p=>p.type==='products')))[0].brand,'Z Brand');
 await page.locator('.quote-page-list').scrollIntoViewIfNeeded();const handles=page.locator('[data-page-handle]');await handles.first().focus();await page.keyboard.press('End');assert.equal(await page.locator('#quote-page-sort').inputValue(),'manual');
 const order=await page.evaluate(()=>vigifts.getSlides().map(p=>p.items?.map(i=>i.id)||p.type));
 // Pointer reorder with actual capture and delegated list handlers.
 const h=page.locator('[data-page-handle]').last(),t=page.locator('.quote-page-row').first();await h.scrollIntoViewIfNeeded();const a=await h.boundingBox(),b=await t.boundingBox();if(width<500){const cdp=await context.newCDPSession(page),point=(x,y)=>({x,y,id:1,radiusX:4,radiusY:4});await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(a.x+10,a.y+12)]});for(let n=1;n<=10;n++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(a.x+10,a.y+12+(b.y+3-a.y-12)*n/10)]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}else{await page.mouse.move(a.x+10,a.y+12);await page.mouse.down();await page.mouse.move(a.x+17,a.y+12);await page.mouse.move(b.x+20,b.y+3,{steps:8});await page.mouse.up();}
 const moved=await page.evaluate(()=>vigifts.getSlides().map(p=>p.items?.map(i=>i.id)||p.type));assert.notDeepEqual(moved,order);
 await page.locator('.quote-page-tools').scrollIntoViewIfNeeded();await page.screenshot({path:out+'/page-order-'+width+'.png',fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
 // Real server save/reopen preserves page order and creates a separate quote.
 await page.locator('[data-action="save-draft"]').click();await page.locator('.quote-recipient-dialog [value="none"]').check();await page.locator('.quote-recipient-dialog button[type="submit"]').click();await page.waitForFunction(()=>vigifts.getState().cloudQuote?.revision===1);const cloud=await page.evaluate(()=>vigifts.getState().cloudQuote);
 assert(!sourceIds.includes(cloud.id));const serverDoc=await f.call('/catalogue-quotes/'+cloud.id,f.mgr);assert.equal(serverDoc.status,200);assert.equal(serverDoc.data.state.settings.pageSort,'manual');
 await page.waitForTimeout(600);await page.reload();await page.waitForFunction(()=>window.vigifts);assert.deepEqual(await page.evaluate(()=>vigifts.getSlides().map(p=>p.items?.map(i=>i.id)||p.type)),moved);
 if(width===1440){
  await page.locator('[data-action="export-pdf"]').click();const download=page.waitForEvent('download');await page.locator('#export-form button[type="submit"]').click();const pdf=await download;const path=out+'/combined.pdf';await pdf.saveAs(path);const data=[...await readFile(path)];assert.equal(await page.evaluate(async d=>(await PDFLib.PDFDocument.load(new Uint8Array(d))).getPageCount(),data),5);await page.locator('#busy').waitFor({state:'hidden'});
  await page.locator('[data-action="export-pptx"]').click();const d=page.waitForEvent('download');await page.locator('#export-form button[type="submit"]').click();await(await d).saveAs(out+'/combined.pptx');await page.locator('#busy').waitFor({state:'hidden'});
 }
 assert.deepEqual(errors,[]);results.push({width,merged:8,pages:5,filterSelection:true,manualPersisted:true,noOverflow:true,exports:width===1440});await context.close();
}
for(const id of sourceIds){const r=await f.call('/catalogue-quotes/'+id,f.mgr);assert.equal(r.data.revision,1,'source quote unchanged');}
console.log(JSON.stringify(results));
}finally{await browser.close();await new Promise(r=>server.close(r));}
