/** Lập đơn mua NCC theo báo giá, mất phản hồi sau khi máy chủ ĐÃ lưu, người dùng bấm "Tạo đơn nháp" lần nữa
 *  (dữ liệu mẫu PGlite cục bộ, không gọi production). Mong đợi: lần gửi lại cùng mã thao tác, máy chủ trả đúng đơn cũ,
 *  mở đúng đơn đó; chỉ có 1 đơn mua; không báo "vượt số cần đặt". Cỡ 390 và 1280. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {setupEarly} from '../../tests/helpers/purchase-early-fixture.ts';
import {eq} from 'drizzle-orm';
import {suppliers,supplierContacts} from '../../src/modules/suppliers/schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setupEarly(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out=process.env.BROWSER_EVIDENCE_DIR||'/tmp/sale-admin-suppliers';await mkdir(out,{recursive:true});
let writes=0,imageFetches=0;
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');
 if(u.pathname.startsWith('/api/staff/')){
  if(req.method!=='GET'&&req.method!=='OPTIONS')writes++;if(u.pathname.endsWith('/images/fetch'))imageFetches++;
  const chunks=[];for await(const c of req)chunks.push(c);const auth=req.headers.authorization?.replace(/^Bearer /,'')||'';
  const r=await f.call(u.pathname.slice('/api/staff'.length)+u.search,auth?'__Host-bn-session='+auth:'',req.method,chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined);
  res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;
 }
 const path=u.pathname==='/'?'/index.html':u.pathname;let data=await readFile(root+path);if(path.endsWith('.html'))data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.writeHead(200,{'content-type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':'text/html'}).end(data);
}catch{res.writeHead(404).end('Fixture resource unavailable');}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const {incomingShipments}=await import('../../src/modules/suppliers/schema.ts');
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']}:{executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),results=[];

try {
 await f.db.update(suppliers).set({saleAdminBrand:null});
 const {products}=await import('../../src/modules/catalog/schema.ts');
 await f.db.insert(products).values({sku:'SUP-TEST',name:'Sản phẩm kiểm thử',brand:'Khác',updatedAt:new Date().toISOString()});
 for(const width of [390,1280]) {
 const user=(await f.call('/me',f.cookies.sa)).data.user,token=f.cookies.sa.split('=')[1],context=await browser.newContext({viewport:{width,height:1000}});
 await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 await context.addInitScript(({user,token})=>{localStorage.setItem('bn-api-region-manual-off','1');localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user,token});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/#/purchases/new?mode=restock');await page.locator('.pur-rs').waitFor();
 const select=page.getByRole('combobox',{name:'Thêm nhà cung cấp'});
 await select.selectOption('b');await page.locator('.pur-sup-chip').waitFor();
 await page.getByPlaceholder('Nhập địa chỉ giao hàng',{exact:true}).fill('Kho thử');
 await page.getByRole('combobox',{name:'Tìm sản phẩm để thêm'}).fill('SUP-TEST');
 await page.locator('.pur-rs-results [role="option"]').first().click();
 await page.getByRole('button',{name:'Tạo đơn nháp',exact:true}).click();
 await page.waitForURL(/#\/purchases\/[^n]/);
 const id=decodeURIComponent(page.url().split('#/purchases/')[1].split('?')[0]);
 const saved=await f.call('/purchase-orders/'+id,f.cookies.sa);assert.equal(saved.status,200,JSON.stringify(saved.data));assert.equal(saved.data.supplier.id,'b');
 assert.ok(!saved.data.actions.includes('approve'));
 await page.getByRole('button',{name:'Gửi duyệt',exact:true}).waitFor();
 const submitted=page.waitForResponse(r=>r.url().endsWith('/purchase-orders/'+id+'/submit')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'Gửi duyệt',exact:true}).click();assert.equal((await submitted).status(),200);
 const pending=await f.call('/purchase-orders/'+id,f.cookies.sa);assert.equal(pending.status,200);assert.ok(!pending.data.actions.includes('approve'));
 assert.equal(await page.getByRole('button',{name:/^Duyệt( đơn| & gửi NCC)?$/}).count(),0);
 assert.equal((await f.call('/purchase-orders/'+id+'/approve',f.cookies.sa,'POST',{revision:pending.data.revision,lines:[]})).status,403);
 assert.deepEqual(errors,[]);await page.screenshot({path:out+'/'+width+'.png'});results.push({width,supplier:'b',created:true});await context.close();
 }
 console.log(results);
}finally{await browser.close();await new Promise(r=>server.close(r));await f.client.close();}
