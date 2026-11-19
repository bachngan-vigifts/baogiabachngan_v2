/** Popup UI + real isolated CRM API. No production requests or business messages. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {homeFixture} from '../../tests/helpers/home-fixture.ts';
import {PASSWORD} from '../../tests/helpers/staff-fixture.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'),f=await homeFixture(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out='/workspace/artifacts/global-reminder';await mkdir(out,{recursive:true});
const attempts=[],saved=[];let failAfterSave=false,expireNext=false;
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://local');if(u.pathname.startsWith('/api/staff/')){const chunks=[];for await(const chunk of req)chunks.push(chunk);const payload=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined,path=u.pathname.slice(10)+u.search,token=req.headers.authorization?.replace(/^Bearer /,'');
 if(path==='/tasks'&&req.method==='POST'){attempts.push(payload);if(expireNext){expireNext=false;res.writeHead(401,{'content-type':'application/json'}).end('{"error":"Phiên hết hạn kiểm thử"}');return;}}
 const r=await f.call(path,token?'__Host-bn-session='+token:'',req.method,payload);if(path==='/tasks'&&req.method==='POST'&&(r.status===201||r.status===200)&&r.data.id){saved.push(r.data);if(failAfterSave){failAfterSave=false;res.writeHead(503,{'content-type':'application/json'}).end('{"error":"Chưa rõ kết quả kiểm thử"}');return;}}
 res.writeHead(r.status,{'content-type':'application/json','cache-control':'no-store','server-timing':'region;desc="ap-northeast-2"'}).end(JSON.stringify({...r.data,...(r.cookie?{sessionToken:/__Host-bn-session=([a-f0-9]{64})/.exec(r.cookie)?.[1]||''}:{})}));return;}
 const path=u.pathname==='/'?'/index.html':u.pathname;let bytes=await readFile(root+path);if(path.endsWith('.html'))bytes=Buffer.from(bytes.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));res.writeHead(200,{'content-type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':'text/html'}).end(bytes);
 }catch(e){res.writeHead(500).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']}),results=[];
try{
 for(const [id,width] of [['mgr',1280],['mgr',390],['emp',390],['wh',390],['acct',390],['counter',390],['admin',390],['restricted',390]]){
  const c=await browser.newContext({viewport:{width,height:850},locale:'vi-VN'});await c.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());await c.addInitScript(token=>localStorage.setItem('bn-v2-session',token),f.cookies[id].split('=')[1]);const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto(origin+'/#/tasks');const launcher=p.locator('#reminder-launcher');await launcher.waitFor({state:'visible'});assert.equal(await p.locator('link[href*="home.css"]').count(),0,'cold non-home route does not need Home CSS');await launcher.click();const d=p.locator('.home-reminder-dialog[open]');await d.waitFor();
  const sizes=await d.evaluate(n=>({width:n.getBoundingClientRect().width,viewport:innerWidth,scroll:n.scrollWidth,client:n.clientWidth,footer:n.querySelector('footer').getBoundingClientRect().bottom,height:innerHeight}));assert.ok(sizes.width<=width);assert.ok(sizes.scroll<=sizes.client+1);assert.ok(sizes.footer<=sizes.height);
  await d.locator('[name=note]').fill('Nhắc từ mọi trang '+id);await d.locator('[name=time]').fill('15:45');await p.screenshot({path:out+'/'+id+'-'+width+'.png'});await d.locator('[type=submit]').click();await p.locator('.home-reminder-dialog').waitFor({state:'detached'});
  const task=(await f.call('/tasks/'+saved.at(-1).id,f.cookies[id])).data.task;assert.equal(task.assigneeId,id);assert.equal(task.dueTime,'15:45');assert.equal(task.description,'Nhắc từ mọi trang '+id);
  const overlap=await p.evaluate(()=>{const a=document.querySelector('#reminder-launcher').getBoundingClientRect(),b=document.querySelector('#chat-launcher').getBoundingClientRect();return {reminder:{left:a.left,right:a.right,bottom:a.bottom},chat:{left:b.left,right:b.right,bottom:b.bottom},overlap:a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top};});assert.equal(overlap.overlap,false);
  if(id==='mgr'){
   for(const route of ['#/quotes/new','#/pos','#/home']){await p.goto(origin+'/'+route);await launcher.waitFor({state:'visible'});const box=await launcher.boundingBox();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=width&&box.y+box.height<=850);await launcher.click();await d.waitFor();await p.keyboard.press('Escape');await p.locator('.home-reminder-dialog').waitFor({state:'detached'});}
  }
  await launcher.click();await d.waitFor();await d.locator('[name=note]').fill('Phiên sắp hết hạn');expireNext=true;await d.locator('[type=submit]').click();await p.locator('#auth').waitFor({state:'visible'});assert.equal(await p.locator('.home-reminder-dialog').count(),0);assert.equal(await launcher.isVisible(),false);
  assert.deepEqual(errors,[]);results.push({id,width,sizes,overlap,coldNonHome:true,savedOwnTask:true,time:'15:45',hiddenOnExpiry:true,errors});await c.close();
 }
 await writeFile(out+'/browser.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}finally{await browser.close();await new Promise(r=>server.close(r));await Promise.allSettled([...f.background]);await f.client.close();}
