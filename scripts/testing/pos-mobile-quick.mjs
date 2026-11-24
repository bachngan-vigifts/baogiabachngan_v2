import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { setup } from "../../tests/helpers/pos-fixture.ts";
import { postMoves } from "../../src/modules/inventory/api/ledger.ts";
import { eq } from "drizzle-orm";
import { posPaymentRequests } from "../../src/modules/sales/pos-schema.ts";
import { salesOrders, customerPayments } from "../../src/modules/sales/schema.ts";
import { products, productPrices, productStock } from "../../src/modules/catalog/schema.ts";
import { posRegisters, webStoreOrders } from "../../src/modules/sales/pos-schema.ts";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const f = await setup({productBrand:'MINH LONG I'});
await f.db.update(posRegisters).set({name:'CỬA HÀNG MINH LONG'}).where(eq(posRegisters.id,f.registerId));
await f.open(f.mgr);
await f.db.update(products).set({name:'Chén cơm 11.2cm Jas Lys — bộ sưu tập gốm sứ hoa văn dành cho khách hàng doanh nghiệp, màu trắng ngà',unit:'Cái',imageUrl:'https://pos-fixture.invalid/cup.svg'}).where(eq(products.sku,'00123'));
await f.db.update(productPrices).set({price:20000}).where(eq(productPrices.sku,'00123'));
await f.db.transaction((tx) => postMoves(tx, "mgr", [{ sku: "00123", warehouseId: "pos-wh", qty: 200, kind: "opening", refType: "opening", refId: "workspace-stock" }]));
const user = (await f.call("/me", f.mgr)).data.user;
await f.db.insert(products).values([{ sku: "00456", brand: "MINH LONG I", name: "Ly thứ hai", unit: "cái", updatedAt: (/* @__PURE__ */ new Date()).toISOString() }, { sku: "00789", brand: "MINH LONG I", name: "Ly hết hàng", unit: "cái", updatedAt: (/* @__PURE__ */ new Date()).toISOString() }]);
await f.db.insert(productPrices).values([{ sku: "00456", policyId: "retail-vat", price: 54e3 }, { sku: "00789", policyId: "retail-vat", price: 54e3 }]);
await f.db.insert(productStock).values({ sku: "00456", warehouseId: "pos-wh", quantity: 50, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
await f.db.transaction((tx) => postMoves(tx, "mgr", [{ sku: "00456", warehouseId: "pos-wh", qty: 50, kind: "opening", refType: "opening", refId: "scan-fixture" }]));
for (let i = 0; i < 20; i++) {
  const sku = "P" + i;
  await f.db.insert(products).values({ sku, brand: "MINH LONG I", name: "Bộ sản phẩm tên rất dài để kiểm tra bố cục bảng " + i, unit: "cái", updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
  await f.db.insert(productPrices).values({ sku, policyId: "retail-vat", price: 108e3 });
  await f.db.insert(productStock).values({ sku, warehouseId: "pos-wh", quantity: 100, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
  await f.db.transaction((tx) => postMoves(tx, "mgr", [{ sku, warehouseId: "pos-wh", qty: 100, kind: "opening", refType: "opening", refId: "workspace-" + sku }]));
}
await f.db.insert(webStoreOrders).values({id:'ref-web-1',source:'minhlong',externalId:'REF-WEB-001',orderNo:'WEB_REF_001',registerId:f.registerId,status:'processing',customerName:'Khách web kiểm thử',total:80000,lines:'[]',orderedAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
const root = process.env.POS_UI_ROOT || fileURLToPath(new URL("../../trial-ui/", import.meta.url)), calls = [], qrResults = [];
const html = `<!doctype html><html class="app-shell"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/pos.css"><link rel="stylesheet" href="/typography.css"><link rel="stylesheet" href="/mobile-actions.css"><script type="module" src="/mobile-actions-init.js"><\/script><button id="approval-launcher" class="approval-launcher" aria-label="Cần duyệt: 42 việc">42</button><nav class="bottom-nav">CRM navigation</nav><div class="workspace"><main class="main"><section id="view-pos"></section></main></div><script type="module">
import {initPos} from '/pos.js';location.hash='#/pos';window.notices=[];window.confirmCount=0;window.printCount=0;new MutationObserver(list=>{for(const m of list)for(const n of m.addedNodes)if(n.tagName==='IFRAME')n.contentWindow.print=()=>{window.printCount++;n.contentWindow.dispatchEvent(new n.contentWindow.Event('afterprint'));};}).observe(document.body,{childList:true});
const api=async(path,method='GET',body)=>{const r=await fetch('/api'+path,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),data=await r.json();if(!r.ok)throw Object.assign(Error(data.error),{status:r.status});return data;};
window.pos=initPos({api,root:document.querySelector('#view-pos'),user:()=>(${JSON.stringify(user)}),toast:(message)=>window.notices.push(message),confirmBox:async()=>{window.confirmCount++;return window.confirmAnswer!==false;},go:hash=>location.hash=hash});await pos.load();window.ready=true;
<\/script>`;
const server = createServer(async (req, res) => {
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
      if (path === "/api/pos/qr" && r.status === 200) qrResults.push(r.data);
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
  }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const origin = "http://127.0.0.1:" + server.address().port, browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox"] });
const shot = process.env.POS_SCREENSHOT_DIR || "/workspace/artifacts/pos-mobile-quick";
await mkdir(shot, { recursive: true });
const results=[];
try {
 for(const width of [390,320,430,768]){
  const context=await browser.newContext({viewport:{width,height:844},locale:'vi-VN'});
  await context.route('**/*',r=>r.request().url().startsWith('https://pos-fixture.invalid/')?r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" rx="12" fill="#eff6ff"/><path d="M18 26h40l-5 31H23Z" fill="#b5d8ff"/><path d="M58 30q22 4 0 19" fill="none" stroke="#518cc6" stroke-width="4"/></svg>'}):r.request().url().startsWith(origin+'/')?r.continue():r.abort());
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.goto(origin);await page.waitForFunction(()=>window.ready);
   await page.screenshot({path:shot+`/${width}-empty.png`});
   assert.equal(await page.locator('.pos-mobile-quick').count(),1,'only mobile quick sale gets the reference layout');
   const input=page.getByRole('searchbox',{name:'Tìm hoặc quét sản phẩm'});
   assert.equal(await page.locator('.pos-mobile-search').isVisible(),true);
   assert.ok((await page.locator('.pos-mobile-toolbar > h1').boundingBox()).x<80,'heading stays next to back control');
   assert.equal(await page.locator('.pos-mobile-toolbar').evaluate(n=>new Set([...n.children].map(x=>Math.round(x.getBoundingClientRect().top+x.getBoundingClientRect().height/2))).size<=2),true,'toolbar stays on one row');
   assert.equal(await page.locator('.pos-mobile-search').evaluate(n=>{const input=n.querySelector('input').getBoundingClientRect(),camera=n.querySelector('button').getBoundingClientRect();return input.width>150&&camera.left>=input.right;}),true,'scan camera stays to the right of search');
   assert.equal(await page.locator('.pos-mobile-customer .pos-customer-trigger').isVisible(),true);
   assert.equal(await page.locator('.scan-field-btn').evaluate(n=>getComputedStyle(n,'::after').display!=='none'),true,'camera icon stays visible after status refresh');
   await page.getByRole('button',{name:'Quét mã',exact:true}).click();
   await page.waitForFunction(()=>typeof window.cameraCode==='function');
   await page.locator('.pos-modal').filter({has:page.locator('.pos-camera')}).locator('.pos-modal-close').click();
   await input.fill('00123');await input.press('Enter');
   await page.waitForFunction(()=>document.querySelector('.pos-qty input')?.value==='1');
   assert.equal(await input.inputValue(),'');
   const quantity=page.locator('.pos-qty').first();await quantity.locator('button').last().click();
   const qty=quantity.locator('input');await qty.fill('4');await qty.dispatchEvent('change');
   await page.waitForFunction(()=>document.querySelector('.pos-line-top>strong')?.textContent==='80.000 đ');
   await page.locator('.pos-mobile-discount input').fill('10');
   await page.waitForFunction(()=>document.querySelector('.pos-line-top>strong')?.textContent==='72.000 đ');
   await page.locator('.pos-mobile-discount input').fill('0');
   await page.getByRole('button',{name:'Chọn sản phẩm',exact:true}).click();
   assert.equal(await page.locator('.pos-mobile-catalog').isVisible(),true);
   await input.fill('00456');await page.locator('.pos-product[data-sku="00456"]').click();
   await page.waitForFunction(()=>document.querySelectorAll('.pos-line:not(.pos-gift-line)').length===2);
   assert.equal(await page.locator('.pos-mobile-catalog').isVisible(),false);
   assert.equal(await input.inputValue(),'');
   await page.waitForFunction(()=>document.querySelector('.pos-mobile-cart-dock>b')?.textContent==='134.000 đ');
   await page.screenshot({path:shot+`/${width}-cart.png`});
   const bounds=await page.locator('.pos-mobile-cart-dock').boundingBox();assert.ok(bounds.y+bounds.height<=844&&bounds.y>600,'fixed checkout remains in view');
   assert.equal(await page.locator('.pos-mobile-quick').evaluate(n=>[...n.querySelectorAll('input,select')].filter(x=>x.getClientRects().length).every(x=>{const r=x.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;})),true,'all fields fit');
   await page.locator('.pos-mobile-customer .pos-customer-trigger').click();
   await page.locator('.pos-customer-option').filter({hasText:'Nguyễn Khách kiểm thử'}).click();
   await page.waitForFunction(()=>!document.querySelector('.pos-open-payment')?.disabled);
   await page.locator('.pos-mobile-cart-dock .pos-open-payment').click();
   await page.locator('.pos-payment-modal').waitFor();
   assert.equal(await page.locator('.pos-payment-modal .pos-payment-method').count(),3,'retain cash/transfer/COD only');
   await page.screenshot({path:shot+`/${width}-payment.png`});
   await page.locator('.pos-payment-modal .pos-modal-close').click();
   await page.getByRole('button',{name:'Thêm hóa đơn',exact:true}).click();
   await page.waitForFunction(()=>document.querySelectorAll('.pos-line:not(.pos-gift-line)').length===0);
   await page.locator('.pos-ref-invoice-select').filter({hasText:'Hóa đơn 1'}).click();
   await page.waitForFunction(()=>document.querySelectorAll('.pos-line:not(.pos-gift-line)').length===2);
   await page.locator('.pos-mobile-cart-open').click();assert.equal(await page.locator('.pos-mobile-order-details').evaluate(n=>n.open),true);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   if(width===390){
    await page.setViewportSize({width:1440,height:900});await page.locator('.pos-mode-scan').waitFor();assert.equal(await page.locator('.pos-mobile-quick').count(),0);
    for(const mode of ['Bán thường','Bán giao hàng']){
      await page.getByRole('button',{name:mode,exact:true}).click();await page.setViewportSize({width:768,height:844});
      await page.waitForFunction(()=>!document.querySelector('.pos-workspace'));assert.equal(await page.locator('.pos-mobile-quick').count(),0,mode+' retains its existing mobile view');
      await page.setViewportSize({width:1440,height:900});await page.locator('.pos-workspace').waitFor();
    }
    await page.getByRole('button',{name:'Bán nhanh',exact:true}).click();await page.setViewportSize({width:390,height:844});await page.locator('.pos-mobile-quick').waitFor();
    await page.locator('#view-pos').evaluate(n=>n.hidden=true);assert.equal(await page.locator('.bottom-nav').isVisible(),true,'other CRM screens retain navigation');
   }
   assert.deepEqual(errors,[]);results.push({width,cart:true,search:true,discount:true,invoices:true,payment:true,errors:0});
  }catch(e){await page.screenshot({path:shot+`/${width}-failure.png`});console.log('DEBUG',{errors,notices:await page.evaluate(()=>window.notices)});throw e;}finally{await context.close();}
 }
 assert.equal(calls.filter(c=>c.method!=='GET'&&!['/pos/preview','/pos/ghn/locations'].includes(c.path)).length,0,'UI inspection cannot write real orders or payments');
 console.log(JSON.stringify(results,null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));await f.client.close();}
