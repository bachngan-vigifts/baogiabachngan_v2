/** Local real router/PGlite only; never cancels a production bill or contacts Sapo/GHN. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setup} from '../../tests/helpers/pos-fixture.ts';
import {posRefunds} from '../../src/modules/sales/return-schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setup(),shift=await f.open(),user=(await f.call('/me',f.mgr)).data.user,token=f.mgr.split('=')[1];
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url));let writes=0;
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;
 if(path.startsWith('/api/staff/')){let body;const chunks=[];for await(const chunk of req)chunks.push(chunk);if(chunks.length)body=JSON.parse(Buffer.concat(chunks).toString());
 const url=new URL(req.url,'http://localhost');if(req.method==='POST'&&path.endsWith('/quick-cancel'))writes++;
 const bearer=req.headers.authorization?.replace(/^Bearer /,'')||'';const r=await f.call(url.pathname.slice('/api/staff'.length)+url.search,bearer?'__Host-bn-session='+bearer:'',req.method,body);
 res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;}
 let data=await readFile(root+(path==='/'?'index.html':path));if(path==='/'||path==='/index.html')data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':'text/html');res.end(data);
 }catch(e){res.writeHead(500).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try{for(const width of [390,1280]){
 const sale=await f.call('/pos/checkout',f.emp,'POST',f.cart(shift.id));assert.equal(sale.status,201);
 const context=await browser.newContext({viewport:{width,height:844}});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 await context.addInitScript(({token,user})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{token,user});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/#/orders/'+sale.data.id);await page.locator('#order-title').filter({hasText:sale.data.orderNo}).waitFor();
 if(width===390)await page.locator('#order-actions > .mobile-action-trigger').click();
 await page.getByRole('button',{name:'Huỷ phiếu nhanh',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Huỷ nhanh bill POS',exact:true});await dialog.waitFor();
 const form=dialog.locator('form');assert.ok((await dialog.textContent()).includes('Sapo/GHN anh xử lý thủ công'));
 await form.locator('textarea').fill('Kiểm thử cục bộ, hàng và tiền đã nhận/trả');const before=writes;
 const save=dialog.getByRole('button',{name:'Huỷ đơn · hoàn tiền · nhập kho',exact:true});await save.click();assert.equal(writes,before);
 await dialog.getByRole('checkbox').check();await save.click();await dialog.waitFor({state:'hidden'});await page.locator('#order-status').filter({hasText:/Đã huỷ/}).waitFor();assert.equal(writes,before+1);
 assert.equal(await page.getByRole('button',{name:'Huỷ phiếu nhanh',exact:true}).count(),0);assert.deepEqual(errors,[]);
 if(process.env.POS_SCREENSHOT_DIR){await mkdir(process.env.POS_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:process.env.POS_SCREENSHOT_DIR+'/cancelled-'+width+'.png'});}
 console.log(JSON.stringify({width,realRouter:true,confirmedRefund:true,requests:1,errors}));await context.close();
 }assert.equal((await f.db.select().from(posRefunds)).length,2);
}finally{await browser.close();server.close();await f.client.close();}
