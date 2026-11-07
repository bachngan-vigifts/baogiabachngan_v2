/** Real app prototype UI, isolated API, synthetic data only. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setup} from '../../tests/helpers/pos-fixture.ts';
import {eq} from 'drizzle-orm';
import {employees} from '../../src/modules/staff/schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright'),f=await setup(),writes=[];
await f.db.update(employees).set({positionId:'sale'}).where(eq(employees.id,'emp'));
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out='/tmp/order-view-permissions-browser';await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/staff/')){const chunks=[];for await(const c of req)chunks.push(c);if(req.method!=='GET')writes.push({path:u.pathname,method:req.method});const token=req.headers.authorization?.replace(/^Bearer /,'');const r=await f.call(u.pathname.slice(10)+u.search,token?'__Host-bn-session='+token:'',req.method,chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined);res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;}
 const path=u.pathname==='/'?'/index.html':u.pathname;let bytes=await readFile(root+path);if(path.endsWith('.html'))bytes=Buffer.from(bytes.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':'text/html;charset=utf-8');res.end(bytes);
}catch(e){res.writeHead(404).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']}),user=(await f.call('/me',f.mgr)).data.user,results=[];
async function contextFor(cookie,width){const context=await browser.newContext({viewport:{width,height:1000},locale:'vi-VN'});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());const profile=(await f.call('/me',cookie)).data.user;await context.addInitScript(({user,token})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user:profile,token:cookie.split('=')[1]});return context;}
try{
 const manager=await contextFor(f.mgr,1440),page=await manager.newPage(),managerErrors=[];page.on('pageerror',e=>managerErrors.push(e.message));await page.goto(origin+'/#/permissions');const root=page.locator('#view-permissions');
 const products=root.getByRole('checkbox',{name:'Sản phẩm theo đơn – Sale',exact:true}),calendar=root.getByRole('checkbox',{name:'Lịch giao hàng – Sale',exact:true});await products.waitFor();assert.equal(await products.isChecked(),true);assert.equal(await calendar.isChecked(),true);
 async function save(){await root.getByRole('button',{name:'Lưu thay đổi (1)',exact:true}).click();await page.waitForFunction(()=>[...document.querySelectorAll('#view-permissions button')].some(b=>b.textContent==='Lưu thay đổi'&&b.disabled));}
 await products.uncheck();await save();let current=(await f.call('/me',f.emp)).data.user.perms;assert.equal(current.includes('page.order-products'),false);assert.equal(current.includes('page.deliveries'),true);
 await products.check();await calendar.uncheck();await save();current=(await f.call('/me',f.emp)).data.user.perms;assert.equal(current.includes('page.order-products'),true);assert.equal(current.includes('page.deliveries'),false);
 assert.deepEqual(managerErrors,[]);await page.screenshot({path:out+'/manager-matrix.png'});await manager.close();results.push({managerSavedIndependentSwitches:true});
 for(const width of [1440,390])for(const scenario of ['products','deliveries','orders','neither']){
  const perms=scenario==='products'?['page.order-products']:scenario==='deliveries'?['page.deliveries']:scenario==='orders'?['page.orders']:[];assert.equal((await f.call('/permissions/positions/sale',f.mgr,'PUT',{perms})).status,200);
  const context=await contextFor(f.emp,width),p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  const denied=async(hash)=>{await p.goto(origin+'/'+hash);await p.waitForFunction(hash=>!location.hash.startsWith(hash),hash);};
  if(scenario==='products'){await p.goto(origin+'/#/order-products');await p.locator('#view-order-products .od-table').waitFor();assert.equal(await p.locator('#view-order-products a[href^="#/deliveries"]').count(),0);await p.screenshot({path:out+'/'+width+'-products.png'});await denied('#/deliveries');await denied('#/orders');}
  else if(scenario==='deliveries'){await p.goto(origin+'/#/deliveries?view=calendar');await p.locator('#deliveries-calendar:not([aria-busy])').waitFor();await p.locator('#deliveries-calendar .dc-grid').waitFor();assert.equal(await p.locator('#view-deliveries').isVisible(),true);await p.screenshot({path:out+'/'+width+'-deliveries.png'});await denied('#/order-products');}
  else{await denied('#/order-products');await denied('#/deliveries');}
  assert.equal(await p.locator('.sidebar [data-nav="order-products"]').evaluate(n=>!n.hidden),scenario==='products');assert.equal(await p.locator('.sidebar [data-nav="deliveries"]').evaluate(n=>!n.hidden),scenario==='deliveries');
  assert.deepEqual(errors,[]);results.push({width,scenario,routeGuard:true,independentMenu:true,errors});await context.close();
 }
 await f.db.update(employees).set({positionId:'warehouse'}).where(eq(employees.id,'emp'));
 assert.equal((await f.call('/permissions/positions/warehouse',f.mgr,'PUT',{perms:['page.order-products']})).status,200);
 const wh=await contextFor(f.emp,390),wp=await wh.newPage(),whErrors=[];wp.on('pageerror',e=>whErrors.push(e.message));await wp.goto(origin+'/#/order-products');await wp.locator('#view-order-products .od-table').waitFor();assert.equal(await wp.locator('.sidebar [data-nav="order-products"]').evaluate(n=>!n.hidden),true);assert.deepEqual(whErrors,[]);await wh.close();results.push({warehouseCanBeGrantedProductPage:true,errors:whErrors});
 assert.equal(writes.length,2);assert.ok(writes.every(w=>w.path==='/api/staff/permissions/positions/sale'&&w.method==='PUT'));
 await writeFile(out+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}finally{await browser.close();await new Promise(r=>server.close(r));await f.client.close();}
