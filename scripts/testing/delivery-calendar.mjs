/** Local browser regression against the real app/router; synthetic data only. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setup} from '../../tests/helpers/pos-fixture.ts';
import {salesOrders,salesOrderLines,deliveries,deliveryLines} from '../../src/modules/sales/schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setup(), today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Ho_Chi_Minh'}),now=new Date().toISOString();
await f.db.insert(salesOrders).values({id:'calendar-order',orderNo:'CAL-DEMO',quoteType:'HRC',customerName:'Công ty minh họa',ownerId:'emp',createdBy:'emp',orderDate:today,status:'confirmed',createdAt:now,updatedAt:now});
await f.db.insert(salesOrderLines).values({id:'calendar-line',orderId:'calendar-order',lineNo:1,sku:'CAL-SKU',name:'Ly kiểm thử <b>nội dung</b> – thông tin sản phẩm rất dài, in logo và đóng hộp riêng theo yêu cầu của khách hàng doanh nghiệp',unit:'Cái',qty:10,unitPrice:1000,taxRate:8,amount:10000});
for(const [i,status] of ['planned','in_transit','delivered','cancelled'].entries()){
 await f.db.insert(deliveries).values({id:'calendar-'+i,deliveryNo:'CAL-'+i,orderId:'calendar-order',plannedDate:today,timeSlot:'09:00',receiverName:'Người nhận minh họa',receiverPhone:'0900000000',address:i%2?'Cần Thơ':'Sóc Trăng',carrier:'Tự giao',status,createdBy:'emp',createdAt:now,updatedAt:now});
 await f.db.insert(deliveryLines).values({deliveryId:'calendar-'+i,orderLineId:'calendar-line',qty:1});
}
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out='/tmp/delivery-calendar-browser',writes=[];
await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/staff/')){
 const chunks=[];for await(const c of req)chunks.push(c);if(req.method!=='GET')writes.push({path:u.pathname,method:req.method});
 const token=req.headers.authorization?.replace(/^Bearer /,'');const r=await f.call(u.pathname.slice(10)+u.search,token?'__Host-bn-session='+token:'',req.method,chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined);
 res.writeHead(r.status,{'content-type':'application/json','server-timing':'region;desc="ap-northeast-2"'}).end(JSON.stringify(r.data));return;}
 const p=u.pathname==='/'?'/index.html':u.pathname;let b=await readFile(root+p);if(p.endsWith('.html'))b=Buffer.from(b.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.setHeader('content-type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':p.endsWith('.ttf')?'font/ttf':'text/html;charset=utf-8');res.end(b);
}catch(e){res.writeHead(404).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']}),user=(await f.call('/me',f.mgr)).data.user;
try{for(const width of [1440,390]){
 const context=await browser.newContext({viewport:{width,height:1050},locale:'vi-VN'});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 await context.addInitScript(({user,token})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user,token:f.mgr.split('=')[1]});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/#/deliveries');
 const view=page.locator('#view-deliveries');await view.locator('.dc-grid').waitFor();
 await page.waitForFunction(()=>document.querySelector('#deliveries-filter-summary').textContent.startsWith('4 chuyến'));
 assert.equal(await view.getByText('Lịch mẫu',{exact:true}).count(),0);assert.equal(await view.locator('.dc-grid>.dc-day').count(),42);
 assert.equal(await view.locator('#deliveries-status [data-status=cancelled]').isVisible(),true,'cancelled is a filter, not a delete action');
 await view.locator('.dc-event').first().click();await page.locator('.delivery-calendar-dialog').waitFor();assert.equal(await page.locator('.delivery-calendar-dialog li b').count(),0,'product name remains text');
 await page.locator('.delivery-calendar-dialog button[aria-label="Đóng chi tiết chuyến giao"]').click();
 await view.locator('.delivery-advanced-filters summary').click();await view.locator('#deliveries-product').fill('NOT-FOUND');
 await page.waitForFunction(()=>document.querySelector('#deliveries-filter-summary').textContent.startsWith('0 chuyến'));
 assert.equal(await view.locator('.dc-event').count(),0);
 await view.locator('#deliveries-clear').click();await page.waitForFunction(()=>document.querySelector('#deliveries-filter-summary').textContent.startsWith('4 chuyến'));
 await view.locator('#deliveries-address').fill('Sóc Trăng');await page.waitForFunction(()=>document.querySelector('#deliveries-filter-summary').textContent.startsWith('2 chuyến'));
 await view.locator('#deliveries-clear').click();await page.waitForFunction(()=>document.querySelector('#deliveries-filter-summary').textContent.startsWith('4 chuyến'));
 await view.locator('.delivery-advanced-filters summary').click();
 for(const [label,n] of [['Tuần',7],['Ngày',1],['Tháng',42]]){
  await view.locator('.dc-tools').getByRole('button',{name:label,exact:true}).click();
  await page.waitForFunction(n=>document.querySelectorAll('.dc-grid>.dc-day').length===n,n);
 }
 await page.screenshot({path:out+'/calendar-'+width+'.png',fullPage:true});
 await view.locator('[data-shipment-tab=products]').click();await view.locator('.dc-products').waitFor();assert.equal(await view.locator('.dc-products tbody tr').count(),4);
 assert.equal(await view.locator('.dc-products td b').count(),0);
 await view.locator('[data-shipment-tab=list]').click();await view.locator('#deliveries-table').waitFor();assert.equal(await view.locator('#deliveries-list tr').count(),4);
 assert.ok(await view.locator('[data-ship]').count()>0,'existing delivery actions remain available');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
 assert.equal(await view.locator('.ff-legend li').count(),6);
 for(const tab of ['products','list']){
  await view.locator('[data-shipment-tab='+tab+']').click();
  const table=view.locator(tab==='list'?'#deliveries-table .ff-table':'.dc-products.ff-table');await table.waitFor();
  const geometry=await table.locator('tbody tr').evaluateAll(rows=>rows.map(tr=>({height:tr.getBoundingClientRect().height,display:getComputedStyle(tr).display,wrap:[...tr.querySelectorAll('.ff-cell')].every(n=>getComputedStyle(n).whiteSpace==='nowrap')})));
  assert.equal(geometry.length,4);for(const r of geometry){assert.ok(r.height<=56,JSON.stringify(r));assert.equal(r.display,'table-row');assert.equal(r.wrap,true);}
 }
 await view.locator('#deliveries-list tr').first().getByRole('button',{name:/CAL-/}).click();await page.locator('.delivery-calendar-dialog').waitFor();
 assert.match(await page.locator('.delivery-calendar-dialog').textContent(),/khách hàng doanh nghiệp/);
 await page.locator('.delivery-calendar-dialog button[aria-label="Đóng chi tiết chuyến giao"]').click();
 await view.locator('[data-shipment-tab=calendar]').click();await view.locator('.dc-event').first().waitFor();
 for(const r of await view.locator('.dc-event').evaluateAll(nodes=>nodes.map(n=>({height:n.getBoundingClientRect().height,nowrap:getComputedStyle(n).whiteSpace,full:n.getAttribute('aria-label')})))){assert.ok(r.height<=46,JSON.stringify(r));assert.equal(r.nowrap,'nowrap');assert.match(r.full,/khách hàng doanh nghiệp/);}
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:out+'/compact-calendar-'+width+'.png',fullPage:true});
 console.log('PASS '+width+'px: real calendar, day/week/month, product/address filters, empty state, product table, escaped labels, existing actions, no JS errors/overflow');await context.close();
}
assert.deepEqual(writes.filter(x=>!x.path.endsWith('/csp-report')),[],'viewing/filtering must not write business data');
}finally{await browser.close();server.close();await f.client.close();}
