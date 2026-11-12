/** Local assets + mocked identity service only; never log in or send mail on production. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,extname} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out=process.env.SUPPLIER_REVIEW_DIR||'/workspace/output/supplier-workspace-review';await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{try{const p=new URL(req.url,'http://localhost').pathname,file=resolve(root,'.'+p);if(!file.startsWith(root)){res.writeHead(404).end();return;}let data=await readFile(file);if(p.endsWith('.html'))data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));res.writeHead(200,{'content-type':({'.html':'text/html;charset=utf-8','.js':'text/javascript','.css':'text/css','.jpeg':'image/jpeg'})[extname(file)]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),results=[];
try{
 for(const [width,enabled,role]of [[390,false,'supplier'],[390,true,'supplier'],[1280,false,'supplier'],[1280,true,'supplier'],[390,true,'employee']]){
  const context=await browser.newContext({viewport:{width,height:960},locale:'vi-VN'});await context.addInitScript(()=>{globalThis.__challenge={renders:0,resets:0};globalThis.turnstile={render(_box,o){globalThis.__challenge.renders++;globalThis.__challenge.options=o;o.callback('review-challenge-1');return'widget';},reset(){globalThis.__challenge.resets++;globalThis.__challenge.options.callback('review-challenge-2');}};});
  const calls=[],reads=[];let authed=false;
  await context.route('**/*',async route=>{const url=new URL(route.request().url());if(url.pathname.startsWith('/api/staff/')){
   const p=url.pathname.slice('/api/staff'.length);reads.push(p);
   if(p==='/me')return route.fulfill({status:authed?200:401,json:authed?{user:{id:'fixture-ncc',role,positionId:role,name:'NCC kiểm thử'}}:{error:'Vui lòng đăng nhập.'}});
   if(p==='/auth-config')return route.fulfill({json:{turnstileSiteKey:enabled?'review-site-key':''}});
   if(p==='/login'){calls.push(route.request().postDataJSON());await new Promise(r=>setTimeout(r,100));if(calls.length===1)return route.fulfill({status:401,json:{error:'Email hoặc mật khẩu không đúng.'}});authed=true;return route.fulfill({json:{sessionToken:'synthetic-session',ok:true}});}
   if(p==='/supplier-portal/early-requests')return route.fulfill({json:{requests:[],canRespond:true}});
   return route.fulfill({status:404,json:{error:'Unexpected fixture route'}});
  }if(url.origin===origin)return route.continue();return route.abort();});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/supplier.html?request=fixture-request');await page.locator('#supplier-auth:not([hidden])').waitFor();
  assert.ok(await page.locator('#supplier-auth .auth-logo img').isVisible());assert.equal(await page.locator('#login-name').getAttribute('type'),'email');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  if(!enabled&&role==='supplier')await page.screenshot({path:out+'/login-'+width+'.png'});
  await page.locator('#login-name').fill('partner@example.test');await page.locator('#login-password').fill('review-password-123');await page.locator('#supplier-show-password').check();assert.equal(await page.locator('#login-password').getAttribute('type'),'text');await page.locator('#supplier-show-password').uncheck();
  if(enabled)await page.waitForFunction(()=>globalThis.__challenge.renders===1);
  await page.locator('#login-form').evaluate(f=>{f.requestSubmit();f.requestSubmit();});await page.locator('#supplier-auth-error').filter({hasText:'không đúng'}).waitFor();assert.equal(calls.length,1,'duplicate submit must be ignored');assert.equal(calls[0].turnstileToken,enabled?'review-challenge-1':'');assert.equal(await page.locator('#login-submit').isEnabled(),true);
  await page.locator('#login-form').evaluate(f=>f.requestSubmit());
  if(role==='employee'){await page.locator('#supplier-auth-error').filter({hasText:'Trang dành cho NCC'}).waitFor();assert.ok(!reads.includes('/supplier-portal/early-requests'));}
  else{await page.locator('#supplier-workspace:not([hidden])').waitFor();assert.equal(await page.locator('#login-password').inputValue(),'');assert.equal(await page.locator('#login-password').getAttribute('type'),'password');}
  if(enabled){assert.equal(calls[1].turnstileToken,'review-challenge-2');assert.equal(await page.evaluate(()=>globalThis.__challenge.resets),2);}else assert.equal(await page.evaluate(()=>globalThis.__challenge.renders),0);
  assert.deepEqual(errors,[]);results.push({width,turnstile:enabled,role,duplicateBlocked:true,passwordToggle:true,roleBoundary:true,errors:0});await context.close();
 }
 console.log(JSON.stringify(results));
}finally{await writeFile(out+'/login-tests.json',JSON.stringify(results,null,2));await browser.close();await new Promise(r=>server.close(r));}
