/** Real local router/PGlite: staff request/receive, Manager approve/refund. No production or external calls. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {eq,sql} from 'drizzle-orm';
import {salesOrders,deliveries,deliveryLines} from '../../src/modules/sales/schema.ts';
import {stockMoves} from '../../src/modules/inventory/schema.ts';
import {setupCrmReturns} from '../../tests/helpers/crm-return-fixture.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setupCrmReturns(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url));
const server=createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/staff/')){
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined,token=req.headers.authorization?.replace(/^Bearer /,''),r=await f.call(u.pathname.slice('/api/staff'.length)+u.search,token?'__Host-bn-session='+token:'',req.method,body);res.writeHead(r.status,{'content-type':'application/json','server-timing':'local;dur=1'}).end(JSON.stringify(r.data));return;
 }
 const path=u.pathname==='/'?'/index.html':u.pathname;let data=await readFile(root+path);if(path.endsWith('.html'))data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':'text/html;charset=utf-8');res.end(data);
}catch(e){res.writeHead(500).end(String(e.message));}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),out='/workspace/scratch/order-return-summary',results=[];await mkdir(out,{recursive:true});

try{
 const id='browser-historical-return';await f.seed(id,0,'emp',false);
 await f.db.update(salesOrders).set({createdAt:'2026-10-14T01:00:00Z'}).where(eq(salesOrders.id,id));
 await f.db.insert(deliveries).values({id:'history-trip',deliveryNo:'GH-LOCAL-HISTORY',orderId:id,plannedDate:'2026-10-14',deliveredAt:'2026-10-15',status:'delivered',createdBy:'mgr',createdAt:'2026-10-14T01:00:00Z',updatedAt:'2026-10-15T01:00:00Z'});
 await f.db.insert(deliveryLines).values([{deliveryId:'history-trip',orderLineId:id+'-a',qty:2},{deliveryId:'history-trip',orderLineId:id+'-b',qty:2}]);
 for(const sku of ['09566','22566'])await f.db.insert(stockMoves).values({id:'opening-'+sku,sku,warehouseId:'pos-wh',qty:100,kind:'opening',refType:'opening',refId:'opening-'+sku,createdBy:'mgr',createdAt:'2026-10-18T15:43:50Z'});
 const made=await f.create(id,[{orderLineId:id+'-a',qty:1,disposition:'restock'},{orderLineId:id+'-b',qty:1,disposition:'restock'}]);
 f.ok(await f.call(`/orders/${id}/returns/${made.data.id}/approve`,f.mgr,'POST',{stockBasis:{kind:'pre_opening',note:'Đối chiếu giao trước chốt tồn; kiểm tra thực nhận hàng hoàn'}}));
 f.ok(await f.call(`/orders/${id}/returns/${made.data.id}/receive`,f.emp,'POST',{confirmed:true}));
 const before=await f.db.select({n:sql`count(*)`,qty:sql`sum(${stockMoves.qty})`}).from(stockMoves);
 for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:950},locale:'vi-VN'});
  await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
  const user=f.ok(await f.call('/me',f.emp)).user;
  await context.addInitScript(({user,token})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user,token:f.emp.split('=')[1]});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/#/orders/'+id);
  await page.locator('.order-return-history').waitFor();
  const status=await page.locator('#order-status').innerText();
  assert.match(status,/Đã giao/);assert.match(status,/Đã nhận hoàn một phần/);assert.match(status,/Cần đối soát xuất kho/);
  const stage=await page.locator('[data-progress-stage="delivered"]').innerText();assert.match(stage,/Đã ghi nhận giao hàng/);assert.doesNotMatch(stage,/Chưa tới/);
  assert.equal(await page.locator('[data-progress-stage="export"]').evaluate(n=>n.classList.contains('done')),false);
  const rows=await page.locator('#order-lines tr').evaluateAll(rows=>rows.map(r=>[...r.children].slice(1,6).map(n=>n.textContent)));
  assert.deepEqual(rows,[['2','2','1','1','1'],['2','2','1','1','1']]);
  if(width<600){assert.match(await page.locator('#order-lines tr').first().locator('td').nth(3).evaluate(n=>getComputedStyle(n,'::before').content),/Đã nhận hoàn/);}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  assert.match(await page.locator('.order-return-history').innerText(),/nhận hoàn 1 Bộ · nhập lại kho 1 Bộ/);
  await page.locator('#order-lines').scrollIntoViewIfNeeded();await page.waitForTimeout(300);assert.equal(await page.locator('#order-lines tr td:first-child a').count(),2);await page.screenshot({path:out+'/summary-'+width+'.png'});
  await page.locator('.order-return-history a').click();await page.locator('.pos-return-modal[open]').waitFor();
  assert.match(await page.locator('.pos-return-modal[open]').innerText(),new RegExp(made.data.returnNo));
  await page.locator('.pos-return-modal[open]').getByRole('button',{name:'Đóng',exact:true}).click();
  assert.deepEqual(errors,[]);results.push({width,status,stage,rows,returnDetailOpens:true,errors});await context.close();
 }
 assert.deepEqual(await f.db.select({n:sql`count(*)`,qty:sql`sum(${stockMoves.qty})`}).from(stockMoves),before);
 console.log(JSON.stringify({results,readOnlyStockUnchanged:true}));
}finally{await writeFile(out+'/results.json',JSON.stringify(results,null,2));await browser.close();server.close();await f.client.close();}
