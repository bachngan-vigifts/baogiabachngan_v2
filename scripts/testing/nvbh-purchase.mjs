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
import {employees} from '../../src/modules/staff/schema.ts';
import {products} from '../../src/modules/catalog/schema.ts';
import {suppliers,supplierContacts} from '../../src/modules/suppliers/schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setupEarly(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out=process.env.BROWSER_EVIDENCE_DIR||'/tmp/nvbh-purchase-preview';await mkdir(out,{recursive:true});
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
try{
 for(const width of [390,1280]){
  await f.db.update(employees).set({positionId:width===390?'sales-ml':'sales-lock'}).where(eq(employees.id,'emp'));
  await f.db.insert(products).values({sku:'TEST-INTENT-'+width,name:'Hàng kiểm thử',brand:'Minh Long',updatedAt:new Date().toISOString()});
  const quote=await f.call('/quotes',f.cookies.emp,'POST',{type:'B2B',quoteNo:'INTENT-'+width,customer:'Khách kiểm thử',vat:8,rows:[{name:'Hàng kiểm thử',sku:'TEST-INTENT-'+width,qty:12,price:245000}]});assert.equal(quote.status,201);
  const user=(await f.call('/me',f.cookies.emp)).data.user,token=f.cookies.emp.split('=')[1],context=await browser.newContext({viewport:{width,height:1000}});
  await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());await context.addInitScript(({user,token})=>{localStorage.setItem('bn-api-region-manual-off','1');localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user,token});
  const page=await context.newPage(),errors=[],bodies=[];page.on('pageerror',e=>errors.push(e.message));
  let dropAfterSave=true;
  await page.route('**/api/staff/purchase-orders',async route=>{if(route.request().method()!=='POST')return route.continue();bodies.push(route.request().postDataJSON());
   if(dropAfterSave){dropAfterSave=false;await route.fetch();return route.abort('connectionreset');} // máy chủ đã lưu, phản hồi mất
   return route.continue();});
  const count=async()=>(await f.db.select({id:incomingShipments.id}).from(incomingShipments).where(eq(incomingShipments.supplierId,'a'))).length;
  const before=await count();
  await page.goto(origin+'/#/purchases/new?type=quote&id='+quote.data.id);await page.locator('.pur-create').waitFor();
  assert.ok(await page.locator('.side-nav .nav, .side-nav .nav-group-toggle').evaluateAll(nodes=>nodes.length>0&&nodes.every(n=>getComputedStyle(n).fontWeight==='400')),'menu text regular on desktop/mobile');
  const input=page.locator('.pur-supplier-search input');const resp=page.waitForResponse(r=>r.url().includes('/purchase-options/suppliers?'));await input.fill('NCC a');await resp;
  await page.locator('.pur-supplier-option').first().click();await page.locator('.pur-sup-chip').first().waitFor();
  await page.getByPlaceholder('Nhập địa chỉ giao hàng',{exact:true}).fill('Kho kiểm thử');
  const create=page.locator('.pur-create').getByRole('button',{name:'Tạo đơn nháp',exact:true});
  await create.click();
  await page.getByText(/chưa rõ máy chủ đã lưu/).first().waitFor({timeout:10000});
  assert.equal(await count(),before+1,'máy chủ đã lưu 1 đơn');
  await page.screenshot({path:out+'/lost-response-'+width+'.png'});
  await create.click();
  await page.waitForURL(/#\/purchases\/[^n]/,{timeout:10000});
  assert.equal(bodies.length,2);assert.equal(bodies[1].clientKey,bodies[0].clientKey,'gửi lại cùng mã thao tác');
  assert.equal(await count(),before+1,'không tạo đơn thứ hai');
  const opened=decodeURIComponent(page.url().split('#/purchases/')[1].split('?')[0]);
  const rows=await f.db.select({id:incomingShipments.id}).from(incomingShipments).where(eq(incomingShipments.supplierId,'a'));assert.ok(rows.some(r=>r.id===opened),'mở đúng đơn đã lưu');
  assert.doesNotMatch(await page.locator('body').innerText(),/vượt/);assert.deepEqual(errors,[]);
  await page.screenshot({path:out+'/opened-'+width+'.png'});
  results.push({width,orders:await count()-before,sameKey:true,opened});await context.close();
 }
 console.log('OK',JSON.stringify(results));
}finally{await writeFile(out+'/results.json',JSON.stringify(results,null,2));await browser.close();await new Promise(r=>server.close(r));await f.client.close();}
