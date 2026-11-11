/** Real local CRM/router, synthetic products only. No production calls or writes. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {setup} from '../../tests/helpers/pos-fixture.ts';
import {products,productPrices} from '../../src/modules/catalog/schema.ts';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const f=await setup(),user=(await f.call('/me',f.mgr)).data.user,token=f.mgr.split('=')[1];
const root=fileURLToPath(new URL('../../trial-ui/',import.meta.url));
const out=process.env.BROWSER_EVIDENCE_DIR||'/tmp/compact-stock-dialogs';await mkdir(out,{recursive:true});
const names=Array.from({length:64},(_,i)=>({sku:'COMPACT'+String(i).padStart(3,'0'),name:'Chén Hoàng Cung Sen Ngọc Bích – sản phẩm kiểm thử tên dài số '+String(i).padStart(3,'0')}));
const now=new Date().toISOString();
await f.db.insert(products).values(names.map(p=>({...p,brand:'Minh Long',unit:'Cái',imageUrl:'https://images.test/'+p.sku+'.png',updatedAt:now})));
await f.db.insert(productPrices).values(names.flatMap(p=>['retail','retail-vat'].map(policyId=>({sku:p.sku,policyId,price:100000}))));
await postMoves(f.db,'mgr',names.map((p,i)=>({sku:p.sku,warehouseId:'pos-wh',qty:1+i%8,kind:'opening',refType:'opening',refId:'compact-'+p.sku})));
const quote=await f.call('/quotes',f.mgr,'POST',{type:'HRC',quoteNo:'HRC_COMPACT_UI',customer:'Khách kiểm thử',vat:8,rows:names.slice(0,16).map(p=>({...p,qty:4,price:100000,unit:'Cái'}))});assert.equal(quote.status,201);
const results=[];let server;
server=createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname.startsWith('/api/staff/')){
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const auth=req.headers.authorization?.replace(/^Bearer /,'')||'';
  const r=await f.call(u.pathname.slice('/api/staff'.length)+u.search,auth?'__Host-bn-session='+auth:'',req.method,chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined);
  res.writeHead(r.status,{'content-type':'application/json'}).end(JSON.stringify(r.data));return;
 }
 const path=u.pathname==='/'?'/index.html':u.pathname;
 let data=await readFile(root+path);
 if(path.endsWith('.html'))data=Buffer.from(data.toString().replace('<head>','<head><meta name="bn-api" content="/api/staff">'));
 res.writeHead(200,{'content-type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.png')?'image/png':'text/html'}).end(data);
}catch(e){res.writeHead(404).end('Fixture resource unavailable');}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
try{
 for(const [width,height]of [[1693,826],[1280,720],[768,900],[390,844],[320,640],[1024,480]]){
  const context=await browser.newContext({viewport:{width,height},locale:'vi-VN'}),page=await context.newPage(),errors=[],apiRequests=[];let images=0,writes=0;
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/staff/')){apiRequests.push(new URL(r.url()).pathname);if(r.method()!=='GET'&&r.method()!=='OPTIONS')writes++;}});
  await context.route('**/*',r=>{
   if(r.request().url().startsWith('https://images.test/')){images++;return r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#e2edeb"/></svg>'});}
   return r.request().url().startsWith(origin+'/')?r.continue():r.abort();
  });
  await context.addInitScript(({token,user})=>{localStorage.setItem('bn-v2-session',token);localStorage.setItem('bn-v2-session-profile',JSON.stringify({session:token,user}));},{token,user});
  await page.goto(origin+'/#/quotes/'+quote.data.id);await page.locator('#line-list tr').first().waitFor();
  await page.locator('#pick-products').click();const picker=page.locator('#picker-dialog');
  await picker.locator('#picker-list .picker-product').first().waitFor();
  const geometry=await picker.evaluate(d=>{const rect=d.getBoundingClientRect(),list=d.querySelector('#picker-list'),r=list.getBoundingClientRect();return {x:rect.x,y:rect.y,width:rect.width,height:rect.height,listHeight:r.height,visible:[...list.children].filter(n=>{const p=n.getBoundingClientRect();return p.top>=r.top&&p.bottom<=r.bottom;}).length,rowHeight:list.firstElementChild.getBoundingClientRect().height,nameWidth:list.querySelector('.picker-product-name').getBoundingClientRect().width,overflow:list.scrollWidth>list.clientWidth+1};});
  assert.ok(geometry.x>=-1&&geometry.y>=-1&&geometry.x+geometry.width<=width+1&&geometry.y+geometry.height<=height+1,JSON.stringify(geometry));
  assert.ok(geometry.width>=width*0.88&&geometry.height>=height*0.9,JSON.stringify(geometry));
  assert.ok(geometry.rowHeight<=48&&!geometry.overflow,JSON.stringify(geometry));assert.ok(geometry.visible>=(height<560?3:4),JSON.stringify(geometry));assert.ok(geometry.nameWidth>=(width>=900?width*0.4:75),JSON.stringify(geometry));
  assert.equal(await picker.locator('.picker-product-details:visible').count(),0);assert.equal(await picker.locator('img').count(),0,'collapsed rows must not create thumbnails');
  if(width===1693){
    const b=await picker.boundingBox();await page.mouse.move(b.x+b.width-3,b.y+b.height-3);await page.mouse.down();await page.mouse.move(b.x+b.width-3,b.y+b.height-130,{steps:8});await page.mouse.up();
    const resized=await picker.boundingBox();assert.ok(resized.height<b.height-50,JSON.stringify({b,resized}));
    await picker.evaluate(d=>d.style.removeProperty('height'));
  }
  await picker.locator('#picker-filter-toggle').click();assert.equal(await picker.locator('#picker-filters').isVisible(),true);
  assert.ok(await picker.locator('.modal-foot [data-close]').isVisible());await picker.locator('#picker-filter-toggle').click();
  const first=picker.locator('.picker-product').first(),toggle=first.locator('[data-picker-details]');const beforeApi=apiRequests.filter(p=>p==='/api/staff/products'||p==='/api/staff/stock-holds').length;
  await toggle.click();await first.locator('.picker-product-details').waitFor();assert.equal(await toggle.getAttribute('aria-expanded'),'true');
  assert.match(await first.locator('.picker-product-details').innerText(),/Nhãn hiệu:|Hàng đang giữ:/);assert.equal(apiRequests.filter(p=>p==='/api/staff/products'||p==='/api/staff/stock-holds').length,beforeApi,'details read already-loaded data');
  await first.locator('input').fill('3');await picker.locator('#picker-policy').dispatchEvent('change');
  await picker.locator('#picker-more').click();await page.waitForFunction(()=>document.querySelectorAll('#picker-list .picker-product').length>=40);
  assert.equal(await first.locator('input').inputValue(),'3');assert.equal(await toggle.getAttribute('aria-expanded'),'true');await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'),'false');
  // Desktop quantity remains direct; on mobile reopening exposes the editable quantity.
  await toggle.click();assert.equal(await first.locator('input').inputValue(),'3');await toggle.click();
  await page.screenshot({path:out+'/picker-'+width+'x'+height+'.png'});
  // Find an item not already in the quote and add it with Enter, then guard duplicates.
  await picker.locator('#picker-search').fill('COMPACT063');await picker.locator('.picker-product').filter({hasText:names[63].name}).waitFor();
  const item=picker.locator('.picker-product').first();await item.locator('[data-picker-details]').click();await item.locator('input').fill('2');await item.locator('input').press('Enter');
  assert.equal(await item.locator('[data-add]').isDisabled(),true);await picker.locator('.modal-foot [data-close]').click();
  assert.match(await page.locator('#line-list [data-k=name]').last().inputValue(),/số 063/);assert.equal(await page.locator('#line-list [data-k=qty]').last().inputValue(),'2');
  // Filter and detail toggles must not recalculate or refetch stock.
  if(width<=850)await page.locator('.quote-actions > .mobile-action-trigger').click();
  await page.locator('#quote-stock').click();const stock=page.locator('#stock-check-dialog');await stock.locator('#stock-check-table').waitFor();
  const cells=await stock.locator('tbody tr').first().locator('td').allTextContents(),stockApi=apiRequests.filter(p=>p==='/api/staff/products'||p==='/api/staff/stock-holds').length;
  assert.equal(await stock.locator('thead th:visible').count(),4);
  const stockGeometry=await stock.evaluate(d=>{const r=d.getBoundingClientRect(),t=d.querySelector('.table-wrap');return {x:r.x,y:r.y,width:r.width,height:r.height,scrollHeight:t.clientHeight,overflow:t.scrollWidth>t.clientWidth+1,rowHeight:t.querySelector('tbody tr').getBoundingClientRect().height};});
  assert.ok(stockGeometry.width>=width*0.88,JSON.stringify(stockGeometry));
  assert.ok(stockGeometry.y>=-1&&stockGeometry.y+stockGeometry.height<=height+1&&!stockGeometry.overflow,JSON.stringify(stockGeometry));assert.ok(stockGeometry.rowHeight<=44,JSON.stringify(stockGeometry));
  await stock.locator('[data-stock-details]').click();assert.ok(await stock.locator('thead th:visible').count()>=7);assert.deepEqual(await stock.locator('tbody tr').first().locator('td').allTextContents(),cells);
  await stock.locator('[data-stock-details]').click();
  await stock.getByRole('button',{name:/^Thiếu \(/}).click();assert.ok((await stock.locator('tr[data-stock-result="enough"]:visible').count())===0);
  await stock.getByRole('button',{name:/^Tất cả \(/}).click();assert.equal(apiRequests.filter(p=>p==='/api/staff/products'||p==='/api/staff/stock-holds').length,stockApi,'filter/detail do not refetch');
  await page.screenshot({path:out+'/stock-'+width+'x'+height+'.png'});
  await stock.locator('.modal-foot [data-close]').click();
  await page.locator('#pick-products').click();await picker.locator('.picker-product').first().waitFor();
  assert.equal(await picker.locator('.picker-product input').first().inputValue(),'1');assert.equal(await picker.locator('.picker-product-details:visible').count(),0,'reopening resets local view state');
  await picker.locator('.modal-foot [data-close]').click();assert.deepEqual(errors,[]);assert.equal(writes,0,'all edit interactions stay local until the user saves');
  console.log(JSON.stringify({width,height,picker:geometry,stock:stockGeometry}));
  results.push({width,height,picker:geometry,stock:stockGeometry,errors:errors.length,writes,expandedWithoutApi:true,addedLocally:true});await context.close();
 }
 console.log(JSON.stringify(results));
}finally{await writeFile(out+'/results.json',JSON.stringify(results,null,2));await browser.close();await new Promise(r=>server.close(r));await f.client.close();}
