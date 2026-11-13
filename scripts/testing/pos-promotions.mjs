/** Real local CRM/router; synthetic data and no external requests. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {promotionFixture} from '../../tests/helpers/pos-promotion-fixture.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright'),f=await promotionFixture();
const out=process.env.REVIEW_DIR||'/tmp/pos-promotions';await mkdir(out,{recursive:true});
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url));
const server=createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname.startsWith('/api/staff/')){
  const chunks=[];for await(const c of req)chunks.push(c);const token=req.headers.authorization?.replace(/^Bearer /,'')||'';
  const r=await f.call(u.pathname.slice('/api/staff'.length)+u.search,token?'__Host-bn-session='+token:'',req.method,chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined);
  res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;
 }
 const path=u.pathname==='/'?'/index.html':u.pathname;let data=await readFile(root+path);if(path.endsWith('.html'))data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.writeHead(200,{'content-type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html'}).end(data);
}catch{res.writeHead(404).end('Fixture resource unavailable');}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),results=[];
try{
 for(const [role,cookie]of [['manager',f.mgr],['cashier',f.emp]])for(const width of [390,1440]){
  const user=(await f.call('/me',cookie)).data.user,token=cookie.split('=')[1],context=await browser.newContext({viewport:{width,height:1000},locale:'vi-VN',timezoneId:'Asia/Ho_Chi_Minh'});
  await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());await context.addInitScript(({user,token})=>{localStorage.setItem('bn-api-region-manual-off','1');localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user,token});
  const page=await context.newPage(),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/#/pos');
  const panel=page.locator('.pos-promotion');await panel.waitFor();await page.waitForFunction(()=>document.querySelector('.pos-promotion')?.textContent.includes('Gourmet'));
  assert.equal(await panel.getByRole('button',{name:'Cấu hình',exact:true}).count(),role==='manager'?1:0);
  await page.locator('.pos-product[data-sku="00123"]').click();await page.getByRole('spinbutton',{name:'Số lượng Ly sứ',exact:true}).fill('10');
  await page.waitForFunction(()=>document.querySelector('.pos-promotion')?.textContent.includes('Được tặng 1'));
  assert.ok((await panel.innerText()).includes('031059000B2'));await panel.screenshot({path:out+`/${role}-${width}-gift.png`});
  const reason=panel.getByRole('textbox',{name:'Lý do không nhận quà'});await reason.fill('Khách từ chối nhận quà');await reason.press('Tab');
  await page.waitForFunction(()=>document.querySelector('.pos-promotion')?.textContent.includes('Không nhận quà'));
  await panel.getByRole('textbox',{name:'Lý do không nhận quà'}).fill('');await panel.getByRole('textbox',{name:'Lý do không nhận quà'}).press('Tab');
  await page.waitForFunction(()=>document.querySelector('.pos-promotion')?.textContent.includes('Được tặng 1'));
  if(role==='manager'){
   await panel.getByRole('button',{name:'Cấu hình',exact:true}).click();const dialog=page.locator('.pos-promotion-dialog');await dialog.waitFor();
   await dialog.screenshot({path:out+`/${role}-${width}-config.png`});assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'config does not overflow');
   await dialog.getByRole('textbox',{name:'Tên chương trình',exact:true}).fill('Minh Long · Tặng bộ 2 chén Gourmet');await dialog.getByRole('button',{name:'Lưu chương trình'}).click();await dialog.waitFor({state:'detached'});
   await page.waitForFunction(()=>document.querySelector('.pos-promotion')?.textContent.includes('Được tặng 1'));
  }
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no page horizontal overflow');assert.deepEqual(errors,[]);
  const program=(await f.call('/pos/promotions?registerId='+f.registerId,cookie)).data.program,timings=[];
  for(let i=0;i<5;i++){const start=performance.now();const result=await f.call('/pos/preview',cookie,'POST',f.body({promotionRevision:program.revision}));assert.equal(result.status,200);timings.push(performance.now()-start);}
  timings.sort((a,b)=>a-b);results.push({role,width,automaticGift:true,optOut:true,configSaved:role==='manager',jsErrors:errors,previewMedianMs:Math.round(timings[2])});await context.close();
 }
}finally{await writeFile(out+'/results.json',JSON.stringify(results,null,2));await browser.close();await new Promise(r=>server.close(r));await f.client.close();}
console.log(JSON.stringify(results));
