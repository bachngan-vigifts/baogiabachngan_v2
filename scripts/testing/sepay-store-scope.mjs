/** E1 on the actual app/router with synthetic PGlite fixtures; external browser requests are blocked. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {eq} from 'drizzle-orm';
import {setupSepay} from '../../tests/helpers/sepay-fixture.ts';
import {employees,positionPermissions} from '../../src/modules/staff/schema.ts';
import {warehouses} from '../../src/modules/catalog/schema.ts';
import {posRegisters,webStoreOrders} from '../../src/modules/sales/pos-schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setupSepay(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out=process.env.BROWSER_EVIDENCE_DIR||'/tmp/sepay-store-scope';await mkdir(out,{recursive:true});
await f.db.update(warehouses).set({name:'Cửa hàng LocknLock'}).where(eq(warehouses.id,'pos-wh'));
await f.db.insert(warehouses).values({id:'e1-ml',name:'Showroom Minh Long',kind:'stock'});
const [register]=await f.db.select().from(posRegisters).where(eq(posRegisters.id,f.registerId));
await f.db.insert(posRegisters).values({...register,id:'e1-ml-register',name:'Showroom Minh Long',warehouseId:'e1-ml'});
await f.db.insert(webStoreOrders).values([
 {id:'e1-lock',source:'lock',externalId:'101',orderNo:'E1_WEB_LOCK',registerId:f.registerId,status:'processing',total:100000,orderedAt:f.stamp,updatedAt:f.stamp},
 {id:'e1-ml',source:'minhlong',externalId:'202',orderNo:'E1_WEB_ML',registerId:'e1-ml-register',status:'processing',total:100000,orderedAt:f.stamp,updatedAt:f.stamp},
]);
const event=await f.incoming('E1 BANK PROOF',333333);
const server=createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://local');if(u.pathname.startsWith('/api/staff/')){const chunks=[];for await(const c of req)chunks.push(c);const token=req.headers.authorization?.replace(/^Bearer /,'');const r=await f.call(u.pathname.slice(10)+u.search,token?'__Host-bn-session='+token:'',req.method,chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined);res.writeHead(r.status,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify(r.data));return;}
 const path=u.pathname==='/'?'/index.html':u.pathname;let data=await readFile(root+path);if(path==='/index.html')data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));res.writeHead(200,{'content-type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':'text/html'}).end(data);
}catch(e){res.writeHead(500).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']}),results=[];
try{
 for(const role of ['sale-admin','accounting','sales-lock','sales-ml','manager'])for(const width of [390,1280]){
  const cookie=role==='manager'?f.mgr:f.emp;
  if(role!=='manager'){await f.db.update(employees).set({positionId:role}).where(eq(employees.id,'emp'));await f.db.insert(positionPermissions).values(['page.sepay','sepay.reconcile-incoming'].map(permission=>({positionId:role,permission}))).onConflictDoNothing();}
  const user=(await f.call('/me',cookie)).data.user,context=await browser.newContext({viewport:{width,height:900},locale:'vi-VN'});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
  await context.addInitScript(({token,user})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{token:cookie.split('=')[1],user});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/#/sepay?from=2026-11-08&to=2026-11-08');await page.locator(`[data-open="${event.id}"]`).waitFor();
  const unassigned=['sale-admin','accounting'].includes(role);
  if(unassigned){await page.locator('[data-web-scope]').waitFor();assert.match(await page.locator('[data-web-scope]').textContent(),/Chưa được phân cửa hàng \/ cần quyền đối soát toàn công ty/);}
  else assert.equal(await page.locator('[data-web-scope]').isVisible(),false);
  await page.locator(`[data-open="${event.id}"]`).click();await page.locator('[data-order-search]').waitFor();await page.locator('[data-order-search] select[name=source]').selectOption('web');await page.locator('[name=orderQuery]').fill('E1_WEB');
  const loaded=page.waitForResponse(r=>r.url().includes('/sepay/orders?')&&r.url().includes('source=web'));await page.locator('[data-order-search] button[type=submit]').click();await loaded;await page.locator('[data-order-search] button[type=submit]').waitFor({state:'visible'});
  await page.waitForFunction(()=>!document.querySelector('[data-order-search] button[type=submit]')?.disabled);
  const ids=await page.locator('[data-order-results] [data-choose]').evaluateAll(ns=>ns.map(n=>n.dataset.choose).sort());
  const expected=unassigned?[]:role==='manager'?['web:e1-lock','web:e1-ml']:['web:e1-'+(role==='sales-lock'?'lock':'ml')];assert.deepEqual(ids,expected);
  if(unassigned)assert.match(await page.locator('[data-order-results]').textContent(),/Chưa được phân cửa hàng/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
  await page.screenshot({path:`${out}/${role}-${width}.png`,fullPage:true});results.push({role,width,ids,unassigned});await context.close();
 }
 await writeFile(out+'/results.json',JSON.stringify(results,null,2));console.log('PASS',JSON.stringify(results));
}finally{await browser.close();await new Promise(r=>server.close(r));await f.client.close();}
