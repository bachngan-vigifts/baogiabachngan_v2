/** Local real-API fixture only; never connects to production or writes its data. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setupWarehouseWork} from '../../tests/helpers/warehouse-work-fixture.ts';
import {libraryProxy} from '../../catalogue-server/library.mjs';
import {createCatalogueSecurity} from '../../catalogue-server/security.mjs';
import {customers} from '../../src/modules/customers/schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url));
const out=process.env.BROWSER_EVIDENCE_DIR||'/tmp/catalogue-category-price';await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{try{
 const path=new URL(req.url,'http://local').pathname;const file=path.endsWith('/')?path+'index.html':path;
 const data=await readFile(root+file);res.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream'}).end(data);
}catch{res.writeHead(404).end();}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),results=[];
try{for(const width of [1440,390]){
 const f=await setupWarehouseWork(),context=await browser.newContext({viewport:{width,height:950}}),errors=[];let quoteWrites=0,failGroups=false;
 try{
 const secure=createCatalogueSecurity({fetcher:async(_url,init)=>{const bearer=new Headers(init.headers).get('authorization')||'',r=await f.call('/me','__Host-bn-session='+bearer.replace(/^Bearer /,''));return Response.json(r.data,{status:r.status});}});
 const at=new Date().toISOString();await f.db.insert(customers).values({id:'recipient-browser-customer',name:'Khách thử nghiệm',customerType:'Doanh nghiệp',contact:'',phone:'',email:'',address:'',search:'khach thu nghiem',sourceVersion:0,syncedAt:at,createdAt:at,approvalStatus:'approved'});
 const imported=await f.call('/catalogue-library',f.cookies.mgr,'POST',{products:Array.from({length:4},(_,i)=>({clientId:'fixture-'+i,product:{name:'Bộ trà kiểm thử '+i,sku:'CAT-00'+i,brand:'Minh Long',category:'Bộ trà',collection:'Camellia',pattern:'Sen',color:'Trắng',regular:1000000+i*1000}}))});
 assert.equal(imported.status,200);const rows=imported.data.products,ids=rows.map(r=>r.id);
 await context.addInitScript(token=>localStorage.setItem('bn-v2-session',token),f.cookies.mgr.split('=')[1]);
 const routeRequest=async route=>{
  const req=route.request(),u=new URL(req.url());
  if(u.origin!==base)return route.abort();
  if(!u.pathname.startsWith('/catalogue/api/'))return route.continue();
  if(u.pathname.endsWith('/quotes')&&['POST','PUT'].includes(req.method()))quoteWrites++;
  if(failGroups&&u.pathname.endsWith('/customers')&&u.searchParams.get('groups')==='1')return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Lỗi tải nhóm kiểm thử'})});
  const response=await secure(new Request(req.url(),{method:req.method(),headers:req.headers(),...(req.method()==='GET'?{}:{body:req.postData()})}),{},request=>libraryProxy(request,async(url,init)=>{
   const v=new URL(url),r=await f.call(v.pathname.replace('/functions/v1/baogia-v2-api/api/staff','')+v.search,f.cookies.mgr,init.method,init.body?JSON.parse(init.body):undefined);return Response.json(r.data,{status:r.status});
  }));return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
 };
 await context.route('**/*',routeRequest);
 for(const badToken of ['', 'expired-session-test-token']){
  const stranger=await browser.newContext({viewport:{width,height:950}});await stranger.route('**/*',routeRequest);
  if(badToken)await stranger.addInitScript(value=>localStorage.setItem('bn-v2-session',value),badToken);
  const locked=await stranger.newPage();await locked.goto(base+'/catalogue/');await locked.locator('#catalogue-auth a').waitFor();await locked.waitForTimeout(250);
  assert.equal(await locked.evaluate(()=>typeof window.vigifts),'undefined');assert.equal(await locked.locator('#app').isVisible(),false);
  await locked.screenshot({path:`${out}/${width}-auth-${badToken?'expired':'anonymous'}.png`});await stranger.close();
 }
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/catalogue/');await page.waitForFunction(()=>window.vigifts);assert((await page.locator('.catalogue-staff').textContent()).trim().length>0);
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
 await page.locator('[data-action="nav"][data-view="quote"]').click();await page.locator('#meta-customer').fill('');
 const recipient=()=>page.locator('.quote-recipient-dialog[open]');
 const save=async()=>{await page.locator('[data-action="save-draft"]').click();await recipient().waitFor();};
 const waitRevision=async n=>page.waitForFunction(n=>window.vigifts.getState().cloudQuote?.revision===n,n);
 await save();await recipient().locator('[type="submit"]').click();await page.waitForFunction(()=>document.querySelector('.quote-recipient-dialog[open] .error')?.textContent.includes('Chọn đúng hồ sơ'));assert.equal(quoteWrites,0);
 await recipient().locator('[data-cancel]').first().click();assert.equal(quoteWrites,0);
 await save();failGroups=true;await recipient().locator('[value="group"]').check();await page.waitForFunction(()=>document.querySelector('.quote-recipient-dialog[open] .error')?.textContent.includes('Lỗi tải nhóm'));assert.equal(quoteWrites,0);
 failGroups=false;await recipient().locator('[data-reload-groups]').click();await recipient().locator('[name="customerGroup"]').selectOption('Doanh nghiệp');
 const recipientLayout=await recipient().evaluate(d=>{const r=d.getBoundingClientRect(),footer=d.querySelector('.modal-foot').getBoundingClientRect();return{width:r.width,footerVisible:footer.bottom<=innerHeight,noHorizontalOverflow:d.scrollWidth<=d.clientWidth+1};});assert(recipientLayout.width<=width&&recipientLayout.footerVisible&&recipientLayout.noHorizontalOverflow);
 await page.screenshot({path:`${out}/${width}-recipient-group.png`});await recipient().locator('[type="submit"]').click();await waitRevision(1);assert.equal(quoteWrites,1);
 let state=await page.evaluate(()=>window.vigifts.getState());assert.equal(state.meta.customerGroup,'Doanh nghiệp');assert.equal(state.meta.customerId,'');
 await page.reload();await page.waitForFunction(()=>window.vigifts);assert.equal(await page.evaluate(()=>window.vigifts.getState().meta.customerGroup),'Doanh nghiệp');
 await save();await recipient().locator('[value="customer"]').check();await recipient().locator('#recipient-customer').fill('khach thu nghiem');await recipient().locator('.catalogue-customer-choice').first().click();await recipient().locator('[data-cancel]').first().click();assert.equal(await page.evaluate(()=>window.vigifts.getState().meta.customerGroup),'Doanh nghiệp');assert.equal(quoteWrites,1,'cancel a staged customer selection must not send or change a group');
 await save();await recipient().locator('[value="customer"]').check();await recipient().locator('#recipient-customer').fill('khach thu nghiem');await recipient().locator('.catalogue-customer-choice').first().click();await recipient().locator('[type="submit"]').click();await waitRevision(2);assert.equal(quoteWrites,2);
 state=await page.evaluate(()=>window.vigifts.getState());assert.equal(state.meta.customerId,'recipient-browser-customer');assert.equal(state.meta.customerGroup,'');
 let snapshot=await f.call('/catalogue-quotes/'+state.cloudQuote.id,f.cookies.mgr);assert.equal(snapshot.data.state.meta.customerId,'recipient-browser-customer');
 await save();await recipient().locator('[value="none"]').check();await page.screenshot({path:`${out}/${width}-recipient-none.png`});await recipient().locator('[type="submit"]').click();await waitRevision(3);assert.equal(quoteWrites,3);
 state=await page.evaluate(()=>window.vigifts.getState());assert.equal(state.meta.customerId,'');assert.equal(state.meta.customerGroup,'');assert.equal(state.meta.customer,'');
 snapshot=await f.call('/catalogue-quotes/'+state.cloudQuote.id,f.cookies.mgr);assert.equal(snapshot.data.state.meta.customerId,'');
 await save();await page.keyboard.press('Escape');assert.equal(await recipient().count(),0);assert.equal(quoteWrites,3);
 await save();await recipient().locator('[value="none"]').check();await page.evaluate(()=>localStorage.setItem('bn-v2-session','different-test-session'));await recipient().locator('[type="submit"]').click();assert.match(await recipient().locator('.error').textContent(),/Tài khoản đã thay đổi/);assert.equal(quoteWrites,3);await recipient().locator('[data-cancel]').first().click();await page.evaluate(token=>localStorage.setItem('bn-v2-session',token),f.cookies.mgr.split('=')[1]);
 await page.evaluate(()=>{localStorage.removeItem('bn-v2-session');window.dispatchEvent(new StorageEvent('storage',{key:'bn-v2-session'}));});await page.waitForFunction(()=>!window.vigifts&&document.querySelector('#catalogue-auth a'));assert.equal(await page.locator('#app').isVisible(),false);
 assert.deepEqual(errors,[]);results.push({width,layout,recipientLayout,commonPrefill:true,mixedPrefill:true,bulkApiPersisted:true,priceBandPagination:true,singlePriceEdit:true,immediateQuoteNavigation:true,security:{anonymousBlocked:true,expiredBlocked:true,staffIdentity:true,logoutLocked:true},recipientSave:{customer:true,group:true,unassigned:true,cancel:true,escape:true,groupRetry:true,identityGuard:true,quoteWrites},errors});
 }finally{await context.close();await f.client.close();}
}await writeFile(out+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));}finally{await browser.close();await new Promise(r=>server.close(r));}
