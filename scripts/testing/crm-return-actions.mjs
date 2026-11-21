/** Kiểm từng thao tác trả hàng / hoàn tiền CRM qua giao diện thật + router thật + PGlite cục bộ. Không gọi production. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {eq} from 'drizzle-orm';
import {setupCrmReturns} from '../../tests/helpers/crm-return-fixture.ts';
import {posReturns,posRefunds,posReturnLines} from '../../src/modules/sales/return-schema.ts';
import {salesOrders} from '../../src/modules/sales/schema.ts';
import {stockMoves} from '../../src/modules/inventory/schema.ts';
import {employees} from '../../src/modules/staff/schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setupCrmReturns(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out=process.env.SCREENSHOT_DIR||'/tmp/crm-return-actions';await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://l'),path=u.pathname;
 if(path.startsWith('/api/staff/')){const ch=[];for await(const c of req)ch.push(c);const body=ch.length?JSON.parse(Buffer.concat(ch).toString()):undefined;const t=req.headers.authorization?.replace(/^Bearer /,'')||'';const r=await f.call(path.slice(10)+u.search,t?'__Host-bn-session='+t:'',req.method,body);res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;}
 let data=await readFile(root+(path==='/'?'index.html':path));if(path==='/')data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':path.endsWith('.svg')?'image/svg+xml':'text/html;charset=utf-8');res.end(data);
}catch(e){res.writeHead(404).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']}:{});
const D='dialog.pos-return-modal[open]',results=[];
async function open(cookie,order,width=1280){const ctx=await browser.newContext({viewport:{width,height:900},locale:'vi-VN'});await ctx.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());const user=f.ok(await f.call('/me',cookie)).user;
 await ctx.addInitScript(({token,user})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{token:cookie.split('=')[1],user});
 const page=await ctx.newPage(),errors=[],toasts=[];page.on('pageerror',e=>errors.push(e.message));await page.exposeFunction('__toast',t=>toasts.push(t));
 await page.addInitScript(()=>{new MutationObserver(()=>{for(const n of document.querySelectorAll('.toast:not([data-seen])')){n.dataset.seen='1';window.__toast(n.textContent);}}).observe(document,{childList:true,subtree:true});});
 await page.goto(origin+'/#/orders/'+order+'?returns=1');await page.locator(D).waitFor();await page.waitForFunction(D=>!/Đang tải/.test(document.querySelector(D)?.textContent||'')&&document.querySelector(D+' h3'),D);
 return {ctx,page,errors,toasts,d:page.locator(D)};}
const btn=(d,name)=>d.getByRole('button',{name,exact:true});
const ret=async id=>(await f.db.select().from(posReturns).where(eq(posReturns.id,id)))[0];
const waitText=(page,re)=>page.waitForFunction(([D,src])=>new RegExp(src).test(document.querySelector(D)?.textContent||''),[D,re.source],{timeout:10000});
async function step(name,fn){const t=Date.now();try{await fn();results.push({name,ok:true,ms:Date.now()-t});console.log('✔',name);}catch(e){results.push({name,ok:false,error:String(e.message||e).split('\n')[0].slice(0,300)});console.log('✘',name,'—',String(e.message||e).split('\n')[0].slice(0,300));}}
const refundAll=async(order,id,extra={})=>f.ok(await f.call(`/orders/${order}/returns/${id}/finalize`,f.mgr,'POST',{confirmed:true,...extra}));
try{
 await step('1. NV lập phiếu trả (giảm công nợ) qua form, kèm đề nghị hoàn tiền',async()=>{
  await f.seed('s1');const {ctx,page,d,errors}=await open(f.emp,'s1');
  await d.getByLabel(/Số lượng trả \(còn 2/).nth(1).fill('2');await d.getByLabel('Mục đích nhận hàng').selectOption('credit');
  await d.getByLabel('Kho thực nhận').selectOption('pos-wh');await d.getByLabel('Lý do trả hàng').fill('Khách đổi ý');
  await d.getByLabel(/Số tiền đề nghị hoàn/).fill('585241');await d.getByLabel(/Tài khoản nhận/).fill('VCB 0123 Nguyễn A');
  await btn(d,'Gửi yêu cầu trả hàng').click();await waitText(page,/Chờ duyệt/);
  const [r]=await f.db.select().from(posReturns).where(eq(posReturns.orderId,'s1'));assert.equal(r.status,'pending');assert.equal(JSON.parse(r.sourceSnapshot).refundRequest.amount,585241);
  assert.match(await d.textContent(),/Đề nghị hoàn: 585\.241/);assert.equal(await btn(d,'Duyệt & hoàn tất').count(),0,'NV thường không có nút duyệt');
  await page.screenshot({path:out+'/1-nv-lap-phieu.png'});assert.deepEqual(errors,[]);await ctx.close();});
 await step('2. NV huỷ phiếu chưa duyệt của mình',async()=>{
  await f.seed('s2');const {data:r}=await f.create('s2',[{orderLineId:'s2-a',qty:1,disposition:'restock'}]);const {ctx,page,d}=await open(f.emp,'s2');
  await btn(d,'Huỷ yêu cầu').click();await d.getByLabel('Lý do huỷ / từ chối').fill('Nhập nhầm');await btn(d,'Xác nhận huỷ / từ chối').click();await waitText(page,/Đã huỷ/);
  assert.equal((await ret(r.id)).status,'cancelled');await ctx.close();});
 await step('3. Manager từ chối phiếu',async()=>{
  await f.seed('s3');const {data:r}=await f.create('s3',[{orderLineId:'s3-a',qty:1,disposition:'restock'}]);const {ctx,page,d}=await open(f.mgr,'s3');
  await btn(d,'Từ chối').click();await d.getByLabel('Lý do huỷ / từ chối').fill('Hàng không đủ điều kiện');await btn(d,'Xác nhận huỷ / từ chối').click();await waitText(page,/Đã từ chối/);
  assert.equal((await ret(r.id)).status,'rejected');await ctx.close();});
 await step('4. Manager Duyệt & hoàn tất, hoàn chuyển khoản theo đề nghị NV',async()=>{
  await f.seed('s4');const {data:r}=await f.create('s4',[{orderLineId:'s4-b',qty:2,disposition:'restock'}],{refundRequest:{amount:585241,method:'transfer',reference:'VCB 0123'}});
  const {ctx,page,d,errors}=await open(f.mgr,'s4');await btn(d,'Duyệt & hoàn tất').click();
  assert.equal(await d.getByLabel(/Số tiền hoàn/).inputValue(),'585241');assert.equal(await d.getByLabel('Mã giao dịch chuyển khoản').inputValue(),'VCB 0123');
  await d.locator('input[type=checkbox]').last().check();await btn(d,'Duyệt & hoàn tất').click();await waitText(page,/Hoàn tất/);
  const x=await ret(r.id);assert.equal(x.status,'completed');assert.equal((await f.db.select().from(posRefunds).where(eq(posRefunds.returnId,r.id))).length,1);
  assert.equal((await f.db.select().from(stockMoves).where(eq(stockMoves.refId,r.id))).length,1);assert.deepEqual(errors,[]);await ctx.close();});
 await step('5. Hoàn một phần → chờ hoàn nốt; bấm lại hoàn nốt → hoàn tất',async()=>{
  await f.seed('s5');const {data:r}=await f.create('s5',[{orderLineId:'s5-b',qty:2,disposition:'restock'}]);
  const {ctx,page,d}=await open(f.mgr,'s5');await btn(d,'Duyệt & hoàn tất').click();await d.getByLabel(/Số tiền hoàn/).fill('300000');await d.getByLabel('Mã giao dịch chuyển khoản').fill('CK-1');
  await d.locator('input[type=checkbox]').last().check();await btn(d,'Duyệt & hoàn tất').click();await waitText(page,/Đang đối trừ\/hoàn tiền/);assert.equal((await ret(r.id)).status,'processing');
  await btn(d,'Duyệt & hoàn tất').click();assert.equal(await d.getByLabel(/Số tiền hoàn/).inputValue(),'285241');await d.getByLabel('Mã giao dịch chuyển khoản').fill('CK-2');
  await d.locator('input[type=checkbox]').last().check();await btn(d,'Duyệt & hoàn tất').click();await waitText(page,/Hoàn tất/);
  assert.equal((await ret(r.id)).status,'completed');assert.equal((await f.db.select().from(posRefunds).where(eq(posRefunds.returnId,r.id))).length,2);await ctx.close();});
 await step('6. Hoàn tiền mặt khi chưa mở ca: báo rõ, không ghi gì; mở ca rồi bấm lại thì xong',async()=>{
  await f.seed('s6');const {data:r}=await f.create('s6',[{orderLineId:'s6-b',qty:2,disposition:'restock'}]);
  const {ctx,page,d,toasts}=await open(f.mgr,'s6');await btn(d,'Duyệt & hoàn tất').click();await d.getByLabel('Hình thức hoàn').selectOption('cash');
  await d.locator('input[type=checkbox]').last().check();await btn(d,'Duyệt & hoàn tất').click();await page.waitForTimeout(1500);
  assert.ok(toasts.some(t=>/mở ca|chuyển khoản/i.test(t)),'báo lỗi rõ: '+toasts.join(' | '));assert.equal((await ret(r.id)).status,'pending','không ghi dở');
  await page.screenshot({path:out+'/6-loi-chua-mo-ca.png'});
  await f.open(f.mgr);await btn(d,'Duyệt & hoàn tất').click();await waitText(page,/Hoàn tất/);assert.equal((await ret(r.id)).status,'completed');await ctx.close();});
 await step('7. Đơn còn nợ: không có tiền hoàn, Duyệt & hoàn tất xong ngay',async()=>{
  await f.seed('s7',0);const {data:r}=await f.create('s7',[{orderLineId:'s7-a',qty:1,disposition:'restock'}]);
  const {ctx,page,d}=await open(f.mgr,'s7');await btn(d,'Duyệt & hoàn tất').click();assert.equal(await d.getByLabel(/Số tiền hoàn/).count(),0);
  await d.locator('input[type=checkbox]').last().check();await btn(d,'Duyệt & hoàn tất').click();await waitText(page,/Hoàn tất/);assert.equal((await ret(r.id)).status,'completed');await ctx.close();});
 await step('8. Phiếu nhận để giao lại: Duyệt & hoàn tất, đơn mở lại để giao',async()=>{
  await f.seed('s8');const {data:r}=await f.create('s8',[{orderLineId:'s8-a',qty:1,disposition:'restock'}],{purpose:'redelivery'});
  const {ctx,page,d}=await open(f.mgr,'s8');await btn(d,'Duyệt & hoàn tất').click();assert.equal(await d.getByLabel(/Số tiền hoàn/).count(),0,'giao lại không hoàn tiền');
  await d.locator('input[type=checkbox]').last().check();await btn(d,'Duyệt & hoàn tất').click();await waitText(page,/Hoàn tất/);
  assert.equal((await ret(r.id)).status,'completed');const [o]=await f.db.select().from(salesOrders).where(eq(salesOrders.id,'s8'));assert.notEqual(o.status,'delivered');await ctx.close();});
 await step('9. Manager chuyển phiếu trả (giảm công nợ) sang nhận để giao lại',async()=>{
  await f.seed('s9');const {data:r}=await f.create('s9',[{orderLineId:'s9-a',qty:1,disposition:'restock'}]);
  const {ctx,page,d}=await open(f.mgr,'s9');await btn(d,'Chuyển sang nhận để giao lại').click();await btn(d,'Xác nhận chuyển sang giao lại').click();await waitText(page,/Nhận để giao lại/);
  assert.equal(JSON.parse((await ret(r.id)).sourceSnapshot).returnPurpose,'redelivery');await ctx.close();});
 await step('10. Hàng trả vượt lượng đã xuất (đơn cũ): chọn Không cộng tồn → xong, không cộng kho',async()=>{
  await f.seed('s10',2186125,'emp',false);const {data:r}=await f.create('s10',[{orderLineId:'s10-b',qty:1,disposition:'restock'}]);
  const {ctx,page,d}=await open(f.mgr,'s10');await btn(d,'Duyệt & hoàn tất').click();assert.equal(await d.getByLabel('Xử lý phần vượt').inputValue(),'damaged');
  await d.locator('input[type=checkbox]').last().check();await btn(d,'Duyệt & hoàn tất').click();await waitText(page,/Hoàn tất|Đang đối trừ/);
  assert.equal((await f.db.select().from(stockMoves).where(eq(stockMoves.refId,r.id))).length,0);await ctx.close();});
 await step('11. Hàng vượt lượng: Manager chọn căn cứ "giao trước ngày chốt tồn"',async()=>{
  await f.seed('s11',2186125,'emp',false);const {data:r}=await f.create('s11',[{orderLineId:'s11-b',qty:1,disposition:'restock'}]);
  const {ctx,page,d,toasts}=await open(f.mgr,'s11');await btn(d,'Duyệt & hoàn tất').click();await d.getByLabel('Xử lý phần vượt').selectOption('basis');
  await page.screenshot({path:out+'/11-before.png'});const kinds=d.locator('select').filter({has:page.locator('option[value=pre_opening]')});await kinds.selectOption('pre_opening');await d.getByLabel('Ghi rõ căn cứ đã kiểm').fill('Giao 14/10 trước ngày chốt tồn');
  await d.locator('input[type=checkbox]').last().check();await btn(d,'Duyệt & hoàn tất').click();await page.waitForTimeout(2000);
  const x=await ret(r.id);assert.ok(['completed','processing'].includes(x.status),'trạng thái '+x.status+' · thông báo: '+toasts.join(' | '));await ctx.close();});
 await step('12. NV kho nhận hàng phiếu đã duyệt (nút cũ), Manager hoàn tiền tiếp bằng Duyệt & hoàn tất',async()=>{
  await f.seed('s12');const {data:r}=await f.create('s12',[{orderLineId:'s12-b',qty:2,disposition:'restock'}]);f.ok(await f.call(`/orders/s12/returns/${r.id}/approve`,f.mgr,'POST',{}));
  let {ctx,page,d}=await open(f.emp,'s12');await btn(d,'Nhận hàng trả về kho').click();await btn(d,'Đã nhận đủ hàng').click().catch(async()=>{await d.getByRole('button').filter({hasText:/Xác nhận|Đã nhận/}).last().click();});
  await page.waitForTimeout(1200);assert.equal((await ret(r.id)).status,'processing');await ctx.close();
  ({ctx,page,d}=await open(f.mgr,'s12'));await btn(d,'Duyệt & hoàn tất').click();await d.getByLabel('Mã giao dịch chuyển khoản').fill('CK-12');await d.locator('input[type=checkbox]').last().check();await btn(d,'Duyệt & hoàn tất').click();await waitText(page,/Hoàn tất/);
  assert.equal((await ret(r.id)).status,'completed');await ctx.close();});
 await step('13. Người được chỉ định duyệt: không tự duyệt phiếu của mình, duyệt được phiếu người khác',async()=>{
  await f.seed('s13');await f.db.update(employees).set({canApprove:true}).where(eq(employees.id,'emp'));
  const {data:own}=await f.create('s13',[{orderLineId:'s13-a',qty:1,disposition:'restock'}]);
  let {ctx,d}=await open(f.emp,'s13');assert.equal(await btn(d,'Duyệt & hoàn tất').count(),0,'không tự duyệt');await ctx.close();
  f.ok(await f.call(`/orders/s13/returns/${own.id}/cancel`,f.emp,'POST',{reason:'test'}));
  const other=f.ok(await f.call('/orders/s13/returns',f.mgr,'POST',{purpose:'credit',key:crypto.randomUUID(),warehouseId:'pos-wh',reason:'Khách trả',lines:[{orderLineId:'s13-a',qty:1,disposition:'restock'}]}),201);
  const o2=await open(f.emp,'s13');assert.equal(await btn(o2.d,'Duyệt & hoàn tất').count(),1);await btn(o2.d,'Duyệt & hoàn tất').click();
  if(await o2.d.getByLabel('Mã giao dịch chuyển khoản').count())await o2.d.getByLabel('Mã giao dịch chuyển khoản').fill('CK-13');
  await o2.d.locator('input[type=checkbox]').last().check();await btn(o2.d,'Duyệt & hoàn tất').click();await o2.page.waitForTimeout(1500);
  assert.ok(['completed','processing'].includes((await ret(other.id)).status),'trạng thái '+(await ret(other.id)).status+' · '+o2.toasts.join(' | '));
  await f.db.update(employees).set({canApprove:false}).where(eq(employees.id,'emp'));await o2.ctx.close();});
 await step('14. Điện thoại 390px: Duyệt & hoàn tất không tràn màn hình',async()=>{
  await f.seed('s14');await f.create('s14',[{orderLineId:'s14-b',qty:2,disposition:'restock'}]);
  const {ctx,page,d,errors}=await open(f.mgr,'s14',390);await btn(d,'Duyệt & hoàn tất').click();await d.getByLabel('Mã giao dịch chuyển khoản').fill('CK-14');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0);await page.screenshot({path:out+'/14-mobile.png'});
  await d.locator('input[type=checkbox]').last().check();await btn(d,'Duyệt & hoàn tất').click();await waitText(page,/Hoàn tất/);assert.deepEqual(errors,[]);await ctx.close();});
}finally{await writeFile(out+'/results.json',JSON.stringify(results,null,2));await browser.close();server.close();}
console.log(JSON.stringify({pass:results.filter(r=>r.ok).length,fail:results.filter(r=>!r.ok).length}));
