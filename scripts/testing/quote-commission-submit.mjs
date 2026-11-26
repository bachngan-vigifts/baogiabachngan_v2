// Real local CRM/router + synthetic PGlite records; no production API or customer data.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setupEarly} from '../../tests/helpers/purchase-early-fixture.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setupEarly(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url));
const users={};for(const who of ['mgr','emp'])users[who]=(await f.call('/me',f.cookies[who])).data.user;
const writes=[];
const server=createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname.startsWith('/api/staff/')){
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined;
  if(req.method!=='GET')writes.push({method:req.method,path:u.pathname});
  const token=req.headers.authorization?.replace(/^Bearer /,'')||'';
  const r=await f.call(u.pathname.slice('/api/staff'.length)+u.search,token?'__Host-bn-session='+token:'',req.method,body);
  res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;
 }
 const path=u.pathname==='/'?'index.html':u.pathname.slice(1);let data=await readFile(root+path);
 if(path==='index.html')data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':'text/html');res.end(data);
}catch(e){res.writeHead(500).end(e.message);}}).listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const dir=process.env.QUOTE_EDIT_SCREENSHOT_DIR||'/tmp/quote-commission';await mkdir(dir,{recursive:true});
const action=async(page,selector)=>{const b=page.locator(selector);await b.waitFor({state:'attached'});if(!await b.isVisible())await b.evaluate(n=>n.closest('[popover]')?.showPopover());await b.click();};
try{for(const width of [1440,390]){
 const q=await f.call('/quotes',f.cookies.emp,'POST',{type:'B2B',quoteNo:'B2B_CK_BROWSER_'+width,date:'2026-11-26',customer:'Khách kiểm thử',vat:8,rows:[{name:'Ly kiểm thử',qty:2,price:100000},{name:'Hộp kiểm thử',qty:2,price:10000}]});assert.equal(q.status,201);
 const context=await browser.newContext({viewport:{width,height:1000}});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 await context.addInitScript(({token,user})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{token:f.cookies.emp.split('=')[1],user:users.emp});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/#/quotes/'+q.data.id);
 await page.locator('#toggle-profit').click();await page.locator('#open-commission').click();await page.locator('#commission-dialog [data-close]').click();
 await action(page,'#submit-quote');const dialog=page.locator('#commission-dialog');await dialog.waitFor({state:'visible'});
 await dialog.locator('button.btn.primary').click();assert.equal(await dialog.isVisible(),true);assert.equal((await f.call('/quotes/'+q.data.id,f.cookies.emp)).data.approvalStatus,'draft');
 await dialog.locator('[data-close]').click();assert.equal((await f.call('/quotes/'+q.data.id,f.cookies.emp)).data.approvalStatus,'draft');
 await action(page,'#submit-quote');await dialog.locator('[data-commission-value]').nth(0).fill('5');await dialog.locator('[data-commission-value]').nth(1).fill('0');
 await page.screenshot({path:dir+'/commission-'+width+'.png'});await dialog.locator('button.btn.primary').click();
 await page.waitForFunction(()=>document.querySelector('#submit-quote').textContent==='Đã gửi duyệt');
 const saved=(await f.call('/quotes/'+q.data.id,f.cookies.emp)).data;assert.equal(saved.approvalStatus,'pending');assert.deepEqual(saved.data.rows.map(r=>r.commission.value),[5,0]);assert.equal(saved.data.rows[0].costPrice,undefined);assert.deepEqual(errors,[]);
 console.log('PASS '+width+': employee submits explicit 5% and 0, blank/cancel do not submit, costs stay private');await context.close();
}}finally{await browser.close();server.close();await f.client.close();}
