/** Real local CRM/router and downloadable files; synthetic data only. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {setup} from '../../tests/helpers/pos-fixture.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setup(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out=process.env.BROWSER_EVIDENCE_DIR||'/tmp/sale-purchasing';await mkdir(out,{recursive:true});
let writes=0,imageFetches=0;
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');
 if(u.pathname.startsWith('/api/staff/')){
  if(req.method!=='GET'&&req.method!=='OPTIONS')writes++;if(u.pathname.endsWith('/images/fetch'))imageFetches++;
  const chunks=[];for await(const c of req)chunks.push(c);const auth=req.headers.authorization?.replace(/^Bearer /,'')||'';
  const r=await f.call(u.pathname.slice('/api/staff'.length)+u.search,auth?'__Host-bn-session='+auth:'',req.method,chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined);
  res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;
 }
 const path=u.pathname==='/'?'/index.html':u.pathname;let data=await readFile(root+path);if(path.endsWith('.html'))data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.writeHead(200,{'content-type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':'text/html'}).end(data);
}catch{res.writeHead(404).end('Fixture resource unavailable');}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),results=[];

try {
 const q=await f.call('/quotes',f.mgr,'POST',{type:'B2B',template:'sale',quoteNo:'SALE-COST-TEST',date:'2026-11-27',customer:'Khách thử',vat:8,rows:[{sku:'00123',name:'Chén',qty:1,price:100000,discount:0,costPrice:50000,costMode:'manual',designImage:true,image:'https://example.test/design.png'}]});assert.equal(q.status,201);assert.equal(q.data.approvalStatus,'draft');
 const user=(await f.call('/me',f.mgr)).data.user,token=f.mgr.split('=')[1],context=await browser.newContext({viewport:{width:1366,height:900}});
 await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 await context.addInitScript(({user,token})=>{localStorage.setItem('bn-api-region-manual-off','1');localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user,token});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
 await page.goto(origin+'/#/quotes/'+q.data.id);await page.locator('#approve-quote').click();
 const supplier=page.getByRole('textbox',{name:'Thông tin NCC dòng 1'});await supplier.waitFor();
 await page.getByRole('button',{name:'Lưu giá mua & duyệt',exact:true}).click();assert.equal(await supplier.evaluate(n=>n.validity.valid),false);
 await supplier.fill('NCC Kiểm thử · Anh A · 0901234567');
 const approved=page.waitForResponse(r=>r.url().endsWith('/quotes/'+q.data.id+'/approve')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'Lưu giá mua & duyệt',exact:true}).click();await page.screenshot({path:out+'/after-cost.png'});assert.equal((await approved).status(),200);
 const saved=await f.call('/quotes/'+q.data.id,f.mgr);assert.equal(saved.data.data.rows[0].supplierInfo,'NCC Kiểm thử · Anh A · 0901234567');
 for(const flow of ['order','contract']){
 await page.locator('#quote-make').click();await page.locator('[data-flow="'+flow+'"]').click();
 const host=page.locator(flow==='order'?'#order-create-sourcing':'#contract-sourcing');await host.waitFor({state:'attached'});
 await page.waitForFunction(id=>document.querySelector(id).textContent==='',flow==='order'?'#order-create-sourcing':'#contract-sourcing');
 await page.screenshot({path:out+'/'+flow+'.png'});
 await page.locator(flow==='order'?'#order-create-dialog [data-close]':'#contract-dialog [data-close]').first().click();
 }
 assert.deepEqual(errors,[]);console.log('PASS approval requires supplier, saved cost kept, order and contract source chooser skipped');await context.close();
}finally{await browser.close();await new Promise(r=>server.close(r));await f.client.close();}
