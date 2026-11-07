/** Run the real UI/router locally with synthetic order lines; no production credentials/data. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setup} from '../../tests/helpers/pos-fixture.ts';
import {salesOrders,salesOrderLines,deliveries,deliveryLines} from '../../src/modules/sales/schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright'),f=await setup(),now=new Date().toISOString(),today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Ho_Chi_Minh'});
const future=new Date(Date.parse(today+'T12:00:00Z')+3*864e5).toISOString().slice(0,10);
await f.db.insert(salesOrders).values({id:'live-order',orderNo:'LIVE-ORDER',quoteType:'HRC',customerName:'Công ty kiểm thử',ownerId:'emp',createdBy:'emp',warehouseId:'pos-wh',orderDate:today,expectedDeliveryDate:future,contact:'Người nhận mẫu',phone:'0900000000',address:'Địa chỉ kiểm thử',status:'confirmed',subtotal:20000,total:21600,createdAt:now,updatedAt:now});
await f.db.insert(salesOrderLines).values([
 {id:'live-a',orderId:'live-order',lineNo:1,sku:'00123',name:'Ly sứ in xanh',unit:'Cái',qty:10,deliveredQty:3,unitPrice:1000,taxRate:8,amount:10000},
 {id:'live-b',orderId:'live-order',lineNo:2,sku:'00123',name:'Ly sứ in đỏ <b>chữ</b>',unit:'Bộ',qty:5,deliveredQty:0,unitPrice:2000,taxRate:8,amount:10000},
]);
await f.db.insert(deliveries).values({id:'live-trip',deliveryNo:'LIVE-TRIP',orderId:'live-order',plannedDate:future,status:'planned',createdBy:'emp',createdAt:now,updatedAt:now});
await f.db.insert(deliveryLines).values({deliveryId:'live-trip',orderLineId:'live-a',qty:4});
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out='/tmp/live-order-products-browser',writes=[];await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/staff/')){
 const chunks=[];for await(const c of req)chunks.push(c);if(req.method!=='GET')writes.push({path:u.pathname,method:req.method,body:chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined});
 const token=req.headers.authorization?.replace(/^Bearer /,'');const r=await f.call(u.pathname.slice(10)+u.search,token?'__Host-bn-session='+token:'',req.method,chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined);
 res.writeHead(r.status,{'content-type':'application/json','server-timing':'region;desc="ap-northeast-2"'}).end(JSON.stringify(r.data));return;}
 const p=u.pathname==='/'?'/index.html':u.pathname;let b=await readFile(root+p);if(p.endsWith('.html'))b=Buffer.from(b.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.setHeader('content-type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':p.endsWith('.ttf')?'font/ttf':'text/html;charset=utf-8');res.end(b);
}catch(e){res.writeHead(404).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']}),user=(await f.call('/me',f.mgr)).data.user;
try{for(const width of [1440,390]){
 const context=await browser.newContext({viewport:{width,height:1050},locale:'vi-VN'});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 await context.addInitScript(({user,token})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user,token:f.mgr.split('=')[1]});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/#/order-products');
 const view=page.locator('#view-order-products');await view.locator('[data-order-line=live-a]').waitFor();
 assert.equal(await view.locator('tbody tr').count(),2);assert.equal(await view.getByText('Dữ liệu minh họa',{exact:false}).count(),0);
 assert.equal(await view.locator('[data-order-line=live-b] td b').count(),0,'HTML in product name remains text');
 await view.locator('.op-stats button').filter({hasText:'Giao một phần'}).click();await page.waitForFunction(()=>document.querySelectorAll('#view-order-products [data-order-line]').length===1);
 assert.equal(await view.locator('[data-order-line=live-a]').count(),1);
 await view.locator('.op-stats button').filter({hasText:'Cần xử lý'}).click();await view.locator('[data-order-line=live-b]').waitFor();
 await view.locator('.op-panel input[type=search]').fill('ly su do');await page.waitForFunction(()=>document.querySelectorAll('#view-order-products [data-order-line]').length===1&&!!document.querySelector('[data-order-line=live-b]'));
 await view.locator('.op-panel input[type=search]').fill('');await view.locator('[data-order-line=live-a]').waitFor();
 await view.locator('[data-order-line=live-a] .op-actions').getByRole('button',{name:'Chi tiết',exact:true}).click();await page.locator('.op-dialog').waitFor();
 assert.match(await page.locator('.op-dialog').textContent(),/Chưa xếp 3/);assert.match(await page.locator('.op-dialog').textContent(),/LIVE-TRIP/);
 await page.locator('.op-dialog button[aria-label="Đóng chi tiết dòng hàng"]').click();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:out+'/products-'+width+'.png',fullPage:true});
 await view.locator('[data-order-line=live-a] .op-actions').getByRole('button',{name:'Xếp lịch',exact:true}).click();await page.locator('#delivery-dialog').waitFor();
 assert.equal(await page.locator('#delivery-lines input[data-line=live-a]').inputValue(),'3');assert.equal(await page.locator('#delivery-lines input[data-line=live-b]').inputValue(),'');
 assert.equal(page.url().includes('scheduleLine'),false,'one-time intent is consumed');
 if(width===390){
  await page.locator('#delivery-form .modal-foot .btn.primary').click();await page.waitForFunction(()=>!document.querySelector('#delivery-dialog').open);
  const actual=await f.call('/order-products?status=all',f.mgr),line=actual.data.lines.find(l=>l.id==='live-a');
  assert.equal(line.availableQty,0);assert.equal(line.scheduledQty,7);assert.equal(line.trips.length,2);
 }else await page.locator('#delivery-dialog').evaluate(d=>d.close());
 assert.deepEqual(errors,[]);console.log('PASS '+width+'px: real lines, duplicate SKU, filters, detail/trips, no HTML injection or overflow, existing schedule form selects only requested line');await context.close();
}
const deliveriesWrites=writes.filter(x=>x.path==='/api/staff/deliveries'&&x.method==='POST');assert.equal(deliveriesWrites.length,1);assert.deepEqual(deliveriesWrites[0].body.lines,[{orderLineId:'live-a',qty:3}]);
console.log('PASS schedule save: one existing POST, exact line quantity, refreshed facts match DB');
}finally{await browser.close();server.close();await f.client.close();}
