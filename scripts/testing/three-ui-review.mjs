/** Local router/PGlite and browser only. No production data or integration calls. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setupEarly} from '../../tests/helpers/purchase-early-fixture.ts';
import {products,warehouses} from '../../src/modules/catalog/schema.ts';
import {customers} from '../../src/modules/customers/schema.ts';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const before=process.argv.includes('--before'),stage=before?'before':'after';
const f=await setupEarly(),ok=(r,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};
const now=new Date().toISOString();
await f.db.insert(products).values({sku:'031106000',name:'Tách trà Jasmine',unit:'Cái',updatedAt:now});
await f.db.insert(warehouses).values({id:'receive',name:'KHO NHẬN',kind:'stock'});
await postMoves(f.db,'mgr',[{sku:'031106000',warehouseId:'receive',qty:1,kind:'opening',refType:'opening',refId:'opening'}]);
await f.db.insert(customers).values([
 {id:'short',name:'CHỊ QUYÊN',contact:'CHỊ QUYÊN',phone:'0918868861'},
 {id:'long',name:'CÔNG TY CỔ PHẦN ỨNG DỤNG VÀ PHÁT TRIỂN CÔNG NGHỆ THÔNG TIN',contact:'Học Nguyễn',phone:'0964656682'},
 {id:'no-phone',name:'Khách chưa có số điện thoại',contact:'Anh Minh',phone:''},
].map(c=>({...c,email:'',address:'',search:c.name.toLowerCase(),sourceVersion:0,syncedAt:now})));
async function request(quantity,received,accept=true){
 const r=ok(await f.call('/purchase-early-requests',f.cookies.mgr,'POST',{clientKey:crypto.randomUUID(),pickupDate:'2026-10-28',scope:{supplierId:'a'},lines:[{sku:'031106000',quantity}]}),201);
 const submitted=ok(await f.call('/purchase-early-requests/'+r.id+'/submit',f.cookies.mgr,'POST',{revision:r.request.revision}));
 if(accept)for(const line of submitted.request.lines)ok(await f.call('/purchase-early-request-lines/'+line.id+'/manager-confirm',f.cookies.mgr,'POST',{supplierId:'a'}));
 if(received)ok(await f.call('/purchase-orders/a1/receipts',f.cookies.kho,'POST',{clientKey:crypto.randomUUID(),earlyRequestId:r.id,createSapo:false,receivedDate:'2026-10-28',warehouse:'KHO NHẬN',lines:[{lineId:'line-a1',goodQty:received,damagedQty:0}]}),201);
 return r.id;
}
const pending=await request(20,0,false),partial=await request(24,12),full=await request(52,52);
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),writes=[];
const server=createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname.startsWith('/api/staff/')){
  const path=u.pathname.slice('/api/staff'.length)+u.search,chunks=[];for await(const c of req)chunks.push(c);
  if(req.method!=='GET')writes.push(path);
  const token=req.headers.authorization?.replace(/^Bearer /,''),r=await f.call(path,token?'__Host-bn-session='+token:'',req.method,chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined);
  res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;
 }
 const path=u.pathname==='/'?'/index.html':u.pathname;let data=await readFile(root+path);
 if(path.endsWith('.html'))data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html;charset=utf-8');res.end(data);
}catch(e){res.writeHead(500).end(String(e.message));}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,out='/workspace/scratch/three-ui-review/'+stage;
await mkdir(out,{recursive:true});const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),results=[];
async function session(role,width){
 const context=await browser.newContext({viewport:{width,height:932},locale:'vi-VN',isMobile:width<=850,hasTouch:width<=850});
 await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 const user=ok(await f.call('/me',f.cookies[role])).user;
 await context.addInitScript(({user,token})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({user,session:token}));},{user,token:f.cookies[role].split('=')[1]});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));return {context,page,errors};
}
async function navigate(page,hash){await page.goto(origin+'/'+hash);await page.locator('#workspace').waitFor();}
try{
 for(const width of before?[390,1280]:[360,390,430,768,1280]){
  const {context,page,errors}=await session('mgr',width);await navigate(page,'#/customers');
  await page.locator('#customer-list .crm-list-card').first().waitFor();
  await page.waitForTimeout(150);
  const metrics=await page.locator('#customer-list .crm-list-card').evaluateAll(rows=>rows.map(row=>{const title=row.querySelector('.crm-card-title').getBoundingClientRect(),actions=row.querySelector('.crm-card-actions').getBoundingClientRect();return {height:row.getBoundingClientRect().height,titleTop:title.top,actionsTop:actions.top,actionsLeft:actions.left,titleRight:title.right};}));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await page.screenshot({path:out+'/customers-'+width+'.png'});
  if(!before&&width<=850){for(const m of metrics){assert.ok(Math.abs(m.actionsTop-m.titleTop)<2,'actions align at top');assert.ok(m.actionsLeft>=m.titleRight,'actions occupy right column');}
   assert.equal(await page.locator('[data-href="#/customers/short"] .crm-card-meta').isVisible(),false);
   assert.equal(await page.locator('[data-href="#/customers/long"] .crm-card-meta').isVisible(),true);
   assert.equal(await page.locator('[data-href="#/customers/short"] a[href="tel:0918868861"]').isVisible(),true);
   const nav=page.locator('.crm-mobile-nav');const keys=await nav.locator('>a').evaluateAll(links=>links.map(a=>a.dataset.mobileNav));
   assert.deepEqual(keys.slice(0,5),['pos','quotes','orders','contracts','receivables']);assert.equal(new Set(keys).size,keys.length);
   assert.equal(await nav.locator('button').count(),0);assert.equal(await nav.evaluate(n=>n.scrollWidth>n.clientWidth),true);
   const sourceKeys=await page.locator('.sidebar [data-nav]:not([hidden])').evaluateAll(links=>links.filter(a=>!a.closest('[hidden]')).map(a=>a.dataset.nav));
   assert.deepEqual([...keys].sort(),[...new Set(sourceKeys)].sort());
   await nav.evaluate(n=>n.scrollLeft=0);await page.screenshot({path:out+'/navigation-'+width+'.png'});
   await nav.evaluate(n=>n.scrollLeft=n.scrollWidth);assert.ok(await nav.evaluate(n=>n.scrollLeft>0));
   const menu=nav.locator('[data-mobile-nav=early-requests]');await menu.scrollIntoViewIfNeeded();await menu.click();
  }else await navigate(page,'#/early-requests');
  await page.locator('.early-page-card').first().waitFor();
  const card=id=>page.locator('.early-page-card').filter({has:page.locator('a[href="#/early-requests/'+id+'"]')});
  if(!before){assert.equal(await card(full).locator('.early-received-summary').innerText(),'SL xin 52 · Đã nhận 52');assert.equal(await card(full).locator('.early-status').count(),0);assert.equal(await card(partial).locator('.early-status').innerText(),'NCC đồng ý');assert.equal(await card(pending).locator('.early-status').innerText(),'Chờ NCC xác nhận');}
  await page.screenshot({path:out+'/early-'+width+'.png'});
  if(!before){assert.equal(await card(full).locator('.early-received-summary').evaluate(n=>getComputedStyle(n).color),'rgb(22, 101, 52)');}
  if(!before&&width===1280){assert.equal(await page.locator('.crm-mobile-nav').isVisible(),false);}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  if(!before&&width<=850){await page.locator('.crm-mobile-nav [data-mobile-nav=customers]').click();await page.locator('#customer-list tr').first().waitFor();await page.goBack();await page.locator('.early-page-card').first().waitFor();assert.equal(await page.locator('.crm-mobile-nav [aria-current=page]').getAttribute('data-mobile-nav'),'early-requests');await page.goForward();await page.locator('#customer-list tr').first().waitFor();}
  assert.deepEqual(errors,[]);results.push({width,customerMetrics:metrics,noOverflow:true,errors});await context.close();
 }
 if(!before){
  const customer=await session('mgr',390);await navigate(customer.page,'#/customers');
  const row=customer.page.locator('[data-href="#/customers/short"]');await row.waitFor();
  await row.locator('.mobile-action-trigger').click();await customer.page.locator('.mobile-action-list:popover-open').waitFor();await customer.page.keyboard.press('Escape');
  await row.locator('[data-quote-for]').click();await customer.page.waitForFunction(()=>document.querySelector('#quote-form [name=customer]').value==='CHỊ QUYÊN');
  assert.deepEqual(customer.errors,[]);await customer.context.close();
 }
 if(!before){const s=await session('kho',390);await navigate(s.page,'#/kho');await s.page.locator('.crm-mobile-nav').waitFor();assert.equal(await s.page.locator('.crm-mobile-nav [data-mobile-nav=staff]').count(),0);assert.equal(await s.page.locator('.crm-mobile-nav [data-mobile-nav=permissions]').count(),0);await s.context.close();}
 assert.equal(writes.length,0);await writeFile(out+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));await f.client.close();}
