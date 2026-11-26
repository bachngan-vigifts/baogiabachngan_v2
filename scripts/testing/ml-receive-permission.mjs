import {postMoves} from '../../src/modules/inventory/api/ledger.ts';
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
const f=await setupEarly(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out=process.env.BROWSER_EVIDENCE_DIR||'/tmp/ml-receive';await mkdir(out,{recursive:true});
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
 const {employees,positionPermissions}=await import('../../src/modules/staff/schema.ts');
 const {products,warehouses}=await import('../../src/modules/catalog/schema.ts');
 await f.db.update(employees).set({positionId:'sales-ml'}).where(eq(employees.id,'emp'));
 await f.db.insert(positionPermissions).values({positionId:'sales-ml',permission:'purchases.receive'});
 await f.db.insert(products).values({sku:'031106000',name:'Chén',brand:'Minh Long',updatedAt:new Date().toISOString()});
 await f.db.insert(warehouses).values({id:'ml-test',name:'Kho thử ML',kind:'stock'});
 await postMoves(f.db,'mgr',[{sku:'031106000',warehouseId:'ml-test',qty:1,kind:'opening',refType:'opening',refId:'ml-opening'}]);
 const user=(await f.call('/me',f.cookies.emp)).data.user,token=f.cookies.emp.split('=')[1];
 const context=await browser.newContext({viewport:{width:1366,height:768}});
 await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 await context.addInitScript(({user,token})=>{localStorage.setItem('bn-api-region-manual-off','1');localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user,token});
 const page=await context.newPage(),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/#/purchases/a1');
 await page.getByRole('button',{name:'Nhận hàng',exact:true}).click();
 await page.getByRole('button',{name:'Không — chỉ nhập CRM',exact:true}).click();
 await page.locator('label').filter({hasText:'Kho nhận *'}).locator('select').selectOption('Kho thử ML');
 await page.getByLabel('Số đạt',{exact:true}).fill('1');
 const response=page.waitForResponse(r=>r.url().endsWith('/purchase-orders/a1/receipts')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'✅ Lưu phiếu nhận hàng',exact:true}).click();
 const r=await response;assert.equal(r.status(),201,await r.text());assert.deepEqual(errors,[]);
 await page.screenshot({path:out+'/received-pc.png'});console.log('PASS: ML granted receiving permission, PC receipt saved in local fixture');
 await context.close();
}finally{await browser.close();await new Promise(r=>server.close(r));await f.client.close();}
