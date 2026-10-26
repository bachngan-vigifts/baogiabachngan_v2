/** Four workflows on the real local CRM router/PGlite. No production orders or carrier requests. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {eq,and} from 'drizzle-orm';
import {setupWarehouseOps,makeCrm} from '../../tests/helpers/warehouse-approval-fixture.ts';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';
import {stockBalances,inventoryAdjustments} from '../../src/modules/inventory/schema.ts';
import {deliveries} from '../../src/modules/sales/schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),shots=process.env.OPS_SCREENSHOT_DIR||'/workspace/scratch/warehouse-approval-actions';await mkdir(shots,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
async function clickAction(locator){await locator.waitFor({state:'attached'});await new Promise(r=>setTimeout(r,120));if(!await locator.isVisible())await locator.evaluate(n=>n.closest('[popover]')?.showPopover());await locator.click();}
try{for(const width of [390,1280]){
 const f=await setupWarehouseOps();await postMoves(f.db,'mgr',[{sku:'00123',warehouseId:'pos-wh',qty:532,kind:'opening',refType:'opening',refId:'browser-opening'}]);
 const data=await makeCrm(f,'BROWSER_'+width,300,'00123','pos-wh',true),orderId=data.order.id;
 const trip=await f.call('/deliveries',f.emp,'POST',{orderId,plannedDate:'2026-10-26',lines:[{orderLineId:data.lines[0].id,qty:300}]});assert.equal(trip.status,201,JSON.stringify(trip.data));
 const tripInfo=(await f.call('/deliveries?id='+trip.data.id,f.mgr)).data.deliveries[0];
 const users={};for(const [key,cookie] of Object.entries({mgr:f.mgr,emp:f.emp,sa:f.sa}))users[key]={token:cookie.split('=')[1],user:(await f.call('/me',cookie)).data.user};
 const writes=[];
 const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost'),path=u.pathname;
  if(path.startsWith('/api/staff/')){let body;const chunks=[];for await(const chunk of req)chunks.push(chunk);if(chunks.length)body=JSON.parse(Buffer.concat(chunks).toString());
   if(req.method!=='GET')writes.push({path,body});const token=req.headers.authorization?.replace(/^Bearer /,'')||'',r=await f.call(path.slice('/api/staff'.length)+u.search,token?'__Host-bn-session='+token:'',req.method,body);
   res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;}
  let body=await readFile(root+(path==='/'?'index.html':path));if(path==='/'||path==='/index.html')body=Buffer.from(body.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
  res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':'text/html');res.end(body);
 }catch(e){res.writeHead(500).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const origin='http://127.0.0.1:'+server.address().port,context=await browser.newContext({viewport:{width,height:900},locale:'vi-VN'});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 await context.addInitScript(({token,user})=>{if(!localStorage.getItem('bn-v2-session')){localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));}},users.sa);
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('Browser error:',e.message);});
 const switchRole=async(key,hash)=>{await page.evaluate(({profile,hash})=>{localStorage.setItem('bn-v2-session',profile.token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:profile.token,user:profile.user}));history.replaceState(null,'',hash);},{profile:users[key],hash});await page.reload();};
 const balance=async()=>(await f.db.select().from(stockBalances).where(and(eq(stockBalances.sku,'00123'),eq(stockBalances.warehouseId,'pos-wh'))))[0].qty;
 try{
  await page.goto(origin+'/#/orders/'+orderId);await clickAction(page.locator('[data-progress-action=packing]'));
  const pack=page.locator('#pack-dialog');await pack.waitFor();assert.equal(await pack.locator('.pack-av').textContent(),'542');assert.equal(await pack.locator('[data-wh]').inputValue(),'300');assert.equal(await pack.locator('.pack-warn').isVisible(),false);assert.equal(writes.filter(w=>w.path.endsWith('/packing')).length,0);
  await page.screenshot({path:shots+'/stock-542-'+width+'.png'});await pack.locator('[data-close]').first().click();
  const made=await f.call('/orders/'+orderId+'/packing',f.mgr,'POST',{sendToWarehouse:true,allocations:[{orderLineId:data.lines[0].id,qty:300,source:'warehouse'}]});assert.equal(made.status,201);const slip=made.data.slips[0];
  await page.reload();const exportCard=page.locator('[data-progress-stage=export]');await exportCard.locator('.progress-doc-links a').waitFor();assert.equal(await exportCard.locator('.progress-doc-links a').textContent(),slip.slipNo);await exportCard.locator('.progress-doc-links a').click();await page.waitForFunction(()=>location.hash.startsWith('#/packing/'));await page.locator('#slip-confirm').waitFor();
  assert.equal((await f.call('/packing/'+slip.id+'/confirm',f.mgr,'POST',{warehouseId:'pos-wh',photos:['data:image/jpeg;base64,YW5o']})).status,200);
  await page.evaluate(id=>location.hash='#/orders/'+id,orderId);await page.locator('[data-progress-stage=sample] [data-progress=sample]').waitFor();await page.locator('[data-progress=sample]').click();await page.waitForFunction(()=>document.querySelector('[data-progress-stage=sample]').classList.contains('done'));
  assert.ok((await page.locator('[data-progress-stage=sample]').textContent()).includes('Sale Admin kiểm thử'));assert.equal(await page.locator('[data-progress-stage=export] [data-progress=export]').count(),0);
  await page.locator('[data-progress=production]').click();await page.waitForFunction(()=>document.querySelector('[data-progress-stage=production]').classList.contains('done'));
  assert.equal(await page.locator('[data-progress-stage=delivered] .progress-doc-links a').textContent(),tripInfo.deliveryNo);
  assert.equal(await page.locator('[data-progress-stage=delivered] .progress-doc-links a').getAttribute('href'),'#/deliveries?deliveryId='+encodeURIComponent(trip.data.id));
  await page.screenshot({path:shots+'/progress-links-'+width+'.png'});
  // The responsible employee confirms dispatch, then Sale Admin confirms delivery.
  await switchRole('emp','#/deliveries?deliveryId='+trip.data.id);await clickAction(page.locator('#deliveries-list [data-to=in_transit]'));await page.locator('#deliveries-list .ship-confirmation').waitFor();assert.ok((await page.locator('#deliveries-list .ship-confirmation').textContent()).includes(users.emp.user.name));
  await switchRole('sa','#/deliveries?deliveryId='+trip.data.id);await clickAction(page.locator('#deliveries-list [data-to=delivered]'));await page.locator('.photo-box').waitFor();await clickAction(page.locator('.photo-box [data-act=ok]'));await page.locator('.photo-box').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('#deliveries-list .ship-confirmation')?.textContent.includes('Sale Admin kiểm thử'));
  assert.equal((await f.db.select().from(deliveries).where(eq(deliveries.id,trip.data.id)))[0].confirmedBy,'ops-admin');assert.equal(await balance(),242);await page.screenshot({path:shots+'/delivery-actor-'+width+'.png'});
  // Employee inventory permissions let them request, never post directly.
  await switchRole('emp','#/inventory');await clickAction(page.locator('#view-inventory').getByRole('button',{name:'Phiếu điều chỉnh',exact:true,includeHidden:true}));const drawer=page.locator('#view-inventory .sup-drawer');
  await drawer.getByRole('textbox',{name:'Lý do *',exact:true}).fill('Kiểm kê lệch một cái');await drawer.locator('[placeholder="Mã hàng (SKU)"]').fill('00123');await drawer.locator('.pur-qty').fill('-1');await drawer.getByRole('button',{name:'Gửi Manager duyệt',exact:true}).click();await drawer.waitFor({state:'hidden'});assert.equal(await balance(),242);
  const pending=(await f.call('/inventory/adjustments?status=pending',f.mgr)).data.adjustments[0];assert.equal(pending.status,'pending');
  await switchRole('mgr','#/inventory');await clickAction(page.locator('#view-inventory').getByRole('button',{name:'Xem phiếu '+pending.refNo,exact:true,includeHidden:true}));const review=page.locator('.inv-adjust-review');await review.getByRole('button',{name:'Duyệt và ghi kho',exact:true}).click();await review.waitFor({state:'hidden'});assert.equal(await balance(),241);
  assert.equal((await f.db.select().from(inventoryAdjustments).where(eq(inventoryAdjustments.id,pending.id)))[0].reviewedBy,'mgr');await page.getByRole('combobox',{name:'Trạng thái phiếu điều chỉnh'}).selectOption('approved');await page.locator('.inv-adjust-queue-row').waitFor();await page.screenshot({path:shots+'/adjustment-approved-'+width+'.png'});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({width,ownHold542for300:true,progressLinks:true,saleAdminPrinting:true,ownerAndAdminActors:true,approvalChangesStockOnlyOnce:true,errors}));
 }finally{await context.close();server.close();await f.client.close();}
}}finally{await browser.close();}
