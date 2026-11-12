/** Real local CRM/router; synthetic data and no external requests. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {customerShareOptionsFixture} from '../../tests/helpers/customer-share-options-fixture.ts';
import {customerStaff} from '../../src/modules/customers/schema.ts';
import {and,eq} from 'drizzle-orm';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright'),f=await customerShareOptionsFixture();
const out=process.env.REVIEW_DIR||'/tmp/customer-share-options';await mkdir(out,{recursive:true});
await f.db.insert(customerStaff).values({customerId:f.id,memberId:'share-it',role:'shared',createdBy:'mgr',createdAt:'2026-01-01T00:00:00.000Z'});
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
  await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());await context.addInitScript(({user,token})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user,token});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/#/customers/'+f.id);
  const button=page.locator('[data-act=staff]');await button.waitFor({state:'attached'});
  if(!await button.isVisible())await button.locator('xpath=ancestor::div[contains(@class,"card")]').last().locator('.mobile-action-trigger').first().click();
  await button.click();const dialog=page.locator('dialog').filter({has:page.getByRole('heading',{name:'Phân công / chia sẻ khách hàng',exact:true})});await dialog.waitFor();
  for(const position of ['it','thiet-ke','warehouse']){
   assert.equal(await dialog.locator('.cd-people input[value="share-'+position+'"]').count(),0);
   assert.equal(await dialog.locator('select[name=owner] option[value="share-'+position+'"]').count(),1,'owner choices remain separate');
  }
  assert.equal(await dialog.locator('select[name=owner]').isDisabled(),role==='owner');
  await dialog.locator('.cd-people-search').fill('share-custom');assert.ok(await dialog.locator('.cd-people li:not([hidden])').count());await dialog.locator('.cd-people-search').fill('');
  await dialog.locator('.cd-people input[value="share-share-custom"]').check();await dialog.screenshot({path:out+`/${role}-${width}.png`});
  assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'dialog does not overflow');
  await dialog.getByRole('button',{name:'Lưu',exact:true}).click();await dialog.waitFor({state:'detached'});
  const shares=await f.db.select().from(customerStaff).where(eq(customerStaff.customerId,f.id));assert.ok(shares.some(s=>s.memberId==='share-share-custom'&&s.role==='shared'));
  assert.equal(shares.find(s=>s.memberId==='share-it').createdAt,'2026-01-01T00:00:00.000Z');assert.equal(shares.find(s=>s.role==='owner').memberId,'emp');
  assert.deepEqual(errors,[]);results.push({role,width,excluded:['it','thiet-ke','warehouse'],ownerOptionsUnchanged:true,legacySharePreserved:true,jsErrors:errors});await context.close();
 }
}finally{await writeFile(out+'/results.json',JSON.stringify(results,null,2));await browser.close();await new Promise(r=>server.close(r));await f.client.close();}
console.log(JSON.stringify(results));
