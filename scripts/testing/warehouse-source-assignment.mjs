/** Real CRM UI + router on synthetic PGlite data. No external browser/API requests are permitted. */
import assert from 'node:assert/strict';
import {createServer}from'node:http';
import {readFile,mkdir,writeFile}from'node:fs/promises';
import{fileURLToPath}from'node:url';
import{eq}from'drizzle-orm';
import{sourceAssignmentFixture}from'../../tests/helpers/warehouse-source-assignment-fixture.ts';
import{warehouseWorkParts as parts,warehouseWorkRuns as runs}from'../../src/modules/warehouse-workspace/schema.ts';
const{chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const f=await sourceAssignmentFixture(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out=process.env.REVIEW_DIR||'/tmp/warehouse-source-assignment';await mkdir(out,{recursive:true});
const errors=[],writes=[];let dropFirstAssign=true;
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/staff/')){const chunks=[];for await(const c of req)chunks.push(c);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined,token=req.headers.authorization?.replace(/^Bearer /,''),r=await f.call(u.pathname.slice(10)+u.search,token?'__Host-bn-session='+token:'',req.method,body);
 if(req.method!=='GET')writes.push({path:u.pathname,status:r.status});if(dropFirstAssign&&u.pathname.endsWith('/assign')&&r.status===200){dropFirstAssign=false;res.writeHead(503,{'content-type':'application/json'}).end(JSON.stringify({error:'Phản hồi thử bị gián đoạn sau khi lưu'}));return;}
 res.writeHead(r.status,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify({...r.data,...(r.cookie?{sessionToken:/__Host-bn-session=([a-f0-9]{64})/.exec(r.cookie)?.[1]||''}:{})}));return;}
 const path=u.pathname==='/'?'/index.html':u.pathname;let bytes=await readFile(root+path);if(path.endsWith('.html'))bytes=Buffer.from(bytes.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.writeHead(200,{'content-type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':path.endsWith('.png')?'image/png':'text/html'}).end(bytes);
 }catch(e){res.writeHead(500).end(String(e.message));}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
const contexts=[];
async function login(width,email='mgr@x.vn'){
 const context=await browser.newContext({viewport:{width,height:980},locale:'vi-VN'});contexts.push(context);await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 const p=await context.newPage();p.on('pageerror',e=>{errors.push(e.message);console.error('PAGE_ERROR',e.message);});await p.goto(origin+'/#/kho');await p.locator('#auth').waitFor({state:'visible'});await p.locator('#email').fill(email);await p.locator('#password').fill('mat-khau-12345');await p.locator('#login-button').click();await p.locator('#workspace').waitFor({state:'visible'});await p.goto(origin+'/#/kho');try{await p.locator('.ww-page').waitFor();}catch(e){await p.screenshot({path:out+'/login-debug-'+width+'.png'});console.error(JSON.stringify({url:p.url(),errors,body:(await p.locator('body').innerText()).slice(-1800)}));throw e;}return p;
}
try{
 const p=await login(1440);await p.locator('[data-ww-action=assign-source]').click();let d=p.locator('.ww-assignment-dialog[open]');await d.locator('[name=sourceTask]').waitFor();assert.equal(await d.locator('[name=sourceTask]').inputValue(),f.id);assert.equal(await d.locator('[name=title]').count(),0);
 await d.screenshot({path:out+'/single-1440.png'});
 await d.locator('[data-mode=team]').click();assert.equal(await d.locator('[data-mode=team]').getAttribute('aria-pressed'),'true');await d.screenshot({path:out+'/team-1440.png'});
 assert.equal(await d.locator('[name=assignee]:checked').count(),2);
 const mobile=await login(390);await mobile.locator('[data-ww-action=assign-source]').click();let md=mobile.locator('.ww-assignment-dialog[open]');await md.locator('[data-mode=team]').click();await md.screenshot({path:out+'/team-390.png'});
 assert.ok(await md.evaluate(e=>e.scrollWidth<=e.clientWidth+1));assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await md.locator('[data-close]').first().click();
 for(const row of await d.locator('[data-member]').all()){const id=await row.getAttribute('data-member');await row.locator('[data-part]').fill(id==='wh'?'Soạn hàng':'Đóng gói');await row.locator('[data-minutes]').fill('20');}
 const due=new Date(Date.now()+86400000+7*3600000).toISOString().slice(0,16);await d.locator('[name=dueAt]').fill(due);await d.locator('[name=reason]').fill('Định mức và hạn công việc được duyệt cho dữ liệu thử');
 await d.locator('[type=submit]').click();await d.locator('[data-error]').filter({hasText:/gián đoạn|lưu|kết nối/}).waitFor();await d.locator('[type=submit]').click();await d.waitFor({state:'hidden'});
 assert.equal((await f.db.select().from(parts).where(eq(parts.assignmentId,f.id))).length,2,'retry must not duplicate team parts');
 assert.equal((await f.db.select().from(runs)).reduce((n,r)=>n+r.weight,0),1);
 const worker=await login(390,'wh@x.vn');await worker.locator('[data-ww-action=start]').first().click();await worker.locator('[data-ww-action=submit]').first().waitFor();await worker.screenshot({path:out+'/worker-part-390.png'});
 assert.equal(await worker.locator('[data-ww-action=assign-source]').count(),0,'worker cannot manage assignments');
 assert.deepEqual(errors,[]);
 await writeFile(out+'/results.json',JSON.stringify({desktop1440:true,mobile390:true,realSourceSelected:true,noFreeFormTask:true,teamParts:2,normalizedWeight:1,lostResponseRetrySafe:true,workerOwnPart:true,noHorizontalOverflow:true,errors,writes},null,2));console.log(JSON.stringify({out,errors,cases:4}));
}finally{for(const c of contexts)await c.close();await browser.close();await new Promise(r=>server.close(r));await f.client.close();}
