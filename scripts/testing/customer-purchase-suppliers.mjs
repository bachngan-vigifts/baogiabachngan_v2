/** Real local CRM/router; synthetic data and no external requests. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {customerPurchaseSuppliersFixture} from '../../tests/helpers/customer-purchase-suppliers-fixture.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright'),f=await customerPurchaseSuppliersFixture();
const out=process.env.REVIEW_DIR||'/tmp/customer-purchase-suppliers';await mkdir(out,{recursive:true});
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
 for(const [role,cookie]of [['manager',f.mgr],['owner',f.emp]])for(const width of [390,1440]){
  const user=(await f.call('/me',cookie)).data.user,token=cookie.split('=')[1],context=await browser.newContext({viewport:{width,height:1000},locale:'vi-VN',timezoneId:'Asia/Ho_Chi_Minh'});
  await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());await context.addInitScript(({user,token})=>{localStorage.setItem('bn-api-region-manual-off','1');localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user,token});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/#/customers/'+f.id);
  await page.locator('[data-tab=purchases]').click();
  const table=page.locator('.cd-tab-body table');await table.waitFor();
  assert.ok((await table.locator('thead').textContent()).includes('Nhà cung cấp'));
  const row=table.locator('tbody tr').filter({hasText:'Túi giấy'});
  assert.ok((await row.innerText()).includes('NCC Bao bì A'));
  assert.ok((await row.innerText()).includes('NCC B <Kiểm thử>'),'supplier text escaped correctly');
  assert.equal(await row.locator('.cd-purchase-supplier').count(),role==='manager'?3:2);
  assert.ok((await table.innerText()).includes('Chưa có thông tin NCC'));
  assert.equal(await table.locator('script,img').count(),0);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no page horizontal overflow');
  await page.locator('.cd-tab-body').screenshot({path:out+`/${role}-${width}.png`});
  assert.deepEqual(errors,[]);
  const timings=[];for(let i=0;i<5;i++){const start=performance.now();const result=await f.call('/customers/'+f.id+'/overview',cookie);assert.equal(result.status,200);timings.push(performance.now()-start);}
  timings.sort((a,b)=>a-b);results.push({role,width,supplierNamesVisible:true,jsErrors:errors,localOverviewMedianMs:Math.round(timings[2])});await context.close();
 }
}finally{await writeFile(out+'/results.json',JSON.stringify(results,null,2));await browser.close();await new Promise(r=>server.close(r));await f.client.close();}
console.log(JSON.stringify(results));
