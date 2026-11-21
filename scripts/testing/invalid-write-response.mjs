/** Phản hồi ghi hỏng trên form Thu tiền thật (dữ liệu mẫu PGlite cục bộ, không gọi production).
 *  A. Cổng trung gian trả HTML 200, lệnh CHƯA tới máy chủ → báo "chưa rõ", giữ form, không báo thành công;
 *     đóng/mở lại form nhập y hệt → gửi lại cùng mã → lưu 1 phiếu.
 *  B. Máy chủ ĐÃ lưu nhưng phản hồi bị cắt (JSON cụt) → báo "chưa rõ"; gửi lại cùng mã → máy chủ nhận ra, vẫn 1 phiếu.
 *  Không tự gửi lại: mỗi lần chỉ có đúng số lệnh người dùng bấm. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {eq} from 'drizzle-orm';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';
import {customerPayments} from '../../src/modules/sales/schema.ts';
import {setupWarehouseOps,makeCrm} from '../../tests/helpers/warehouse-approval-fixture.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setupWarehouseOps(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out=process.env.SCREENSHOT_DIR||'/tmp/invalid-write-response';await mkdir(out,{recursive:true});
await postMoves(f.db,'mgr',[{sku:'00123',warehouseId:'pos-wh',qty:50,kind:'opening',refType:'opening',refId:'iwr-opening'}]);
const {order}=await makeCrm(f,'IWR',3,'00123','pos-wh',false);
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://l'),path=u.pathname;
 if(path.startsWith('/api/staff/')){const ch=[];for await(const c of req)ch.push(c);const body=ch.length?JSON.parse(Buffer.concat(ch).toString()):undefined;const t=req.headers.authorization?.replace(/^Bearer /,'')||'';
  const r=await f.call(path.slice(10)+u.search,t?'__Host-bn-session='+t:'',req.method,body);res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;}
 let data=await readFile(root+(path==='/'?'index.html':path));if(path==='/')data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.svg')?'image/svg+xml':'text/html;charset=utf-8');res.end(data);
}catch(e){res.writeHead(404).end(String(e.message));}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']}:{});
const user=(await f.call('/me',f.mgr)).data.user,token=f.mgr.split('=')[1];
const count=async()=>(await f.db.select().from(customerPayments).where(eq(customerPayments.orderId,order.id))).filter(p=>!p.voidedAt).length;
const results=[];const step=async(name,fn)=>{try{await fn();results.push(['✔',name]);}catch(e){results.push(['✘',name+' — '+(e.message||e).split('\n')[0]]);}};
try{
 const ctx=await browser.newContext({viewport:{width:Number(process.env.WIDTH||1280),height:900},locale:'vi-VN'});
 await ctx.addInitScript(({token,user})=>{localStorage.setItem('bn-api-region-manual-off','1');localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{token,user});
 const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 let mode='forward';const keys=[];
 await page.route('**/api/staff/payments',async route=>{
  if(route.request().method()!=='POST')return route.continue();
  keys.push(JSON.parse(route.request().postData()).key);
  if(mode==='html')return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Wi-Fi login</title><p>Đăng nhập wifi</p>'}); // chưa tới máy chủ
  if(mode==='truncated'){const r=await route.fetch();const text=await r.text();return route.fulfill({status:r.status(),contentType:'application/json',body:text.slice(0,Math.max(1,text.length-5))});} // đã lưu, phản hồi cụt
  return route.continue();
 });
 await page.goto(origin+'/#/orders/'+order.id);await page.locator('#order-new-payment').waitFor();
 const dlg=page.locator('#payment-dialog'),form=page.locator('#payment-form');
 const fill=async(amount,ref)=>{await page.locator('#order-new-payment').click();await dlg.waitFor();
  await form.locator('[name=amount]:visible, [name=amount] ~ input:visible, input[data-money-proxy]:visible').first().fill(String(amount)).catch(async()=>{await form.locator('[name=amount]').fill(String(amount));});
  await form.locator('[name=method]').selectOption('transfer');await form.locator('[name=reference]').fill(ref);};
 const submit=()=>form.locator('.modal-foot .btn.primary').click();
 const toasts=()=>page.locator('#toasts').innerText();

 await step('A1. HTML 200 chưa tới máy chủ → báo chưa rõ, giữ form, không báo thành công, chưa có phiếu',async()=>{
  mode='html';await fill(1000,'CK-A');await submit();
  await page.locator('#payment-error').filter({hasText:/chưa rõ/}).waitFor({timeout:5000});
  assert.ok(await dlg.isVisible(),'form vẫn mở');assert.equal(await form.locator('[name=reference]').inputValue(),'CK-A','giữ nội dung');
  assert.doesNotMatch(await toasts(),/Đã ghi nhận thanh toán/);assert.equal(await count(),0);assert.equal(keys.length,1,'không tự gửi lại');
  await page.screenshot({path:out+'/A1-chua-ro.png'});
 });
 await step('A2. Đóng form, mở lại nhập y hệt → gửi lại cùng mã → 1 phiếu, báo thành công',async()=>{
  await dlg.locator('[data-close]').first().click().catch(()=>page.keyboard.press('Escape'));mode='forward';
  await fill(1000,'CK-A');await submit();await dlg.waitFor({state:'hidden',timeout:8000});
  assert.match(await toasts(),/Đã ghi nhận thanh toán/);assert.equal(keys[1],keys[0],'cùng mã chống lặp');assert.equal(await count(),1);
 });
 await step('B1. Máy chủ đã lưu nhưng phản hồi cụt → báo chưa rõ, giữ form',async()=>{
  mode='truncated';await fill(2000,'CK-B');await submit();
  await page.locator('#payment-error').filter({hasText:/chưa rõ/}).waitFor({timeout:8000});
  assert.ok(await dlg.isVisible());assert.equal(await count(),2,'máy chủ đã lưu');assert.equal(keys.length,3);
 });
 await step('B2. Bấm gửi lại ngay (form còn mở) → cùng mã → máy chủ trả phiếu cũ, vẫn 2 phiếu',async()=>{
  mode='forward';await submit();await dlg.waitFor({state:'hidden',timeout:8000});
  assert.equal(keys[3],keys[2],'cùng mã');assert.equal(await count(),2,'không ghi lần hai');
 });
 await step('C. Lệnh đọc trả HTML → báo lỗi, trang không vỡ',async()=>{
  await page.route('**/api/staff/orders/'+order.id+'*',r=>r.request().method()==='GET'?r.fulfill({status:200,contentType:'text/html',body:'<html>oops</html>'}):r.continue());
  await page.evaluate(()=>{location.hash='#/orders';});await page.waitForTimeout(500);await page.evaluate(id=>{location.hash='#/orders/'+id;},order.id);await page.waitForTimeout(1500);
  assert.match(await page.locator('body').innerText(),/không hợp lệ|chưa sẵn sàng|Không/i);
 });
 assert.deepEqual(errors,[],'không lỗi JS');
}finally{await browser.close();server.close();}
for(const [s,n] of results)console.log(s,n);
const fail=results.filter(r=>r[0]==='✘').length;console.log(JSON.stringify({pass:results.length-fail,fail}));if(fail)process.exitCode=1;
