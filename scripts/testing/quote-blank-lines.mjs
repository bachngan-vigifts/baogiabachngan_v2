/** Local real CRM router/PGlite; never edits a production quote. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setup} from '../../tests/helpers/pos-fixture.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setup(),user=(await f.call('/me',f.mgr)).data.user,token=f.mgr.split('=')[1];
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url));let writes=0;
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost'),path=u.pathname;
 if(path.startsWith('/api/staff/')){let body;const chunks=[];for await(const chunk of req)chunks.push(chunk);if(chunks.length)body=JSON.parse(Buffer.concat(chunks).toString());
 if(req.method==='PUT'&&path.startsWith('/api/staff/quotes/'))writes++;
 const bearer=req.headers.authorization?.replace(/^Bearer /,'')||'';const r=await f.call(path.slice('/api/staff'.length)+u.search,bearer?'__Host-bn-session='+bearer:'',req.method,body);
 res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;}
 let data=await readFile(root+(path==='/'?'index.html':path));if(path==='/'||path==='/index.html')data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':'text/html');res.end(data);
 }catch(e){res.writeHead(500).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try{for(const width of [390,1280]){
 const q=await f.call('/quotes',f.mgr,'POST',{type:'B2B',quoteNo:'B2B_BG_BLANK_'+width,date:'2026-10-26',customer:'Khách kiểm thử',vat:8,rows:[
  {sku:'00123',name:'Ly sứ',qty:2,price:100000,discount:10,printFee:8000},
  {name:'Dòng cũ có phí',qty:2,price:20000,discount:10,printFee:1000},
 ]});assert.equal(q.status,201);
 const context=await browser.newContext({viewport:{width,height:844}});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 await context.addInitScript(({token,user})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{token,user});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/#/quotes/'+q.data.id);await page.locator('#line-list tr[data-i="1"]').waitFor();
 assert.equal(await page.locator('#line-list tr[data-i="0"] [data-k=discount]').inputValue(),'10');
 assert.equal(await page.locator('#line-list tr[data-i="1"] [data-k=printFee]').inputValue(),'1.000','legacy charges remain visible/editable rather than silently zeroed');
 if(!await page.locator('#add-line').isVisible())await page.locator('#add-line').evaluate(b=>b.closest('[popover]')?.showPopover());
 await page.locator('#add-line').click();let row=page.locator('#line-list tr[data-i="2"]');
 await row.locator('[data-k=name]').fill('Túi giấy trắng');await row.locator('[data-k=qty]').fill('350');await row.locator('[data-k=price]').fill('14000');
 assert.equal(await row.locator('[data-k=discount],[data-k=printFee]').count(),0);
 assert.equal((await row.locator('.line-total').textContent()).replace(/\D/g,''),'4900000');
 // A custom row has only a main text and one optional note; images preserve its identity.
 assert.equal(await row.locator('[data-k=sku],[data-k=bundleContents],[data-k=printDescription],[data-k=packagingDescription]').count(),0);
 await row.locator('[data-k=manualDescription]').fill('Dán logo hai mặt');
 if(width>850){
 await row.locator('[data-image]').click();await page.locator('#image-url').fill('https://example.invalid/manual.png');await page.locator('#image-save').click();}
 row=page.locator('#line-list tr[data-i="2"]');assert.equal(await row.locator('[data-k=discount],[data-k=printFee]').count(),0);
 await page.locator('#edit-terms').evaluate(b=>b.click());const terms=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'Điều khoản thanh toán',exact:true})});
 await terms.locator('[name=disc]').fill('5');await terms.getByRole('button',{name:'Áp dụng',exact:true}).click();
 assert.equal(await row.locator('[data-k=discount],[data-k=printFee]').count(),0,'whole-quote discount skips simple manual lines');
 const before=writes,response=page.waitForResponse(r=>r.url().includes('/api/staff/quotes/'+q.data.id)&&r.request().method()==='PUT');await page.keyboard.press('Control+s');assert.equal((await response).status(),200);
 await page.waitForTimeout(350);assert.equal(writes,before+1);
 const saved=(await f.call('/quotes/'+q.data.id,f.mgr)).data.data.rows[2];
 assert.equal(saved.manualDescription,'Dán logo hai mặt');assert.equal(saved.manualLine,true);assert.equal(saved.qty,350);assert.equal(saved.price,14000);assert.equal(saved.discount,0);assert.equal(saved.printFee,0);
 await page.reload();await page.locator('#line-list tr[data-i="2"]').waitFor();assert.equal(await page.locator('#line-list tr[data-i="2"] [data-k=discount],#line-list tr[data-i="2"] [data-k=printFee]').count(),0);
 if(width===1280){
  for(const src of ['pdf-lib.min.js','fontkit.umd.min.js','hrc-pdf.js','editable-pdf.js'])await page.addScriptTag({url:origin+'/'+src});
  for(const type of ['HRC','B2B','VIGIFTS']){
   const bytes=await page.evaluate(async ({type})=>{
    const banner=document.createElement('canvas');banner.width=400;banner.height=60;banner.getContext('2d').fillRect(0,0,400,60);
    return [...await EditableQuotePdf.create({state:{type,quoteNo:'TEST',date:'2026-10-26',customer:'Khách thử',vat:8,rows:[{manualLine:true,name:'Túi giấy trắng',manualDescription:'Dán logo hai mặt',qty:1,price:100},{manualLine:true,name:'Dòng không mô tả',manualDescription:'   ',qty:1,price:200}]},images:[null,null],banner})];
   },{type});
   const path='/tmp/quote-manual-'+type+'.pdf';await writeFile(path,Buffer.from(bytes));const text=execFileSync('pdftotext',['-layout',path,'-'],{encoding:'utf8'});
   assert.ok(text.includes('Dán logo hai mặt'),type+' PDF retains optional note');assert.ok(text.includes('Dòng không mô tả'));
   assert.ok(!text.includes('theo tiêu chuẩn nhà sản xuất'));assert.ok(!text.includes('Chưa bao gồm chi phí in ấn logo'));
  }
 }
 assert.deepEqual(errors,[]);if(process.env.QUOTE_SCREENSHOT_DIR){await mkdir(process.env.QUOTE_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:process.env.QUOTE_SCREENSHOT_DIR+'/blank-'+width+'.png'});}
 console.log(JSON.stringify({width,total:4900000,persisted:true,legacyChargesPreserved:true,errors}));await context.close();
 }}finally{await browser.close();server.close();await f.client.close();}
