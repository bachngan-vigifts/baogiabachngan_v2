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
const f = await setup();
await f.db.update(posRegisters).set({name:'CỬA HÀNG LOCKNLOCK CẦN THƠ'}).where(eq(posRegisters.id,f.registerId));
await f.open(f.mgr);
await f.db.update(products).set({name:'Chén cơm 11.2cm jas lys',unit:'Cái'}).where(eq(products.sku,'00123'));
await f.db.update(productPrices).set({price:20000}).where(eq(productPrices.sku,'00123'));
await f.db.transaction((tx) => postMoves(tx, "mgr", [{ sku: "00123", warehouseId: "pos-wh", qty: 200, kind: "opening", refType: "opening", refId: "workspace-stock" }]));
const user = (await f.call("/me", f.mgr)).data.user;
await f.db.insert(products).values([{ sku: "00456", brand:"LocknLock", name: "Ly thứ hai", unit: "cái", updatedAt: (/* @__PURE__ */ new Date()).toISOString() }, { sku: "00789", brand:"LocknLock", name: "Ly hết hàng", unit: "cái", updatedAt: (/* @__PURE__ */ new Date()).toISOString() }]);
await f.db.insert(productPrices).values([{ sku: "00456", policyId: "retail-vat", price: 54e3 }, { sku: "00789", policyId: "retail-vat", price: 54e3 }]);
await f.db.insert(productStock).values({ sku: "00456", warehouseId: "pos-wh", quantity: 50, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
await f.db.transaction((tx) => postMoves(tx, "mgr", [{ sku: "00456", warehouseId: "pos-wh", qty: 50, kind: "opening", refType: "opening", refId: "scan-fixture" }]));
for (let i = 0; i < 24; i++) {
  const sku = i===0 ? "LHD1141" : "TEST" + i;
  await f.db.insert(products).values({ sku, brand:"LocknLock", imageUrl:"https://pos-fixture.invalid/lhd1141.jpg", name: i===0?"Nồi sâu lòng LocknLock Handycook 14cm — LHD1141":"Sản phẩm fixture kiểm tra bố cục " + i, unit: "cái", updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
  await f.db.insert(productPrices).values({ sku, policyId: "retail-vat", price: 108e3 });
  await f.db.insert(productStock).values({ sku, warehouseId: "pos-wh", quantity: 100, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
  await f.db.transaction((tx) => postMoves(tx, "mgr", [{ sku, warehouseId: "pos-wh", qty: 100, kind: "opening", refType: "opening", refId: "workspace-" + sku }]));
}
await f.db.insert(webStoreOrders).values({id:'ref-web-1',source:'minhlong',externalId:'REF-WEB-001',orderNo:'WEB_REF_001',registerId:f.registerId,status:'processing',customerName:'Khách web kiểm thử',total:80000,lines:'[]',orderedAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
const root = process.env.POS_UI_ROOT || fileURLToPath(new URL("../../trial-ui/", import.meta.url)), calls = [];
const metadata=await f.db.select({sku:products.sku,name:products.name,imageUrl:products.imageUrl}).from(products);
const html = `<!doctype html><html class="app-shell"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/pos.css"><link rel="stylesheet" href="/typography.css"><link rel="stylesheet" href="/mobile-actions.css"><link rel="stylesheet" href="/visual-theme.css"><script type="module" src="/mobile-actions-init.js"><\/script><button id="chat-launcher">Tin nhắn</button><button id="reminder-launcher">Nhắc chăm sóc nhanh</button><div class="workspace"><main class="main"><section id="view-pos"></section></main></div><script type="module">
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
const shot = process.env.POS_SCREENSHOT_DIR || "/workspace/pos-horizontal-preview";
await mkdir(shot, { recursive: true });

const photo=process.env.POS_PHOTO_PATH?await readFile(process.env.POS_PHOTO_PATH):Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect x="150" y="250" width="400" height="300" rx="40" fill="#87939b"/></svg>');
const photoType=process.env.POS_PHOTO_PATH?'image/jpeg':'image/svg+xml';
const results=[];
try {
 for(const [width,height] of [[969,954],[1622,1014],[1811,1514],[2126,1526],[390,844]]) {
  const context=await browser.newContext({viewport:{width,height},locale:'vi-VN'});
  await context.route('**/*',r=>r.request().url().startsWith('https://pos-fixture.invalid/')?r.fulfill({contentType:photoType,body:photo}):r.request().url().startsWith(origin+'/')?r.continue():r.abort());
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.waitForFunction(()=>window.ready);
  const input=page.getByRole('searchbox',{name:'Tìm hoặc quét sản phẩm'});
  if(width>850)await page.getByRole('button',{name:'Bán thường',exact:true}).click();else await input.fill('LHD1141');
  const tile=page.locator('.pos-product[data-sku="LHD1141"]');await tile.waitFor();
  await tile.scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>{const i=document.querySelector('[data-sku="LHD1141"] img');return i?.complete&&i.naturalWidth>0;});
  if(width>850){
   await page.evaluate(()=>document.fonts.load('8.736px Roboto'));
   assert.equal(await page.locator('.pos-catalog-controls').isVisible(),false);
   assert.equal(await page.locator('.pos-ref-products').evaluate(n=>[...n.childNodes].some(x=>x.nodeType===3&&x.textContent.includes('null'))),false);
   assert.equal(await page.locator('.pos-basket-head').evaluate(n=>{const a=n.querySelector('.pos-customer-trigger').getBoundingClientRect(),b=n.querySelector('.pos-ref-catalog-actions').getBoundingClientRect();return a.right<=b.left+1;}),true);
   const geom=await tile.evaluate(b=>{const im=b.querySelector('img'),n=b.querySelector('.pos-product-name'),p=b.querySelector('.pos-product-price'),a=im.getBoundingClientRect(),c=n.getBoundingClientRect(),d=p.getBoundingClientRect(),g=b.closest('.pos-grid');return {imageLeft:a.right<=c.left,priceBelow:d.top>=c.bottom-1,contain:getComputedStyle(im).objectFit==='contain',noHorizontalScroll:g.scrollWidth<=g.clientWidth+1,source:im.dataset.productImageSource};});
   assert.ok(geom.imageLeft&&geom.priceBelow&&geom.contain&&geom.noHorizontalScroll,JSON.stringify(geom));
   const next=page.getByRole('button',{name:'Trang sản phẩm tiếp',exact:true});await next.click();await page.waitForFunction(()=>document.querySelector('.pos-catalog-page-label').textContent==='Trang 2');await page.getByRole('button',{name:'Trang sản phẩm trước',exact:true}).click();await tile.waitFor();
   const filter=page.getByRole('button',{name:'Bộ lọc sản phẩm',exact:true});await filter.click();assert.equal(await page.locator('.pos-catalog-controls').isVisible(),true);
   await page.locator('.pos-product-filters').getByRole('button',{name:'Còn hàng',exact:true}).click();
   assert.equal(await page.locator('.pos-product-stock-details').first().isVisible(),true);await filter.click();
   await page.getByRole('button',{name:'Danh sách sản phẩm',exact:true}).click();assert.equal(await tile.locator('img').isVisible(),false);
   await page.getByRole('button',{name:'Hiển thị ảnh sản phẩm',exact:true}).click();assert.equal(await tile.locator('img').isVisible(),true);
   await page.locator('.pos-grid').evaluate(n=>n.scrollTop=0);
   await page.screenshot({path:shot+'/'+width+'-catalog.png'});
   results.push({width,...geom,filters:true,pagination:true,listAndPhotos:true});
  }
  await tile.locator('img').click();await page.waitForFunction(()=>document.querySelector('.pos-qty input')?.value==='1');
  await input.fill('LHD1141');await tile.waitFor();await tile.click();await page.waitForFunction(()=>document.querySelector('.pos-qty input')?.value==='2');
  assert.equal(await page.locator('.pos-line:not(.pos-gift-line)').count(),1);assert.deepEqual(errors,[]);
  if(width<=850)await page.screenshot({path:shot+'/'+width+'-cart.png'});
  await context.close();
 }
 console.log(JSON.stringify(results,null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));if(pendingReads)await new Promise(r=>drainResolve=r);await f.client.close();}
