/** Real CRM UI and API on synthetic data only. All nonlocal requests are blocked. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {eq} from 'drizzle-orm';
import {homeFixture} from '../../tests/helpers/home-fixture.ts';
import {tasks} from '../../src/modules/tasks/schema.ts';
import {warehouseWorkRuns as runs} from '../../src/modules/warehouse-workspace/schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const f=await homeFixture(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out='/tmp/warehouse-workspace';await mkdir(out,{recursive:true});
const check=(r,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};
const calendar={days:[0,1,2,3,4,5,6],start:'00:00',end:'23:59',breakStart:'',breakEnd:''};
check(await f.call('/warehouse-workspace/settings',f.cookies.mgr,'PUT',{calendar,bonusBudget:1000000,revision:0,reason:'Ca kiểm thử'}));
const at=new Date().toISOString();for(const id of ['browser-wh-desktop','browser-wh-mobile','browser-cancel-1440','browser-cancel-390']){
 await f.db.insert(tasks).values({id,title:'Soạn hàng '+id,assigneeId:'wh',dueDate:f.today,dueTime:'23:59',description:'8 dòng hàng · 24 sản phẩm',createdBy:'mgr',createdAt:at,updatedAt:at});
 check(await f.call('/warehouse-workspace/'+id+'/action',f.cookies.mgr,'POST',{action:'configure',memberId:'wh',taskRevision:1,revision:0,kind:'picking',weight:2,standardMinutes:30,note:'Định mức kiểm thử'}));
}
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://local');if(u.pathname.startsWith('/api/staff/')){
 const chunks=[];for await(const x of req)chunks.push(x);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined,token=req.headers.authorization?.replace(/^Bearer /,'');
 const r=await f.call(u.pathname.slice(10)+u.search,token?'__Host-bn-session='+token:'',req.method,body);
 res.writeHead(r.status,{'content-type':'application/json','cache-control':'no-store','server-timing':'region;desc="ap-northeast-2"'}).end(JSON.stringify({...r.data,...(r.cookie?{sessionToken:/__Host-bn-session=([a-f0-9]{64})/.exec(r.cookie)?.[1]||''}:{})}));return;}
 const path=u.pathname==='/'?'/index.html':u.pathname;let bytes=await readFile(root+path);if(path.endsWith('.html'))bytes=Buffer.from(bytes.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.writeHead(200,{'content-type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':'text/html'}).end(bytes);
 }catch(e){res.writeHead(500).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']}),results=[];
try{for(const width of [1440,390]){
 const context=await browser.newContext({viewport:{width,height:900},locale:'vi-VN'});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 await context.addInitScript(token=>localStorage.setItem('bn-v2-session',token),f.cookies.wh.split('=')[1]);const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(origin+'/#/kho');await p.locator('.ww-page').waitFor();
 const id='browser-wh-'+(width===1440?'desktop':'mobile'),card=p.locator('[data-task="'+id+'"]');await card.locator('[data-ww-action=start]').click();await card.locator('[data-ww-action=block]').waitFor();
 await card.locator('[data-ww-action=block]').click();let d=p.locator('dialog.ww-dialog[open]');await d.locator('[name=note]').fill('Chờ NCC giao phần còn thiếu');await d.locator('[type=submit]').click();await card.locator('[data-ww-action=resume]').waitFor();
 await card.locator('[data-ww-action=resume]').click();await card.locator('[data-ww-action=submit]').click();d=p.locator('dialog.ww-dialog[open]');await d.locator('[name=note]').fill('Đã kiểm đủ hàng, phiếu bàn giao đối chiếu');await d.locator('[type=submit]').click();await p.locator('dialog.ww-dialog').waitFor({state:'hidden'});await p.locator('.ww-tabs [data-tab=review]').click();await card.waitFor();
 assert.equal(await p.locator('[data-ww-action=confirm]').count(),0);assert.equal(await p.locator('[data-ww-action=settings]').count(),0);if(width===1440)assert.equal(await p.locator('.ww-performance').textContent().then(t=>t.includes('Chưa đủ dữ liệu')),true);
 assert.ok(await p.locator('.ww-page').evaluate(n=>n.scrollWidth<=innerWidth));await p.locator('.main').evaluate(n=>n.scrollTo(0,0));await p.screenshot({path:out+'/worker-'+width+'.png',fullPage:true});
 // Manager uses the same UI, approves a completed wait and confirms the manual task.
 await context.addInitScript(token=>localStorage.setItem('bn-v2-session',token),f.cookies.mgr.split('=')[1]);await p.reload();await p.locator('.ww-page').waitFor();await p.locator('[name=member]').selectOption('wh');await p.locator('.ww-tabs [data-tab=review]').click();await card.waitFor();await card.locator('.ww-waits summary').click();await card.locator('[data-ww-action=review-wait]').click();d=p.locator('dialog.ww-dialog[open]');await d.locator('[name=note]').fill('NCC giao trễ, đã kiểm tra xác nhận');await d.locator('[type=submit]').click();await p.locator('dialog.ww-dialog').waitFor({state:'hidden'});await card.locator('[data-ww-action=confirm]').click();d=p.locator('dialog.ww-dialog[open]');await d.locator('[name=note]').fill('Đúng số lượng và quy cách');await d.locator('[type=submit]').click();await p.locator('dialog.ww-dialog').waitFor({state:'hidden'});await p.locator('.ww-tabs [data-tab=done]').click();await card.waitFor();
 await p.locator('[data-ww-action=settings]').click();d=p.locator('dialog.ww-dialog[open]');assert.ok(await d.evaluate(n=>n.getBoundingClientRect().width<=innerWidth));await d.locator('[name=reason]').fill('Kiểm tra lưu ca làm');await d.locator('[type=submit]').click();await p.locator('dialog.ww-dialog').waitFor({state:'hidden'});
 await p.locator('.ww-tabs [data-tab=priority]').click();const cancelId='browser-cancel-'+width,cancelCard=p.locator('[data-task="'+cancelId+'"]');await cancelCard.locator('[data-ww-action=cancel]').click();d=p.locator('dialog.ww-dialog[open]');await d.locator('[name=note]').fill('Không còn nhu cầu, giữ bản theo dõi để đối chiếu');await d.locator('[type=submit]').click();await p.locator('dialog.ww-dialog').waitFor({state:'hidden'});assert.equal((await f.db.select().from(runs).where(eq(runs.taskId,cancelId)))[0].stage,'cancelled');
 assert.equal((await f.db.select().from(runs).where(eq(runs.taskId,id)))[0].stage,'confirmed');assert.deepEqual(errors,[]);await p.locator('.main').evaluate(n=>n.scrollTo(0,0));await p.screenshot({path:out+'/manager-'+width+'.png',fullPage:true});results.push({width,lifecycle:true,managerApproval:true,settings:true,noOverflow:true,errors});await context.close();
}
 await writeFile(out+'/results.json',JSON.stringify(results,null,2));process.stdout.write(JSON.stringify(results)+'\n');
}finally{await browser.close();server.close();await Promise.allSettled([...f.background]);await f.client.close();}
