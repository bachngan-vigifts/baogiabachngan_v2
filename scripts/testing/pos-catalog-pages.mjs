import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { setup } from "../../tests/helpers/pos-fixture.ts";
import { postMoves } from "../../src/modules/inventory/api/ledger.ts";
import { eq } from "drizzle-orm";
import { products, productPrices, productStock } from "../../src/modules/catalog/schema.ts";
import { posRegisters, webStoreOrders } from "../../src/modules/sales/pos-schema.ts";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const f = await setup({productBrand:'MINH LONG I'});
await f.db.update(posRegisters).set({name:'CỬA HÀNG MINH LONG'}).where(eq(posRegisters.id,f.registerId));
await f.open(f.mgr);
await f.db.update(products).set({name:'Chén cơm 11.2cm jas lys',unit:'Cái'}).where(eq(products.sku,'00123'));
await f.db.update(productPrices).set({price:20000}).where(eq(productPrices.sku,'00123'));
await f.db.transaction((tx) => postMoves(tx, "mgr", [{ sku: "00123", warehouseId: "pos-wh", qty: 200, kind: "opening", refType: "opening", refId: "workspace-stock" }]));
const user = (await f.call("/me", f.mgr)).data.user;
await f.db.insert(products).values([{ sku: "00456", brand:"MINH LONG I", name: "Ly thứ hai", unit: "cái", updatedAt: (/* @__PURE__ */ new Date()).toISOString() }, { sku: "00789", brand:"MINH LONG I", name: "Ly hết hàng", unit: "cái", updatedAt: (/* @__PURE__ */ new Date()).toISOString() }]);
await f.db.insert(productPrices).values([{ sku: "00456", policyId: "retail-vat", price: 54e3 }, { sku: "00789", policyId: "retail-vat", price: 54e3 }]);
await f.db.insert(productStock).values({ sku: "00456", warehouseId: "pos-wh", quantity: 50, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
await f.db.transaction((tx) => postMoves(tx, "mgr", [{ sku: "00456", warehouseId: "pos-wh", qty: 50, kind: "opening", refType: "opening", refId: "scan-fixture" }]));
for (let i = 0; i < 65; i++) {
  const sku = "P" + i;
  await f.db.insert(products).values({ sku, brand:"MINH LONG I", imageUrl:`https://pos-fixture.invalid/product-${i%3}.svg`, name: "Bộ sản phẩm tên rất dài để kiểm tra bố cục bảng " + i, unit: "cái", updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
  await f.db.insert(productPrices).values({ sku, policyId: "retail-vat", price: 108e3 });
  await f.db.insert(productStock).values({ sku, warehouseId: "pos-wh", quantity: 100, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
  await f.db.transaction((tx) => postMoves(tx, "mgr", [{ sku, warehouseId: "pos-wh", qty: 100, kind: "opening", refType: "opening", refId: "workspace-" + sku }]));
}
await f.db.insert(webStoreOrders).values({id:'ref-web-1',source:'minhlong',externalId:'REF-WEB-001',orderNo:'WEB_REF_001',registerId:f.registerId,status:'processing',customerName:'Khách web kiểm thử',total:80000,lines:'[]',orderedAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
const root = process.env.POS_UI_ROOT || fileURLToPath(new URL("../../trial-ui/", import.meta.url)), calls = [];
const metadata=await f.db.select({sku:products.sku,name:products.name,imageUrl:products.imageUrl}).from(products);
const html = `<!doctype html><html class="app-shell"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/pos.css"><link rel="stylesheet" href="/typography.css"><link rel="stylesheet" href="/mobile-actions.css"><script type="module" src="/mobile-actions-init.js"><\/script><button id="chat-launcher">Tin nhắn</button><button id="reminder-launcher">Nhắc chăm sóc nhanh</button><div class="workspace"><main class="main"><section id="view-pos"></section></main></div><script type="module">
import {initPos} from '/pos.js';location.hash='#/pos';window.notices=[];window.confirmCount=0;window.printCount=0;new MutationObserver(list=>{for(const m of list)for(const n of m.addedNodes)if(n.tagName==='IFRAME')n.contentWindow.print=()=>{window.printCount++;n.contentWindow.dispatchEvent(new n.contentWindow.Event('afterprint'));};}).observe(document.body,{childList:true});
const api=async(path,method='GET',body)=>{const r=await fetch('/api'+path,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),data=await r.json();if(!r.ok)throw Object.assign(Error(data.error),{status:r.status});return data;};
window.pos=initPos({api,localSearch:location.search.includes('local=1')?(q)=>${JSON.stringify(metadata)}.filter(p=>(p.sku+' '+p.name).toLowerCase().includes(q.toLowerCase())):()=>null,root:document.querySelector('#view-pos'),user:()=>(${JSON.stringify(user)}),toast:(message)=>window.notices.push(message),confirmBox:async()=>{window.confirmCount++;return window.confirmAnswer!==false;},go:hash=>location.hash=hash});await pos.load();window.ready=true;
<\/script>`;
let pendingReads=0,drainResolve;
const server = createServer(async (req, res) => {
  pendingReads++;
  try {
    const u = new URL(req.url, "http://localhost"), path = u.pathname;
    if (path.startsWith("/api/")) {
      let body;
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      if (chunks.length) body = JSON.parse(Buffer.concat(chunks).toString());
      calls.push({ path: path.slice(4), method: req.method, body });
      if(path==='/api/pos/ghn/locations'){res.setHeader('content-type','application/json');res.end(JSON.stringify({locations:[{id:body.districtId?'3':body.provinceId?'2':'1',name:body.districtId?'Phường kiểm thử':body.provinceId?'Quận kiểm thử':'Cần Thơ'}]}));return;}
      if (path === "/api/pos/catalog" && u.searchParams.get("q")) await new Promise((r2) => setTimeout(r2, u.searchParams.get("q") === "00123" ? 350 : 100));
      const r = await f.call(path.slice(4) + u.search, f.mgr, req.method, body);
      if(path==='/api/pos/options'&&req.headers['x-test-no-snapshot']){delete r.data.stockSnapshot;delete r.data.stockSnapshotVersion;}
      res.writeHead(r.status, { "content-type": "application/json" }).end(JSON.stringify(r.data));
      return;
    }
    if (path === "/barcode-camera.js") {
      res.setHeader("content-type", "text/javascript");
      res.end("export async function startBarcodeCamera(video,onCode){window.cameraCode=onCode;return {stop(){}};}");
      return;
    }
    res.setHeader("content-type", path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".ttf") ? "font/ttf" : "text/html");
    res.end(path === "/" ? html : await readFile(root + path));
  } catch (e) {
    res.writeHead(500).end(e.message);
  } finally {if(--pendingReads===0)drainResolve?.();}
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const origin = "http://127.0.0.1:" + server.address().port, browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox"] });
const shot = process.env.POS_SCREENSHOT_DIR || "/workspace/artifacts/pos-catalog-pages";
await mkdir(shot, { recursive: true });
const results=[];
try {
 for(const [width,height] of [[2126,1526],[1812,1000],[2214,1000],[1280,1000],[1024,1000]]) {
  const context=await browser.newContext({viewport:{width,height},locale:'vi-VN',extraHTTPHeaders:width<=1280?{'x-test-no-snapshot':'1'}:{}});
  await context.route('**/*',r=>r.request().url().startsWith('https://pos-fixture.invalid/')?r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><rect x="20" y="12" width="60" height="50" rx="12" fill="#d8ebfa"/><path d="M30 30h40" stroke="#0070f4" stroke-width="3"/></svg>'}):r.request().url().startsWith(origin+'/')?r.continue():r.abort());
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  try {
   await page.goto(origin+(width===1280?'?local=1':''));await page.waitForFunction(()=>window.ready);
   await page.getByRole('button',{name:'Bán thường',exact:true}).click();
   await page.waitForFunction(()=>document.querySelectorAll('.pos-product-tile').length>=24);
   assert.equal(await page.locator('.pos-product-tile').count(),24,'normal catalog must render only 24 products');
   const positions=await page.locator('.pos-product-tile').evaluateAll(ns=>ns.map(n=>{const r=n.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),height:r.height};}));
   assert.equal(new Set(positions.map(p=>p.x)).size,8,'8 columns');assert.equal(new Set(positions.map(p=>p.y)).size,3,'3 rows');
   assert.ok(positions.every(p=>p.height>=156),'cards must never collapse');
   if(width>=1812){const geom=await page.locator('.pos-grid').evaluate(n=>({height:n.clientHeight,scroll:n.scrollHeight,rows:getComputedStyle(n).gridTemplateRows,tiles:[...n.children].map(x=>x.getBoundingClientRect().height)}));assert.ok(geom.scroll<=geom.height+1,'all three rows fit without vertical scrolling');}
   if(height===1526){
    await page.waitForFunction(()=>[...document.querySelectorAll('.pos-product img')].every(n=>n.naturalWidth>0));
    const photos=await page.locator('.pos-product img').evaluateAll(ns=>ns.map(n=>{const r=n.getBoundingClientRect(),tile=n.closest('.pos-product-tile').getBoundingClientRect();return {height:r.height,width:r.width,card:tile.height,fit:getComputedStyle(n).objectFit,source:n.dataset.productImageSource};}));
    assert.ok(photos.every(n=>n.height>=100&&n.height>=n.width*.7),'product photos must use the card image area, not a fixed 48px strip');
    assert.ok(photos.every(n=>n.fit==='contain'&&n.source.startsWith('https://pos-fixture.invalid/product-')),'original images remain uncropped');
   }
   const badges=await page.locator('.pos-product').evaluateAll(ns=>ns.map(n=>{const image=n.querySelector('img,.pos-image-empty').getBoundingClientRect(),price=n.querySelector('.pos-product-price').getBoundingClientRect(),name=n.querySelector('.pos-product-name').getBoundingClientRect();return {inside:price.top>=image.top&&price.bottom<=image.bottom+1&&price.left>=image.left&&price.right<=image.right+1,nameBelow:name.top>=image.bottom,border:getComputedStyle(n.closest('.pos-product-tile')).borderTopWidth};}));
   assert.ok(badges.every(n=>n.inside&&n.nameBelow&&n.border==='0px'),'price badge overlays photo, name sits below and tile has no outer border');
   await page.screenshot({path:shot+`/${width}-catalog.png`});
   const skus=()=>page.locator('.pos-product').evaluateAll(ns=>ns.map(n=>n.dataset.sku));
   const first=await skus(),next=page.getByRole('button',{name:'Trang sản phẩm tiếp',exact:true}),prev=page.getByRole('button',{name:'Trang sản phẩm trước',exact:true});
   assert.equal(await prev.isDisabled(),true);await next.click();
   await page.waitForFunction(()=>document.querySelector('.pos-catalog-page-label')?.textContent==='Trang 2');
   const second=await skus();assert.equal(second.length,24);assert.ok(second.every(s=>!first.includes(s)));
   await next.click();await page.waitForFunction(()=>document.querySelector('.pos-catalog-page-label')?.textContent==='Trang 3');
   const third=await skus();assert.ok(third.length>0&&third.length<=24);assert.ok(third.every(s=>!first.includes(s)&&!second.includes(s)));assert.equal(await next.isDisabled(),true);
   await prev.click();await page.waitForFunction(()=>document.querySelector('.pos-catalog-page-label')?.textContent==='Trang 2');assert.deepEqual(await skus(),second);
   const search=page.getByRole('searchbox',{name:'Tìm nhanh sản phẩm trong danh mục'});
   await search.fill('00123');
   if(width===1024){
    await page.waitForRequest(r=>r.url().includes('/api/pos/catalog?')&&r.url().includes('q=00123'));
    await search.fill('P64');await page.waitForFunction(()=>document.querySelector('.pos-product')?.dataset.sku==='P64');
    await page.waitForTimeout(450);assert.deepEqual(await skus(),['P64'],'late query results cannot replace the latest input');
    await search.fill('00123');
   }
   await page.waitForFunction(()=>document.querySelectorAll('.pos-product-tile').length===1&&document.querySelector('.pos-product')?.dataset.sku==='00123');
   assert.deepEqual(await skus(),['00123']);assert.equal(await page.locator('.pos-catalog-page-label').textContent(),'Trang 1');
   await page.locator('.pos-product').click();await page.waitForFunction(()=>document.querySelector('.pos-qty input'));
   const qty=await page.locator('.pos-qty input').inputValue();
   assert.equal(await page.locator('.pos-lines').evaluate(n=>{const p=n.closest('.pos-catalog').getBoundingClientRect();return [...n.querySelectorAll('input,select')].filter(x=>x.getClientRects().length).every(x=>{const r=x.getBoundingClientRect();return r.left>=p.left&&r.right<=p.right;});}),true,'quantity and inline discount fit beside the wider catalog');
   assert.equal(await search.inputValue(),'','choosing a product clears the catalog search too');
   await page.waitForFunction(()=>document.querySelectorAll('.pos-product-tile').length===24);
   await next.click();await page.waitForFunction(()=>document.querySelector('.pos-catalog-page-label')?.textContent==='Trang 2');
   await next.click();await page.waitForFunction(()=>document.querySelector('.pos-catalog-page-label')?.textContent==='Trang 3');
   assert.equal(new Set(await skus()).size,(await skus()).length,'cached search pages must not append preview duplicates');
   await page.locator('.pos-ref-products .pos-filter-toggle').click();await page.locator('[data-filter=out]').click();
   await page.waitForFunction(()=>[...document.querySelectorAll('.pos-product')].some(n=>n.dataset.sku==='00789'));
   assert.equal(await page.locator('.pos-qty input').inputValue(),qty,'filtering preserves cart');
   await page.locator('[data-filter=all]').click();await page.waitForFunction(()=>document.querySelectorAll('.pos-product-tile').length===24);
   await search.fill('00123');await page.waitForFunction(()=>document.querySelectorAll('.pos-product-tile').length===1);
   await Promise.all([page.waitForResponse(r=>/pricePolicyId=retail(?:&|$)/.test(r.url())),page.getByRole('combobox',{name:'Chính sách giá'}).selectOption('retail')]);
   await page.waitForFunction(()=>document.querySelector('.pos-product-price')?.textContent.includes('20.000'));
   assert.equal(await page.locator('.pos-qty input').inputValue(),qty,'policy changes preserve cart');
   await page.getByRole('button',{name:'Bán nhanh',exact:true}).click();
   assert.equal(await page.getByRole('searchbox',{name:'Tìm hoặc quét sản phẩm'}).inputValue(),'00123');
   await page.getByRole('button',{name:'Bán thường',exact:true}).click();assert.equal(await search.inputValue(),'00123');
   assert.equal(await page.locator('#chat-launcher').isVisible(),false);assert.equal(await page.locator('#reminder-launcher').isVisible(),false);
   await page.locator('#view-pos').evaluate(n=>n.hidden=true);assert.equal(await page.locator('#chat-launcher').isVisible(),true);assert.equal(await page.locator('#reminder-launcher').isVisible(),true);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
   results.push({width,height,pageSizes:[first.length,second.length,third.length],columns:8,rows:3,search:true,filters:true,cartPreserved:true});
  } catch(e) {await page.screenshot({path:shot+`/${width}-failure.png`});console.log({errors,notices:await page.evaluate(()=>window.notices)});throw e;} finally {await context.close();}
 }
 assert.equal(calls.filter(c=>c.method!=='GET'&&c.path!=='/pos/preview').length,0,'catalog actions cannot write orders, payments or shipping');
 console.log(JSON.stringify(results,null,2));
} finally {await browser.close();await new Promise(r=>server.close(r));if(pendingReads)await new Promise(r=>drainResolve=r);await f.client.close();}
