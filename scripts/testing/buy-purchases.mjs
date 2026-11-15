/** Trang Đơn mua NCC (khung Mua hàng mới) trên router thật + PGlite cục bộ. Không gọi production, mail, Sapo. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {eq} from 'drizzle-orm';
import {setupEarly} from '../../tests/helpers/purchase-early-fixture.ts';
import {products} from '../../src/modules/catalog/schema.ts';
import {incomingShipments,incomingShipmentLines} from '../../src/modules/suppliers/schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setupEarly(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url));
const ok=(r,s=200)=>{assert.equal(r.status,s,JSON.stringify(r.data));return r.data;};
await f.db.insert(products).values([{sku:'031106000',name:'Bộ trà 0.7 L Jasmine Trắng Ngà',unit:'Cái',updatedAt:'2026-10-01T00:00:00Z'}]);
const now='2026-10-21T00:00:00Z';
for(const [id,extra,date,price] of [['draft',{approvalStatus:'pending'},'2099-12-01',120000],['ready',{supplierStatus:'confirmed',supplierConfirmedAt:now},'2099-12-05',95000]]){
  await f.db.insert(incomingShipments).values({id,ticketNumber:'PO-'+id,source:'supplier-order',warehouse:'Kho',supplierId:'a',supplierName:'NCC a',arrivalDate:date,createdAt:now,createdBy:'mgr',updatedAt:now,...extra});
  await f.db.insert(incomingShipmentLines).values({id:'line-'+id,shipmentId:id,lineNo:1,sku:'031106000',name:'Bộ trà 0.7 L Jasmine Trắng Ngà',unit:'Cái',quantity:40,promisedDate:date,price});
}
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://l'),path=u.pathname;
  if(path.startsWith('/api/staff/')){const ch=[];for await(const c of req)ch.push(c);const body=ch.length?JSON.parse(Buffer.concat(ch).toString()):undefined;
    const t=req.headers.authorization?.replace(/^Bearer /,'')||'';const r=await f.call(path.slice(10)+u.search,t?'__Host-bn-session='+t:'',req.method,body);res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;}
  let data=await readFile(root+(path==='/'?'index.html':path));if(path==='/')data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
  res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':path.endsWith('.svg')?'image/svg+xml':'text/html;charset=utf-8');res.end(data);
}catch(e){res.writeHead(404).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,out=process.env.BUY_SCREENSHOT_DIR||'/tmp/buy-purchases';await mkdir(out,{recursive:true});
const browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']}:{});
async function open(role,width){
  const ctx=await browser.newContext({viewport:{width,height:900},locale:'vi-VN'});await ctx.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
  const user=ok(await f.call('/me',f.cookies[role])).user;
  await ctx.addInitScript(({token,user})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{token:f.cookies[role].split('=')[1],user});
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));return {ctx,page,errors};
}
const V='#view-purchases',rows=p=>p.locator(V+' .pur-orders tbody tr.clickable');
const waitRows=(p,n)=>p.waitForFunction(({V,n})=>document.querySelectorAll(V+' .pur-orders tbody tr.clickable').length===n&&document.querySelector(V+' .buy-panel').getAttribute('aria-busy')!=='true',{V,n});
const kpi=(p,k)=>p.locator(V+` .buy-kpi[data-key="${k}"]`);
const results={};
try{
  {const {ctx,page,errors}=await open('mgr',1440);await page.goto(origin+'/#/purchases');await page.waitForSelector(V+' .buy-kpi');await waitRows(page,6);
   const counts=await page.locator(V+' .buy-kpi').evaluateAll(k=>Object.fromEntries(k.map(x=>[x.dataset.key||'all',x.querySelector('b').textContent])));
   assert.equal(counts.draft,'1');assert.equal(counts.awaiting_confirmation,'4');assert.equal(counts.confirmed,'1');assert.equal(counts.late,'4');assert.equal(counts.all,'6');
   assert.equal(await page.locator(V+' .buy-head .btn.primary').textContent(),'+ Tạo đơn mua');
   assert.equal(await page.locator(V+' .pur-chips').isVisible(),false,'11 nút lọc cũ đã thay bằng ô đếm');
   await page.locator(V+' .buy-head').getByRole('button',{name:'Thêm ▾'}).click();
   assert.deepEqual(await page.locator(V+' .buy-head .buy-menu-item b').allTextContents(),['Công nợ NCC','Nhập đơn từ file NCC']);await page.keyboard.press('Escape');
   const row=n=>rows(page).filter({hasText:n});
   assert.match(await row('PO-draft').textContent(),/4\.800\.000[\s\S]*Nháp – chưa gửi duyệt[\s\S]*Gửi duyệt/);
   assert.match(await row('PO-ready').textContent(),/05\/12\/2099[\s\S]*Còn \d+ ngày[\s\S]*Nhận hàng/);
   assert.match(await row('PO-a1').textContent(),/Trễ \d+ ngày[\s\S]*Chưa có giá[\s\S]*Chờ NCC xác nhận/,'chưa có giá thì không hiện 0 đ');
   // Lọc bằng ô đếm, bấm lại để bỏ; số đếm giữ nguyên
   await kpi(page,'late').click();await waitRows(page,4);assert.equal(await kpi(page,'').locator('b').textContent(),'6');
   await kpi(page,'late').click();await waitRows(page,6);
   // Trạng thái hiếm chọn trong Bộ lọc
   await page.locator(V+' .buy-filter-toggle').click();await page.locator(V+' .buy-filters').getByLabel('Trạng thái').selectOption('cancelled');await waitRows(page,0);
   assert.equal(await page.locator(V+' .buy-filter-toggle').textContent(),'Bộ lọc · 1');
   await page.locator(V+' .buy-filters').getByRole('button',{name:'Xoá bộ lọc'}).click();await waitRows(page,6);
   await page.locator(V+' .buy-search').fill('PO-ready');await waitRows(page,1);await page.locator(V+' .buy-search').fill('');await waitRows(page,6);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0);
   await page.screenshot({path:out+'/purchases-1440.png',fullPage:true});
   // Ngăn chi tiết: một nút chính theo trạng thái
   const main=async(id,label)=>{await page.goto(origin+'/#/purchases/'+id);await page.waitForFunction(t=>document.querySelector('.pur-drawer:not([hidden]) h2')?.textContent.startsWith(t),'PO-'+id);await page.locator('.pur-drawer:not([hidden]) .pur-main-action').waitFor();assert.equal(await page.locator('.pur-drawer .pur-main-action').textContent(),label,id);};
   await main('draft','Duyệt giá');
   await main('a1','Xác nhận thay NCC');
   const more=page.locator('.pur-drawer .pur-more');await more.locator('summary').click();
   const items=await more.locator('.buy-menu-item').allTextContents();assert.ok(items.includes('Nhận hàng')&&items.includes('Tải PDF / Excel gửi NCC'),items.join('|'));
   assert.equal(await page.locator('.pur-drawer .buy-danger').textContent(),'Huỷ đơn');
   assert.equal(await page.locator('.pur-drawer').getByRole('button',{name:'Manager xác nhận thay NCC'}).count(),0);
   await page.screenshot({path:out+'/purchase-detail-1440.png'});
   await main('ready','Nhận hàng');
   await page.locator('.pur-drawer .pur-main-action').click();const choice=page.locator('dialog.receipt-sapo-choice[open]');await choice.waitFor();await choice.getByRole('button',{name:'Đóng'}).click();
   assert.equal((await f.call('/purchase-orders/ready',f.cookies.mgr)).data.progress.good,0,'mở form nhận hàng chưa ghi gì');
   assert.deepEqual(errors,[]);results.manager=true;await ctx.close();}
  {const {ctx,page,errors}=await open('sa',390);await page.goto(origin+'/#/purchases');await page.waitForSelector(V+' .buy-kpi');await page.waitForTimeout(800);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0,'không tràn ngang trên điện thoại');
   assert.equal(await page.locator(V+' [data-mobile-row-detail]').count(),0,'danh sách hiện dạng thẻ, không giấu cột sau nút Chi tiết');
   await page.screenshot({path:out+'/purchases-390.png',fullPage:true});assert.deepEqual(errors,[]);results.saleAdminMobile=true;await ctx.close();}
  {const {ctx,page,errors}=await open('kho',390);await page.goto(origin+'/#/purchases');await page.locator(V+' .kho-recv:not([hidden])').waitFor();
   assert.equal(await page.locator(V+' .buy-head .btn.primary').isVisible(),false,'kho không lập đơn');
   assert.equal(await page.locator(V+' .buy-kpis').isVisible(),false,'kho thấy thẻ hàng chờ nhận thay bảng');
   assert.deepEqual(errors,[]);results.warehouse=true;await ctx.close();}
  console.log(JSON.stringify(results));
}finally{await browser.close();server.close();}
