/** Local canonical fixtures only. No live CRM, Sapo, GHN or production calls. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setupEarly} from '../../tests/helpers/purchase-early-fixture.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright'),f=await setupEarly(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),writes=[];
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/staff/')){
 const path=u.pathname.slice('/api/staff'.length)+u.search,chunks=[];for await(const c of req)chunks.push(c);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined;
 if(req.method!=='GET')writes.push(path);const token=req.headers.authorization?.replace(/^Bearer /,''),r=await f.call(path,token?'__Host-bn-session='+token:'',req.method,body);res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;
 }const path=u.pathname==='/'?'/index.html':u.pathname;let data=await readFile(root+path);if(path.endsWith('.html'))data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript;charset=utf-8':path.endsWith('.css')?'text/css':'text/html;charset=utf-8');res.end(data);
}catch(e){res.writeHead(500).end(String(e.message));}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),out='/workspace/scratch/mobile-new-quote-popup';await mkdir(out,{recursive:true});const results=[];
async function session(role,width){const context=await browser.newContext({viewport:{width,height:1000},locale:'vi-VN'});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());const user=ok(await f.call('/me',f.cookies[role])).user;await context.addInitScript(({token,user})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{token:f.cookies[role].split('=')[1],user});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));return{context,page,errors};}
try{
 for(const width of [360,390,430,768,1280]){
  const s=await session('mgr',width),{page}=s;await page.goto(origin+'/#/quotes');
  const create=page.locator('[data-new-quote]').first();await create.waitFor();await create.click();
  const dialog=page.locator('#new-quote-dialog');
  await page.screenshot({path:out+'/new-quote-'+width+'.png'});
  assert.equal(await dialog.evaluate(d=>d.open),true,'Create quote must open setup dialog at '+width);
  assert.equal(new URL(page.url()).hash,'#/quotes','Opening setup must not navigate to editor');
  await dialog.locator('[data-close]').first().click();
  assert.equal(new URL(page.url()).hash,'#/quotes');
  await create.click();
  assert.equal(await dialog.evaluate(d=>d.open),true);
  await page.locator('#nq-customer').fill('Khách kiểm thử');
  await page.locator('#nq-deposit-rate').fill('40');
  await page.locator('#nq-create').click();
  await page.waitForURL('**/#/quotes/new');
  assert.equal(await dialog.evaluate(d=>d.open),false);
  await page.waitForFunction(()=>document.querySelector('#quote-form [name=customer]').value==='Khách kiểm thử');
  assert.equal(s.errors.length,0,JSON.stringify(s.errors));
  results.push({width,popup:true,editor:true});await s.context.close();
 }
 assert.equal(writes.length,0,'Opening quote form must not write business data');
 console.log(JSON.stringify(results));
}finally{await browser.close();await new Promise(r=>server.close(r));}
