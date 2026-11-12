/** Local real router/DB, synthetic records, no production writes or external traffic. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {adjustmentFixture} from '../../tests/helpers/packing-adjustment-fixture.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await adjustmentFixture(),out=process.env.REVIEW_DIR||'/tmp/packing-adjustment';await mkdir(out,{recursive:true});
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),requests=[];let loseReply=false;
const server=createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname.startsWith('/api/staff/')){
  requests.push({path:u.pathname,method:req.method});const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const token=req.headers.authorization?.replace(/^Bearer /,'')||'';
  const r=await f.call(u.pathname.slice('/api/staff'.length)+u.search,token?'__Host-bn-session='+token:'',req.method,chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined);
  if(loseReply&&u.pathname.endsWith('/adjust-quantities')&&r.status===200){loseReply=false;res.writeHead(502,{'content-type':'application/json'}).end(JSON.stringify({message:'Kết nối gián đoạn sau xử lý, chưa rõ kết quả. Gửi lại cùng mã thao tác.',code:'OUTCOME_UNKNOWN'}));return;}
  res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;
 }
 const path=u.pathname==='/'?'/index.html':u.pathname;let bytes=await readFile(root+path);
 if(path.endsWith('.html'))bytes=Buffer.from(bytes.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 const type=path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.png')?'image/png':'text/html';res.writeHead(200,{'content-type':type}).end(bytes);
}catch{res.writeHead(404).end('Fixture resource unavailable');}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),results=[];
try{
 for(const [role,cookie]of [['manager',f.mgr],['employee',f.emp],['warehouse',f.kho]])for(const width of [390,1440]){
  const user=(await f.call('/me',cookie)).data.user,token=cookie.split('=')[1],context=await browser.newContext({viewport:{width,height:1000},locale:'vi-VN',timezoneId:'Asia/Ho_Chi_Minh'});
  await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());await context.addInitScript(({user,token})=>{for(const storage of [localStorage,sessionStorage])for(const key of Object.keys(storage))if(key.startsWith('bn-pc:'))storage.removeItem(key);localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user,token});
  const page=await context.newPage(),errors=[],timings=[];page.on('pageerror',e=>errors.push(e.message));
  for(let i=0;i<3;i++){
   const count=requests.filter(r=>r.path==='/api/staff/packing/adjust-slip'&&r.method==='GET').length,start=performance.now();
   if(i===0)await page.goto(origin+'/#/packing/adjust-slip');else await page.reload();try{await page.locator('#packing-body .data-table tbody tr').first().waitFor();}catch(ex){await page.screenshot({path:out+'/failure.png',fullPage:true});console.error('fixture page state',await page.locator('#packing-body').innerText(),errors);throw ex;}timings.push(Math.round(performance.now()-start));
   assert.equal(requests.filter(r=>r.path==='/api/staff/packing/adjust-slip'&&r.method==='GET').length-count,1,'one existing detail request per page');
   assert.equal(await page.locator('[data-packed-adjust]').count(),role==='manager'?1:0);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow');
  }
  if(role==='manager'){
   const data=await f.read(),next=data.slip.totalQty+1;
   await page.locator('[data-packed-adjust]').click();const dialog=page.locator('.packed-adjust-modal');await dialog.waitFor();
   await dialog.locator('[name=qty-0]').fill(String(next));await dialog.locator('[name=reason]').fill('Đối chiếu số thực tế bằng dữ liệu kiểm thử');
   await dialog.screenshot({path:out+`/adjust-${width}.png`});assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
   loseReply=true;await dialog.getByRole('button',{name:'Lưu & cập nhật kho'}).click();try{await dialog.locator('[data-error]').filter({hasText:/./}).waitFor();}catch(ex){console.error('save state',{posts:requests.filter(r=>r.method==='POST'),dialog:await dialog.count(),text:await page.locator('body').innerText(),errors});throw ex;}await dialog.getByRole('button',{name:'Lưu & cập nhật kho'}).waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('.packed-adjust-modal button[type=submit]').disabled);
   assert.equal((await f.read()).slip.totalQty,next,'first save committed even with lost reply');
   await dialog.getByRole('button',{name:'Lưu & cập nhật kho'}).click();await dialog.waitFor({state:'detached'});await page.locator('#packing-body .pick-qty').filter({hasText:String(next)}).waitFor();
   assert.equal(await f.balance(),50-next,'replay never issues twice');
   await page.locator('[data-packed-history]').click();await page.getByRole('heading',{name:'Lịch sử DG-ADJUST'}).waitFor();assert.ok(await page.getByText(/PACK-ADJUST: .*→/).count());await page.locator('dialog').last().screenshot({path:out+`/history-${width}.png`});
  }
  assert.deepEqual(errors,[]);results.push({role,width,detailMedianMs:[...timings].sort((a,b)=>a-b)[1],samplesMs:timings,detailRequestsPerLoad:1,jsErrors:errors});await context.close();
 }
}finally{await writeFile(out+'/results.json',JSON.stringify(results,null,2));await browser.close();await new Promise(r=>server.close(r));await f.client.close();}
console.log(JSON.stringify(results));
