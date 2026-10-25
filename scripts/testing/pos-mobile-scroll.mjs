/** Local browser regression; mocks all business APIs, never accesses production.
 * npm install --prefix /tmp/pos-browser playwright
 * PLAYWRIGHT_MODULE=/tmp/pos-browser/node_modules/playwright/index.mjs node scripts/testing/pos-mobile-scroll.mjs
 * Optional CHROMIUM_PATH and POS_SCREENSHOT_DIR. Browser dependency is deliberately outside CRM's runtime.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, join } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const repo = fileURLToPath(new URL('../../', import.meta.url));
const html = `<!doctype html><html class="app-shell" lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/trial-ui/style.css"><link rel="stylesheet" href="/trial-ui/pos.css">
<link rel="stylesheet" href="/trial-ui/typography.css"><link rel="stylesheet" href="/trial-ui/mobile-actions.css">
<script type="module" src="/trial-ui/mobile-actions-init.js"></script>
<div class="workspace"><main class="main"><header class="topbar">CRM thử nghiệm</header><section class="view" id="view-pos"></section></main></div>
<script type="module">
import {initPos} from '/trial-ui/pos.js';
window.catalogCalls=[]; window.failNext=false;
const api=async(path)=>{
 if(path.startsWith('/pos/options'))return {registers:[{id:'r',name:'Quầy thử',pricePolicyId:'vat'}],current:{id:'s',registerId:'r',memberId:'emp'},policies:[],templates:[],shifts:[]};
 if(path.startsWith('/pos/orders'))return {orders:[],counts:{}};
 if(path.startsWith('/pos/customers'))return {canListRetail:true,customers:[{id:'customer',name:'Khách thử nghiệm',phone:'0901234567'}]};
 if(path.startsWith('/pos/catalog')){
  catalogCalls.push(path); if(window.failNext){window.failNext=false;throw Error('Lỗi mạng giả lập');}
  const p=new URL(path,location.origin).searchParams,o=Number(p.get('offset')),n=Number(p.get('limit'));
  return {products:Array.from({length:n},(_,i)=>({sku:'SP'+(o+i),name:'Sản phẩm thử '+(o+i),price:50000,available:10})),nextOffset:o+n<1000?o+n:null};
 }
 throw Error('Unexpected mock API: '+path);
};
window.pos=initPos({root:document.querySelector('#view-pos'),api,user:()=>({id:'emp',role:'manager'}),toast:()=>{},confirmBox:async()=>false,go:()=>{}});
await pos.load();window.ready=true;
</script>`;
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = resolve(repo, '.' + path);
    if (path !== '/' && !file.startsWith(resolve(repo, 'trial-ui') + '/')) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', {'.js':'text/javascript','.css':'text/css'}[extname(path)] || 'text/html');
    res.end(path === '/' ? html : await readFile(file));
  } catch { res.writeHead(404).end(); }
}).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox']});
try {
  for (const [width,height] of [[375,667],[390,844],[768,1024],[844,390]]) {
    const context = await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true});
    // Fail rather than contacting anything outside the local fixture.
    await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    const page = await context.newPage(), errors=[];
    page.on('pageerror', e=>errors.push(e.message));
    await page.goto(origin); await page.waitForFunction(()=>window.ready);
    const metrics = () => page.evaluate(()=>{
      const g=document.querySelector('.pos-grid');
      return {height:g.clientHeight,viewport:innerHeight,overscroll:getComputedStyle(g).overscrollBehaviorY,
        products:g.querySelectorAll('.pos-product-tile').length,requests:catalogCalls.length,
        overflow:document.querySelector('.main').scrollWidth>innerWidth+1};
    });
    let result=await metrics();
    assert.ok(result.height<=height*.49+2,JSON.stringify(result));
    assert.equal(result.overscroll,'auto'); assert.equal(result.overflow,false);
    assert.equal(result.products,20); assert.equal(result.requests,1);
    for(let i=0;i<6;i++)await page.locator('.pos-grid').evaluate(e=>{e.scrollTop=e.scrollHeight;});
    await page.waitForTimeout(150);
    assert.equal((await metrics()).requests,1,'scroll must not load extra mobile pages');
    await page.getByRole('button',{name:'Trang tiếp ›',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.pos-product').dataset.sku==='SP20');
    assert.equal((await metrics()).products,20);
    await page.getByRole('button',{name:'‹ Trang trước',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.pos-product').dataset.sku==='SP0');
    // A failed page request must preserve the page and allow retry.
    await page.evaluate(()=>window.failNext=true);
    await page.getByRole('button',{name:'Trang tiếp ›',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('.pos-catalog-pages button:last-child').disabled);
    assert.equal(await page.locator('.pos-product').first().getAttribute('data-sku'),'SP0');
    await page.getByRole('button',{name:'Trang tiếp ›',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.pos-product').dataset.sku==='SP20');
    // At the product boundary, a touch scroll must chain into .main (the real app scroll owner).
    await page.locator('.pos-grid').evaluate(e=>{e.scrollIntoView({block:'center'});e.scrollTop=e.scrollHeight;});
    await page.waitForTimeout(100);
    const before=await page.locator('.main').evaluate(e=>e.scrollTop);
    const box=await page.locator('.pos-grid').boundingBox();
    const cdp=await context.newCDPSession(page);
    const x=Math.round(box.x+box.width/2),y=Math.round(Math.min(box.y+box.height/2,height-160));
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for(let step=1;step<=10;step++){
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-step*16}]});
      await page.waitForTimeout(20);
    }
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.waitForTimeout(350);
    assert.ok(await page.locator('.main').evaluate(e=>e.scrollTop)>before,'touch at grid end must reach customer/cart');
    await page.locator('.pos-mobile-cart-open').tap();
    await page.waitForTimeout(500);
    assert.ok(await page.locator('.pos-customer-trigger').isVisible());
    await page.locator('.pos-customer-trigger').tap();
    await page.getByRole('combobox',{name:'Tìm khách hàng',exact:true}).fill('Khách');
    await page.locator('.pos-customer-option').first().tap();
    await page.waitForFunction(()=>document.querySelector('.pos-customer-trigger').textContent==='Khách thử nghiệm');
    assert.equal(await page.locator('.pos-mobile-cart-info small').textContent(),'Khách thử nghiệm');
    assert.equal(await page.locator('.pos-customer-picker').count(),0);
    assert.deepEqual(errors,[]);
    if(process.env.POS_SCREENSHOT_DIR){await mkdir(process.env.POS_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:join(process.env.POS_SCREENSHOT_DIR,`pos-mobile-${width}x${height}.png`)});}
    console.log(JSON.stringify({width,height,...await metrics(),customerSelected:true,touchScroll:true}));
    await context.close();
  }
  const desktop = await browser.newPage({viewport:{width:1280,height:800}});
  await desktop.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await desktop.goto(origin); await desktop.waitForFunction(()=>window.ready);
  assert.equal(await desktop.locator('.pos-product-tile').count(),60);
  await desktop.getByRole('button',{name:'Xem thêm sản phẩm',exact:true}).click();
  await desktop.waitForFunction(()=>document.querySelectorAll('.pos-product-tile').length===120);
  await desktop.setViewportSize({width:390,height:844});
  await desktop.waitForFunction(()=>document.querySelectorAll('.pos-product-tile').length===20);
  assert.ok(await desktop.getByRole('button',{name:'Trang tiếp ›',exact:true}).isVisible());
  await desktop.setViewportSize({width:1280,height:800});
  await desktop.waitForFunction(()=>document.querySelectorAll('.pos-product-tile').length===60);
  console.log('desktop append and desktop/mobile resize: passed');
  await desktop.close();
} finally { await browser.close(); server.close(); }
