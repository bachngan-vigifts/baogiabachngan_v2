/** Real catalogue UI/API fixture + existing public Storage images, GET only upstream.
 * PRODUCT_IMAGE_SAMPLES: JSON array of up to 60 existing public product image URLs.
 * UI_BASELINE=1 serves committed catalogue files to measure before the change.
 * Never writes production records or Storage objects. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setupWarehouseWork} from '../../tests/helpers/warehouse-work-fixture.ts';
import {libraryProxy} from '../../catalogue-server/library.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright'),f=await setupWarehouseWork();
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out=process.env.BROWSER_EVIDENCE_DIR||'/tmp/catalogue-product-images-'+(process.env.UI_BASELINE?'before':'after');await mkdir(out,{recursive:true});
const samples=JSON.parse(await readFile(process.env.PRODUCT_IMAGE_SAMPLES,'utf8')).slice(0,12),storageOrigin='https://taceqfnsorewelsbdckg.supabase.co';
assert.ok(samples.length>0);assert.ok(samples.every(s=>s.startsWith(storageOrigin+'/storage/v1/object/public/product-images/')&&!new URL(s).searchParams.has('token')));
const products=Array.from({length:60},(_,i)=>({clientId:'thumbnail-'+i,product:{name:'Sản phẩm kiểm thử '+String(i).padStart(2,'0'),sku:'THUMB-'+i,brand:'Minh Long',category:'Bộ trà',regular:100000,image:samples[i%samples.length],url:'https://minhlongonline.com/san-pham/test-'+i}}));
for(let i=0;i<products.length;i+=20){const r=await f.call('/catalogue-library',f.cookies.mgr,'POST',{products:products.slice(i,i+20)});assert.equal(r.status,200,JSON.stringify(r.data));}
const baseline=new Map(process.env.UI_BASELINE?['app.js','shared-library.js','style.css'].map(p=>['/catalogue/'+p,execFileSync('git',['show','HEAD:trial-ui/catalogue/'+p])]):[]);
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://local');
 if(u.pathname.startsWith('/catalogue/api/')){assert.equal(req.method,'GET','browser must not write');const answer=await libraryProxy(new Request('https://crm.minhlongonline.com'+req.url,{headers:req.headers}),async(url,init)=>{assert.equal(init.method,'GET');const v=new URL(url),r=await f.call(v.pathname.replace('/functions/v1/baogia-v2-api/api/staff','')+v.search,f.cookies.mgr);return Response.json(r.data,{status:r.status});});res.writeHead(answer.status,{'content-type':'application/json'}).end(Buffer.from(await answer.arrayBuffer()));return;}
 const path=u.pathname.endsWith('/')?u.pathname+'index.html':u.pathname,data=baseline.get(path)||await readFile(root+path);res.writeHead(200,{'content-type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.html')?'text/html':path.endsWith('.ttf')?'font/ttf':'application/octet-stream'}).end(data);
 }catch(e){res.writeHead(500).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox'],...(process.env.HTTPS_PROXY?{proxy:{server:process.env.HTTPS_PROXY,bypass:'127.0.0.1,localhost'}}:{})}),results=[];
try{for(const width of process.env.VIEWPORT_WIDTH?[Number(process.env.VIEWPORT_WIDTH)]:[1440,390]){
 const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width,height:1000}}),network=[],errors=[];
 await context.addInitScript(token=>{localStorage.setItem('bn-v2-session',token);window.__images={lcp:0,cls:0,shifts:[]};new PerformanceObserver(l=>{for(const e of l.getEntries())window.__images.lcp=e.startTime;}).observe({type:'largest-contentful-paint',buffered:true});new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput){window.__images.cls+=e.value;window.__images.shifts.push({value:e.value,sources:e.sources.map(s=>({node:s.node?.id||s.node?.className||s.node?.tagName,previous:s.previousRect.toJSON(),current:s.currentRect.toJSON()}))});}}).observe({type:'layout-shift',buffered:true});},f.cookies.mgr.split('=')[1]);
 await context.route('**/*',async r=>{const req=r.request(),u=new URL(req.url());assert.equal(req.method(),'GET','no upstream writes');
  if(u.origin===base&&u.pathname==='/catalogue/api/external-image'){const source=u.searchParams.get('url');assert.ok(samples.includes(source));const start=Date.now(),response=await r.fetch({url:source}),body=await response.body();network.push({kind:'original-proxy',url:source,status:response.status(),bytes:body.length,ms:Date.now()-start});return r.fulfill({response,body});}
  if(u.origin===base||u.origin===storageOrigin&&u.pathname.startsWith('/storage/v1/object/public/product-images/thumbs/'))return r.continue();
  if(u.origin===storageOrigin&&u.pathname.startsWith('/storage/v1/object/public/product-images/')){network.push({kind:'unexpected-original',url:req.url()});return r.continue();}
  return r.abort();
 });
 const page=await context.newPage(),downloads=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',response=>{if(response.url().startsWith(storageOrigin+'/storage/v1/object/public/product-images/thumbs/')){const start=Date.now();downloads.push((async()=>{try{const body=await response.body();network.push({kind:'thumbnail',url:response.url(),status:response.status(),bytes:body.length,bodyWaitMs:Date.now()-start});}catch{/* Navigating away may cancel offscreen images after initial measurements. */}})());}});
 await page.goto(base+'/catalogue/');await page.waitForFunction(()=>window.vigifts);await page.locator('[data-action="nav"][data-view="products"]').click();await page.locator('.library-grid img').first().waitFor();await page.waitForTimeout(1500);await Promise.all(downloads);
 const beforeScroll={requests:network.length,assigned:await page.locator('.library-grid img[src]').count(),pictureHeight:(await page.locator('.library-picture').first().boundingBox()).height};
 // On narrow screens the filter form fills the viewport. No image should be
 // required to load before the user scrolls down to the actual grid.
 await page.locator('.library-grid img').first().scrollIntoViewIfNeeded();await page.waitForFunction(()=>{const im=document.querySelector('.library-grid img');return im?.complete&&im.naturalWidth>0;});await page.waitForTimeout(1500);await Promise.all(downloads);
 const initial=[...network],dom=await page.locator('.library-grid img').evaluateAll(ns=>({total:ns.length,assigned:ns.filter(n=>n.getAttribute('src')).length,lazy:ns.every(n=>n.loading==='lazy'),async:ns.every(n=>n.decoding==='async'),dimensions:ns.every(n=>n.width>0&&n.height>0)})),metrics=await page.evaluate(()=>window.__images);await page.screenshot({path:out+'/'+width+'.png'});
 if(!process.env.UI_BASELINE){assert.equal((await page.locator('.library-picture').first().boundingBox()).height,beforeScroll.pictureHeight,'picture area must not jump when lazy source loads');assert.ok(initial.length>0&&initial.every(r=>r.kind==='transform'&&r.status===200),'thumbnails must successfully use real transforms only');assert.ok(dom.assigned<dom.total,'offscreen images must wait');assert.ok(dom.lazy&&dom.async&&dom.dimensions);await page.locator('.library-grid img').last().scrollIntoViewIfNeeded();await page.waitForFunction(()=>{const ns=document.querySelectorAll('.library-grid img'),im=ns[ns.length-1];return im.complete&&im.naturalWidth>0;});
  await page.locator('.library-grid details summary').first().click();await page.locator('[data-lib="pick"]').first().click();await page.locator('[data-action="nav"][data-view="quote"]').click();
  const mini=page.locator('.selection img.mini-photo');await mini.waitFor();assert.match(await mini.getAttribute('src'),/render\/image\/public\/.*width=128/,'selected list uses a small variant');
  await page.locator('.selection [data-action="edit"]').first().click();const detail=page.locator('#upload-box img');await detail.waitFor();assert.ok(samples.includes(new URL(await detail.getAttribute('src')).searchParams.get('url')),'editing/detail keeps original file');await page.waitForFunction(()=>{const im=document.querySelector('#upload-box img');return im.complete&&im.naturalWidth>0;});await page.locator('[data-action="close-modal"]').first().click();
 }
 assert.deepEqual(errors,[]);results.push({width,beforeScroll,...dom,imageRequests:initial.length,imageBytes:initial.reduce((n,r)=>n+r.bytes,0),requests:initial,metrics,errors});console.log(JSON.stringify({width,beforeScroll,transformsVerified:!process.env.UI_BASELINE}));await Promise.all(downloads);await context.unrouteAll({behavior:'wait'});await context.close();
}await writeFile(out+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results.map(({requests,...r})=>r)));}finally{await browser.close();await new Promise(r=>server.close(r));await f.client.close();}
