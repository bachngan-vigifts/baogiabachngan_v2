/** Real CRM UI/router/PGlite, synthetic GHN only. Never contacts live CRM/carriers. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {eq} from 'drizzle-orm';
import {setup} from '../../tests/helpers/pos-fixture.ts';
import {deliveries,salesOrders} from '../../src/modules/sales/schema.ts';
import {posRefunds,posReturns} from '../../src/modules/sales/return-schema.ts';
import {stockBalances} from '../../src/modules/inventory/schema.ts';
import {applyGhnStatus} from '../../src/modules/sales/api/pos-ghn-sync.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setup(),shift=await f.open(),user=(await f.call('/me',f.mgr)).data.user,token=f.mgr.split('=')[1],remotes=new Map();
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),dir='/workspace/scratch/manager-ghn-quick-cancel';await mkdir(dir,{recursive:true});
let loseReply=true;const posts=[];
const server=createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname.startsWith('/api/staff/')){
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined;
  const auth=req.headers.authorization?.replace(/^Bearer /,'')||'',path=u.pathname.slice('/api/staff'.length)+u.search;
  if(req.method==='POST'&&path.endsWith('/ghn-quick-cancel'))posts.push(body);
  const r=await f.call(path,auth?'__Host-bn-session='+auth:'',req.method,body);
  if(loseReply&&req.method==='POST'&&path.endsWith('/ghn-quick-cancel')&&r.status===200){loseReply=false;res.writeHead(502,{'content-type':'application/json'}).end(JSON.stringify({error:'Mất phản hồi giả lập sau commit'}));return;}
  res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;
 }
 let data=await readFile(root+(u.pathname==='/'?'index.html':u.pathname.slice(1)));if(u.pathname==='/')data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.setHeader('content-type',u.pathname.endsWith('.js')?'text/javascript':u.pathname.endsWith('.css')?'text/css':'text/html');res.end(data);
}catch(e){res.writeHead(500).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),results=[];
try{
 for(const width of [1280,390]){
  // Create the fixture without carrier credentials; attach synthetic GHN afterwards.
  f.env.ghnToken=undefined;const deposit=width===390?50000:0,code='BROWSER-'+width;
  const sale=await f.call('/pos/checkout',f.emp,'POST',f.cart(shift.id,{fulfillmentMode:'cod',depositAmount:deposit,delivery:{address:'Kho khách',receiverName:'Khách thử',receiverPhone:'0900000000'}}));assert.equal(sale.status,201,JSON.stringify(sale.data));
  const d=(await f.call('/orders/'+sale.data.id,f.mgr)).data,ship=d.deliveries[0];
  await f.db.update(deliveries).set({carrier:'GHN',trackingCode:code,trackingStatus:deposit?'returned':'cancel'}).where(eq(deliveries.id,ship.id));
  if(deposit)await applyGhnStatus(f.env,ship.id,'picked',new Date().toISOString());
  remotes.set(code,{order_code:code,client_order_code:d.order.orderNo,shop_id:6096731,status:deposit?'returned':'cancel'});
  f.env.ghnToken='test-only';f.env.ghnFetch=async(url,init)=>{assert.ok(String(url).endsWith('/detail'));return Response.json({code:200,data:remotes.get(JSON.parse(init.body).order_code)});};
  const context=await browser.newContext({viewport:{width,height:1000}});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
  await context.addInitScript(({token,user})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{token,user});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/#/orders/'+sale.data.id);
  await page.getByRole('button',{name:'Huỷ phiếu nhanh',exact:true}).evaluate(b=>b.click());
  const modal=page.getByRole('dialog',{name:'Huỷ nhanh bill POS',exact:true});await modal.waitFor();
  if(deposit)await modal.getByLabel('Cách đã hoàn tiền cho khách',{exact:true}).selectOption('cash');else assert.equal(await modal.getByLabel('Ca ghi nhận hoàn tiền',{exact:true}).isVisible(),false);
  await modal.getByLabel('Lý do huỷ',{exact:true}).fill('Manager xác nhận GHN kết thúc và xử lý một lần');await modal.getByRole('checkbox').check();
  await modal.screenshot({path:dir+'/confirm-'+width+'.png'});assert.ok(await modal.evaluate(e=>e.scrollWidth<=e.clientWidth+1));
  await modal.getByRole('button',{name:'Xác nhận huỷ nhanh',exact:true}).click();
  if(width===1280){await modal.locator('[role=alert]').filter({hasText:'Mất phản hồi'}).waitFor();await modal.getByRole('button',{name:'Xác nhận huỷ nhanh',exact:true}).click();assert.deepEqual(posts[0],posts[1]);}
  await modal.waitFor({state:'detached'});await page.waitForFunction(()=>!Array.from(document.querySelectorAll('#order-actions button')).some(b=>b.textContent==='Huỷ phiếu nhanh'));
  assert.equal((await f.db.select().from(salesOrders).where(eq(salesOrders.id,sale.data.id)))[0].status,'cancelled');assert.equal((await f.db.select().from(stockBalances))[0].qty,10);
  const refunds=await f.db.select().from(posRefunds),returns=await f.db.select().from(posReturns);assert.equal(returns.filter(r=>r.orderId===sale.data.id).length,1);assert.equal(refunds.length,deposit?1:0);if(deposit)assert.equal(refunds[0].amount,50000);
  assert.deepEqual(errors,[]);results.push({width,carrierStatus:deposit?'returned':'cancel',managerOneAction:true,refund:deposit,stock:10,lostReplyReplay:width===1280});await context.close();
 }
 await writeFile(dir+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}finally{await browser.close();server.close();await f.client.close();}
