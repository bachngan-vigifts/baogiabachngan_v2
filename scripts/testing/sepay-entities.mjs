/** Synthetic bank evidence only; all browser requests outside localhost are blocked. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {eq} from 'drizzle-orm';
import {employees} from '../../src/modules/staff/schema.ts';
import {setupSepay} from '../../tests/helpers/sepay-fixture.ts';
import {sepayTransactions as bank} from '../../src/modules/integrations/schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setupSepay(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out='/workspace/artifacts/sepay-entities';await mkdir(out,{recursive:true});
const user=(await f.call('/me',f.emp)).data.user,catalog=(await f.call('/permissions',f.mgr)).data,position=catalog.positions.find(p=>p.id===user.positionId);
f.env.sepayDebitImportEnabled=true;
await f.call('/permissions/positions/'+position.id,f.mgr,'PUT',{perms:[...new Set([...position.perms,'page.sepay'])]});
await f.incoming('BN INCOMING',100000);await f.incoming('VG INCOMING',200000,{accountNumber:'159063909'});
const debit=(id,accountNumber,amount)=>({id,providerId:id,transferType:'out',accountNumber,amount,transactionAt:f.stamp,content:'PRIVATE DEBIT '+id,status:'review',reason:'Tiền ra; không ghi thu.',payload:'{}',receivedAt:f.stamp});
await f.db.insert(bank).values([debit('BN-DEBIT','123456',888888),debit('VG-DEBIT','159063909',777777)]);
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://local');if(u.pathname.startsWith('/api/staff/')){const chunks=[];for await(const c of req)chunks.push(c);const token=req.headers.authorization?.replace(/^Bearer /,'');const r=await f.call(u.pathname.slice(10)+u.search,token?'__Host-bn-session='+token:'',req.method,chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined);res.writeHead(r.status,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify(r.data));return;}const path=u.pathname==='/'?'/index.html':u.pathname;let body=await readFile(root+path);if(path==='/index.html')body=Buffer.from(body.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));res.writeHead(200,{'content-type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':'text/html'}).end(body);}catch(e){res.writeHead(500).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),results=[];
try{for(const [role,cookie] of [['manager',f.mgr],['accounting',f.accountant],['delegated',f.emp]])for(const width of [1280,390]){
 const context=await browser.newContext({viewport:{width,height:900},locale:'vi-VN'});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());await context.addInitScript(token=>localStorage.setItem('bn-v2-session',token),cookie.split('=')[1]);const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 const hash='#/sepay?from=2026-11-08&to=2026-11-08';await p.goto(origin+'/'+hash);await p.locator('[data-list] table').waitFor();assert.match(await p.locator('[data-list]').innerText(),/BN INCOMING/);assert.doesNotMatch(await p.locator('[data-list]').innerText(),/VG INCOMING|PRIVATE DEBIT/);
 await p.getByRole('tab',{name:'Vigifts',exact:true}).click();await p.locator('[data-list]').filter({hasText:'VG INCOMING'}).waitFor();assert.doesNotMatch(await p.locator('[data-list]').innerText(),/BN INCOMING/);
 if(role!=='delegated'){
  await p.locator('[name=direction]').selectOption('out');await p.locator('[data-filters] [type=submit]').click();await p.locator('[data-open="VG-DEBIT"]').waitFor();assert.match(await p.locator('.sp-stat-outgoing strong').innerText(),/777[.\s]777/);assert.doesNotMatch(await p.locator('[data-list]').innerText(),/BN-DEBIT/);
  await p.locator('[data-open="VG-DEBIT"]').click();await p.locator('[data-detail] .sp-bank-amount').waitFor();assert.equal(await p.locator('[data-order-search]').count(),0);assert.equal(await p.locator('[data-confirm]').count(),0);
  await p.getByRole('tab',{name:'Bách Ngân',exact:true}).click();await p.locator('[data-open="BN-DEBIT"]').waitFor();assert.doesNotMatch(await p.locator('[data-list]').innerText(),/VG-DEBIT/);
 }else{
  assert.equal(await p.locator('[name=direction]').isVisible(),false);assert.equal(await p.locator('.sp-stat-outgoing').count(),0);
  await p.goto(origin+'/'+hash+'&direction=out');await p.locator('[data-list] .sp-error').waitFor();assert.doesNotMatch(await p.locator('#view-sepay').innerText(),/PRIVATE DEBIT|888[.\s]888|777[.\s]777/);assert.equal(await p.locator('[data-detail] .sp-bank-amount').count(),0);
 }
 if(role==='accounting'&&width===1280){
  await p.locator('[data-open="BN-DEBIT"]').click();await p.locator('[data-detail] .sp-bank-amount').waitFor();const accountant=(await f.call('/me',f.accountant)).data.user;
  await f.db.update(employees).set({positionId:user.positionId}).where(eq(employees.id,accountant.id));await p.locator('[data-refresh]').click();await p.locator('[data-list] .sp-error').waitFor();
  assert.doesNotMatch(await p.locator('#view-sepay').innerText(),/PRIVATE DEBIT|888[.\s]888/);assert.equal(await p.locator('[data-detail] .sp-bank-amount').count(),0);assert.equal(await p.locator('.sp-stat-outgoing').count(),0);
  await f.db.update(employees).set({positionId:'accounting'}).where(eq(employees.id,accountant.id));
 }
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.deepEqual(errors,[]);await p.screenshot({path:out+'/'+role+'-'+width+'.png',fullPage:true});results.push({role,width,entityIsolation:true,debitAccess:role!=='delegated',noReceiptAction:true,noPageErrors:true});await context.close();
}await writeFile(out+'/browser.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));}finally{await browser.close();await new Promise(r=>server.close(r));await f.client.close();}
