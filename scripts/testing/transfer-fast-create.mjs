/** Manager "Tạo & xuất kho" / "Tạo & duyệt" trên form điều chuyển; nhân viên vẫn "Gửi duyệt". Router thật + PGlite cục bộ, không gọi production. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {auditLogs} from '../../src/core/db/schema.ts';
import {and,eq} from 'drizzle-orm';
import {warehouses} from '../../src/modules/catalog/schema.ts';
import {stockBalances,stockTransfers} from '../../src/modules/inventory/schema.ts';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';
import {setupWarehouseOps,makeCrm} from '../../tests/helpers/warehouse-approval-fixture.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setupWarehouseOps(),root=process.env.UI_ROOT||fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out=process.env.SCREENSHOT_DIR||'/tmp/transfer-fast-create';await mkdir(out,{recursive:true});
await f.db.insert(warehouses).values({id:'target',name:'Kho nhận thử',kind:'stock'});
const opened=await f.db.select().from(stockBalances).where(eq(stockBalances.warehouseId,'pos-wh'));if(!opened.length)await postMoves(f.db,'mgr',[{sku:'00123',warehouseId:'pos-wh',qty:100,kind:'opening',refType:'opening',refId:'fast-open'}]);
await postMoves(f.db,'mgr',[{sku:'00123',warehouseId:'target',qty:0.001,kind:'opening',refType:'opening',refId:'fast-open-target'}]);
const heldOrder=await makeCrm(f,'held-fast',99);
assert.equal((await f.call('/orders/'+heldOrder.order.id+'/holds',f.mgr,'POST',{clientKey:'fast-held-test'})).status,201);
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://l'),path=u.pathname;
 if(path.startsWith('/api/staff/')){const ch=[];for await(const c of req)ch.push(c);const body=ch.length?JSON.parse(Buffer.concat(ch).toString()):undefined;const t=req.headers.authorization?.replace(/^Bearer /,'')||'';const r=await f.call(path.slice(10)+u.search,t?'__Host-bn-session='+t:'',req.method,body);res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;}
 let data=await readFile(root+(path==='/'?'index.html':path));if(path==='/')data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':path.endsWith('.svg')?'image/svg+xml':'text/html;charset=utf-8');res.end(data);
}catch(e){res.writeHead(404).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']}:{});
const bal=async wh=>(await f.db.select().from(stockBalances).where(and(eq(stockBalances.sku,'00123'),eq(stockBalances.warehouseId,wh))))[0]?.qty??0;
async function open(cookie,width){const ctx=await browser.newContext({viewport:{width,height:900},locale:'vi-VN'});await ctx.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());const user=(await f.call('/me',cookie)).data.user;
 await ctx.addInitScript(({token,user})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{token:cookie.split('=')[1],user});const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));return {ctx,page,errors};}
async function fill(page){const d=page.locator('.sup-drawer:not([hidden])');await d.waitFor();await d.getByRole('combobox',{name:'Kho đi'}).selectOption('pos-wh');await d.locator('select').nth(1).selectOption('target');
 await d.getByPlaceholder(/VD: đơn/).fill('Bổ sung hàng trưng bày');const find=d.getByRole('searchbox').or(d.locator('input[type=search]')).first();await find.fill('00123');await d.locator('.transfer-search-result').first().click();
 await d.locator('input[type=number]').first().fill('3');return d;}
try{
 for(const width of [1280,390]){
  const {ctx,page,errors}=await open(f.mgr,width);await page.goto(origin+'/#/transfers');await page.getByRole('button',{name:'＋ Xin điều chuyển'}).click();const d=await fill(page);
  assert.equal(await d.getByRole('button',{name:'Gửi duyệt',exact:true}).count(),0,'Manager không còn nút Gửi duyệt rời');
  await page.screenshot({path:`${out}/${width}-form.png`});
  const before=await bal('pos-wh');await d.getByRole('button',{name:'Tạo & xuất kho'}).click();
  const prompt=page.getByRole('dialog').filter({hasText:'Lấy hàng đang giữ cho đơn khác'});await prompt.waitFor();
  // Cancel leaves stock and form intact. A second attempt must ask for a real reason again.
  await prompt.getByRole('button',{name:'Huỷ',exact:true}).click();assert.equal(await bal('pos-wh'),before);
  await d.getByRole('button',{name:'Tạo & xuất kho'}).click();await prompt.waitFor();
  await prompt.locator('textarea,input:not([type=hidden])').first().fill('Ưu tiên chuyển hàng đã được Manager xác nhận');
  await prompt.getByRole('button',{name:'Gửi',exact:true}).click();
  await page.waitForFunction(()=>/#\/transfers\/[0-9a-f-]{36}/.test(location.hash));
  await page.waitForTimeout(800);assert.equal(await bal('pos-wh'),before-3,'trừ kho đi ngay');
  const id=page.url().split('/transfers/')[1];assert.equal((await f.db.select().from(stockTransfers).where(eq(stockTransfers.id,id)))[0].status,'shipped');
  const audits=await f.db.select().from(auditLogs).where(and(eq(auditLogs.entityId,id),eq(auditLogs.action,'stock-hold-override')));assert.equal(audits.length,1);assert.equal(JSON.parse(audits[0].data).reason,'Ưu tiên chuyển hàng đã được Manager xác nhận');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0);await page.screenshot({path:`${out}/${width}-shipped.png`});
  // Tạo & duyệt: chưa trừ kho.
  await page.goto(origin+'/#/transfers');await page.getByRole('button',{name:'＋ Xin điều chuyển'}).click();const d2=await fill(page);const b2=await bal('pos-wh');
  await d2.getByRole('button',{name:'Tạo & duyệt (kho xuất sau)'}).click();await page.waitForFunction(()=>/#\/transfers\/[0-9a-f-]{36}/.test(location.hash));await page.waitForTimeout(500);
  const id2=page.url().split('/transfers/')[1];assert.equal((await f.db.select().from(stockTransfers).where(eq(stockTransfers.id,id2)))[0].status,'approved');assert.equal(await bal('pos-wh'),b2);
  // A replay may have advanced since the original create. Toast must trust the returned state, not the clicked mode.
  await page.goto(origin+'/#/transfers');await page.getByRole('button',{name:'＋ Xin điều chuyển'}).click();const d3=await fill(page);
  await page.route('**/api/staff/stock-transfers',async route=>{if(route.request().method()!=='POST')return route.continue();const response=await route.fetch(),data=await response.json();await route.fulfill({response,json:{...data,status:'shipped',replayed:true}});},{times:1});
  await page.evaluate(()=>document.querySelector('#toasts').replaceChildren());
  await d3.getByRole('button',{name:'Tạo & duyệt (kho xuất sau)'}).click();await page.waitForFunction(()=>/#\/transfers\/[0-9a-f-]{36}/.test(location.hash));await page.locator('.toast').filter({hasText:'đã xuất kho, chờ kho đến nhận'}).waitFor();
  assert.deepEqual(errors,[]);await ctx.close();console.log(width,'ok manager');
 }
 // Nhân viên: chỉ "Gửi duyệt".
 const {ctx,page,errors}=await open(f.sa,1280);await page.goto(origin+'/#/transfers');await page.getByRole('button',{name:'＋ Xin điều chuyển'}).click();const d=page.locator('.sup-drawer:not([hidden])');await d.waitFor();
 assert.equal(await d.getByRole('button',{name:'Gửi duyệt',exact:true}).count(),1);assert.equal(await d.getByRole('button',{name:'Tạo & xuất kho'}).count(),0);assert.deepEqual(errors,[]);await ctx.close();console.log('ok staff');
}finally{await browser.close();server.close();await f.client.close();}
