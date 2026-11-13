/** Real local customer form/API/PGlite browser regression; never production. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createTestDb} from '../../tests/helpers/postgres.ts';
import {seedStaff,PASSWORD} from '../../tests/helpers/staff-fixture.ts';
import {createAppRouter} from '../../src/app/router.ts';
import {vietnamToday} from '../../src/modules/customers/domain/anniversary.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const s=await createTestDb();await seedStaff(s.d1);const router=createAppRouter(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url));
const call=async(path,cookie='',method='GET',body)=>{
 const r=await router.handle(new Request('https://trial.test/api/staff'+path,{method,headers:{origin:'https://trial.test',cookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),{db:s.db,passwordIterations:1000,sapoOrderPush:'off'});
 return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]||''};
};
const cookie=(await call('/login','','POST',{email:'mgr@x.vn',password:PASSWORD})).cookie,user=(await call('/me',cookie)).data.user;
const server=createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname.startsWith('/api/staff/')){const chunks=[];for await(const chunk of req)chunks.push(chunk);const token=req.headers.authorization?.replace(/^Bearer /,''),r=await call(u.pathname.slice('/api/staff'.length)+u.search,token?'__Host-bn-session='+token:'',req.method,chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined);res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;}
 const path=u.pathname==='/'?'/index.html':u.pathname;let bytes=await readFile(root+path);if(path.endsWith('.html'))bytes=Buffer.from(bytes.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':'text/html;charset=utf-8');res.end(bytes);
}catch(e){res.writeHead(500).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,out='/workspace/scratch/customer-anniversary';await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),results=[];
const next=new Date(vietnamToday()+'T00:00:00Z');next.setUTCDate(next.getUTCDate()+15);
const founded=String(next.getUTCFullYear()-10)+next.toISOString().slice(4,10);
try{for(const width of [1440,390]){
 const context=await browser.newContext({viewport:{width,height:1000},locale:'vi-VN'});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 await context.addInitScript(({user,token})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user,token:cookie.split('=')[1]});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/#/customers');/* Script này kiểm tra danh bạ / ngày kỷ niệm, không kiểm tra chia bước: hiện mọi ô của form 3 bước (xem customer-form-steps.mjs). */await page.addStyleTag({content:'#customer-dialog .cstep-off{display:revert!important}#customer-dialog #save-customer[hidden]{display:inline-flex!important}'});
 await page.locator('#new-customer').click();const dialog=page.locator('#customer-dialog');await dialog.locator('[name="name"]').fill('Công ty kỷ niệm '+width);
 await dialog.locator('[name="establishedDate"]').fill(founded);assert.match(await dialog.innerText(),/Kỷ niệm 10 năm/);
 await dialog.locator('#save-customer').click();await page.locator('#customer-detail').getByRole('heading',{name:'Công ty kỷ niệm '+width,exact:true}).waitFor();
 assert.match(await page.locator('#customer-detail').innerText(),/Kỷ niệm tiếp theo/);
 const id=decodeURIComponent(new URL(page.url()).hash.split('/')[2]);assert.equal((await call('/customers/'+id,cookie)).data.customer.establishedDate,founded);
 await page.locator('#customer-detail [data-act="edit"]').click();assert.equal(await dialog.locator('[name="establishedDate"]').inputValue(),founded);
 await dialog.locator('[name="phone"]').fill('0905'+width);await dialog.locator('#save-customer').click();await dialog.waitFor({state:'hidden'});
 assert.equal((await call('/customers/'+id,cookie)).data.customer.establishedDate,founded);
 await page.evaluate(()=>{location.hash='#/customers';});
 await page.locator('#customer-list tr').filter({hasText:'Công ty kỷ niệm '+width}).first().waitFor();
 if(width<850){const row=page.locator('#customer-list tr').filter({hasText:'Công ty kỷ niệm '+width}).first();await row.locator('[data-label="Kỷ niệm thành lập"]').waitFor({state:'visible'});assert.match(await row.locator('.crm-card-owner').innerText(),/Tên mgr/);}
 await page.locator('#customer-anniversaries').click();
 const reminders=page.locator('dialog[open]').filter({has:page.getByRole('heading',{name:'Gợi ý kỷ niệm thành lập',exact:true})});await reminders.waitFor();assert.match(await reminders.innerText(),/Công ty kỷ niệm/);assert.match(await reminders.innerText(),/10 năm/);
 await page.screenshot({path:out+'/'+width+'.png',fullPage:true});assert.deepEqual(errors,[]);results.push({width,created:true,editPreserved:true,reminderShown:true,errors});await context.close();
}await writeFile(out+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));}finally{await browser.close();server.close();await s.client.close();}
