/** Real CRM + PGlite fixtures. No production calls or product writes. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {setup} from '../../tests/helpers/pos-fixture.ts';
import {products} from '../../src/modules/catalog/schema.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url)),before=process.env.BEFORE==='1',out=process.env.SCREENSHOT_DIR||'/tmp/product-list-compact';await mkdir(out,{recursive:true});
const f=await setup(),writes=[],at=new Date().toISOString();
await f.db.insert(products).values([{sku:'00002-LONG',name:'Bộ trà 0.7 L JAS Trắng Ngà với tên sản phẩm dài cần xem chi tiết đầy đủ',unit:'Bộ',brand:'Minh Long',updatedAt:at},{sku:'00003',name:'Sản phẩm chưa có giá',unit:'Cái',brand:'Minh Long',updatedAt:at}]);
const baseline=new Map();if(before)for(const name of ['index.html','app.js','mobile-profiles-p3.js'])baseline.set('/'+name,execFileSync('git',['show','HEAD:trial-ui/'+name]));
const server=createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost'),path=u.pathname;
 if(path.startsWith('/api/staff/')){
  const chunks=[];for await(const c of req)chunks.push(c);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined,t=req.headers.authorization?.replace(/^Bearer /,'')||'';
  if(req.method!=='GET')writes.push({path,method:req.method});
  const r=await f.call(path.slice('/api/staff'.length)+u.search,t?'__Host-bn-session='+t:'',req.method,body);
  res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;
 }
 let data=baseline.get(path==='/'?'/index.html':path)||await readFile(root+(path==='/'?'index.html':path.slice(1)));
 if(path==='/'||path==='/index.html')data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.ttf')?'font/ttf':'text/html;charset=utf-8');res.end(data);
}catch(e){res.writeHead(500).end(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});const results=[];
try{
 for(const width of (process.env.WIDTHS||'320,390,430,768,1024,1440,1813').split(',').map(Number))for(const role of (process.env.ROLES||'manager,employee').split(',')){
  const cookie=role==='manager'?f.mgr:f.emp,user=(await f.call('/me',cookie)).data.user;
  const context=await browser.newContext({viewport:{width,height:1000},locale:'vi-VN',isMobile:width<=850,hasTouch:width<=850});
  await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
  await context.addInitScript(({user,token})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{user,token:cookie.split('=')[1]});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/#/products');await page.locator('[data-select="00123"]').waitFor();await page.waitForTimeout(500);
  const facts=await page.locator('#product-list > tr').evaluateAll(rows=>rows.map(row=>{
   const css=getComputedStyle(row),r=row.getBoundingClientRect(),cells=[...row.children].filter(c=>!!c.getClientRects().length),actions=row.querySelector('.row-actions');
   return {sku:row.querySelector('[data-select]')?.dataset.select,height:Math.round(r.height),right:r.right,display:css.display,gridRows:css.gridTemplateRows.split(' ').length,overflow:row.scrollWidth>row.clientWidth+1,
    price:row.querySelector('[data-label="Giá"]')?.textContent.trim(),stock:row.querySelector('[data-label="Tồn"]')?.textContent.trim(),held:row.querySelector('[data-label="Đang tạm giữ"]')?.textContent.trim(),incoming:row.querySelector('[data-label="Hàng đang về"]')?.textContent.trim(),
    visibleCells:cells.length,actions:[...actions.querySelectorAll('button')].map(b=>({text:b.textContent.trim(),hidden:!b.getClientRects().length,top:b.getBoundingClientRect().top,left:b.getBoundingClientRect().left,width:b.getBoundingClientRect().width})),thumbWidth:Math.round(row.querySelector('.thumb').getBoundingClientRect().width),inventoryLabels:[...row.querySelectorAll('.product-stock-cell,.product-held-cell,.product-incoming-cell')].map(n=>getComputedStyle(n,'::before').display),detailsButtons:row.querySelectorAll('[data-mobile-card-details] button,.crm-card-details').length};
  }));
  if(!before&&width<=850){for(const row of facts){assert.equal(row.gridRows,3,JSON.stringify(row));assert.ok(row.height<=150,JSON.stringify(row));assert.ok(!row.overflow&&row.right<=width+1,JSON.stringify(row));assert.ok(row.actions.every(a=>!a.hidden));assert.equal(row.detailsButtons,0);assert.ok(row.thumbWidth<=32);assert.ok(row.inventoryLabels.every(v=>v==='inline')); assert.ok(row.actions.find(a=>a.text.includes('Báo giá')).left<=Math.min(...row.actions.map(a=>a.left)));}}
  if(width>850){assert.equal(await page.locator('#product-table').evaluate(n=>getComputedStyle(n).display),'table');assert.ok(facts.every(r=>r.visibleCells===10));for(const row of facts)assert.ok(Math.max(...row.actions.map(a=>a.top))-Math.min(...row.actions.map(a=>a.top))<2,'desktop actions on one line: '+JSON.stringify(row));}
  assert.equal(await page.locator('[data-remove-product]').count(),role==='manager'?3:0);
  const check=page.locator('[data-select="00123"]');await check.check();assert.match(await page.locator('#product-selection-text').textContent(),/1 sản phẩm/);await check.uncheck();
  await page.screenshot({path:out+'/'+role+'-'+width+'.png'});
  if(!before&&width===390){
   await page.locator('[data-update-product="00123"]').click();await page.locator('dialog[open] [name=name]').waitFor();assert.equal(await page.locator('dialog[open] [name=name]').inputValue(),'Ly sứ');await page.keyboard.press('Escape');
   if(role==='manager'){await page.locator('[data-remove-product="00123"]').click();await page.locator('#confirm-dialog[open]').waitFor();assert.match(await page.locator('#confirm-dialog').textContent(),/00123/);await page.keyboard.press('Escape');}
   await page.locator('[data-quote-product="00123"]').click();await page.waitForFunction(()=>location.hash==='#/quotes/new');
  }
  assert.deepEqual(errors,[]);results.push({width,role,before,rows:facts,handlersChecked:!before&&width===390});console.log(JSON.stringify({width,role,before,heights:facts.map(r=>r.height)}));await context.close();
 }
 assert.ok(!writes.some(r=>/\/products\/[^/]+(?:\/archive)?$/.test(r.path)),'product buttons must not write without confirmation');
}finally{await writeFile(out+'/results.json',JSON.stringify({results,writes},null,2));await browser.close();server.close();await f.client.close();}
