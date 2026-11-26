/** Real local dashboard/router/PGlite: no-commission revenue; external requests blocked. */
import assert from 'node:assert/strict';import {createServer} from 'node:http';import {readFile,mkdir} from 'node:fs/promises';import {fileURLToPath} from 'node:url';
import {setupNoCommissionKpi} from '../../tests/helpers/kpi-no-commission-fixture.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright'),month=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Ho_Chi_Minh'}).slice(0,7),f=await setupNoCommissionKpi(month);
const data=(await f.call('/dashboard/kpi?from='+month+'&to='+month,f.mgr)).data,member=data.members.find(m=>m.id==='emp');
assert.equal(member.parts.find(p=>p.key==='revenue').actual,f.total);
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out='/tmp/dashboard-no-commission';await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/staff/')){
 const chunks=[];for await(const c of req)chunks.push(c);const token=req.headers.authorization?.replace(/^Bearer /,'');const r=await f.call(u.pathname.slice(10)+u.search,token?'__Host-bn-session='+token:'',req.method,chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined);
 res.writeHead(r.status,{'content-type':'application/json','server-timing':'region;desc="ap-northeast-2"'}).end(JSON.stringify(r.data));return;}
 const p=u.pathname==='/'?'/index.html':u.pathname;let b=await readFile(root+p);if(p.endsWith('.html'))b=Buffer.from(b.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.setHeader('content-type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':p.endsWith('.ttf')?'font/ttf':'text/html;charset=utf-8');res.end(b);
}catch(e){res.writeHead(404).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']}),user=(await f.call('/me',f.mgr)).data.user;
try{for(const width of [1440,390]){
 const context=await browser.newContext({viewport:{width,height:1100},locale:'vi-VN'});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 await context.addInitScript(({user,token})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user,token:f.mgr.split('=')[1]});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/#/dashboard');
 await page.locator('.dash-kpi-person').filter({hasText:member.name}).waitFor();await page.locator('.dash-kpi-person').filter({hasText:member.name}).click();
 await page.getByRole('button',{name:'Xem chi tiết Doanh số ghi nhận của '+member.name,exact:true}).click();
 const dialog=page.locator('dialog.dash-kpi-popup');await dialog.getByText('DH-TEST-0',{exact:true}).waitFor();
 const text=await dialog.innerText();for(const expected of ['3.250.000','30.200.000','8.500.000','41.950.000'])assert.ok(text.includes(expected),expected);
 assert.doesNotMatch(text,/Chưa xác định|thiếu căn cứ/);assert.equal(await dialog.locator('tbody tr').count(),3);assert.deepEqual(errors,[]);
 await page.screenshot({path:out+'/dashboard-'+width+'.png'});console.log('PASS '+width+'px: dashboard revenue opens drilldown; three synthetic orders total 41,950,000 before VAT, no missing basis or JS errors');await context.close();
}
}finally{await browser.close();server.close();await f.client.close();}
