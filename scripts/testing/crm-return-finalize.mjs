/** Trả hàng CRM một bước (Duyệt & hoàn tất) trên router thật + PGlite cục bộ. Không gọi production. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {eq} from 'drizzle-orm';
import {setupCrmReturns} from '../../tests/helpers/crm-return-fixture.ts';
import {salesOrderLines} from '../../src/modules/sales/schema.ts';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';
import {posReturnLines,posReturns} from '../../src/modules/sales/return-schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setupCrmReturns(),root=process.env.UI_ROOT||fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out=process.env.SCREENSHOT_DIR||'/tmp/crm-return-finalize';await mkdir(out,{recursive:true});
await f.seed('demo');await f.seed('old',0,'emp',false);
await f.db.update(salesOrderLines).set({qty:10,deliveredQty:10}).where(eq(salesOrderLines.id,'old-a'));
await postMoves(f.db,'mgr',[{sku:'09566',warehouseId:'pos-wh',qty:8,kind:'opening',refType:'opening',refId:'old-open'}]);
await postMoves(f.db,'mgr',[{sku:'09566',warehouseId:'pos-wh',qty:-8,kind:'sale',refType:'sales_order',refId:'old'}]);
const a=(await f.create('demo',[{orderLineId:'demo-b',qty:2,disposition:'restock'}],{refundRequest:{amount:585241,method:'transfer',reference:'VCB 0123456789 · Nguyễn Văn A',note:'Khách cần hoàn trong ngày'}})).data,b=(await f.create('old',[{orderLineId:'old-a',qty:10,disposition:'restock'}])).data;
await f.seed('decimal',0,'emp',false);
await f.db.update(salesOrderLines).set({qty:0.4,deliveredQty:0.4}).where(eq(salesOrderLines.id,'decimal-a'));
const decimal=(await f.create('decimal',[{orderLineId:'decimal-a',qty:0.4,disposition:'restock'},{orderLineId:'decimal-b',qty:1,disposition:'restock'}])).data;
await f.db.update(posReturns).set({sourceSnapshot:JSON.stringify({...JSON.parse(decimal.sourceSnapshot),unprovenDamagedByLine:{'decimal-a':0.3}})}).where(eq(posReturns.id,decimal.id));
await f.seed('invalid',0,'emp',false);
const invalid=(await f.create('invalid',[{orderLineId:'invalid-a',qty:1,disposition:'restock'}])).data;
await f.db.update(posReturns).set({sourceSnapshot:JSON.stringify({...JSON.parse(invalid.sourceSnapshot),unprovenDamagedByLine:{'invalid-a':2}})}).where(eq(posReturns.id,invalid.id));
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://l'),path=u.pathname;
 if(path.startsWith('/api/staff/')){const ch=[];for await(const c of req)ch.push(c);const body=ch.length?JSON.parse(Buffer.concat(ch).toString()):undefined;const t=req.headers.authorization?.replace(/^Bearer /,'')||'';const r=await f.call(path.slice(10)+u.search,t?'__Host-bn-session='+t:'',req.method,body);res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;}
 let data=await readFile(root+(path==='/'?'index.html':path));if(path==='/')data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':path.endsWith('.svg')?'image/svg+xml':'text/html;charset=utf-8');res.end(data);
}catch(e){res.writeHead(404).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']}:{});
async function open(cookie,width){const ctx=await browser.newContext({viewport:{width,height:900},locale:'vi-VN'});await ctx.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());const user=f.ok(await f.call('/me',cookie)).user;
 await ctx.addInitScript(({token,user})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{token:cookie.split('=')[1],user});const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));return {ctx,page,errors};}
const dlg='dialog.pos-return-modal[open]';
// UI_BEFORE=1: chỉ chụp cửa sổ cũ (nhiều nút rời) để so sánh.
if(process.env.UI_BEFORE){try{const {ctx,page}=await open(f.mgr,1280);await page.goto(origin+'/#/orders/demo?returns=1');await page.locator(dlg).getByRole('button',{name:'Duyệt phiếu trả'}).waitFor();await page.screenshot({path:out+'/1280-before.png'});await ctx.close();}finally{await browser.close();server.close();await f.client.close();}process.exit(0);}
try{
 for(const width of [1280,390]){const {ctx,page,errors}=await open(f.mgr,width);
  const id=width===1280?'demo':'old',r=width===1280?a:b;
  await page.goto(origin+'/#/orders/'+id+'?returns=1');await page.locator(dlg).waitFor();await page.locator(dlg).getByRole('button',{name:'Duyệt & hoàn tất'}).waitFor();
  assert.equal(await page.locator(dlg).getByRole('button',{name:'Duyệt phiếu trả'}).count(),0,'không còn nút duyệt rời');
  await page.locator(dlg).getByRole('button',{name:'Duyệt & hoàn tất'}).click();
  if(id==='demo'){assert.match(await page.locator(dlg).textContent(),/Nhân viên đề nghị hoàn 585\.241/);assert.equal(await page.locator(dlg).getByLabel(/Số tiền hoàn/).inputValue(),'585.241');assert.equal(await page.locator(dlg).getByLabel('Mã giao dịch chuyển khoản').inputValue(),'VCB 0123456789 · Nguyễn Văn A');}
  else assert.equal(await page.locator(dlg).getByLabel('Xử lý phần vượt').inputValue(),'damaged');
  await page.screenshot({path:`${out}/${width}-form.png`});
  // A server-side conflict must leave the user's confirmation and refund fields intact for correction/retry.
  await page.locator(dlg).locator('input[type=checkbox]').last().check();
  if(id==='demo'){
   let calls=0;const count=req=>{if(req.url().endsWith('/returns/'+r.id+'/finalize'))calls++;};page.on('request',count);
   await page.locator(dlg).getByLabel(/Số tiền hoàn/).fill('585242');await page.locator(dlg).getByRole('button',{name:'Duyệt & hoàn tất'}).click();
   await page.getByText('Số tiền hoàn từ 0 đến 585.241 đ.',{exact:true}).waitFor();assert.equal(calls,0,'vượt trần bị chặn trước khi gửi');
   assert.equal(await page.locator(dlg).getByLabel(/Số tiền hoàn/).inputValue(),'585.242');assert.equal(await page.locator(dlg).getByLabel('Mã giao dịch chuyển khoản').inputValue(),'VCB 0123456789 · Nguyễn Văn A');
   await page.locator(dlg).getByLabel(/Số tiền hoàn/).fill('585241');page.off('request',count);
  }
  await page.route('**/returns/'+r.id+'/finalize',route=>route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'Số hoàn vượt phần thực thu dư sau đối trừ công nợ.'})}),{times:1});
  await page.locator(dlg).getByRole('button',{name:'Duyệt & hoàn tất'}).click();
  await page.getByText('Số hoàn vượt phần thực thu dư sau đối trừ công nợ.',{exact:true}).waitFor();
  assert.equal(await page.locator(dlg).locator('input[type=checkbox]').last().isChecked(),true);
  if(id==='demo')assert.equal(await page.locator(dlg).getByLabel('Mã giao dịch chuyển khoản').inputValue(),'VCB 0123456789 · Nguyễn Văn A');
    await page.locator(dlg).locator('input[type=checkbox]').last().check();await page.locator(dlg).getByRole('button',{name:'Duyệt & hoàn tất'}).click();
  await page.waitForFunction(()=>/Hoàn tất/.test(document.querySelector('dialog.pos-return-modal[open]')?.textContent||''));
  const [row]=await f.db.select().from(posReturns).where(eq(posReturns.id,r.id));assert.equal(row.status,'completed',id);
  if(id==='old'){const [line]=await f.db.select().from(posReturnLines).where(eq(posReturnLines.returnId,r.id));assert.equal(line.restockQty,8);assert.equal(line.receivedQty-line.restockQty,2);assert.match(await page.locator(dlg).textContent(),/Nhập tồn 8; hàng hỏng 2/);}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0);
  await page.screenshot({path:`${out}/${width}-done.png`});
  await page.locator(dlg).getByRole('button',{name:'Đóng',exact:true}).click();
  if(id==='old')await page.locator('.order-return-history').getByText(/hàng hỏng 2 Bộ/).waitFor();
  await page.goto(origin+'/#/orders/decimal?returns=1');await page.locator(dlg).getByRole('button',{name:'Duyệt & hoàn tất'}).waitFor();
  assert.match(await page.locator(dlg).textContent(),/Nhập tồn 0,1; hàng hỏng 0,3/);assert.doesNotMatch(await page.locator(dlg).textContent(),/hàng hỏng 0(?![,\d])|0\.30000000000000004/);
  await page.locator(dlg).getByRole('button',{name:'Duyệt & hoàn tất'}).click();assert.match(await page.locator(dlg).textContent(),/Nhập tồn 0,1; hàng hỏng 0,3/);await page.locator(dlg).getByRole('button',{name:'Đóng',exact:true}).click();
  await page.goto(origin+'/#/orders/invalid?returns=1');await page.locator(dlg).getByText(/Cần đối soát:/).waitFor();assert.match(await page.locator(dlg).textContent(),/Phần hàng hỏng trên phiếu không hợp lệ/);
  await page.screenshot({path:`${out}/${width}-invalid-warning.png`});assert.deepEqual(errors,[]);await ctx.close();console.log(width,'ok',id,'decimal + invalid warning');}
}finally{await browser.close();server.close();await f.client.close();}
