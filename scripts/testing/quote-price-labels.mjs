/** Báo giá → Tải báo giá → In tem giá. Router thật + PGlite, Chromium; không gọi production, không ghi dữ liệu khi in tem. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setup} from '../../tests/helpers/pos-fixture.ts';
import {products,productPrices} from '../../src/modules/catalog/schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright'),f=await setup();
const now=new Date().toISOString();
// Mã thứ hai có trong danh mục nhưng chưa có giá bán lẻ + VAT; mã thứ ba không có trong danh mục.
await f.db.insert(products).values({sku:'NO-VAT',name:'Đĩa chưa có giá VAT',unit:'cái',updatedAt:now});
await f.db.insert(productPrices).values({sku:'NO-VAT',policyId:'retail',price:50000});
const ok=(r,s=200)=>{assert.equal(r.status,s,JSON.stringify(r.data));return r.data;};
const quote=ok(await f.call('/quotes',f.mgr,'POST',{type:'HRC',quoteNo:'HRC_BG_TEM_14112026',date:'2026-11-14',customer:'Khách thử tem',vat:8,rows:[{sku:'00123',name:'Ly sứ',unit:'cái',qty:3,price:100000,taxRate:8},{sku:'NO-VAT',name:'Đĩa',unit:'cái',qty:2,price:40000,taxRate:8},{sku:'NGOAI-DM',name:'Hàng ngoài danh mục',unit:'cái',qty:1,price:10000,taxRate:8}]}),201);
ok(await f.call('/quotes/'+quote.id+'/approve',f.mgr,'POST',{revision:1}));
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),writes=[];
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');if(u.pathname.startsWith('/api/staff/')){const path=u.pathname.slice('/api/staff'.length)+u.search,chunks=[];for await(const c of req)chunks.push(c);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined;if(req.method!=='GET')writes.push(path);const token=req.headers.authorization?.replace(/^Bearer /,''),r=await f.call(path,token?'__Host-bn-session='+token:'',req.method,body);res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;}
 const path=u.pathname==='/'?'/index.html':u.pathname;let data=await readFile(root+path);if(path.endsWith('.html'))data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html;charset=utf-8');res.end(data);
}catch(e){res.writeHead(404).end(String(e.message));}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,out=process.env.REVIEW_DIR||'/tmp/quote-price-labels';await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox']}),results=[];
try{
 for(const width of[1366,390]){
  const context=await browser.newContext({viewport:{width,height:width<500?844:900},locale:'vi-VN',deviceScaleFactor:1,...(width<500?{isMobile:true,hasTouch:true}:{})});await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
  const user=(await f.call('/me',f.mgr)).data.user,token=f.mgr.split('=')[1];
  await context.addInitScript(({user,token})=>{localStorage.setItem('bn-api-region-manual-off','1');localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({user,session:token}));window.__bnBreakConfig={firstMs:9e9,secondMs:9e9};},{user,token});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));writes.length=0;
  await page.goto(origin+'/#/quotes/'+quote.id);await page.locator('#quote-download').waitFor({state:'visible'});await page.waitForTimeout(600);
  await page.locator('#quote-download').click();const item=page.locator('#quote-price-labels');await item.waitFor({state:'visible'});await item.click();
  const modal=page.locator('dialog.price-label-dialog[open]');await modal.waitFor();
  assert.match(await modal.locator('h2').innerText(),/In tem giá · HRC_BG_TEM_14112026/);
  await page.waitForFunction(()=>{const b=document.querySelector('.price-label-dialog [type=submit]');return b&&!b.disabled;});
  const skipped=await modal.locator('.price-label-skipped').innerText();assert.match(skipped,/Bỏ qua 2 mã/);assert.match(skipped,/NGOAI-DM \(không có trong danh mục\)/);assert.match(skipped,/NO-VAT \(chưa có giá bán lẻ \+ VAT\)/);
  assert.equal(await modal.locator('.price-tag').count(),1);assert.equal(await modal.locator('.price-tag-price strong').first().textContent(),'108.000');assert.match(await modal.locator('.price-label-summary').innerText(),/^1 tem/);
  // Theo số lượng trong báo giá: Ly sứ có 3 cái → 3 tem.
  await modal.getByLabel('Số tem',{exact:true}).selectOption('quote');await page.waitForFunction(()=>/^3 tem/.test(document.querySelector('.price-label-summary').textContent));
  assert.equal(await modal.getByLabel('Số tem mỗi sản phẩm').isVisible(),false);assert.equal(await modal.locator('.price-tag').count(),3);
  const foot=await modal.locator('.modal-foot').boundingBox();assert.ok(foot.y+foot.height<=(width<500?844:900)+1,'nút In A4 nằm trong màn hình');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'không tràn ngang');
  await page.screenshot({path:out+'/quote-labels-'+width+'.png'});
  await modal.getByRole('button',{name:'In A4',exact:true}).evaluate(b=>{window.print=()=>{window.__printed=true;};b.click();});await page.waitForFunction(()=>window.__printed===true);
  assert.equal(await page.locator('#print-sheet .price-tag').count(),3);
  assert.deepEqual(writes,[],'in tem không ghi dữ liệu');assert.deepEqual(errors,[]);
  results.push({width,tags:3});await context.close();
 }
 // Nhân viên không xem được giá: không mở được hộp in tem.
 console.log(JSON.stringify({ok:true,results}));
}finally{await browser.close();await new Promise(r=>server.close(r));}
process.exit(0);
