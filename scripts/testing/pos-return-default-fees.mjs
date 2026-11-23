/** Real router/PGlite + Chromium, synthetic data only; outbound browser traffic is blocked. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {eq} from 'drizzle-orm';
import {setup} from '../../tests/helpers/pos-fixture.ts';
import {employees} from '../../src/modules/staff/schema.ts';
import {salesOrderLines} from '../../src/modules/sales/schema.ts';
import {posReturns} from '../../src/modules/sales/return-schema.ts';
import {stockBalances} from '../../src/modules/inventory/schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setup(),shift=await f.open(),writes=[];
const ok=(r,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};
await f.db.update(employees).set({canApprove:true}).where(eq(employees.id,'cashier2'));
await f.db.update(stockBalances).set({qty:1000});
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out=process.env.REVIEW_DIR||'/tmp/pos-return-default-fees';await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname.startsWith('/api/staff/')){
  const chunks=[];for await(const c of req)chunks.push(c);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined;
  const who=req.headers['x-role']==='mgr'?f.mgr:req.headers['x-role']==='delegated'?f.other:f.emp;
  const route=u.pathname.slice(10)+u.search,r=await f.call(route,who,req.method,body);
  if(req.method!=='GET')writes.push({route,body,status:r.status});
  res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;
 }
 if(u.pathname==='/test'){res.writeHead(200,{'content-type':'text/html'}).end('<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/pos.css"></head><body></body></html>');return;}
 res.writeHead(200,{'content-type':u.pathname.endsWith('.js')?'text/javascript':'text/css'}).end(await readFile(root+u.pathname));
}catch(e){res.writeHead(500).end(String(e.message));}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||process.env.CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox']});
const results=[];
const openReturns=(page,role,orderId)=>page.evaluate(async({orderId,shift,role})=>{
 const {openPosReturns}=await import('/pos-returns.js');window.__toasts=[];
 const api=async(path,method='GET',body)=>{const r=await fetch('/api/staff'+path,{method,headers:{'content-type':'application/json','x-role':role},body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Object.assign(Error(d.error||'Lỗi'),{status:r.status});return d;};
 await openPosReturns({api,toast:m=>window.__toasts.push(m),shift,register:{id:shift.registerId},orderId});
},{orderId,shift,role});
async function newSale(fees){return ok(await f.call('/pos/checkout',f.emp,'POST',f.cart(shift.id,{feeName:fees?'Gói quà':'',feeAmount:fees?10800:0,shippingFee:fees?20000:0,tendered:300000})),201);}
async function newRequest(fees){const order=await newSale(fees),lines=await f.db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId,order.id));const r=ok(await f.call('/pos/returns',f.emp,'POST',{key:crypto.randomUUID(),orderId:order.id,shiftId:shift.id,reason:'Kiểm thử phí trả hàng',serviceFee:fees?10800:0,shippingFee:fees?20000:0,lines:lines.map(l=>({orderLineId:l.id,qty:l.qty}))}),201);return {order,r};}
async function scenario(width,name,run){
 const context=await browser.newContext({viewport:{width,height:900},locale:'vi-VN'}),errors=[];
 await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 try{await page.goto(origin+'/test');await run(page);assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.__toasts||[]),[]);results.push({width,name,passed:true,errors});}
 catch(e){results.push({width,name,passed:false,error:e.message,errors});await page.screenshot({path:out+'/FAIL-'+width+'-'+name+'.png',fullPage:true}).catch(()=>{});}
 finally{await context.close();}
}
try{
 await scenario(390,'request-defaults',async page=>{
  const order=await newSale(true);await openReturns(page,'emp',order.id);
  const svc=page.getByLabel('Đề nghị hoàn thêm phí dịch vụ'),ship=page.getByLabel('Đề nghị hoàn thêm phí ship'),qty=page.locator('.pos-return-line input').first();
  assert.equal(await svc.inputValue(),'0');assert.equal(await ship.inputValue(),'0');
  await qty.fill('1');assert.equal(await ship.inputValue(),'0');await qty.fill('2');assert.equal(await svc.inputValue(),'10800');assert.equal(await ship.inputValue(),'20000');
  await ship.fill('15000');await qty.fill('1');await qty.fill('2');assert.equal(await ship.inputValue(),'15000');await ship.fill('20000');
  await page.getByLabel('Lý do đổi/trả (bắt buộc)').fill('Trả cả đơn');
  const [response]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/pos/returns')&&r.request().method()==='POST'),page.getByRole('button',{name:'Gửi yêu cầu duyệt',exact:true}).click()]);assert.equal(response.status(),201);
  const [saved]=await f.db.select().from(posReturns).where(eq(posReturns.orderId,order.id));assert.equal(saved.requestedServiceFee,10800);assert.equal(saved.requestedShippingFee,20000);
 });
 for(const width of [390,1280]){
  await scenario(width,'delegated-fees',async page=>{
   const {order,r}=await newRequest(true);await openReturns(page,'delegated',order.id);
   const modal=page.locator('.pos-return-modal');
   assert.equal(await page.getByLabel('Phí dịch vụ được hoàn').count(),0);assert.equal(await page.getByLabel('Phí ship được hoàn').count(),0);
   assert.match(await modal.innerText(),/Phí đề nghị: dịch vụ 10.800 đ.*ship 20.000 đ/);
   assert.equal(await modal.getByText('Chỉ Manager được hoàn phí dịch vụ/ship',{exact:true}).count(),1);assert.doesNotMatch(await modal.innerText(),/đang chờ quyết định của Manager/);
   const path='/pos/returns/'+r.id+'/approve',count=()=>writes.filter(w=>w.route===path).length;
   await modal.getByRole('button',{name:'Duyệt yêu cầu',exact:true}).click();
   const confirm=page.getByRole('dialog',{name:'Duyệt không hoàn phí',exact:true});await confirm.waitFor({timeout:3000});
   assert.match(await confirm.innerText(),/phí hoàn = 0 đ/);assert.match(await confirm.innerText(),/không duyệt lại được/);assert.match(await confirm.innerText(),/10.800 đ/);assert.match(await confirm.innerText(),/20.000 đ/);
   await page.screenshot({path:out+'/delegated-'+width+'.png',fullPage:true});
   await confirm.getByRole('button',{name:'Huỷ',exact:true}).click();assert.equal(count(),0);
   assert.equal((await f.db.select().from(posReturns).where(eq(posReturns.id,r.id)))[0].status,'pending');
   await modal.getByRole('button',{name:'Duyệt yêu cầu',exact:true}).click();
   const [response]=await Promise.all([page.waitForResponse(r=>r.url().endsWith(path)&&r.request().method()==='POST'),confirm.getByRole('button',{name:'Duyệt, không hoàn phí',exact:true}).click()]);assert.equal(response.status(),200);assert.equal(count(),1);await modal.getByText('Phí được duyệt hoàn: 0 đ',{exact:true}).waitFor();
   const [saved]=await f.db.select().from(posReturns).where(eq(posReturns.id,r.id));assert.equal(saved.status,'approved');assert.equal(saved.approvedServiceFee,0);assert.equal(saved.approvedShippingFee,0);assert.equal(saved.requestedServiceFee,10800);assert.equal(saved.requestedShippingFee,20000);
   assert.equal((await f.call(path,f.mgr,'POST',{serviceFee:10800,shippingFee:20000})).status,409);
  });
  await scenario(width,'delegated-zero',async page=>{
   const {order,r}=await newRequest(false);await openReturns(page,'delegated',order.id);
   assert.doesNotMatch(await page.locator('.pos-return-modal').innerText(),/Chỉ Manager được hoàn phí|chờ quyết định của Manager/);assert.match(await page.locator('.pos-return-modal').innerText(),/Không đề nghị hoàn phí/);
   const path='/pos/returns/'+r.id+'/approve';const [response]=await Promise.all([page.waitForResponse(r=>r.url().endsWith(path)&&r.request().method()==='POST'),page.getByRole('button',{name:'Duyệt yêu cầu',exact:true}).click()]);assert.equal(response.status(),200);await page.getByText('Phí được duyệt hoàn: 0 đ',{exact:true}).waitFor();assert.equal(await page.getByRole('dialog',{name:'Duyệt không hoàn phí'}).count(),0);
  });
  await scenario(width,'manager',async page=>{
   const {order,r}=await newRequest(true);await openReturns(page,'mgr',order.id);
   assert.doesNotMatch(await page.locator('.pos-return-modal').innerText(),/Chỉ Manager được hoàn phí dịch vụ\/ship/);
   assert.equal(await page.getByLabel('Phí dịch vụ được hoàn').inputValue(),'10800');assert.equal(await page.getByLabel('Phí dịch vụ được hoàn').getAttribute('max'),'10800');assert.equal(await page.getByLabel('Phí ship được hoàn').inputValue(),'20000');assert.equal(await page.getByLabel('Phí ship được hoàn').getAttribute('max'),'20000');
   const path='/pos/returns/'+r.id+'/approve';const [response]=await Promise.all([page.waitForResponse(r=>r.url().endsWith(path)&&r.request().method()==='POST'),page.getByRole('button',{name:'Duyệt yêu cầu',exact:true}).click()]);assert.equal(response.status(),200);await page.getByText('Phí được duyệt hoàn: 30.800 đ',{exact:true}).waitFor();assert.equal(await page.getByRole('dialog',{name:'Duyệt không hoàn phí'}).count(),0);
   const [saved]=await f.db.select().from(posReturns).where(eq(posReturns.id,r.id));assert.equal(saved.approvedServiceFee,10800);assert.equal(saved.approvedShippingFee,20000);
  });
 }
 assert.equal(browser.contexts().length,0);
}finally{await writeFile(out+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));await browser.close();server.close();await f.client.close();}
process.exitCode=results.some(r=>!r.passed)?1:0;
