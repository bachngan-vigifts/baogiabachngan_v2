/** Real local CRM/router and downloadable files; synthetic data only. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {setup} from '../../tests/helpers/pos-fixture.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setup(),root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),out=process.env.BROWSER_EVIDENCE_DIR||'/tmp/sale-quote-exports';await mkdir(out,{recursive:true});
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
try{
 for(const [type,width]of [['HRC',1280],['B2B',1280],['VIGIFTS',390]]){
  const q=await f.call('/quotes',f.emp,'POST',{type,quoteNo:type+'_SALE_EXPORT_'+width,customer:'Khách kiểm thử Vigifts',notes:'Thanh toán theo thỏa thuận thử nghiệm',vat:8,rows:[{name:'Bình gốm tiếng Việt',sku:'SECRET_SKU',qty:100,price:280556,discount:45,printFee:8000,image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',costPrice:1}]});assert.equal(q.status,201);
  const user=(await f.call('/me',f.emp)).data.user,token=f.emp.split('=')[1],context=await browser.newContext({viewport:{width,height:1000}});
  await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());await context.addInitScript(({user,token})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user,token});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/#/quotes/'+q.data.id);await page.locator('#line-list tr').first().waitFor();
  assert.equal(await page.locator('#quote-download').isDisabled(),true,'draft export stays blocked for Sale');
  const approved=await f.call('/quotes/'+q.data.id+'/approve',f.mgr,'POST',{revision:1});assert.equal(approved.status,200);await page.reload();await page.waitForFunction(()=>!document.querySelector('#quote-download').disabled);
  if(width<=850)await page.locator('.quote-actions > .mobile-action-trigger').click();
  await page.locator('#quote-download').click();await page.screenshot({path:out+'/menu-'+type+'.png'});
  assert.equal(await page.locator('#pdf-quote-sale').isVisible(),true);assert.equal(await page.locator('#excel-quote-sale').isVisible(),true);
  const before=writes,fetches=imageFetches;
  const pdfDownload=page.waitForEvent('download');await page.locator('#pdf-quote-sale').click();const pdf=await pdfDownload,pdfPath=out+'/'+type+'.pdf';await pdf.saveAs(pdfPath);
  const text=execFileSync('pdftotext',['-layout',pdfPath,'-'],{encoding:'utf8'});for(const heading of ['STT','Hình ảnh','Tên sản phẩm','Giá bán','Phí in','Thành tiền'])assert.ok(text.includes(heading));assert.doesNotMatch(text,/SECRET_|Mã hàng/);for(const expected of ['BẢNG CHÀO GIÁ','Khách kiểm thử Vigifts','Thanh toán theo thỏa thuận thử nghiệm','Tổng thanh toán','Số tiền bằng chữ'])assert.ok(text.includes(expected),expected);assert.ok(text.includes(type==='HRC'?'15.430.580':'16.230.580'));
  await page.locator('#quote-download').click();const xlsxDownload=page.waitForEvent('download');await page.locator('#excel-quote-sale').click();const xlsx=await xlsxDownload,xlsxPath=out+'/'+type+'.xlsx';await xlsx.saveAs(xlsxPath);
  const sheet=await page.evaluate(async()=>{const m=await import('/sale-quote-export.js');const book=m.buildSaleWorkbook({type:'HRC',rows:[{name:'fixture',qty:1,price:1}]},globalThis.ExcelJS);return {sheets:book.worksheets.length,columns:book.worksheets[0].columnCount};});assert.deepEqual(sheet,{sheets:1,columns:8});
  assert.equal(writes,before,'export must not write quote or payments');assert.equal(imageFetches,fetches,'simple exports do not request source images');assert.deepEqual(errors,[]);
  results.push({type,width,pdf:pdf.suggestedFilename(),excel:xlsx.suggestedFilename(),columns:8,embeddedDesign:true,errors:errors.length});await context.close();
 }
 console.log(JSON.stringify(results));
}finally{await writeFile(out+'/results.json',JSON.stringify(results,null,2));await browser.close();await new Promise(r=>server.close(r));await f.client.close();}
