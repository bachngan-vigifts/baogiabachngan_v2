import {products as catalogProducts} from '../../src/modules/catalog/schema.ts';
/** Real CRM UI and isolated API; synthetic images exercise failure handling. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setup} from '../../tests/helpers/pos-fixture.ts';
import {eq} from 'drizzle-orm';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright'),f=await setup(),writes=[];

const root=new URL('../../trial-ui/',import.meta.url).pathname,out='/tmp/product-thumbnail-regression';await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/staff/')){const chunks=[];for await(const c of req)chunks.push(c);if(req.method!=='GET')writes.push({path:u.pathname,method:req.method});const token=req.headers.authorization?.replace(/^Bearer /,'');const r=await f.call(u.pathname.slice(10)+u.search,token?'__Host-bn-session='+token:'',req.method,chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined);res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;}
 const path=u.pathname==='/'?'/index.html':u.pathname;let bytes=await readFile(root+path);if(path.endsWith('.html'))bytes=Buffer.from(bytes.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':'text/html;charset=utf-8');res.end(bytes);
}catch(e){res.writeHead(404).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']}),user=(await f.call('/me',f.mgr)).data.user,results=[];
async function contextFor(cookie,width){const context=await browser.newContext({viewport:{width,height:1000},locale:'vi-VN'});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());const profile=(await f.call('/me',cookie)).data.user;await context.addInitScript(({user,token})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user:profile,token:cookie.split('=')[1]});return context;}
const source='https://taceqfnsorewelsbdckg.supabase.co/storage/v1/object/public/product-images/regression.png';
await f.db.update(catalogProducts).set({imageUrl:source}).where(eq(catalogProducts.sku,'00123'));await f.open();
try{
 for(const width of [1440,390]){
  const c=await contextFor(f.emp,width),p=await c.newPage(),errors=[],requests=[];p.on('pageerror',e=>errors.push(e.message));
  await c.route('**/storage/v1/**',r=>{const u=new URL(r.request().url());requests.push(u.pathname+u.search);return u.pathname.includes('/product-images/thumbs/')?r.fulfill({status:400,contentType:'application/json',body:'{"error":"Object not found"}'}):r.fulfill({status:200,contentType:'image/png',headers:{'cache-control':'max-age=3600'},body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64')});});
  await p.goto(origin+'/#/products');await p.waitForFunction(source=>{const im=document.querySelector('#product-list img');return im?.src===source&&im.complete&&im.naturalWidth>0;},source);
  const thumb=p.locator('#product-list img');assert.equal(await thumb.getAttribute('decoding'),'async');assert.equal(await thumb.getAttribute('width'),'64');assert.equal(await thumb.getAttribute('height'),'64');
  await p.locator('[data-product-card="00123"]').click();await p.locator('.pd-image').waitFor();assert.equal(await p.locator('.pd-image').getAttribute('src'),source,'detail keeps original high-resolution source');
  await p.goto(origin+'/#/pos');await p.waitForFunction(source=>{const im=document.querySelector('.pos-product img');return im?.src===source&&im.complete&&im.naturalWidth>0;},source);
  assert.equal(await p.locator('.pos-product img').getAttribute('decoding'),'async');await p.evaluate(()=>window.__image=document.querySelector('.pos-product img'));
  await p.locator('.pos-filter-toggle').click();await p.locator('.pos-product-filters [data-filter=all]').click();assert.equal(await p.evaluate(()=>window.__image===document.querySelector('.pos-product img')),true);
  assert.equal(requests.filter(x=>x.includes('/product-images/thumbs/128/regression.png.webp')).length,1);assert.equal(requests.filter(x=>x.includes('/product-images/thumbs/320/regression.png.webp')).length,1);assert.equal(requests.some(x=>x.includes('/render/image/')),false,'không gọi dịch vụ thu nhỏ ảnh tính phí');assert.deepEqual(errors,[]);
  results.push({width,fallbackOnce:true,originalDetail:true,retainsImage:true,errors});await c.close();
 }
 assert.equal(writes.length,0);await writeFile(out+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}finally{await browser.close();await new Promise(r=>server.close(r));await f.client.close();}
