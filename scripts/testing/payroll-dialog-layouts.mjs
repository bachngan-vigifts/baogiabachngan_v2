import {auditDialog} from './dialog-layout-assertions.mjs';
/** Real local CRM/router/PGlite: discover salary settings and configure Sale Admin rewards, never production. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setupSalesPayroll} from '../../tests/helpers/sales-payroll-fixture.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setupSalesPayroll(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url));
const server=createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/staff/')){
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined,token=req.headers.authorization?.replace(/^Bearer /,''),r=await f.call(u.pathname.slice('/api/staff'.length)+u.search,token?'__Host-bn-session='+token:'',req.method,body);res.writeHead(r.status,{'content-type':'application/json','server-timing':'local;dur=1'}).end(JSON.stringify(r.data));return;
 }
 const path=u.pathname==='/'?'/index.html':u.pathname;let data=await readFile(root+path);if(path.endsWith('.html'))data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':'text/html;charset=utf-8');res.end(data);
}catch(e){res.writeHead(500).end(String(e.message));}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),out='/tmp/crm-payroll-dialogs',results=[];await mkdir(out,{recursive:true});



async function pageFor(width,cookie){
 const context=await browser.newContext({viewport:{width,height:1050},locale:'vi-VN'});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());const user=(await f.call('/me',cookie)).data.user;
 await context.addInitScript(({user,token})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user,token:cookie.split('=')[1]});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));return{context,page,errors};
}
try{
 await f.salary();
 for(const width of [1440,1024,390]){
  const {context,page,errors}=await pageFor(width,f.mgr);
  await page.goto(origin+'/#/members/emp?month=2026-10');
  await page.locator('#member-detail [data-act="salary"]').first().click();
  results.push(await auditDialog(page,'dialog[open]','salary-profile',width,out));
  await page.goto(origin+'/#/payroll?month=2026-10');
  for(const [action,name]of [['params','payroll-params'],['bonus-params','bonus-params']]){
   const control=page.locator('#payroll-board [data-act="'+action+'"]');
   // This audit measures the form, including settings hidden by the existing mobile toolbar.
   if(width<900)await control.evaluate(n=>n.click());else await control.click();
   results.push(await auditDialog(page,'dialog.pr-params[open]',name,width,out));
  }
  assert.deepEqual(errors,[]);await context.close();
 }
 await writeFile(out+'/results.json',JSON.stringify(results,null,2));
 console.log('PASS '+results.length+' payroll popup/viewport cases');
}finally{await browser.close();await new Promise(r=>server.close(r));await f.client.close();}
