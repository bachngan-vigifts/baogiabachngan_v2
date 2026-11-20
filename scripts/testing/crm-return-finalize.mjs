/** Trả hàng CRM một bước (Duyệt & hoàn tất) trên router thật + PGlite cục bộ. Không gọi production. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {eq} from 'drizzle-orm';
import {setupCrmReturns} from '../../tests/helpers/crm-return-fixture.ts';
import {posReturns} from '../../src/modules/sales/return-schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setupCrmReturns(),root=process.env.UI_ROOT||fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out=process.env.SCREENSHOT_DIR||'/tmp/crm-return-finalize';await mkdir(out,{recursive:true});
await f.seed('demo');await f.seed('old',2186125,'emp',false);
const a=(await f.create('demo',[{orderLineId:'demo-b',qty:2,disposition:'restock'}],{refundRequest:{amount:585241,method:'transfer',reference:'VCB 0123456789 · Nguyễn Văn A',note:'Khách cần hoàn trong ngày'}})).data,b=(await f.create('old',[{orderLineId:'old-b',qty:1,disposition:'restock'}])).data;
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
if(process.env.UI_BEFORE){try{const {ctx,page}=await open(f.mgr,1280);await page.goto(origin+'/#/orders/demo?returns=1');await page.locator(dlg).getByRole('button',{name:'Duyệt phiếu trả'}).waitFor();await page.screenshot({path:out+'/1280-before.png'});await ctx.close();}finally{await browser.close();server.close();}process.exit(0);}
try{
 for(const width of [1280,390]){const {ctx,page,errors}=await open(f.mgr,width);
  const id=width===1280?'demo':'old',r=width===1280?a:b;
  await page.goto(origin+'/#/orders/'+id+'?returns=1');await page.locator(dlg).waitFor();await page.locator(dlg).getByRole('button',{name:'Duyệt & hoàn tất'}).waitFor();
  assert.equal(await page.locator(dlg).getByRole('button',{name:'Duyệt phiếu trả'}).count(),0,'không còn nút duyệt rời');
  await page.locator(dlg).getByRole('button',{name:'Duyệt & hoàn tất'}).click();
  if(id==='demo'){assert.match(await page.locator(dlg).textContent(),/Nhân viên đề nghị hoàn 585\.241/);assert.equal(await page.locator(dlg).getByLabel(/Số tiền hoàn/).inputValue(),'585241');assert.equal(await page.locator(dlg).getByLabel('Mã giao dịch chuyển khoản').inputValue(),'VCB 0123456789 · Nguyễn Văn A');}
  else assert.equal(await page.locator(dlg).getByLabel('Xử lý phần vượt').inputValue(),'damaged');
  await page.screenshot({path:`${out}/${width}-form.png`});
    await page.locator(dlg).locator('input[type=checkbox]').last().check();await page.locator(dlg).getByRole('button',{name:'Duyệt & hoàn tất'}).click();
  await page.waitForFunction(()=>/Hoàn tất/.test(document.querySelector('dialog.pos-return-modal[open]')?.textContent||''));
  const [row]=await f.db.select().from(posReturns).where(eq(posReturns.id,r.id));assert.equal(row.status,'completed',id);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0);
  await page.screenshot({path:`${out}/${width}-done.png`});assert.deepEqual(errors,[]);await ctx.close();console.log(width,'ok',id);}
}finally{await browser.close();server.close();}
