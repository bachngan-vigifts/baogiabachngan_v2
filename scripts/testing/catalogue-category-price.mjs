/** Local real-API fixture only; never connects to production or writes its data. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setupWarehouseWork} from '../../tests/helpers/warehouse-work-fixture.ts';
import {libraryProxy} from '../../catalogue-server/library.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url));
const out=process.env.BROWSER_EVIDENCE_DIR||'/tmp/catalogue-category-price';await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{try{
 const path=new URL(req.url,'http://local').pathname;const file=path.endsWith('/')?path+'index.html':path;
 const data=await readFile(root+file);res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream'}).end(data);
}catch{res.writeHead(404).end();}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),results=[];
try{for(const width of [1440,390]){
 const f=await setupWarehouseWork(),context=await browser.newContext({viewport:{width,height:950}}),errors=[];
 try{
 const imported=await f.call('/catalogue-library',f.cookies.mgr,'POST',{products:Array.from({length:4},(_,i)=>({clientId:'fixture-'+i,product:{name:'Bộ trà kiểm thử '+i,sku:'CAT-00'+i,brand:'Minh Long',category:'Bộ trà',collection:'Camellia',pattern:'Sen',color:'Trắng',regular:1000000+i*1000}}))});
 assert.equal(imported.status,200);const rows=imported.data.products,ids=rows.map(r=>r.id);
 await context.addInitScript(token=>localStorage.setItem('bn-v2-session',token),f.cookies.mgr.split('=')[1]);
 await context.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url());
  if(u.origin!==base)return route.abort();
  if(!u.pathname.startsWith('/catalogue/api/'))return route.continue();
  const response=await libraryProxy(new Request(req.url(),{method:req.method(),headers:req.headers(),...(req.method()==='GET'?{}:{body:req.postData()})}),async(url,init)=>{
   const v=new URL(url),r=await f.call(v.pathname.replace('/functions/v1/baogia-v2-api/api/staff','')+v.search,f.cookies.mgr,init.method,init.body?JSON.parse(init.body):undefined);return Response.json(r.data,{status:r.status});
  });return route.fulfill({status:response.status,contentType:'application/json',body:await response.text()});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/catalogue/');await page.waitForFunction(()=>window.vigifts);
 const openLibrary=async()=>{await page.locator('[data-action="nav"][data-view="products"]').click();await page.locator('.library-grid .product-card').first().waitFor();await page.locator('[data-lib="reset"]').click();await page.locator(`[data-library-id="${ids[0]}"]`).waitFor();};
 const choose=async id=>page.locator(`[data-lib-check="${id}"]`).check();
 const dialog=()=>page.locator('dialog.shared-library-dialog[open]');
 await openLibrary();await choose(ids[0]);await choose(ids[1]);await page.locator('[data-bulk="edit"]').click();
 assert.equal(await dialog().locator('[name="category"]').inputValue(),'Bộ trà');assert.equal(await dialog().locator('[name="collection"]').inputValue(),'Camellia');
 assert.deepEqual(await dialog().locator('form').evaluate(f=>[...new FormData(f)]),[],'prefill must not silently enable bulk changes');
 await dialog().locator('[data-apply="category"]').check();await dialog().locator('[name="category"]').fill('Bộ trà demo');
 await dialog().locator('[data-apply="priceBand"]').check();await dialog().locator('[name="priceBand"]').selectOption('6');
 const layout=await dialog().evaluate(d=>{const r=d.getBoundingClientRect(),foot=d.querySelector('.modal-foot').getBoundingClientRect(),body=d.querySelector('.modal-body').getBoundingClientRect();return{width:r.width,viewport:innerWidth,footerVisible:foot.bottom<=innerHeight&&foot.top>=0,noOverlap:body.bottom<=foot.top+1,overflow:d.scrollWidth>d.clientWidth+1};});
 assert(layout.width<=width&&layout.footerVisible&&layout.noOverlap&&!layout.overflow,JSON.stringify(layout));
 await page.screenshot({path:`${out}/${width}-bulk.png`});await dialog().locator('[type="submit"]').click();await page.waitForFunction(()=>!document.querySelector('dialog[open]'));
 await page.waitForFunction(()=>document.querySelector('.library-bulk-tools strong')?.textContent.includes('Đã tick 0'));
 const saved=await f.call('/catalogue-library?includeStock=0',f.cookies.kt);assert(saved.data.products.filter(r=>ids.slice(0,2).includes(r.id)).every(r=>r.product.priceBand===6&&r.product.category==='Bộ trà demo'));
 await page.locator('[data-lib="reset"]').click();await page.locator(`[data-library-id="${ids[0]}"]`).waitFor();await choose(ids[0]);await choose(ids[1]);await page.locator('[data-bulk="add"]').click();await page.locator('[data-action="nav"][data-view="quote"].active').waitFor();
 assert.equal(await page.locator('.selection .product-row').count(),2);assert(await page.evaluate(()=>window.vigifts.getSlides().some(s=>s.type==='products'&&s.band===6&&s.items.length===2)));
 await page.screenshot({path:`${out}/${width}-quote.png`});
 await openLibrary();await page.locator(`[data-library-id="${ids[0]}"] > .card-body > details`).evaluate(d=>d.open=true);await page.locator(`[data-library-id="${ids[0]}"] [data-lib="pick"]`).click();await page.locator('[data-view="quote"].active').waitFor();assert.equal(await page.locator('.selection .product-row').count(),2,'picking an included product must not remove it');
 await openLibrary();await choose(ids[0]);await choose(ids[2]);await page.locator('[data-bulk="edit"]').click();assert.equal(await dialog().locator('[name="category"]').inputValue(),'');assert.match(await dialog().textContent(),/Hiện có:.*Bộ trà demo/);assert.deepEqual(await dialog().locator('form').evaluate(f=>[...new FormData(f)]),[]);await page.screenshot({path:`${out}/${width}-mixed.png`});await dialog().locator('[data-close]').first().click();
 await page.locator(`[data-library-id="${ids[0]}"] > .card-body > details`).evaluate(d=>d.open=true);await page.locator(`[data-library-id="${ids[0]}"] [data-lib="edit"]`).click();assert.equal(await dialog().locator('[name="priceBand"]').inputValue(),'6');await dialog().locator('[name="override"]').fill('450000');await dialog().locator('[type="submit"]').click();await page.waitForFunction(()=>!document.querySelector('dialog[open]'));
 const single=await f.call('/catalogue-library?includeStock=0',f.cookies.kt);assert.equal(single.data.products.find(r=>r.id===ids[0]).product.override,450000);
 assert.deepEqual(errors,[]);results.push({width,layout,commonPrefill:true,mixedPrefill:true,bulkApiPersisted:true,priceBandPagination:true,singlePriceEdit:true,immediateQuoteNavigation:true,errors});
 }finally{await context.close();await f.client.close();}
}await writeFile(out+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));}finally{await browser.close();await new Promise(r=>server.close(r));}
