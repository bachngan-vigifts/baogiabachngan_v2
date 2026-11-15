/** Trang Lấy hàng trước (khung Mua hàng mới) trên router thật + PGlite cục bộ. Không gọi production, mail, Sapo. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setupEarly} from '../../tests/helpers/purchase-early-fixture.ts';
import {products} from '../../src/modules/catalog/schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setupEarly(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url));
const ok=(r,s=200)=>{assert.equal(r.status,s,JSON.stringify(r.data));return r.data;};
await f.db.insert(products).values([{sku:'031106000',name:'Bộ trà 0.7 L Jasmine Trắng Ngà',unit:'Cái',updatedAt:'2026-10-01T00:00:00Z'}]);
const create=async(qty,pickup)=>ok(await f.call('/purchase-early-requests',f.cookies.mgr,'POST',{clientKey:crypto.randomUUID(),pickupDate:pickup,lines:[{sku:'031106000',quantity:qty}]}),201);
const submit=async r=>ok(await f.call('/purchase-early-requests/'+r.id+'/submit',f.cookies.mgr,'POST',{revision:r.request.revision})).request;
const draft=await create(5,'2099-12-01');
const pending=await submit(await create(6,'2020-01-02'));
const accepted=await submit(await create(7,'2099-12-02'));ok(await f.call('/purchase-early-request-lines/'+accepted.lines[0].id+'/manager-confirm',f.cookies.mgr,'POST',{supplierId:'a'}));
const rejected=await submit(await create(8,'2099-12-03'));ok(await f.call('/supplier-portal/early-requests/'+rejected.lines[0].id+'/respond',f.cookies.ncc,'POST',{status:'rejected',note:'Hết hàng'}));
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://l'),path=u.pathname;
  if(path.startsWith('/api/staff/')){const ch=[];for await(const c of req)ch.push(c);const body=ch.length?JSON.parse(Buffer.concat(ch).toString()):undefined;
    const t=req.headers.authorization?.replace(/^Bearer /,'')||'';const r=await f.call(path.slice(10)+u.search,t?'__Host-bn-session='+t:'',req.method,body);res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;}
  let data=await readFile(root+(path==='/'?'index.html':path));if(path==='/')data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
  res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':path.endsWith('.svg')?'image/svg+xml':'text/html;charset=utf-8');res.end(data);
}catch(e){res.writeHead(404).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,out=process.env.BUY_SCREENSHOT_DIR||'/tmp/buy-early';await mkdir(out,{recursive:true});
const browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']}:{});
async function open(role,width){
  const ctx=await browser.newContext({viewport:{width,height:900},locale:'vi-VN'});await ctx.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
  const user=ok(await f.call('/me',f.cookies[role])).user;
  await ctx.addInitScript(({token,user})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{token:f.cookies[role].split('=')[1],user});
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));return {ctx,page,errors};
}
const V='#view-early-requests';
const rows=page=>page.locator(V+' .early-page-list tr.early-page-card');
const waitRows=async(page,n)=>page.waitForFunction(({V,n})=>document.querySelectorAll(V+' .early-page-list tr.early-page-card').length===n&&!document.querySelector(V+' .early-page-index').hasAttribute('aria-busy'),{V,n});
const kpi=(page,key)=>page.locator(V+` .buy-kpi[data-key="${key}"]`);
const results={};
try{
  {const {ctx,page,errors}=await open('mgr',1440);await page.goto(origin+'/#/early-requests');await page.waitForSelector(V+' .buy-kpi');await waitRows(page,4);
   const counts=await page.locator(V+' .buy-kpi').evaluateAll(k=>Object.fromEntries(k.map(x=>[x.dataset.key||'all',x.querySelector('b').textContent])));
   assert.deepEqual(counts,{draft:'1',pending:'1',accepted:'1',rejected:'1',all:'4'},'ô đếm theo trạng thái');
   assert.equal(await page.locator(V+' h1').textContent(),'Lấy hàng trước');
   assert.equal(await page.locator(V+' .buy-head .btn.primary').textContent(),'+ Tạo phiếu lấy trước');
   assert.equal(await page.getByRole('button',{name:'Xin bằng file'}).count(),0,'các nút tạo cũ đã gom vào một nút');
   const row=name=>rows(page).filter({hasText:name});
   assert.match(await row(draft.request.ticketNumber).textContent(),/Nháp[\s\S]*Gửi NCC/);
   assert.match(await row(pending.ticketNumber).textContent(),/02\/01\/2020[\s\S]*Trễ \d+ ngày[\s\S]*Chờ NCC xác nhận/);
   assert.equal(await row(pending.ticketNumber).locator('.buy-late').count()>0,true,'ngày lấy quá hẹn tô đỏ');
   assert.match(await row(accepted.ticketNumber).textContent(),/NCC đồng ý[\s\S]*Nhận hàng/);
   assert.match(await row(rejected.ticketNumber).textContent(),/NCC từ chối[\s\S]*Chọn NCC khác hoặc huỷ/);
   assert.match(await row(accepted.ticketNumber).textContent(),/Bộ trà 0.7 L Jasmine Trắng Ngà[\s\S]*031106000 · xin 7/);
   // Ô đếm lọc nhanh, bấm lại để bỏ lọc; các số đếm giữ nguyên
   await kpi(page,'rejected').click();await waitRows(page,1);assert.equal(await kpi(page,'rejected').getAttribute('aria-pressed'),'true');
   assert.equal(await kpi(page,'').locator('b').textContent(),'4');assert.match(page.url(),/status=rejected/,'bộ lọc lưu trên URL');
   await kpi(page,'rejected').click();await waitRows(page,4);
   // Bộ lọc gập + tìm kiếm + xoá bộ lọc
   assert.equal(await page.locator(V+' .buy-filters').isVisible(),false);
   await page.locator(V+' .buy-filter-toggle').click();await page.locator(V+' .buy-filters').getByLabel('Lọc ngày theo').selectOption('created');await waitRows(page,4);
   assert.equal(await page.locator(V+' .buy-filter-toggle').textContent(),'Bộ lọc · 1');
   await page.getByRole('searchbox',{name:'Tìm phiếu lấy hàng trước'}).fill(pending.ticketNumber);await waitRows(page,1);
   await page.locator(V+' .buy-filters').getByRole('button',{name:'Xoá bộ lọc'}).click();await waitRows(page,4);
   assert.equal(await page.getByRole('searchbox',{name:'Tìm phiếu lấy hàng trước'}).inputValue(),'');
   // Chọn nhiều: thanh thao tác chỉ hiện nút khi đã chọn
   const bulk=page.locator(V+' .early-list-bulk');assert.equal(await bulk.getByRole('button',{name:/Xác nhận thay NCC/}).isVisible(),false);
   await page.getByRole('checkbox',{name:'Chọn phiếu '+pending.ticketNumber}).check();assert.equal(await bulk.getByRole('button',{name:'Xác nhận thay NCC'}).isVisible(),true);
   assert.match(await bulk.textContent(),/Đã chọn 1 phiếu/);
   await bulk.getByRole('button',{name:'Bỏ chọn'}).click();assert.equal(await bulk.getByRole('button',{name:'Xác nhận thay NCC'}).isVisible(),false);
   await page.screenshot({path:out+'/early-1440.png',fullPage:true});
   // Một nút tạo phiếu: hộp chọn 3 cách nhập
   await page.locator(V+' .buy-head .btn.primary').click();const chooser=page.locator('dialog.buy-chooser[open]');await chooser.waitFor();
   assert.deepEqual(await chooser.locator('.buy-choice b').allTextContents(),['Chọn hàng','Từ file Excel','Từ ảnh phiếu']);
   await page.screenshot({path:out+'/early-chooser-1440.png'});
   await chooser.getByRole('button',{name:'Xin hàng bằng file'}).click();await page.locator('.early-file-dialog[open]').waitFor();await page.keyboard.press('Escape');
   await page.locator(V+' .buy-head .btn.primary').click();await page.locator('dialog.buy-chooser[open]').getByRole('button',{name:'Tạo đơn lấy hàng nhanh'}).click();
   await page.waitForFunction(()=>location.hash==='#/early-requests/new');await page.waitForFunction(V=>!document.querySelector(V+' .early-quick-host').hidden,V);
   assert.equal(await page.locator(V+' .buy-head .btn.primary').isVisible(),false,'đang tạo phiếu thì ẩn nút tạo');
   // Bấm dòng mở chi tiết; nút đổi tên, nút huỷ không còn nền đỏ đậm
   await page.goto(origin+'/#/early-requests');await waitRows(page,4);await rows(page).filter({hasText:pending.ticketNumber}).locator('td').nth(1).click();
   await page.waitForFunction(id=>location.hash==='#/early-requests/'+id,pending.id);await page.locator(V+' .early-page-detail .early-request-card').first().waitFor();
   const detail=page.locator(V+' .early-page-detail');assert.equal(await detail.getByRole('button',{name:'Xác nhận thay NCC'}).count()>=1,true);
   const cancel=detail.getByRole('button',{name:'Huỷ phiếu',exact:true}).first();assert.equal(await cancel.isVisible(),true);
   assert.notEqual(await cancel.evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(180, 35, 44)','nút huỷ không nổi bật hơn nút chính');
   assert.equal(await detail.getByText(/Đơn CRM:/).count(),0);
   await page.screenshot({path:out+'/early-detail-1440.png',fullPage:true});
   assert.deepEqual(errors,[]);results.manager=true;await ctx.close();}
  // Nhân viên không có quyền lập phiếu: không thấy nút tạo; điện thoại không tràn ngang
  {const {ctx,page,errors}=await open('emp',390);await page.goto(origin+'/#/early-requests');await page.waitForTimeout(800);
   const denied=await page.locator(V+' .error:not([hidden])').count();
   if(!denied){await waitRows(page,4);assert.equal(await page.locator(V+' .buy-head .btn.primary').isVisible(),false,'không có quyền thì không có nút tạo');}
   results.employee=denied?'không có quyền xem':'xem được, không có nút tạo';assert.deepEqual(errors,[]);await ctx.close();}
  {const {ctx,page,errors}=await open('sa',390);await page.goto(origin+'/#/early-requests');await page.waitForSelector(V+' .buy-kpi');await waitRows(page,4);
   assert.equal(await page.locator(V+' .buy-head .btn.primary').isVisible(),true,'Sale Admin có quyền lập phiếu');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0,'không tràn ngang trên điện thoại');
   await page.screenshot({path:out+'/early-390.png',fullPage:true});assert.deepEqual(errors,[]);results.saleAdminMobile=true;await ctx.close();}
  console.log(JSON.stringify(results));
}finally{await browser.close();server.close();await f.client.close();}
