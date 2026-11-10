import {auditDialog} from './dialog-layout-assertions.mjs';
/** Real CRM cash form with local API/PGlite; no production money movements. */
import assert from 'node:assert/strict';import{createServer}from'node:http';import{readFile,mkdir,writeFile}from'node:fs/promises';import{fileURLToPath}from'node:url';import{setup}from'../../tests/helpers/pos-fixture.ts';
const{chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright'),f=await setup(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out='/tmp/crm-cash-dialogs',writes=[],names=[];await mkdir(out,{recursive:true});await f.open();const user=(await f.call('/me',f.emp)).data.user,day=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Ho_Chi_Minh'});
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/staff/')){const chunks=[];for await(const c of req)chunks.push(c);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined,token=req.headers.authorization?.replace(/^Bearer /,''),r=await f.call(u.pathname.slice(10)+u.search,token?'__Host-bn-session='+token:'',req.method,body);if(req.method!=='GET')writes.push({path:u.pathname,body,status:r.status,id:r.data.id});if(u.pathname.endsWith('/cash/entry-names'))names.push(u.searchParams.get('drawerId'));res.writeHead(r.status,{'content-type':'application/json','server-timing':'region;desc="ap-northeast-2"'}).end(JSON.stringify(r.data));return;}const path=u.pathname==='/'?'/index.html':u.pathname;let data=await readFile(root+path);if(path.endsWith('.html'))data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));res.writeHead(200,{'content-type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':'text/html'}).end(data);}catch(e){res.writeHead(500).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),results=[];
try{for(const width of [1440,1024,390,320]){
 const c=await browser.newContext({viewport:{width,height:932},locale:'vi-VN'});
 await c.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 await c.addInitScript(({user,token})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user,token:f.emp.split('=')[1]});
 const p=await c.newPage();await p.goto(origin+'/#/cash');const cash=p.locator('#view-cash');
 for(const [button,name]of [['+ Chi tiền','cash-expense'],['Nộp quỹ','cash-remittance']]){
  await cash.getByRole('button',{name:button,exact:true}).click();
  const d=p.locator('dialog.cash-dialog[open]');
  if(width>=900)results.push(await auditDialog(p,'dialog.cash-dialog[open]',name,width,out));
  else{await p.screenshot({path:out+'/'+name+'-'+width+'.png'});assert.ok(await d.evaluate(n=>n.scrollWidth<=n.clientWidth+1));await d.getByRole('button',{name:'Huỷ',exact:true}).click();}
 }
 await c.close();
}await writeFile(out+'/results.json',JSON.stringify(results,null,2));console.log('PASS cash expense/remittance layouts at 1440/1024/390/320');
}finally{await browser.close();await new Promise(r=>server.close(r));await f.client.close();}
