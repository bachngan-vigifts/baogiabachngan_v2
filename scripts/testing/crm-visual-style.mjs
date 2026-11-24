/** Read-only shell fixture: compare controls, input, responsive mode and print before/after theme. */
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url));
const out=process.env.STYLE_SCREENSHOT_DIR||'/tmp/crm-visual-style';
await mkdir(out,{recursive:true});
const html=(await readFile(root+'index.html','utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
const server=createServer(async(req,res)=>{try{const p=new URL(req.url,'http://localhost').pathname;res.setHeader('content-type',p.endsWith('.css')?'text/css':p.endsWith('.ttf')?'font/ttf':p.endsWith('.png')?'image/png':p.endsWith('.jpeg')?'image/jpeg':'text/html');res.end(p==='/'?html:await readFile(root+p));}catch{res.writeHead(404).end();}}).listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const results=[];
try{
for(const width of [1440,1366,390]){
 const page=await browser.newPage({viewport:{width,height:width===1366?768:900},locale:'vi-VN'}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
 await page.goto(origin);
 await page.evaluate(()=>{
  document.querySelectorAll('.auth').forEach(n=>n.hidden=true);
  document.querySelector('#workspace').hidden=false;
  document.querySelectorAll('.view').forEach(n=>n.hidden=n.id!=='view-products');
  document.querySelectorAll('.nav-group').forEach(n=>n.classList.add('is-open'));
  document.querySelector('[data-nav="products"]').classList.add('active');
  document.querySelector('#user-name').textContent='Nhân viên thử nghiệm';
  document.querySelector('#user-role').textContent='Manager';
  document.querySelector('#breadcrumb').textContent='Sản phẩm';
  document.querySelector('#product-count').textContent='8 sản phẩm';
  document.querySelector('#product-policy').innerHTML='<option>Giá bán lẻ + VAT</option>';
  const names=['Ly sứ Gourmet','Bình giữ nhiệt Energetic 550ml','Bộ chén cơm trắng','Nồi dưỡng sinh Ceres','Bình hoa gốm','Dĩa tròn 20cm','Bộ trà Jasmine','Cốc thủy tinh'];
  document.querySelector('#product-list').innerHTML=names.map((name,i)=>`<tr class="product-compact-row"><td class="product-select-cell"><input type="checkbox" aria-label="Chọn ${name}"></td><td class="first product-identity-cell"><button type="button" class="prod-cell prod-open"><span class="thumb">▧</span><span><span class="strong">${name}</span><small>DEMO00${i+1}</small></span></button></td><td class="product-brand-cell">Thương hiệu mẫu</td><td class="product-unit-cell">Cái</td><td class="product-price-cell num">100.000 đ</td><td class="product-stock-cell num">25</td><td class="product-held-cell num">0</td><td class="product-incoming-cell num">—</td><td class="product-supplier-cell">—</td><td class="actions-cell product-actions-cell"><div class="row-actions"><button class="btn secondary small">Cập nhật</button><button class="btn ghost small danger-text" data-remove-product>Xóa</button><button class="btn primary small product-quote-action">+ Báo giá</button></div></td></tr>`).join('');
 });
 await page.evaluate(()=>document.fonts.ready);
 const snapshot=()=>page.evaluate(()=>({controls:[...document.querySelectorAll('#workspace :is(button,input,select,a)')].map(n=>({tag:n.tagName,id:n.id,text:n.textContent,disabled:n.disabled,hidden:n.hidden,value:n.value})),sidebar:getComputedStyle(document.querySelector('.sidebar')).width,grid:getComputedStyle(document.querySelector('#product-list')).display,rows:document.querySelectorAll('#product-list tr').length,buttons:[...document.querySelectorAll('#view-products button')].filter(n=>n.getClientRects().length).map(n=>n.textContent)}));
 await page.locator('#product-search').fill('Gourmet');
 await page.locator('#product-search').blur();
 await page.evaluate(()=>document.querySelector('link[href="visual-theme.css"]').disabled=true);
 await page.evaluate(()=>document.fonts.ready);
 const before=await snapshot();
 await page.screenshot({path:out+'/products-before-'+width+'.png'});
 await page.emulateMedia({media:'print'});
 const printBefore=await page.evaluate(()=>({font:getComputedStyle(document.documentElement).getPropertyValue('--font'),blue:getComputedStyle(document.documentElement).getPropertyValue('--blue')}));
 await page.evaluate(()=>document.querySelector('link[href="visual-theme.css"]').disabled=false);
 assert.deepEqual(await page.evaluate(()=>({font:getComputedStyle(document.documentElement).getPropertyValue('--font'),blue:getComputedStyle(document.documentElement).getPropertyValue('--blue')})),printBefore,'print style unchanged');
 await page.emulateMedia({media:'screen'});
 await page.evaluate(()=>document.fonts.ready);
 assert.deepEqual(await snapshot(),before,'same controls, values, sidebar width and table/card mode');
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('#new-product')).backgroundColor==='rgb(0, 100, 204)');
 // Main restored this navy/white palette at the user's request after the original theme test.
 assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.sidebar')).backgroundColor),'rgb(20, 32, 54)');
 assert.equal(await page.locator('.nav.active').first().evaluate(n=>getComputedStyle(n).color),'rgb(255, 255, 255)');
 assert.ok(Number(await page.locator('.nav.active').first().evaluate(n=>getComputedStyle(n).fontWeight))>=700);
 assert.equal(await page.locator('#product-search').inputValue(),'Gourmet');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no page horizontal overflow');
 if(width===390)assert.ok(await page.locator('#product-search').evaluate(n=>parseFloat(getComputedStyle(n).fontSize))>=16,'iOS input font remains at least 16px');
 await page.screenshot({path:out+'/products-after-'+width+'.png'});
 assert.deepEqual(errors,[]);
 results.push({width,sameControls:true,sameLayoutMode:true,printUnchanged:true,inputRetained:true,noHorizontalOverflow:true});
 await page.close();
}
await writeFile(out+'/results.json',JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results));
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
