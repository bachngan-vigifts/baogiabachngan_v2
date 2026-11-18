/** Full local CRM/router + synthetic PGlite data; all external browser requests blocked. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setup} from '../../tests/helpers/pos-fixture.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setup(),sent=[];
f.env.aiChatIntegration={webhookUrl:'https://n8n.fixture.invalid/hook',webhookToken:'x'.repeat(64),fetch:async(_u,i)=>{sent.push(JSON.parse(String(i.body)));return new Response('{}');}};
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url));
const server=createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname.startsWith('/api/staff/')){
  const chunks=[];for await(const c of req)chunks.push(c);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined;
  const token=req.headers.authorization?.replace(/^Bearer /,'')||'';
  const r=await f.call(u.pathname.slice('/api/staff'.length)+u.search,token?'__Host-bn-session='+token:'',req.method,body);
  res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;
 }
 const path=u.pathname==='/'?'index.html':u.pathname.slice(1);let data=await readFile(root+path);
 if(path==='index.html')data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.writeHead(200,{'content-type':path.endsWith('.js')?'application/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':'text/html;charset=utf-8'}).end(data);
 }catch{res.writeHead(500).end('Fixture error');}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,dir=process.env.AI_CHAT_SCREENSHOTS||'/workspace/artifacts/pr719-ai-chat';await mkdir(dir,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']}),results=[];
try{for(const [role,cookie] of [['manager',f.mgr],['employee',f.emp]])for(const width of [390,1440]){
 const user=(await f.call('/me',cookie)).data.user,token=cookie.split('=')[1];
 const ctx=await browser.newContext({viewport:{width,height:900},locale:'vi-VN'});await ctx.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 await ctx.addInitScript(({token,user})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{token,user});
 const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/index.html#/ai-chat');await page.locator('#view-ai-chat [data-ask]').waitFor();
 if(width===390){await page.locator('.crm-mobile-nav [data-mobile-nav-group=work]').click();assert.equal(await page.locator('.crm-nav-sheet [data-mobile-nav=ai-chat]').isVisible(),true);await page.locator('.crm-nav-sheet [data-mobile-nav=ai-chat]').click();}
 const question='Hướng dẫn kiểm tra nguồn hàng '+role+' '+width+'?';
 await page.locator('#view-ai-chat textarea').fill(question);await page.locator('#view-ai-chat [data-ask] button').click();
 await page.waitForFunction(q=>[...document.querySelectorAll('.ai-chat-card h2')].some(n=>n.textContent===q),question);
 const payload=sent.find(p=>p.question.text===question);assert.ok(payload);
 const answer='<img src=x onerror="window.aiFixtureXss=true"> Nội dung minh hoạ';
 const reply=await f.router.handle(new Request('https://trial.test/api/staff/integrations/ai-chat/'+payload.question.id+'/result',{method:'POST',headers:{origin:'https://trial.test',authorization:'Bearer '+payload.callback.token,'content-type':'application/json'},body:JSON.stringify({status:'answered',answer})}),f.env);assert.equal(reply.status,200);
 await page.reload();await page.locator('#view-ai-chat .ai-chat-answer').first().waitFor();
 const card=page.locator('.ai-chat-card').filter({has:page.getByRole('heading',{name:question,exact:true})});
 assert.equal(await card.locator('.ai-chat-answer p').textContent(),answer);assert.equal(await card.locator('.ai-chat-answer img').count(),0);assert.equal(await page.evaluate(()=>!!window.aiFixtureXss),false);
 await card.locator('[data-helpful]').click();await page.waitForFunction(id=>document.querySelector('[data-helpful="'+id+'"]')?.dataset.on==='1',payload.question.id);
 await page.locator('#view-ai-chat [data-search]').fill('khong-tim-thay-fixture');await page.waitForFunction(()=>document.querySelector('#view-ai-chat .full-empty')?.textContent.includes('Chưa có'));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
 assert.deepEqual(errors,[]);await page.screenshot({path:dir+'/'+role+'-'+width+'.png'});results.push({role,width,menu:true,post:true,callback:true,escapedAnswer:true,helpful:true,search:true,errors});console.log(JSON.stringify(results.at(-1)));await ctx.close();
 }}finally{await writeFile(dir+'/results.json',JSON.stringify(results,null,2));await browser.close();server.close();await f.client.close();}
