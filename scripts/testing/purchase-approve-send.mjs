/** Đơn mua NCC: Manager "Duyệt & gửi NCC" một lần bấm (duyệt + gửi email PDF). Mailer giả, PGlite cục bộ – không gửi email thật, không gọi production. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {eq} from 'drizzle-orm';
import {setupEarly} from '../../tests/helpers/purchase-early-fixture.ts';
import {products} from '../../src/modules/catalog/schema.ts';
import {incomingShipments,incomingShipmentLines,supplierContacts,supplierOrderEvents} from '../../src/modules/suppliers/schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setupEarly(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out=process.env.SCREENSHOT_DIR||'/tmp/purchase-approve-send';await mkdir(out,{recursive:true});
const sent=[];let mailOk=true;
f.env.mailer={apiKey:'test-key-0123456789',from:'Bách Ngân <don-hang@test.vn>',fetch:async(_u,init)=>{sent.push(JSON.parse(init.body));return mailOk?new Response(JSON.stringify({id:'mail-'+sent.length}),{status:200}):new Response('{}',{status:500});}};
await f.db.insert(products).values([{sku:'031106000',name:'Bộ trà Jasmine',unit:'Cái',updatedAt:'2026-10-01T00:00:00Z'}]);
await f.db.insert(supplierContacts).values({id:'c-a',supplierId:'a',kind:'order',name:'Phòng bán hàng',email:'donhang@ncc-a.test',createdAt:'2026-10-01T00:00:00Z'});
const now='2026-10-21T00:00:00Z';
for(const id of ['p1','p2']){await f.db.insert(incomingShipments).values({id,ticketNumber:'PO-'+id,source:'supplier-order',warehouse:'Kho',supplierId:'a',supplierName:'NCC a',approvalStatus:'pending',submittedAt:now,arrivalDate:'2099-12-01',createdAt:now,createdBy:'mgr',updatedAt:now});
 await f.db.insert(incomingShipmentLines).values({id:'line-'+id,shipmentId:id,lineNo:1,sku:'031106000',name:'Bộ trà Jasmine',unit:'Cái',quantity:10,promisedDate:'2099-12-01',price:120000});}
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://l'),path=u.pathname;
 if(path.startsWith('/api/staff/')){const ch=[];for await(const c of req)ch.push(c);const body=ch.length?JSON.parse(Buffer.concat(ch).toString()):undefined;const t=req.headers.authorization?.replace(/^Bearer /,'')||'';const r=await f.call(path.slice(10)+u.search,t?'__Host-bn-session='+t:'',req.method,body);res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;}
 let data=await readFile(root+(path==='/'?'index.html':path));if(path==='/')data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':path.endsWith('.svg')?'image/svg+xml':'text/html;charset=utf-8');res.end(data);
}catch(e){res.writeHead(404).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']}:{});
const ctx=await browser.newContext({viewport:{width:1440,height:900},locale:'vi-VN'});await ctx.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
const user=(await f.call('/me',f.cookies.mgr)).data.user;await ctx.addInitScript(({token,user})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{token:f.cookies.mgr.split('=')[1],user});
const page=await ctx.newPage(),errors=[],toasts=[];page.on('pageerror',e=>errors.push(e.message));
const openApprove=async id=>{await page.goto(origin+'/#/purchases/'+id);await page.locator('.pur-drawer:not([hidden]) .pur-main-action').waitFor();assert.equal(await page.locator('.pur-drawer .pur-main-action').textContent(),'Duyệt giá');await page.locator('.pur-drawer .pur-main-action').click();await page.getByRole('button',{name:'Duyệt & gửi NCC'}).waitFor();};
const status=async id=>(await f.db.select().from(incomingShipments).where(eq(incomingShipments.id,id)))[0].approvalStatus;
const waitToast=re=>page.waitForFunction(src=>[...document.querySelectorAll('.toast')].some(t=>new RegExp(src).test(t.textContent)),re.source,{timeout:15000});
try{
 // 1. Duyệt & gửi: một lần bấm, đơn duyệt + email PDF tới email nhận đơn trong danh bạ.
 await openApprove('p1');assert.equal(await page.getByRole('checkbox',{name:'Gửi email đơn cho NCC ngay sau khi duyệt'}).isChecked(),true);await page.screenshot({path:out+'/1-form.png'});
 await page.getByRole('button',{name:'Duyệt & gửi NCC'}).click();await waitToast(/Đã duyệt và gửi email đơn tới donhang@ncc-a\.test/);
 assert.equal(await status('p1'),'approved');assert.equal(sent.length,1);assert.deepEqual(sent[0].to,['donhang@ncc-a.test']);assert.equal(sent[0].attachments[0].filename,'Don-dat-hang-PO-p1.pdf');
 const ev=(await f.db.select().from(supplierOrderEvents).where(eq(supplierOrderEvents.shipmentId,'p1'))).map(e=>e.action);assert.ok(ev.includes('approve')&&ev.includes('mail'),ev.join(','));
 await page.screenshot({path:out+'/2-done.png'});
 // 2. Dịch vụ email lỗi: đơn vẫn duyệt, báo rõ để gửi lại – không mất bước duyệt.
 mailOk=false;await openApprove('p2');await page.getByRole('button',{name:'Duyệt & gửi NCC'}).click();await waitToast(/Đã duyệt đơn, nhưng chưa gửi được email NCC/);assert.equal(await status('p2'),'approved');
 // 3. Bỏ tích: nhãn nút đổi về "Duyệt đơn".
 assert.deepEqual(errors,[]);console.log('ok',JSON.stringify({sent:sent.length}));
}finally{await browser.close();server.close();await f.client.close();}
