/** Real browser/router/PGlite verification, synthetic data only. External traffic blocked. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setup} from '../../tests/helpers/pos-fixture.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setup(),shift=await f.open(),user=(await f.call('/me',f.mgr)).data.user,token=f.mgr.split('=')[1];
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),dir='/workspace/scratch/faster-write-feedback',calls=[];
await mkdir(dir,{recursive:true});let loseTask=false;
const server=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost'),path=url.pathname;
 if(path.startsWith('/api/staff/')){
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined;
  calls.push({path:path.slice(10),method:req.method,body});
  const bearer=req.headers.authorization?.replace(/^Bearer /,'')||'';
  const r=await f.call(path.slice('/api/staff'.length)+url.search,bearer?'__Host-bn-session='+bearer:'',req.method,body);
  await new Promise(resolve=>setTimeout(resolve,100));
  if(loseTask&&req.method==='POST'&&path==='/api/staff/tasks'){loseTask=false;res.writeHead(502,{'content-type':'application/json'}).end(JSON.stringify({error:'Mất phản hồi kiểm thử sau khi máy chủ đã lưu'}));return;}
  res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;
 }
 let data=await readFile(root+(path==='/'?'index.html':path));if(path==='/'||path==='/index.html')data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(data);
}catch(e){res.writeHead(500).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),results=[];
try{for(const width of [1280,390]){
 const context=await browser.newContext({viewport:{width,height:1000}});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 await context.addInitScript(({token,user})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{token,user});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/#/tasks');await page.locator('#tasks-new').click();const form=page.locator('#tasks-quick'),title='Việc kiểm thử '+width;
 await form.locator('[name=title]').fill(title);await form.locator('[name=assigneeId]').selectOption('mgr');
 loseTask=true;await form.locator('[type=submit]').click();await form.getByRole('button',{name:'Gửi lại lần giao việc trước',exact:true}).waitFor();
 if(width===1280){await page.reload();await page.locator('#tasks-new').click();}else{await form.locator('[data-cancel]').click();await form.waitFor({state:'hidden'});await page.locator('#tasks-new').click();}await form.waitFor({state:'visible'});assert.equal(await form.locator('[name=title]').inputValue(),title);
 await form.getByRole('button',{name:'Gửi lại lần giao việc trước',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#tasks-quick [name=title]').value==='');
 await form.locator('[name=title]').fill(title);await form.getByRole('button',{name:'Giao việc',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#tasks-quick [name=title]').value==='');
 const creates=calls.filter(c=>c.path==='/tasks'&&c.method==='POST'&&c.body.title===title);assert.equal(creates.length,3);assert.equal(creates[0].body.clientKey,creates[1].body.clientKey);assert.notEqual(creates[1].body.clientKey,creates[2].body.clientKey);
 const tasks=(await f.call('/tasks?view=created',f.mgr)).data.tasks.filter(t=>t.title===title);assert.equal(tasks.length,2);
 await page.screenshot({path:dir+'/tasks-'+width+'.png',fullPage:true});
 const sale=await f.call('/pos/checkout',f.emp,'POST',f.cart(shift.id,{fulfillmentMode:'cod',depositAmount:50000,delivery:{address:'Kho khách',receiverName:'Khách',receiverPhone:'0900000000'}}));assert.equal(sale.status,201,JSON.stringify(sale.data));
 await page.goto(origin+'/#/orders/'+sale.data.id);await page.locator('[data-void-payment]').click();await page.getByLabel('Lý do huỷ phiếu thu').fill('Sai khoản thu kiểm thử');
 const mark=calls.length;await page.getByRole('button',{name:'Huỷ phiếu thu',exact:true}).click();await page.locator('.void-note').waitFor();
 assert.equal(calls.slice(mark).filter(c=>c.method==='GET'&&c.path==='/orders/'+sale.data.id).length,0,'confirmed write must not fetch the order a second time');
 const detail=(await f.call('/orders/'+sale.data.id,f.mgr)).data;assert.ok(detail.payments[0].voidedAt);assert.deepEqual(errors,[]);
 await page.screenshot({path:dir+'/confirmed-order-'+width+'.png',fullPage:true});results.push({width,lostReplySameKey:true,recoveredAfterReload:width===1280,distinctConfirmedIntents:true,taskRows:2,extraOrderGets:0,pageErrors:errors});await context.close();
}console.log(JSON.stringify(results));}finally{await writeFile(dir+'/results.json',JSON.stringify(results,null,2));await browser.close();server.close();await f.client.close();}
