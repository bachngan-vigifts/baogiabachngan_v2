/** Mock-only browser test; PLAYWRIGHT_MODULE=/tmp/pos-browser/node_modules/playwright/index.mjs node scripts/testing/portal-forgot-password.mjs */
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
import assert from 'node:assert/strict';import {createServer} from 'node:http';import {readFile} from 'node:fs/promises';import {fileURLToPath} from 'node:url';import {resolve,extname} from 'node:path';
const root=fileURLToPath(new URL('../../trial-ui',import.meta.url));
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname,file=resolve(root,'.'+path);if(!file.startsWith(root+'/')){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpeg':'image/jpeg'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
try{
 for(const [path,audience] of [['customer.html','customer'],['supplier.html','supplier'],['index.html',undefined]]){
  const context=await browser.newContext({viewport:{width:390,height:844}}),calls=[];
  await context.route('**/*',async route=>{
   const url=route.request().url();
   if(url.includes('/api/staff/')){
    const endpoint=url.split('/api/staff')[1];
    if(endpoint==='/forgot-password'){calls.push(route.request().postDataJSON());await new Promise(r=>setTimeout(r,100));await route.fulfill(calls.length===1?{status:404,json:{error:'Không tìm thấy.'},headers:{'access-control-allow-origin':origin}}:{status:200,json:{ok:true,message:'Nếu email khớp tài khoản đang hoạt động, hệ thống sẽ gửi liên kết đặt lại mật khẩu.'},headers:{'access-control-allow-origin':origin}});}
    else await route.fulfill({status:endpoint==='/me'?401:200,json:endpoint==='/me'?{error:'Vui lòng đăng nhập.'}:{ok:true},headers:{'access-control-allow-origin':origin}});
   }else if(url.startsWith(origin+'/'))await route.continue();else await route.abort();
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/'+path);
  await page.getByRole('button',{name:'Quên mật khẩu?',exact:true}).click();
  await page.getByLabel('Email nhận liên kết đặt lại mật khẩu',{exact:true}).fill('account@example.test');
  await page.locator('dialog[open] form').evaluate(f=>{f.requestSubmit();f.requestSubmit();});
  await page.getByRole('status').filter({hasText:'đang được cập nhật'}).waitFor();
  assert.equal(calls.length,1);assert.equal(await page.getByLabel('Email nhận liên kết đặt lại mật khẩu',{exact:true}).inputValue(),'account@example.test');
  assert.equal(await page.getByRole('button',{name:'Gửi liên kết đặt lại',exact:true}).isEnabled(),true);
  await page.locator('dialog[open] form').evaluate(f=>f.requestSubmit());
  await page.getByRole('status').filter({hasText:'Nếu email khớp'}).waitFor();
  assert.equal(calls.length,2);assert.deepEqual(calls[0],{email:'account@example.test',...(audience?{audience}:{})});assert.deepEqual(calls[1],calls[0]);
  assert.deepEqual(errors,[]);console.log(path+': recovery button, rollout404, retry and duplicate-click protection passed');await context.close();
 }
 const context=await browser.newContext({viewport:{width:390,height:844}}),calls=[];
 await context.route('**/*',async route=>{
  const url=route.request().url();if(url.includes('/api/staff/')){const path=url.split('/api/staff')[1];calls.push({path,body:route.request().postDataJSON()});await route.fulfill({json:path==='/activation-info'?{email:'account@example.test'}:{ok:true},headers:{'access-control-allow-origin':origin}});}
  else if(url.startsWith(origin+'/'))await route.continue();else await route.abort();
 });
 const page=await context.newPage();await page.goto(origin+'/reset-password.html#token='+'a'.repeat(64)+'&portal=supplier');await page.locator('#reset-form:not([hidden])').waitFor();assert.equal(new URL(page.url()).hash,'');assert.equal(await page.locator('#reset-login').getAttribute('href'),'supplier.html');
 await page.locator('[name=password]').fill('new-password-123');await page.locator('[name=password2]').fill('not-matching-123');await page.getByRole('button',{name:'Lưu mật khẩu mới',exact:true}).click();assert.equal(calls.length,1);
 await page.locator('[name=password2]').fill('new-password-123');await page.getByRole('button',{name:'Lưu mật khẩu mới',exact:true}).click();await page.getByText('Đã đặt mật khẩu mới. Vui lòng đăng nhập lại.',{exact:true}).waitFor();assert.equal(calls.length,2);assert.equal(calls[1].path,'/activate');assert.equal(await page.locator('#reset-form').isHidden(),true);console.log('reset page: fragment cleared, confirmation and redemption passed');await context.close();
}finally{await browser.close();server.close();}
