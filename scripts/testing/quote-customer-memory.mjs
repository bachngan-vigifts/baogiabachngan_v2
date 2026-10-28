/** Real local router/PGlite with the full quote editor. No production writes. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setup} from '../../tests/helpers/pos-fixture.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright'),f=await setup();
const uiRoot=process.env.UI_ROOT||fileURLToPath(new URL('../../trial-ui/',import.meta.url)),writes=[];let loseResponse=false;
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/staff/')){
 const path=u.pathname.slice('/api/staff'.length)+u.search,chunks=[];for await(const c of req)chunks.push(c);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined;
 if(req.method!=='GET')writes.push({path,body});const token=req.headers.authorization?.replace(/^Bearer /,''),r=await f.call(path,token?'__Host-bn-session='+token:'',req.method,body);
 if(loseResponse&&path==='/purchase-early-requests/file'&&r.status===201){loseResponse=false;res.writeHead(503,{'content-type':'application/json'}).end(JSON.stringify({error:'Mất phản hồi thử nghiệm sau lưu'}));return;}
 const data={...r.data};if(r.cookie)data.sessionToken=r.cookie.split('=')[1];res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(data));return;
 }const path=u.pathname==='/'?'/index.html':u.pathname;let data=await readFile(uiRoot+path);if(path.endsWith('.html'))data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html;charset=utf-8');res.end(data);
}catch(e){res.writeHead(500).end(String(e.message));}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,out='/workspace/scratch/quote-customer-memory';await mkdir(out,{recursive:true});const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),results=[];let debugPage;
async function session(width,role='mgr'){
 const context=await browser.newContext({viewport:{width,height:932},locale:'vi-VN'});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 const cookie=role==='mgr'?f.mgr:f.emp,user=(await f.call('/me',cookie)).data.user;
 await context.addInitScript(({user,token})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({user,session:token}));},{user,token:cookie.split('=')[1]});
 const page=await context.newPage(),errors=[];debugPage=page;page.on('pageerror',e=>errors.push(e.message));return{context,page,errors};
}
try{
 for(const width of [390,1280]){
  const c=await f.call('/customers',f.mgr,'POST',{name:'Khách nhớ '+width,phone:'0907777'+String(width).padStart(3,'0'),contact:'Ms Old',email:'old@example.com',address:'Địa chỉ ban đầu'});assert.equal(c.status,201);
  const q=await f.call('/quotes',f.mgr,'POST',{type:'HRC',quoteNo:'BG-MEM-'+width,date:'2026-10-28',customer:'Khách nhớ '+width,customerId:c.data.id,phone:'0907777'+String(width).padStart(3,'0'),contact:'Ms Old',email:'old@example.com',customerAddress:'Địa chỉ ban đầu',vat:8,rows:[{sku:'00123',name:'Ly sứ',unit:'cái',qty:1,price:100000}]});assert.equal(q.status,201);
  const {context,page,errors}=await session(width);await page.goto(origin+'/#/quotes/'+q.data.id);await page.waitForFunction(()=>document.querySelector('#quote-form [name=contact]')?.value==='Ms Old');if(await page.locator('[data-quote-step=info]').isVisible())await page.locator('[data-quote-step=info]').click();
  await page.locator('#quote-form [name=contact]').fill('Ms New '+width);await page.locator('#quote-form [name=email]').fill('new'+width+'@example.com');await page.locator('#quote-form [name=customerAddress]').fill('Địa chỉ mới '+width);
  const saved=page.waitForResponse(r=>r.url().includes('/quotes/'+q.data.id)&&r.request().method()==='PUT');await page.keyboard.press('Control+s');assert.equal((await saved).status(),200);await page.waitForFunction(()=>document.querySelector('#quote-customer-memory-status')?.textContent.includes('Đã lưu thông tin'));
  const profile=await f.call('/customers/'+c.data.id,f.mgr);assert.equal(profile.data.customer.contact,'Ms New '+width);assert.equal(profile.data.customer.email,'new'+width+'@example.com');assert.equal(profile.data.customer.address,'Địa chỉ mới '+width);
  await page.reload();await page.waitForFunction(()=>document.querySelector('#quote-form [name=contact]')?.value.startsWith('Ms New'));assert.equal(await page.locator('#quote-form [name=email]').inputValue(),'new'+width+'@example.com');assert.deepEqual(errors,[]);results.push({width,updatedAndReloaded:true,errors});await context.close();
 }
 await writeFile(out+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}catch(e){if(debugPage&&!debugPage.isClosed())console.log((await debugPage.locator('body').innerText()).slice(-3000));throw e;}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));await f.client.close();}
