/** Trình duyệt -> router thật -> PGlite. Dữ liệu là fixture thử nghiệm; không gọi dịch vụ ngoài, không dùng dữ liệu production. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {eq} from 'drizzle-orm';
import {setupEarly} from '../../tests/helpers/purchase-early-fixture.ts';
import {createAppRouter} from '../../src/app/router.ts';
import {memoryFileStore} from '../../src/core/storage/file-store.ts';
import {incomingShipments,incomingShipmentLines} from '../../src/modules/suppliers/schema.ts';
const{chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setupEarly(),out=process.env.REVIEW_DIR||'/tmp/supplier-delivery-calendar';await mkdir(out,{recursive:true});
// Ngày "hôm nay" theo máy chủ (giờ Việt Nam); hai đơn của NCC a hẹn cùng ngày 17 tháng này, đơn của NCC b không được lộ sang.
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh'}).format(new Date()),month=today.slice(0,7),due=month+'-17',next=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),1)).toISOString().slice(0,7)+'-05';
for(const id of['a1','a2']){await f.db.update(incomingShipments).set({arrivalDate:due}).where(eq(incomingShipments.id,id));await f.db.update(incomingShipmentLines).set({promisedDate:due}).where(eq(incomingShipmentLines.shipmentId,id));}
await f.db.update(incomingShipments).set({arrivalDate:due}).where(eq(incomingShipments.id,'b1'));await f.db.update(incomingShipmentLines).set({promisedDate:due}).where(eq(incomingShipmentLines.shipmentId,'b1'));
await f.db.insert(incomingShipments).values({id:'a3',ticketNumber:'PO-a3',source:'supplier-order',warehouse:'Kho',supplierId:'a',supplierName:'NCC a',approvalStatus:'approved',arrivalDate:next,createdAt:'2026-10-21T00:00:00Z',createdBy:'mgr',updatedAt:'2026-10-21T00:00:00Z'});
await f.db.insert(incomingShipmentLines).values([{id:'line-a3-1',shipmentId:'a3',lineNo:1,sku:'031106000',name:'Chén cơm thử nghiệm',unit:'Cái',quantity:120,promisedDate:next},{id:'line-a3-2',shipmentId:'a3',lineNo:2,sku:'01654020803',name:'Bộ trà thử nghiệm',unit:'Bộ',quantity:8,promisedDate:next}]);
const router=createAppRouter(),env={db:f.db,passwordIterations:1000,sapoOrderPush:'off',files:memoryFileStore()},root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),calls=[];
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/staff/')){const chunks=[];for await(const x of req)chunks.push(x);const token=req.headers.authorization?.replace(/^Bearer /,''),path=u.pathname.slice('/api/staff'.length)+u.search;calls.push({path,method:req.method});const r=await router.handle(new Request('https://trial.test/api/staff'+path,{method:req.method,headers:{origin:'https://trial.test','content-type':'application/json',cookie:token?'__Host-bn-session='+token:''},body:chunks.length?Buffer.concat(chunks):undefined}),env);let payload=await r.json();const cookie=r.headers.get('set-cookie');if(cookie)payload.sessionToken=/__Host-bn-session=([a-f0-9]{64})/.exec(cookie)?.[1]||'';res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(payload));return;}
 const path=u.pathname==='/'?'/supplier.html':u.pathname;if(path.includes('..')){res.writeHead(403).end();return;}let data=await readFile(root+path);if(path.endsWith('.html'))data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));res.writeHead(200,{'content-type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.jpeg')?'image/jpeg':'text/html;charset=utf-8'}).end(data);
}catch(e){res.writeHead(500).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox']}),errors=[],results=[];
try{
 for(const width of[1440,390]){
  const context=await browser.newContext({viewport:{width,height:width===390?844:1000},reducedMotion:'reduce',locale:'vi-VN',deviceScaleFactor:1});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());await context.addInitScript(token=>localStorage.setItem('bn-v2-session',token),f.cookies.ncc.split('=')[1]);
  const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));calls.length=0;
  await p.goto(origin+'/supplier.html#overview');await p.locator('#ncc-overview-panels .ncc-panel-action').waitFor();
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'overview overflow');await p.screenshot({path:out+'/overview-'+width+'.png',fullPage:true});
  await p.locator('#ncc-overview-panels .ncc-panel-action').click();await p.locator('#ncc-page h1').filter({hasText:'Lịch giao theo ngày'}).waitFor();await p.locator('#ncc-cal-day .ncc-loading').waitFor({state:'hidden'});
  assert.equal(new URL(p.url()).hash,'#calendar');assert.equal(await p.locator('#ncc-cal-title').innerText(),'Tháng '+Number(month.slice(5,7))+'/'+month.slice(0,4));
  // Chỉ ngày 17 có đơn, đúng hai đơn của NCC a; đơn của NCC b không xuất hiện.
  assert.deepEqual(await p.locator('[data-day]').evaluateAll(n=>n.map(x=>x.dataset.day)),[due]);assert.match(await p.locator('[data-day]').innerText(),/2 đơn/);
  const dayText=await p.locator('#ncc-cal-day').innerText();assert.match(dayText,/PO-a1/);assert.match(dayText,/PO-a2/);assert.doesNotMatch(dayText,/PO-b1/);assert.match(dayText,/15\.000 sản phẩm/);
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'calendar overflow');
  // Xem mã hàng ngay trong lịch.
  await p.locator('[data-lines="a1"]').click();await p.locator('.ncc-cal-lines').waitFor();assert.match(await p.locator('.ncc-cal-lines').innerText(),/031106000/);assert.match(await p.locator('.ncc-cal-lines').innerText(),/8\.000/);
  await p.screenshot({path:out+'/calendar-'+width+'.png',fullPage:true});
  await p.locator('[data-lines="a1"]').click();assert.equal(await p.locator('.ncc-cal-lines').count(),0);
  // Mở chi tiết đơn bằng ngăn có sẵn của trang Đơn đặt hàng.
  await p.locator('[data-order="a2"]').click();await p.locator('.ncc-drawer h3').filter({hasText:'Hàng trên đơn PO-a2'}).waitFor();await p.locator('.ncc-drawer-head [data-close]').click();
  // Sang tháng sau: đơn a3 hẹn ngày 05, có hai mã hàng.
  await p.locator('[data-cal="next"]').click();await p.locator('[data-day="'+next+'"]').waitFor();assert.match(await p.locator('#ncc-cal-day').innerText(),/PO-a3/);
  await p.locator('[data-lines="a3"]').click();await p.locator('.ncc-cal-lines tbody tr').nth(1).waitFor();assert.equal(await p.locator('.ncc-cal-lines tbody tr').count(),2);
  // Tháng trước nữa không có đơn: báo rõ, không lỗi.
  await p.locator('[data-cal="prev"]').click();await p.locator('[data-cal="prev"]').click();await p.locator('#ncc-cal-day .ncc-empty').waitFor();assert.match(await p.locator('#ncc-cal-sum').innerText(),/Không có đơn/);
  await p.locator('[data-cal="today"]').click();await p.locator('[data-day="'+due+'"]').waitFor();
  // Làm mới, rồi quay lại trang danh sách vẫn chạy bình thường.
  await p.locator('#ncc-refresh').click();await p.locator('[data-day="'+due+'"]').waitFor();
  await p.goto(origin+'/supplier.html#orders');await p.locator('#ncc-records .ncc-table').waitFor();await p.goBack();await p.locator('[data-day="'+due+'"]').waitFor();
  assert.equal(await p.locator('#ncc-message.error:not([hidden]),#ncc-cal-message.error:not([hidden])').count(),0);
  assert.ok(calls.every(c=>c.method==='GET'),'calendar only reads: '+JSON.stringify(calls.filter(c=>c.method!=='GET')));
  results.push({width,calls:calls.length});await context.close();
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,results}));
}finally{await browser.close();await new Promise(r=>server.close(r));}
process.exit(0);
