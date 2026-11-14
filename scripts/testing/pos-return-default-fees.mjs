/** Trả hàng POS: bill có phí ship / phí dịch vụ, trả hết hàng thì tự đề nghị hoàn phí; Manager duyệt mặc định đúng phí đề nghị.
 * Router thật + PGlite + Chromium; không gọi production. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {eq} from 'drizzle-orm';
import {setup} from '../../tests/helpers/pos-fixture.ts';
import {posReturns} from '../../src/modules/sales/return-schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setup(),shift=await f.open();
const ok=(r,s=200)=>{assert.equal(r.status,s,JSON.stringify(r.data));return r.data;};
const order=ok(await f.call('/pos/checkout',f.emp,'POST',f.cart(shift.id,{feeName:'Gói quà',feeAmount:10800,shippingFee:20000,tendered:300000})),201);
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out=process.env.REVIEW_DIR||'/tmp/pos-return-default-fees';await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');
 if(u.pathname.startsWith('/api/staff/')){const chunks=[];for await(const c of req)chunks.push(c);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined;const who=req.headers['x-role']==='mgr'?f.mgr:f.emp;const r=await f.call(u.pathname.slice(10)+u.search,who,req.method,body);res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;}
 if(u.pathname==='/test'){res.writeHead(200,{'content-type':'text/html'}).end('<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/pos.css"></head><body></body></html>');return;}
 const data=await readFile(root+u.pathname);res.writeHead(200,{'content-type':u.pathname.endsWith('.js')?'text/javascript':'text/css'}).end(data);}catch(e){res.writeHead(404).end(String(e.message));}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:process.env.CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox']});
const openReturns=(page,role)=>page.evaluate(async({orderId,shift,role})=>{const {openPosReturns}=await import('/pos-returns.js');
 window.__toasts=[];const api=async(path,method='GET',body)=>{const r=await fetch('/api/staff'+path,{method,headers:{'content-type':'application/json','x-role':role},body:body?JSON.stringify(body):undefined});const d=await r.json();if(!r.ok)throw Object.assign(Error(d.error||'Lỗi'),{status:r.status});return d;};
 await openPosReturns({api,toast:(m)=>window.__toasts.push(m),shift,register:{id:shift.registerId},orderId});},{orderId:order.id,shift,role});
try{
 const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/test');
 await openReturns(page,'emp');await page.getByRole('button',{name:'Gửi yêu cầu duyệt'}).waitFor();
 const svc=page.getByLabel('Đề nghị hoàn thêm phí dịch vụ'),ship=page.getByLabel('Đề nghị hoàn thêm phí ship'),qty=page.locator('.pos-return-line input').first();
 // Chưa nhập số lượng: chưa đề nghị hoàn phí.
 assert.equal(await svc.inputValue(),'0');assert.equal(await ship.inputValue(),'0');assert.match(await page.locator('.pos-return-fee-note').innerText(),/Trả một phần/);
 // Trả 1/2: vẫn 0.
 await qty.fill('1');assert.equal(await ship.inputValue(),'0');
 // Trả hết 2/2: tự điền 10.800 + 20.000.
 await qty.fill('2');assert.equal(await svc.inputValue(),'10800');assert.equal(await ship.inputValue(),'20000');assert.match(await page.locator('.pos-return-fee-note').innerText(),/Trả toàn bộ hàng/);
 await page.screenshot({path:out+'/request-full.png',fullPage:true});
 // Sửa tay phí ship thì không bị ghi đè khi đổi số lượng.
 await ship.fill('15000');await qty.fill('1');await qty.fill('2');assert.equal(await ship.inputValue(),'15000');
 await ship.fill('20000');
 await page.getByLabel('Lý do đổi/trả (bắt buộc)').fill('Khách trả cả đơn');await page.getByRole('button',{name:'Gửi yêu cầu duyệt'}).click();
 await page.getByText(/Chờ duyệt/).first().waitFor();
 const [saved]=await f.db.select().from(posReturns).where(eq(posReturns.orderId,order.id));assert.equal(saved.requestedServiceFee,10800);assert.equal(saved.requestedShippingFee,20000);
 await page.close();
 // Manager mở: ô duyệt phí mặc định đúng mức đề nghị.
 const m=await browser.newPage({viewport:{width:1366,height:900},deviceScaleFactor:1});m.on('pageerror',e=>errors.push(e.message));await m.goto(origin+'/test');await openReturns(m,'mgr');
 await m.getByRole('button',{name:'Duyệt yêu cầu'}).waitFor();
 assert.equal(await m.getByLabel('Phí dịch vụ được hoàn').inputValue(),'10800');assert.equal(await m.getByLabel('Phí ship được hoàn').inputValue(),'20000');
 await m.screenshot({path:out+'/approve-defaults.png',fullPage:true});
 await m.getByRole('button',{name:'Duyệt yêu cầu'}).click();await m.waitForTimeout(800);
 const [approved]=await f.db.select().from(posReturns).where(eq(posReturns.orderId,order.id));assert.equal(approved.approvedServiceFee,10800);assert.equal(approved.approvedShippingFee,20000);
 assert.deepEqual(errors,[]);console.log('ok',approved.status,approved.total);
}finally{await browser.close();server.close();}
process.exit(0);
