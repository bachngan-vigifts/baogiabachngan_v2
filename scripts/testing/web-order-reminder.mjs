// Actual local CRM/router; all records and sessions are synthetic PGlite fixtures.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setup} from '../../tests/helpers/pos-fixture.ts';
import {webStoreOrders} from '../../src/modules/sales/pos-schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setup();await f.open(f.emp);const profile=(await f.call('/me',f.emp)).data.user;
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),writes=[];
const server=createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname.startsWith('/api/staff/')){
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined;
  if(req.method!=='GET')writes.push({method:req.method,path:u.pathname,action:body?.action});
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
const dir=process.env.WEB_REMINDER_SCREENSHOT_DIR||'/workspace/artifacts/web-order-reminder';await mkdir(dir,{recursive:true});
try{for(const width of [1440,430]){
 const ids=['contact','ghn','cancel'].map(kind=>kind+'-'+width),now=new Date().toISOString();
 await f.db.insert(webStoreOrders).values(ids.map((id,i)=>({id,source:'lock',externalId:id,orderNo:'WEB-'+id,registerId:f.registerId,status:'processing',customerName:'Khách kiểm thử '+i,phone:'0900000000',address:'Địa chỉ kiểm thử',orderedAt:new Date(Date.now()-(40+i)*60_000).toISOString(),updatedAt:now,lines:JSON.stringify([{sku:'00123',name:'Ly sứ',quantity:1,total:100000,totalTax:8000}]),total:108000})));
 const context=await browser.newContext({viewport:{width,height:1000}}),errors=[];
 await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 await context.addInitScript(({token,user})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{token:f.emp.split('=')[1],user:profile});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/#/pos');
 let reminder=page.locator('dialog.pos-contact-reminder[open]');await reminder.waitFor();
 assert.equal(await page.locator('dialog.pos-contact-reminder[open]').count(),1);
 const row=id=>reminder.locator(`[data-attention-order-id="${id}"]`);
 for(const id of ids)await row(id).waitFor();
 for(const b of await row(ids[0]).getByRole('button').all()){const box=await b.boundingBox();assert(box&&box.x>=0&&box.x+box.width<=width&&box.y+box.height<=1000);}
 assert.equal(await reminder.evaluate(n=>n.scrollWidth<=n.clientWidth+1),true);
 await page.screenshot({path:dir+'/popup-'+width+'.png'});
 await row(ids[0]).getByRole('button',{name:'Đã liên hệ',exact:true}).evaluate(n=>{n.click();n.click();});await row(ids[0]).waitFor({state:'detached'});
 assert.equal(writes.filter(w=>w.path===`/api/staff/pos/web-orders/${ids[0]}/contact`).length,1);
 await page.reload();await reminder.waitFor();assert.equal(await row(ids[0]).count(),0,'contact persists across page reload');
 await row(ids[1]).getByRole('button',{name:'Xử lý giao GHN',exact:true}).click();
 const ghn=page.locator('dialog[open]').filter({hasText:'Hoàn thiện địa chỉ GHN'});await ghn.waitFor();assert.equal(await reminder.count(),0);
 await page.screenshot({path:dir+'/ghn-'+width+'.png'});await ghn.locator('.pos-modal-close').click();
 await page.locator('.pos-contact-warning').getByRole('button',{name:'Xem nhắc nhở',exact:true}).click();await reminder.waitFor();
 await row(ids[2]).getByRole('button',{name:'Hủy đơn',exact:true}).click();
 const cancel=page.locator('dialog[open]').filter({hasText:'Huỷ đơn web'});await cancel.waitFor();await cancel.getByRole('textbox',{name:'Lý do huỷ đơn',exact:true}).waitFor();
 await page.screenshot({path:dir+'/cancel-'+width+'.png'});await cancel.locator('.pos-modal-close').click();
 assert.equal(writes.filter(w=>['confirm','cancel','complete'].includes(w.action)).length,0,'opening existing workflows never submits them');
 await page.locator('.pos-contact-warning').getByRole('button',{name:'Xem nhắc nhở',exact:true}).click();await reminder.waitFor();
 await page.goto(origin+'/#/home');assert.equal(await page.locator('dialog.pos-contact-reminder[open]').count(),0);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({width,autoPopup:true,contactPersisted:true,cancelAndGhnOpenExistingForms:true,errors}));
 // Remove the untouched demo orders before the next viewport to keep the screenshot concise.
 await f.client.query('delete from web_store_orders where id in ($1,$2)',[ids[1],ids[2]]);await context.close();
}}finally{await browser.close();server.close();await f.client.close();}
