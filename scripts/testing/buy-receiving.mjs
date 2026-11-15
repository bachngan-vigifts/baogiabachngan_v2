/** Trang Nhận hàng NCC (khung Mua hàng mới) trên router thật + PGlite cục bộ. Không gọi production, mail, Sapo. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setupEarly} from '../../tests/helpers/purchase-early-fixture.ts';
import {products} from '../../src/modules/catalog/schema.ts';
import {incomingShipments,incomingShipmentLines} from '../../src/modules/suppliers/schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setupEarly(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url));
const ok=(r,s=200)=>{assert.equal(r.status,s,JSON.stringify(r.data));return r.data;};
await f.db.insert(products).values([{sku:'031106000',name:'Bộ trà 0.7 L Jasmine Trắng Ngà',unit:'Cái',updatedAt:'2026-10-01T00:00:00Z'}]);
const now='2026-10-21T00:00:00Z';
for(const [id,date] of [['future','2099-12-01'],['nodate',null]]){
  await f.db.insert(incomingShipments).values({id,ticketNumber:'PO-'+id,source:'supplier-order',warehouse:'Kho',supplierId:'b',supplierName:'NCC b',approvalStatus:'approved',arrivalDate:date,createdAt:now,createdBy:'mgr',updatedAt:now});
  await f.db.insert(incomingShipmentLines).values({id:'line-'+id,shipmentId:id,lineNo:1,sku:'031106000',name:'Bộ trà 0.7 L Jasmine Trắng Ngà',unit:'Cái',quantity:30,promisedDate:date||''});
}
const made=ok(await f.call('/purchase-early-requests',f.cookies.mgr,'POST',{clientKey:crypto.randomUUID(),pickupDate:'2099-11-30',lines:[{sku:'031106000',quantity:500}]}),201);
const sub=ok(await f.call('/purchase-early-requests/'+made.id+'/submit',f.cookies.mgr,'POST',{revision:made.request.revision}));
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://l'),path=u.pathname;
  if(path.startsWith('/api/staff/')){const ch=[];for await(const c of req)ch.push(c);const body=ch.length?JSON.parse(Buffer.concat(ch).toString()):undefined;
    const t=req.headers.authorization?.replace(/^Bearer /,'')||'';const r=await f.call(path.slice(10)+u.search,t?'__Host-bn-session='+t:'',req.method,body);res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;}
  let data=await readFile(root+(path==='/'?'index.html':path));if(path==='/')data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
  res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':path.endsWith('.svg')?'image/svg+xml':'text/html;charset=utf-8');res.end(data);
}catch(e){res.writeHead(404).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,out=process.env.BUY_SCREENSHOT_DIR||'/tmp/buy-receiving';await mkdir(out,{recursive:true});
const browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']}:{});
const results={};
async function open(role,width){
  const ctx=await browser.newContext({viewport:{width,height:900},locale:'vi-VN'});await ctx.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
  const user=ok(await f.call('/me',f.cookies[role])).user;
  await ctx.addInitScript(({token,user})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{token:f.cookies[role].split('=')[1],user});
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));return {ctx,page,errors};
}
const rows=page=>page.locator('#view-receiving .buy-list tbody tr');
const waitRows=async(page,n)=>page.waitForFunction(n=>document.querySelectorAll('#view-receiving .buy-list tbody tr').length===n&&!document.querySelector('#view-receiving .buy-summary').textContent.startsWith('Đang'),n);
try{
  // Manager, máy tính
  {const {ctx,page,errors}=await open('mgr',1440);await page.goto(origin+'/#/receiving');await page.waitForSelector('#view-receiving .buy-kpi');
   await waitRows(page,7);
   const counts=await page.locator('#view-receiving .buy-kpi').evaluateAll(k=>Object.fromEntries(k.map(x=>[x.dataset.key,x.querySelector('b').textContent])));
   assert.deepEqual(counts,{late:'4',scheduled:'2',undated:'1',all:'7'},'KPI đếm theo trạng thái: 4 đơn quá hẹn, 1 đơn + 1 phiếu sắp tới, 1 đơn chưa hẹn');
   assert.equal(await page.locator('#view-receiving h1').textContent(),'Nhận hàng NCC');
   assert.equal(await page.locator('.sidebar a[data-nav=receiving] span').textContent(),'Nhận hàng NCC');
   await page.locator('#view-receiving .buy-kpi[data-key=undated]').click();await waitRows(page,1);
   assert.match(await rows(page).first().textContent(),/Chưa hẹn ngày[\s\S]*PO-nodate/);
   assert.equal(await page.locator('#view-receiving .buy-kpi[data-key=undated]').getAttribute('aria-pressed'),'true');
   assert.equal(await page.locator('#view-receiving .buy-kpi[data-key=all] b').textContent(),'7','số đếm không đổi khi chọn một trạng thái');
   await page.locator('#view-receiving .buy-kpi[data-key=late]').click();await waitRows(page,4);
   assert.equal(await rows(page).locator('.buy-late').count()>=4,true,'ngày quá hẹn tô đỏ');assert.match(await rows(page).first().textContent(),/Trễ \d+ ngày/);
   await page.locator('#view-receiving .buy-kpi[data-key=all]').click();await waitRows(page,7);
   // Tìm kiếm
   await page.locator('#view-receiving .buy-search').fill('PO-a2');await waitRows(page,1);assert.match(await rows(page).textContent(),/PO-a2/);
   await page.locator('#view-receiving .buy-search').fill('');await waitRows(page,7);
   // Bộ lọc gập: mở, lọc loại phiếu, đếm bộ lọc, xoá bộ lọc
   const panel=page.locator('#view-receiving .buy-filters');assert.equal(await panel.isVisible(),false,'bộ lọc gập sẵn');
   await page.locator('#view-receiving .buy-filter-toggle').click();assert.equal(await panel.isVisible(),true);
   await panel.getByLabel('Loại chứng từ').selectOption('early');await waitRows(page,1);
   assert.equal(await page.locator('#view-receiving .buy-filter-toggle').textContent(),'Bộ lọc · 1');
   assert.match(await rows(page).textContent(),/Phiếu lấy hàng trước[\s\S]*Chờ NCC xác nhận/);
   assert.equal(await rows(page).locator('a.buy-doc').getAttribute('href'),'#/early-requests/'+made.id,'số phiếu mở trang Lấy hàng trước');
   await page.screenshot({path:out+'/receiving-filter-1440.png',fullPage:true});
   // Xác nhận thay NCC: hỏi lại trước khi ghi, sau đó hiện nút Nhận hàng theo đơn mua
   await rows(page).getByRole('button',{name:'Xác nhận thay NCC'}).click();
   await page.locator('#confirm-dialog[open]').waitFor();assert.match(await page.locator('#confirm-text').textContent(),/chưa ghi nhận hàng vào kho/);
   await page.locator('#confirm-cancel').click();
   assert.equal((await f.call('/purchase-early-requests?id='+made.id,f.cookies.mgr)).data.requests[0].lines[0].allocations.every(a=>a.status==='pending'),true,'bấm Huỷ không ghi gì');
   await rows(page).getByRole('button',{name:'Xác nhận thay NCC'}).click();await page.locator('#confirm-dialog[open]').waitFor();await page.locator('#confirm-ok').click();
   await page.waitForFunction(()=>/NCC đồng ý/.test(document.querySelector('#view-receiving .buy-list tbody').textContent));
   const receive=rows(page).getByRole('link',{name:/^Nhận hàng · PO-/});assert.equal(await receive.count()>=1,true);
   assert.match(await receive.first().getAttribute('href'),new RegExp('\\?receive=1&earlyRequestId='+made.id));
   await panel.getByRole('button',{name:'Xoá bộ lọc'}).click();await waitRows(page,7);assert.equal(await page.locator('#view-receiving .buy-filter-toggle').textContent(),'Bộ lọc');
   const po=rows(page).filter({hasText:'PO-future'}).getByRole('link',{name:'Nhận hàng',exact:true});assert.equal(await po.getAttribute('href'),'#/purchases/future?receive=1');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0,'không tràn ngang');
   await page.screenshot({path:out+'/receiving-1440.png',fullPage:true});
   // Đường dẫn từ trang Kho: chỉ phiếu lấy trước còn việc chờ
   await page.goto(origin+'/#/receiving?type=early&workOnly=1');await page.waitForFunction(()=>!document.querySelector('#view-receiving .buy-hint').hidden);
   assert.match(await page.locator('#view-receiving .buy-hint').textContent(),/Đang xem việc chờ/);
   assert.equal(await page.locator('#view-receiving .buy-filters').getByLabel('Loại chứng từ').inputValue(),'early');
   assert.deepEqual(errors,[]);results.manager=true;await ctx.close();}
  // Kho trên điện thoại: không có nút xác nhận thay NCC, nút Nhận hàng luôn thấy, không tràn ngang
  {const {ctx,page,errors}=await open('kho',390);await page.goto(origin+'/#/receiving');await page.waitForSelector('#view-receiving .buy-kpi');await waitRows(page,7);
   assert.equal(await page.getByRole('button',{name:'Xác nhận thay NCC'}).count(),0,'chỉ Manager xác nhận thay NCC');
   const first=rows(page).filter({hasText:'PO-future'}).getByRole('link',{name:'Nhận hàng',exact:true});assert.equal(await first.isVisible(),true,'nút Nhận hàng không bị giấu sau nút Chi tiết');
   assert.equal(await page.locator('#view-receiving [data-mobile-row-detail]').count(),0);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0,'không tràn ngang trên điện thoại');
   await page.screenshot({path:out+'/receiving-390.png',fullPage:true});
   assert.deepEqual(errors,[]);results.warehouseMobile=true;await ctx.close();}
  console.log(JSON.stringify(results));
}finally{await browser.close();server.close();await f.client.close();}
