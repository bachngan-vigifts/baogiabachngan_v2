/** Offline visual / behavior tests: synthetic data, no production network or writes. */
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createReviewServer} from '../review-supplier-workspace.mjs';
import {PAGES} from '../../design/supplier-workspace/pages.js';
import {REVIEW_DATA as DATA} from '../../design/supplier-workspace/fixtures.js';
import {pageRows,filterRows} from '../../design/supplier-workspace/model.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const out=process.env.SUPPLIER_REVIEW_DIR||'/workspace/output/supplier-workspace-review';await mkdir(out,{recursive:true});
const server=createReviewServer().listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']}),results=[],errors=[],external=[],writes=[];
try{
for(const width of [1440,390,360,768]){
 const context=await browser.newContext({viewport:{width,height:width<500?844:1000},locale:'vi-VN',reducedMotion:'reduce'});
 await context.route('**/*',r=>{if(!r.request().url().startsWith(origin+'/')){external.push(r.request().url());return r.abort();}if(r.request().method()!=='GET')writes.push(r.request().method());return r.continue();});
 const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));
 for(const [key,def] of Object.entries(PAGES)){
  await p.goto(origin+'/#'+key);await p.locator('h1').filter({hasText:def.title}).waitFor();
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,key+' overflow at '+width);
  if(width===1440||width===390)await p.screenshot({path:out+'/'+key+'-'+(width===390?'mobile':'desktop')+'.png',fullPage:true});if(width===390)await p.screenshot({path:out+'/'+key+'-phone.png'});
  if(key!=='overview'){
   assert.equal(await p.locator('#records tbody tr').count(),Math.min(8,filterRows(pageRows(key,DATA),{from:['orders','requests','transfers','advances','invoices','deliveries'].includes(key)?'2026-11-01':'',to:'2026-11-12'}).length));
   await p.locator('[data-open]').first().click();await p.locator('.detail').waitFor();
   assert.equal(await p.evaluate(()=>{const r=document.querySelector('.detail').getBoundingClientRect();return r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;}),true,key+' drawer bounds');
   for(let tab=0;tab<4;tab++){await p.keyboard.press('Tab');assert.equal(await p.locator('.detail').evaluate(n=>n.contains(document.activeElement)),true,'focus remains in details');}if(width===1440&&['orders','stock','balances','invoices'].includes(key))await p.screenshot({path:out+'/'+key+'-detail.png'});
   await p.keyboard.press('Escape');assert.equal(await p.locator('.detail').count(),0);
   await p.locator('#f-q').fill('zzz-no-match');await p.locator('.empty').waitFor();assert.equal(await p.locator('#records tbody tr').count(),0);
   await p.locator('[data-reset-empty]').click();await p.locator('#records tbody tr').first().waitFor();
   if(width===1440){
    await p.locator('[data-toggle-filters]').click();
    const selects=await p.locator('select[data-filter]').evaluateAll(nodes=>nodes.map(n=>({key:n.dataset.filter,value:n.options[1]?.value})).filter(n=>n.value));
    for(const {key:filterKey,value} of selects){
     await p.locator('[data-reset]').click();await p.locator('[data-filter="'+filterKey+'"]').selectOption(value);
     const active=await p.locator('[data-filter]').evaluateAll(nodes=>Object.fromEntries(nodes.map(n=>[n.dataset.filter,n.value])));active.valueField=key==='stock'?'available':PAGES[key].valueField||'total';
     let expected=filterRows(pageRows(key,DATA,active.asOf||'2026-11-12'),active);for(const prop of ['priority','series','destination'])if(active[prop])expected=expected.filter(r=>r[prop]===active[prop]);
     assert.equal(await p.locator('#records tbody tr').count(),Math.min(8,expected.length),key+' filter '+filterKey);
    }
    await p.locator('[data-reset]').click();
   }

  }
  results.push({page:key,width,overflow:false,drawer:key!=='overview',emptyState:key!=='overview'});
 }
 if(width<500){await p.getByRole('button',{name:'Mở menu',exact:true}).click();assert.equal(await p.locator('body').evaluate(n=>n.classList.contains('menu-open')),true);await p.locator('.sidebar a[href="#products"]').click();await p.locator('h1').filter({hasText:'Sản phẩm'}).waitFor();assert.equal(await p.locator('body').evaluate(n=>n.classList.contains('menu-open')),false);}
 if(width===1440){
  await p.goto(origin+'/#orders');await p.locator('[data-toggle-filters]').click();await p.locator('#f-from').fill('2026-11-12');await p.locator('#f-to').fill('2026-11-01');await p.locator('#f-to').dispatchEvent('change');assert.ok(await p.locator('#filter-error').textContent());assert.equal(await p.locator('#records tbody tr').count(),0);await p.screenshot({path:out+'/filters-invalid.png'});
  await p.locator('[data-reset]').click();await p.locator('[data-next]').click();assert.ok((await p.locator('#pagination').textContent()).includes('9–16'));
  await p.locator('#f-status').selectOption('awaiting_confirmation');assert.equal(await p.locator('#records tbody tr').count(),1);
  const downloadPromise=p.waitForEvent('download');await p.locator('[data-export]').click();const download=await downloadPromise;const content=await readFile(await download.path(),'utf8');assert.equal(content.trim().split('\r\n').length,2);
  await p.goto(origin+'/#products');await p.locator('[data-view="grid"]').click();assert.equal(await p.locator('.product-tile').count(),8);await p.screenshot({path:out+'/products-grid.png'});
  await p.goto(origin+'/#balances');await p.locator('#f-asOf').fill('2026-11-10');await p.locator('#f-asOf').dispatchEvent('change');assert.equal(await p.locator('#balance-date').textContent(),'10/11/2026');await p.locator('#f-asOf').fill('');await p.locator('#f-asOf').dispatchEvent('change');assert.ok((await p.locator('#filter-error').textContent()).includes('Chọn ngày'));
  await p.goto(origin+'/#stock?status=unknown');assert.equal(await p.locator('#records tbody tr').count(),1);assert.ok((await p.locator('#records').textContent()).includes('Chưa công bố'));await p.screenshot({path:out+'/stock-unknown.png',fullPage:true});
  await p.goto(origin+'/#advances');await p.locator('[data-primary]').click();await p.locator('#action-source').selectOption(DATA.orders[0].id);await p.locator('#action-amount').fill('999999999');await p.locator('#review-action button[type="submit"]').click();assert.ok((await p.locator('#action-error').textContent()).includes('vượt'));await p.locator('#action-amount').fill('500000');await p.locator('#review-action button[type="submit"]').click();assert.ok((await p.locator('#action-result').textContent()).includes('Chưa có dữ liệu'));await p.screenshot({path:out+'/advance-preview.png'});await p.keyboard.press('Escape');
  await p.goto(origin+'/#invoices');await p.locator('[data-primary]').click();await p.locator('#action-source').selectOption(DATA.orders[0].id);await p.locator('#action-number').fill('0000192');await p.locator('#review-action button[type="submit"]').click();assert.ok((await p.locator('#action-result').textContent()).includes('hợp lệ'));await p.screenshot({path:out+'/invoice-preview.png'});
 }
 await p.goto(origin+'/#login');const frame=p.frameLocator('iframe');await frame.locator('#supplier-auth').waitFor({state:'visible'});assert.equal(await frame.locator('#login-name').getAttribute('type'),'email');await p.screenshot({path:out+'/login-'+width+'.png',fullPage:true});
 await context.close();
}
assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(writes,[]);console.log(JSON.stringify({pages:results.length,errors,externalRequests:external.length,businessWrites:writes.length,results}));
}finally{await writeFile(out+'/workspace-tests.json',JSON.stringify({results,errors,external,writes},null,2));await browser.close();server.close();}
