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
const dir=process.env.QUOTE_EDIT_SCREENSHOT_DIR||'/workspace/artifacts/quote-edit-requests';await mkdir(dir,{recursive:true});
const action=async(page,selector)=>{const b=page.locator(selector);await b.waitFor({state:'attached'});if(!await b.isVisible())await b.evaluate(n=>n.closest('[popover]')?.showPopover());await b.click();};
try{for(const width of [1440,430]){
 const q=await f.call('/quotes',f.cookies.emp,'POST',{type:'B2B',quoteNo:'B2B_EDIT_BROWSER_'+width,date:'2026-11-17',customer:'Khách kiểm thử',vat:8,rows:[{name:'Ly kiểm thử',qty:2,price:100000}]});assert.equal(q.status,201);
 const id=q.data.id;assert.equal((await f.call(`/quotes/${id}/approve`,f.cookies.mgr,'POST',{revision:1})).status,200);
 const contexts={},pages={},errors=[];
 for(const who of ['emp','mgr']){
  const context=await browser.newContext({viewport:{width,height:1000}});contexts[who]=context;
  await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
  await context.addInitScript(({token,user})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{token:f.cookies[who].split('=')[1],user:users[who]});
  const page=await context.newPage();pages[who]=page;page.on('pageerror',e=>errors.push(e.message));
 }
 const staff=pages.emp,manager=pages.mgr;
 await staff.goto(origin+'/#/quotes/'+id);await staff.locator('#request-quote-edit:not([hidden])').waitFor({state:'attached'});
 assert.equal(await staff.locator('[name=quoteNo]').isDisabled(),true);
 await action(staff,'#request-quote-edit');let dlg=staff.locator('dialog.quote-edit-request-dialog[open]');
 await dlg.getByRole('textbox',{name:'Lý do sửa báo giá',exact:true}).fill('Nội dung sẽ hủy');await dlg.getByRole('button',{name:'Đóng',exact:true}).click();
 await action(staff,'#request-quote-edit');dlg=staff.locator('dialog.quote-edit-request-dialog[open]');
 assert.equal(await dlg.getByRole('textbox',{name:'Lý do sửa báo giá',exact:true}).inputValue(),'');
 const reason='Khách xin đổi số lượng <img src=x onerror=alert(1)>'.repeat(3);
 await dlg.getByRole('textbox',{name:'Lý do sửa báo giá',exact:true}).fill(reason);
 await staff.screenshot({path:dir+'/request-'+width+'.png'});
 await dlg.getByRole('button',{name:'Gửi yêu cầu',exact:true}).evaluate(n=>{n.click();n.click();});await dlg.waitFor({state:'hidden'});
 await staff.waitForFunction(()=>document.querySelector('#request-quote-edit')?.textContent==='Đang chờ cho phép sửa');
 assert.equal(await staff.locator('[name=quoteNo]').isDisabled(),true);
 await manager.goto(origin+'/#/quotes/'+id);await manager.locator('#request-quote-edit:not([hidden])').waitFor({state:'attached'});await action(manager,'#request-quote-edit');
 const review=manager.locator('dialog.quote-edit-request-dialog[open]');await review.getByRole('button',{name:'Cho phép sửa',exact:true}).waitFor();
 assert.equal(await review.locator('img').count(),0,'request text cannot inject markup');
  assert.equal(await review.locator('.quote-edit-request-reason').innerText(),reason,'Manager can read the complete reason');
  await review.getByRole('button',{name:'Từ chối',exact:true}).click();await review.getByRole('alert').filter({hasText:'Nhập lý do ít nhất 5 ký tự.'}).waitFor();
 for(const name of ['Đóng','Cho phép sửa','Từ chối']){const b=await review.getByRole('button',{name,exact:true}).boundingBox();assert(b&&b.x>=0&&b.x+b.width<=width&&b.y+b.height<=1000,name+' is within viewport');}
 assert.equal(await review.evaluate(n=>n.scrollWidth<=n.clientWidth+1),true);
 await manager.screenshot({path:dir+'/review-'+width+'.png'});
 await review.getByRole('button',{name:'Cho phép sửa',exact:true}).click();await review.waitFor({state:'hidden'});
 await staff.reload();await staff.waitForFunction(()=>document.querySelector('#request-quote-edit')?.textContent==='Được phép sửa');
 assert.equal(await staff.locator('[name=quoteNo]').isDisabled(),false);
 await staff.locator('[name=internalNote]').fill('Sửa theo yêu cầu đã được Manager cho phép');
 await action(staff,width>850?'#save-quote':'#save-quote-m');
 await staff.waitForFunction(()=>document.querySelector('#editor-approval')?.textContent==='Nháp').catch(async e=>{console.log({error:await staff.locator('#quote-error').innerText(),writes});await staff.screenshot({path:dir+'/failure-'+width+'.png'});throw e;});
 const saved=await f.call(`/quotes/${id}`,f.cookies.mgr);assert.equal(saved.data.revision,2);assert.equal(saved.data.approvalStatus,'draft');
 assert.equal(saved.data.data.internalNote,'Sửa theo yêu cầu đã được Manager cho phép');
 assert.equal(writes.filter(w=>w.path===`/api/staff/quotes/${id}/edit-request`).length,1,'double click sends one request');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({width,requestReviewSave:true,cancelResets:true,privatePermission:true,noHorizontalDialogOverflow:true,errors}));
 for(const c of Object.values(contexts))await c.close();
}}finally{await browser.close();server.close();await f.client.close();}
