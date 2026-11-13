/** Real browser + real local API/Postgres WASM; synthetic data only. */
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setupEarly} from '../../tests/helpers/purchase-early-fixture.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setupEarly(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out='/tmp/accounting-import-resume';await mkdir(out,{recursive:true});
async function post(path,body){const r=await f.call('/accounting'+path,f.cookies.mgr,'POST',body);assert(r.status<300,JSON.stringify(r.data));return r.data;}
const entity=await post('/entities',{name:'Synthetic 30k entity',taxCode:'0123456789',confirmed:true});
const book=await post('/books',{name:'Synthetic 30k book',entityId:entity.id});
await f.client.exec(`insert into price_policies(id,name) values ('resume-list','Giá bán lẻ');
 insert into products(sku,name,unit,updated_at) select 'RESUME-'||n,'Synthetic product '||n,'Cái','2026-11-01' from generate_series(1,30000)n;
 insert into product_prices(sku,policy_id,price) select 'RESUME-'||n,'resume-list',100 from generate_series(1,30000)n;`);
let droppedChunk=false,droppedFinish=false,blockOnce=true,releaseBlock,blocked,committed;
const blockedPromise=new Promise(r=>blocked=r),committedPromise=new Promise(r=>committed=r);
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://local');
  if(url.pathname.startsWith('/api/staff/')){
   const body=[];for await(const c of req)body.push(c);
   if(url.pathname.endsWith('/chunks/3')&&blockOnce){blockOnce=false;blocked();await new Promise(r=>releaseBlock=r);}
   const token=req.headers.authorization?.replace(/^Bearer /,'')||'';
   const result=await f.call(url.pathname.slice('/api/staff'.length)+url.search,token?'__Host-bn-session='+token:'',req.method,body.length?JSON.parse(Buffer.concat(body)):undefined);
   if(url.pathname.endsWith('/chunks/3'))committed();
   if(url.pathname.endsWith('/chunks/2')&&!droppedChunk){droppedChunk=true;res.destroy();return;}
   if(url.pathname.endsWith('/finish')&&result.status<300&&!droppedFinish){droppedFinish=true;res.destroy();return;}
   res.writeHead(result.status,{'content-type':'application/json'}).end(JSON.stringify(result.data));return;
  }
  const path=url.pathname==='/'?'index.html':url.pathname.slice(1);if(path.includes('..'))throw Error('path');
  let data=await readFile(root+path);if(path==='index.html')data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
  res.writeHead(200,{'content-type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html'}).end(data);
 }catch(e){res.writeHead(500).end(e.message);}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try{
 const context=await browser.newContext({viewport:{width:1440,height:950}});
 await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
 const user=(await f.call('/me',f.cookies.mgr)).data.user,token=f.cookies.mgr.split('=')[1];
 await context.addInitScript(({user,token})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user,token});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 async function open(){
  await page.goto(origin+'/#/accounting');await page.locator('#view-accounting .ac-stats').waitFor();
  if(await page.locator('#view-accounting [name=entityId]').inputValue()!==entity.id){
   await Promise.all([page.waitForResponse(r=>r.url().includes('/accounting/report?')&&r.url().includes(entity.id)),page.locator('#view-accounting [name=entityId]').selectOption(entity.id)]);
  }
  await page.locator('#view-accounting [name=bookId]').selectOption(book.id);
  await Promise.all([page.waitForResponse(r=>r.url().includes('/accounting/report?')&&r.url().includes(book.id)),page.locator('#view-accounting .ac-filters button').click()]);
  await page.locator('[data-action=import-document]').click();await page.locator('dialog.ac-dialog').waitFor();
 }
 await open();let d=page.locator('dialog.ac-dialog');
 await d.locator('[name=reference]').fill('OPEN-30K-BROWSER');await d.locator('[name=note]').fill('Synthetic browser interruption test');
 const scope={Buffer};vm.createContext(scope);vm.runInContext(await readFile(root+'xlsx.full.min.js','utf8'),scope);
 const x=scope.XLSX,ws=x.utils.aoa_to_sheet([['SKU','SL'],...Array.from({length:30000},(_,i)=>['RESUME-'+(i+1),1])]),wb=x.utils.book_new();x.utils.book_append_sheet(wb,ws,'Stock');
 const excel=Buffer.from(x.write(wb,{type:'array',bookType:'xlsx'}));
 await d.locator('[data-file]').setInputFiles({name:'30000.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:excel});
 await d.locator('[data-start]').click();
 let diagnosticTimer;
 try {await Promise.race([blockedPromise,new Promise((_,reject)=>{diagnosticTimer=setTimeout(()=>reject(Error('Upload did not reach chunk 3')),20000);})]);}
 finally {clearTimeout(diagnosticTimer);}
 console.log('Reached chunk 3');
 // Close the dialog while a request is in flight, then let the server commit it.
 await d.locator('[data-close]').last().click();releaseBlock();await committedPromise;
 const jobs=(await f.call('/accounting/books/'+book.id+'/imports',f.cookies.mgr)).data.jobs;
 const id=jobs[0].id;assert.equal((await f.call('/accounting/imports/'+id,f.cookies.mgr)).data.receivedRows,2000);
 assert.equal(droppedChunk,true,'lost COMMIT acknowledgement was retried safely');
 await open();d=page.locator('dialog.ac-dialog');await d.locator('[data-jobs] button').first().click();
 await d.locator('[data-status]').filter({hasText:'2000/30000'}).waitFor();
 assert.equal(await d.locator('[name=reference]').isDisabled(),true);assert.equal(await d.locator('[data-file]').isDisabled(),false);
 // The page was reloaded: no file input/in-memory source survives. IndexedDB backup must resume.
 assert.equal(await d.locator('[data-file]').inputValue(),'');
 await context.setOffline(true);await d.locator('[data-resume]').click();await d.locator('.ac-error').filter({hasText:/./}).waitFor();
 assert.equal((await f.call('/accounting/imports/'+id,f.cookies.mgr)).data.receivedRows,2000);
 await context.setOffline(false);
 // Browser storage eviction: choose the original file; a changed file must never replace acknowledged chunks.
 await d.locator('[data-close]').last().click();await page.locator('[data-action=import-document]').click();d=page.locator('dialog.ac-dialog');
 await d.locator('[data-jobs] button').first().click();await d.locator('[data-status]').filter({hasText:'2000/30000'}).waitFor();
 await page.evaluate(async id=>{const {importFileCache}=await import('./accounting-import-cache.js');await importFileCache.remove(id);},id);
 await d.locator('[data-file]').setInputFiles({name:'changed.csv',mimeType:'text/csv',buffer:Buffer.from('SKU,SL\nRESUME-1,2\n')});
 await d.locator('[data-resume]').click();await d.locator('.ac-error').filter({hasText:'File đã thay đổi'}).waitFor();
 assert.equal((await f.call('/accounting/imports/'+id,f.cookies.mgr)).data.receivedRows,2000);
 await d.locator('[data-file]').setInputFiles({name:'30000.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:excel});
 await d.locator('[data-resume]').click();await d.locator('[data-status]').filter({hasText:'30000/30000'}).waitFor({timeout:60000});
 assert.equal((await f.call('/accounting/imports/'+id,f.cookies.mgr)).data.chunks.length,60);
 assert.equal(await d.locator('.ac-line').count(),0,'30k inputs are not rendered');
 await d.locator('[data-finish]').click();await d.locator('[data-result]').filter({hasText:/tạo chứng từ nháp/i}).waitFor();
 assert.equal(droppedFinish,true);
 assert.equal((await f.client.query("select count(*)::int n from accounting_documents where reference='OPEN-30K-BROWSER'")).rows[0].n,1);
 assert.equal((await f.client.query('select count(*)::int n from accounting_lines')).rows[0].n,30000);
 await page.screenshot({path:out+'/completed-pc.png'});
 await d.locator('[data-close]').last().click();
 // Original-row error download, no automatic partial document when a SKU is missing.
 await page.locator('[data-action=import-document]').click();d=page.locator('dialog.ac-dialog');
 await page.setViewportSize({width:390,height:950});
 await d.locator('[name=reference]').fill('BAD-BROWSER');await d.locator('[name=note]').fill('Unknown SKU test');
 await d.locator('[data-file]').setInputFiles({name:'bad.csv',mimeType:'text/csv',buffer:Buffer.from('SKU,SL\nRESUME-1,1\nNOT-EXISTS,2\nRESUME-1,1\n')});
 await d.locator('[data-start]').click();await d.locator('[data-status]').filter({hasText:'3/3 dòng · 2 dòng lỗi'}).waitFor();
 assert.equal(await d.locator('[data-finish]').isDisabled(),true);
 const downloadPromise=page.waitForEvent('download');await d.locator('[data-errors]').click();const download=await downloadPromise;
 const text=await readFile(await download.path(),'utf8');assert.match(text,/NOT-EXISTS/);assert.match(text,/Mã không tồn tại/);assert.match(text,/SKU trùng/);
 const g=await d.evaluate(r=>({left:r.getBoundingClientRect().left,right:r.getBoundingClientRect().right,overflow:r.scrollWidth>r.clientWidth+1,footer:r.querySelector('footer').getBoundingClientRect().bottom}));
 assert(g.left>=0&&g.right<=391&&!g.overflow&&g.footer<=950,JSON.stringify(g));
 await page.screenshot({path:out+'/errors-mobile.png'});
 await d.locator('[data-cancel]').click();await d.locator('[data-status]').filter({hasText:'Đã hủy'}).waitFor();
 assert.equal((await f.client.query("select count(*)::int n from accounting_documents where reference='BAD-BROWSER'")).rows[0].n,0);
 // Device cache quota failure happens before creating a server job.
 await d.locator('[name=reference]').fill('CACHE-FAIL');await d.locator('[name=note]').fill('Quota failure');
 await d.locator('[data-file]').setInputFiles({name:'small.csv',mimeType:'text/csv',buffer:Buffer.from('SKU,SL\nRESUME-1,1\n')});
 await page.evaluate(async()=>{const {importFileCache}=await import('./accounting-import-cache.js');window.restoreImportCache=importFileCache.set;importFileCache.set=async()=>{throw Error('Synthetic storage quota exceeded');};});
 await d.locator('[data-start]').click();await d.locator('.ac-error').filter({hasText:'quota exceeded'}).waitFor();
 assert.equal((await f.client.query("select count(*)::int n from accounting_import_jobs where reference='CACHE-FAIL'")).rows[0].n,0);
 await page.evaluate(async()=>{const {importFileCache}=await import('./accounting-import-cache.js');importFileCache.set=window.restoreImportCache;});
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({rows:30000,chunks:60,closeMidRequest:true,reloadResume:true,offlineResume:true,lostChunkAck:true,lostFinalizeAck:true,unknownSkuReport:true,noPartialDocument:true,storageEviction:true,changedFileRejected:true,quotaFailureBeforeJob:true,errors}));
 await context.close();
}finally{await browser.close();server.close();}
