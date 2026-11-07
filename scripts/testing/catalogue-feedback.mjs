/** Synthetic-only browser regression for staff catalogue feedback. No production requests. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const base=resolve('trial-ui/catalogue'),server=createServer(async(req,res)=>{try{const name=req.url==='/'?'test.html':req.url.split('?')[0].slice(1);if(name==='test.html'){res.setHeader('Content-Type','text/html');res.end('<html lang="vi"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body><main id="test"></main></body></html>');return;}const path=resolve(base,name);if(!path.startsWith(base+'/'))throw Error();res.setHeader('Content-Type',name.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(path));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{for(const width of [1440,390]){
 const page=await browser.newPage({viewport:{width,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
 await page.evaluate(async()=>{
  const {createSharedLibrary}=await import('/shared-library.js');
  const id='a'.repeat(64),product={id:'shared-client',name:'Bộ trà kiểm thử',brand:'Bát Tràng',category:'Bộ trà',sku:'TEST-TEA',regular:100000,priceOnRequest:false,url:'https://example.test/products/tea'},row={id,revision:1,product};
  const local={...product,id:'pending-client',name:'Sản phẩm chờ chia sẻ',sku:'PENDING',url:'https://example.test/products/pending'};
  let account='test-session',products=[local],pricePending=[],rows=[row];const calls={list:0,stock:0,archive:0,put:0};const timers=[];window.setInterval=fn=>{timers.push(fn);return timers.length;};
  const stock=()=>[{sku:'TEST-TEA',unit:'Bộ',available:12,heldTotal:0,incoming:{qty:0,orders:[]},supplier:null,warehouses:[{name:'Kho kiểm thử',source:'ledger',onHand:12,held:0,available:12}],checkedAt:new Date().toISOString()}];
  const api=async(path,method='GET',body)=>{
   if(path.startsWith('api/library-stock')){calls.stock++;return{stock:stock()};}
   if(path==='api/library-bulk'){calls.archive++;assertLocal(body.items.length===1&&body.items[0].id===id,'archive must exclude pending local');rows=[];return{action:'archive',count:1};}
   if(method==='PUT'){calls.put++;row.revision++;row.product=body.product;return row;}
   if(method==='POST'){return{products:[{...row,clientId:'pending-client',priceConflict:{incoming:{regular:0,priceOnRequest:true,fromPrice:false}}}],errors:[]};}
   calls.list++;return{products:structuredClone(rows),total:rows.length,memberId:'employee-test',facets:{brand:['Bát Tràng'],category:['Bộ trà']}};
  };
  function assertLocal(ok,message){if(!ok)throw Error(message);}
  const lib=createSharedLibrary({api,identity:()=>account,getProducts:()=>products,getSelected:()=>[],priceOf:p=>p.regular,getPricing:()=>({lockDiscount:0,minhDiscount:0,fee:0}),onPick:()=>{},onPickMany:()=>{},onPublished:()=>{},pin:()=>{},pending:async()=>[],savePending:async()=>{},removePending:async()=>{},getBulkPending:async()=>null,putBulkPending:async()=>{},getPricePending:async()=>pricePending,putPricePending:async(_owner,value)=>{pricePending=value;},toast:()=>{}});
  // Do not publish local fixture during the rendering checks.
  const realTimeout=window.setTimeout;window.setTimeout=(fn,delay,...args)=>delay===500?0:realTimeout(fn,delay,...args);
  lib.mount(document.querySelector('#test'));window.fixture={lib,calls,row,timers,setAccount:value=>{account=value;},getPrices:()=>pricePending};
 });
 await page.waitForSelector('[data-library-id]');
 await page.locator('[data-lib-details]').first().locator('summary').first().click();await page.waitForSelector('.library-stock details');
 await page.locator('.library-stock details summary').first().click();
 const counts=await page.evaluate(()=>({...fixture.calls}));assert.equal(counts.stock,1);
 // Focus refreshes while cache is fresh must preserve the same card and both disclosure levels.
 await page.evaluate(()=>{window.cardBefore=document.querySelector('[data-library-id]');window.dispatchEvent(new Event('focus'));});
 await page.waitForTimeout(100);
 assert.equal(await page.evaluate(()=>window.cardBefore===document.querySelector('[data-library-id]')),true);
 assert.equal(await page.locator('.library-stock details[open]').count(),1);
 assert.equal((await page.evaluate(()=>fixture.calls.stock)),1);
 // Force the automatic stale-list poll without waiting a minute.
 await page.evaluate(async()=>{const original=Date.now;Date.now=()=>original()+61000;fixture.timers[0]();await new Promise(r=>setTimeout(r,50));Date.now=original;});
 assert.equal(await page.evaluate(()=>window.cardBefore===document.querySelector('[data-library-id]')),true);
 assert.equal(await page.locator('.library-stock details[open]').count(),1);assert.equal(await page.evaluate(()=>fixture.calls.stock),2);
 await page.locator('[data-lib-all]').check();assert.equal(await page.locator('[data-bulk=archive]').isDisabled(),true);
 await page.locator('[data-bulk=shared-only]').click();assert.equal(await page.locator('[data-bulk=archive]').isEnabled(),true);
 await page.locator('[data-bulk=archive]').click();await page.locator('dialog[open] button[type=submit]').click();
 await page.waitForFunction(()=>fixture.calls.archive===1);assert.equal(await page.locator('[data-library-id^="local:"]').count(),1);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'horizontal overflow');
 await page.screenshot({path:'/tmp/catalogue-feedback-'+width+'.png',fullPage:true});
 // Separate explicit price review exercises acceptance, persistence, keep and identity isolation.
 await page.evaluate(async()=>{
  const {createLibraryPriceReview}=await import('/library-price-review.js');let who='session-a',member='employee-a',saved=[],puts=0,fail='',keys=[];const current={id:'b'.repeat(64),revision:1,product:{name:'Sản phẩm giá liên hệ',regular:546000,priceOnRequest:false},priceConflict:{incoming:{regular:0,priceOnRequest:true,fromPrice:false}}};
  const review=createLibraryPriceReview({api:async(_path,method='GET',body)=>{if(method==='PUT'){keys.push(body.clientKey);if(fail){const error=Error(fail);error.status=fail==='revision conflict'?409:503;fail='';throw error;}puts++;if(body.product.priceOnRequest!==true)throw Error('wrong contact price');}if(method==='GET')return{...current,revision:2};return{};},identity:()=>who,getMember:()=>member,getPending:async()=>saved,putPending:async(_member,items)=>{saved=items;},refresh:async()=>{},toast:()=>{}});
  const render=()=>{document.querySelector('#test').innerHTML=review.html();};review.mount(render);await review.load(member);await review.record([current]);document.querySelector('#test').onclick=e=>review.click(e);
  window.priceFixture={review,current,get:()=>({saved,puts,keys}),failNext:value=>{fail=value;},switchAccount:()=>{who='session-b';member='employee-b';review.reset();render();}};
 });
 await page.locator('[data-price-review]').click();assert.match(await page.locator('dialog[open]').innerText(),/546.000/);
 await page.locator('dialog[open] [data-keep]').click();await page.waitForFunction(()=>priceFixture.get().saved.length===0);assert.equal(await page.evaluate(()=>priceFixture.get().puts),0);
 await page.evaluate(async()=>{await priceFixture.review.record([priceFixture.current]);priceFixture.failNext('revision conflict');});await page.locator('[data-price-review]').click();await page.locator('dialog[open] [type=submit]').click();await page.waitForFunction(()=>document.querySelector('dialog[open] .error')?.textContent.includes('revision conflict'));assert.equal(await page.evaluate(()=>priceFixture.get().saved.length),1);await page.locator('dialog[open] [data-reload]').click();await page.waitForFunction(()=>priceFixture.get().saved[0]?.revision===2);await page.evaluate(()=>priceFixture.failNext('connection lost'));await page.locator('dialog[open] [type=submit]').click();await page.waitForFunction(()=>document.querySelector('dialog[open] .error')?.textContent.includes('connection lost'));await page.locator('dialog[open] [type=submit]').click();await page.waitForFunction(()=>priceFixture.get().puts===1&&priceFixture.get().saved.length===0);assert.equal(await page.evaluate(()=>priceFixture.get().keys[1]===priceFixture.get().keys[2]),true,'retry keeps durable clientKey');
 await page.evaluate(async()=>{await priceFixture.review.record([priceFixture.current]);priceFixture.switchAccount();});assert.equal(await page.locator('[data-price-review]').count(),0);
 assert.deepEqual(errors,[]);await page.close();console.log('PASS catalogue feedback',width);
}}finally{await browser.close();server.close();}
