/** Hai máy cùng sửa hồ sơ khách (dữ liệu mẫu PGlite cục bộ, không gọi production).
 *  A (Manager) đổi địa chỉ, lưu. B (nhân viên phụ trách) mở từ trước, sửa điện thoại, lưu → báo xung đột, GIỮ điện thoại B nhập,
 *  tự lấy địa chỉ mới của A (B không sửa ô này); B lưu lại → hồ sơ có cả hai thay đổi.
 *  Cùng sửa một ô khác nhau → liệt kê đối chiếu, nút "Dùng bản mới". Cỡ 390 và 1280. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {customerPurchaseSuppliersFixture} from '../../tests/helpers/customer-purchase-suppliers-fixture.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright'),f=await customerPurchaseSuppliersFixture();
const out=process.env.SCREENSHOT_DIR||'/tmp/customer-profile-conflict';await mkdir(out,{recursive:true});
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url));
let held=null;
function pauseNext(method){let release,seen;const gate=new Promise(r=>{release=r;}),ready=new Promise(r=>{seen=r;});held={method,gate,seen};return{release,ready};}
async function waitPaused(p){let timer;try{await Promise.race([p.ready,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Response was not paused')),8000);})]);}finally{clearTimeout(timer);}}

const server=createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname.startsWith('/api/staff/')){const chunks=[];for await(const c of req)chunks.push(c);const token=req.headers.authorization?.replace(/^Bearer /,'')||'';
  const r=await f.call(u.pathname.slice('/api/staff'.length)+u.search,token?'__Host-bn-session='+token:'',req.method,chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined);
  if(held&&req.method===held.method&&u.pathname==='/api/staff/customers/'+f.id&&(req.method!=='GET'||u.searchParams.get('refresh')==='1')){const h=held;held=null;h.seen();await h.gate;}
  res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;}
 const path=u.pathname==='/'?'/index.html':u.pathname;let data=await readFile(root+path);if(path.endsWith('.html'))data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.writeHead(200,{'content-type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.svg')?'image/svg+xml':'text/html'}).end(data);
}catch{res.writeHead(404).end('Fixture resource unavailable');}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']}:{});
const {customers}=await import('../../src/modules/customers/schema.ts');const {eq}=await import('drizzle-orm');
const row=async()=>(await f.db.select().from(customers).where(eq(customers.id,f.id)))[0];
const results=[];let shots=[];const step=async(name,fn)=>{try{await fn();results.push(['✔',name]);}catch(e){results.push(['✘',name+' — '+(e.message||e)]);for(const [i,p] of shots.entries())await p.screenshot({path:`${out}/FAIL-${results.length}-${i}.png`}).catch(()=>{});}};
async function client(cookie,width){const mobile=width<500,user=(await f.call('/me',cookie)).data.user,token=cookie.split('=')[1];
 const context=await browser.newContext({viewport:{width,height:mobile?844:900},locale:'vi-VN',...(mobile?{isMobile:true,hasTouch:true}:{})});
 await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 await context.addInitScript(({user,token})=>{localStorage.setItem('bn-api-region-manual-off','1');localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user,token});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/#/customers/'+f.id);await page.locator('#customer-detail [data-act=edit]').first().waitFor();
 const openEdit=async()=>{await page.locator('#customer-detail [data-act=edit]').first().click();await page.locator('#customer-dialog[open]').waitFor();};
 const field=n=>page.locator('#customer-form').locator(`[name=${n}]`).first();
 // Form 3 bước: nút Lưu ở bước "Kiểm tra và lưu".
 const save=async()=>{if(!await page.locator('#save-customer').isVisible())await page.locator('#customer-dialog button').filter({hasText:'Kiểm tra và lưu'}).click();await page.locator('#save-customer').click();};
 const toStep1=async()=>{const b=page.locator('#customer-dialog button').filter({hasText:'Công ty'}).first();if(await b.isVisible())await b.click();};
 return {page,context,errors,openEdit,field,save,toStep1};}
try{
 for(const width of [390,1280]){
  await f.db.update(customers).set({address:'Địa chỉ ban đầu '+width,phone:'0900000'+width,email:''}).where(eq(customers.id,f.id));
  const A=await client(f.mgr,width),B=await client(f.emp,width);shots=[A.page,B.page];
  await step(width+': B mở trước, A đổi địa chỉ và lưu',async()=>{
   await B.openEdit();await A.openEdit();
   await A.toStep1();await A.field('address').fill('12 Lý Tự Trọng, Cần Thơ');await A.save();await A.page.locator('#customer-dialog[open]').waitFor({state:'detached',timeout:8000}).catch(async()=>{await A.page.locator('#customer-dialog').waitFor({state:'hidden',timeout:8000});});
   assert.equal((await row()).address,'12 Lý Tự Trọng, Cần Thơ');
  });
  await step(width+': B sửa điện thoại từ bản cũ → báo xung đột, giữ điện thoại B nhập, tự lấy địa chỉ mới, chưa ghi gì',async()=>{
   await B.toStep1();await B.field('phone').fill('0909111222');await B.save();
   const box=B.page.locator('#customer-conflict');await box.waitFor({timeout:8000});
   assert.match(await box.innerText(),/vừa được người khác/);assert.match(await box.innerText(),/Địa chỉ/);
   assert.equal(await B.field('phone').inputValue(),'0909111222','giữ nội dung B');assert.equal(await B.field('address').inputValue(),'12 Lý Tự Trọng, Cần Thơ','lấy địa chỉ của A');
   assert.match(await B.page.locator('.customer-step-summary').innerText(),/Địa chỉ: 12 Lý Tự Trọng/,'tóm tắt bước 3 hiện địa chỉ mới');
   assert.ok(await B.page.locator('#customer-dialog[open]').isVisible());const r=await row();assert.equal(r.address,'12 Lý Tự Trọng, Cần Thơ');assert.notEqual(r.phone,'0909111222');
   await B.page.screenshot({path:`${out}/conflict-${width}.png`});
  });
  await step(width+': B bấm Lưu lại → có cả địa chỉ A và điện thoại B',async()=>{
   await B.save();await B.page.locator('#customer-dialog').waitFor({state:'hidden',timeout:8000});
   const r=await row();assert.deepEqual([r.address,r.phone],['12 Lý Tự Trọng, Cần Thơ','0909111222']);
  });
  await step(width+': cùng sửa một ô (email) khác nhau → liệt kê đối chiếu, "Dùng bản mới" lấy giá trị của người kia',async()=>{
   await A.openEdit();await B.openEdit();
   await A.toStep1();await A.field('email').fill('a@example.test');await A.save();await A.page.locator('#customer-dialog').waitFor({state:'hidden',timeout:8000});
   await B.toStep1();await B.field('email').fill('b@example.test');await B.save();
   const box=B.page.locator('#customer-conflict');await box.waitFor({timeout:8000});assert.match(await box.innerText(),/Email: bản mới «a@example.test» – bạn nhập «b@example.test»/);
   assert.equal(await B.field('email').inputValue(),'b@example.test','chưa tự đè phần B nhập');
   await box.getByRole('button',{name:'Dùng bản mới'}).click();assert.equal(await B.field('email').inputValue(),'a@example.test');
   await B.save();await B.page.locator('#customer-dialog').waitFor({state:'hidden',timeout:8000});assert.equal((await row()).email,'a@example.test');
  });
  for(const c of [A,B]){assert.deepEqual(c.errors,[],'lỗi JS');await c.context.close();}
 }

 for(const width of [390,1280])for(const [caseIndex,scenario] of ['khác khách','mở lại cùng khách','lưu thành công về muộn'].entries()){
  const sequence=String(width*10+caseIndex).padStart(5,'0'),newPhone='0922'+sequence+'2',stalePhone='0911'+sequence+'1';
  await f.db.update(customers).set({name:'Khách A thử phản hồi muộn',address:'Địa chỉ A trước sửa',phone:'0933'+sequence+'3'}).where(eq(customers.id,f.id));
  const B=await client(f.mgr,width);shots=[B.page];let paused;
  await step(width+': '+scenario+' → phản hồi form cũ không thay/đóng form mới',async()=>{try{
   await B.openEdit();await B.toStep1();await B.field('phone').fill(stalePhone);
   const method=scenario==='lưu thành công về muộn'?'PUT':'GET';
   if(method==='GET')await f.db.update(customers).set({address:'Địa chỉ A bản mới 1'}).where(eq(customers.id,f.id));
   paused=pauseNext(method);await B.save();await waitPaused(paused);
   await B.page.locator('#customer-dialog [data-close]').first().click();
   const same=scenario==='mở lại cùng khách',target=same?f.id:'history-other-customer';
   if(same)await f.db.update(customers).set({address:'Địa chỉ A bản mới 2'}).where(eq(customers.id,f.id));
   else{await B.page.evaluate(id=>{location.hash='#/customers/'+id;},target);await B.page.waitForFunction(()=>document.querySelector('#customer-detail')?.textContent.includes('Khách khác'));}
   await B.openEdit();await B.toStep1();await B.field('phone').fill(newPhone);
   const snapshot=Object.fromEntries(await Promise.all(['name','address','phone','email'].map(async k=>[k,await B.field(k).inputValue()])));
   const response=B.page.waitForResponse(r=>r.request().method()===method&&new URL(r.url()).pathname==='/api/staff/customers/'+f.id);paused.release();await (await response).finished();await B.page.waitForTimeout(150);
   assert.equal(await B.page.locator('#customer-dialog').evaluate(d=>d.open),true,'không đóng form hiện tại');
   for(const [k,v]of Object.entries(snapshot))assert.equal(await B.field(k).inputValue(),v,'giữ '+k+' của form mới');
   assert.equal(await B.page.locator('#customer-conflict').isVisible(),false);assert.equal(await B.page.locator('#save-customer').isDisabled(),false);
   await B.save();await B.page.locator('#customer-dialog').waitFor({state:'hidden',timeout:8000});
   const saved=(await f.db.select().from(customers).where(eq(customers.id,target)))[0];assert.equal(saved.name,snapshot.name);assert.equal(saved.phone,newPhone);assert.deepEqual(B.errors,[]);
  }finally{paused?.release();held=null;}});await B.context.close();
 }
}finally{await browser.close();server.close();await f.client.close();}
for(const [s,n] of results)console.log(s,n);
const fail=results.filter(r=>r[0]==='✘').length;console.log(JSON.stringify({pass:results.length-fail,fail}));if(fail)process.exitCode=1;
