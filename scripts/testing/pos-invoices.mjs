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
const f = await setup();
await f.db.update(posRegisters).set({name:'CỬA HÀNG MINH LONG'}).where(eq(posRegisters.id,f.registerId));
await f.open(f.mgr);
await f.db.update(products).set({name:'Chén cơm 11.2cm jas lys',unit:'Cái'}).where(eq(products.sku,'00123'));
await f.db.update(productPrices).set({price:20000}).where(eq(productPrices.sku,'00123'));
await f.db.transaction((tx) => postMoves(tx, "mgr", [{ sku: "00123", warehouseId: "pos-wh", qty: 200, kind: "opening", refType: "opening", refId: "workspace-stock" }]));
const user = (await f.call("/me", f.mgr)).data.user;
await f.db.insert(products).values([{ sku: "00456", name: "Ly thứ hai", unit: "cái", updatedAt: (/* @__PURE__ */ new Date()).toISOString() }, { sku: "00789", name: "Ly hết hàng", unit: "cái", updatedAt: (/* @__PURE__ */ new Date()).toISOString() }]);
await f.db.insert(productPrices).values([{ sku: "00456", policyId: "retail-vat", price: 54e3 }, { sku: "00789", policyId: "retail-vat", price: 54e3 }]);
await f.db.insert(productStock).values({ sku: "00456", warehouseId: "pos-wh", quantity: 50, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
await f.db.transaction((tx) => postMoves(tx, "mgr", [{ sku: "00456", warehouseId: "pos-wh", qty: 50, kind: "opening", refType: "opening", refId: "scan-fixture" }]));
for (let i = 0; i < 20; i++) {
  const sku = "P" + i;
  await f.db.insert(products).values({ sku, name: "Bộ sản phẩm tên rất dài để kiểm tra bố cục bảng " + i, unit: "cái", updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
  await f.db.insert(productPrices).values({ sku, policyId: "retail-vat", price: 108e3 });
  await f.db.insert(productStock).values({ sku, warehouseId: "pos-wh", quantity: 100, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
  await f.db.transaction((tx) => postMoves(tx, "mgr", [{ sku, warehouseId: "pos-wh", qty: 100, kind: "opening", refType: "opening", refId: "workspace-" + sku }]));
}
await f.db.insert(webStoreOrders).values({id:'ref-web-1',source:'minhlong',externalId:'REF-WEB-001',orderNo:'WEB_REF_001',registerId:f.registerId,status:'processing',customerName:'Khách web kiểm thử',total:80000,lines:'[]',orderedAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
const secondCustomer=await f.call('/pos/customers',f.mgr,'POST',{name:'Khách hóa đơn hai',phone:'0907654321'});assert.equal(secondCustomer.status,201);
const root = process.env.POS_UI_ROOT || fileURLToPath(new URL("../../trial-ui/", import.meta.url)), calls = [], qrResults = [];
const html = `<!doctype html><html class="app-shell"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/pos.css"><link rel="stylesheet" href="/typography.css"><link rel="stylesheet" href="/mobile-actions.css"><script type="module" src="/mobile-actions-init.js"><\/script><div class="workspace"><main class="main"><section id="view-pos"></section></main></div><script type="module">
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
const shot = process.env.POS_SCREENSHOT_DIR || "/workspace/artifacts/pos-reference";
await mkdir(shot, { recursive: true });
const context=await browser.newContext({viewport:{width:1440,height:900},locale:'vi-VN'});
await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
const scan=async(code,qty)=>{const input=page.getByRole('searchbox',{name:'Tìm hoặc quét sản phẩm'});await input.fill(code);await input.press('Enter');await page.locator('.pos-qty input').waitFor();await page.locator('.pos-qty input').fill(String(qty));await page.locator('.pos-qty input').dispatchEvent('change');};
const waitAmount=amount=>page.waitForFunction(value=>document.querySelector('.pos-line-top>strong')?.textContent===value,amount);
const chooseCustomer=async(name)=>{await page.locator('.pos-customer-trigger').click();await page.locator('.pos-customer-picker .pos-customer-option').filter({hasText:name}).click();};
const tab=n=>page.getByRole('button',{name:'Hóa đơn '+n,exact:true});
try {
 await page.goto(origin);await page.waitForFunction(()=>window.ready);
 await scan('00123',2);await chooseCustomer('Nguyễn Khách kiểm thử');await page.locator('.pos-order-note textarea').fill('Ghi chú hóa đơn một');await waitAmount('40.000 đ');
 await page.getByRole('button',{name:'Bán giao hàng',exact:true}).click();await page.locator('.pos-ref-delivery-form').getByText('Số nhà, tên đường',{exact:true}).locator('..').locator('input').fill('Địa chỉ hóa đơn một');await page.getByRole('button',{name:'Bán nhanh',exact:true}).click();
 await page.evaluate(()=>{window.savedStorageSet=Storage.prototype.setItem;Storage.prototype.setItem=()=>{throw Error('fixture quota');};});
 await page.getByRole('button',{name:'Thêm hóa đơn',exact:true}).click();assert.equal(await page.locator('.pos-ref-invoice-select').count(),1);assert.equal(await page.locator('.pos-qty input').inputValue(),'2');
 await page.evaluate(()=>Storage.prototype.setItem=window.savedStorageSet);
 await page.getByRole('button',{name:'Thêm hóa đơn',exact:true}).click();await tab(2).waitFor();assert.equal(await page.locator('.pos-line').count(),0);
 await scan('00456',3);await chooseCustomer('Khách hóa đơn hai');await page.locator('.pos-order-note textarea').fill('Ghi chú hóa đơn hai');await waitAmount('162.000 đ');
 await page.screenshot({path:shot+'/parallel-invoices.png'});
 await page.getByRole('button',{name:'Bán giao hàng',exact:true}).click();await page.locator('.pos-ref-delivery-form').getByText('Số nhà, tên đường',{exact:true}).locator('..').locator('input').fill('Địa chỉ hóa đơn hai');await page.getByRole('button',{name:'Bán nhanh',exact:true}).click();
 await tab(1).click();await waitAmount('40.000 đ');assert.equal(await page.locator('.pos-order-note textarea').inputValue(),'Ghi chú hóa đơn một');assert.match(await page.locator('.pos-customer-trigger').textContent(),/Nguyễn Khách/);
 await page.getByRole('button',{name:'Bán giao hàng',exact:true}).click();assert.equal(await page.locator('.pos-ref-delivery-form').getByText('Số nhà, tên đường',{exact:true}).locator('..').locator('input').inputValue(),'Địa chỉ hóa đơn một');await page.getByRole('button',{name:'Bán nhanh',exact:true}).click();
 await page.locator('.pos-qty input').fill('4');await waitAmount('80.000 đ');
 await page.reload();await page.waitForFunction(()=>window.ready);await waitAmount('80.000 đ');assert.equal(await tab(1).getAttribute('aria-pressed'),'true');
 await page.setViewportSize({width:390,height:844});await tab(2).click();await waitAmount('162.000 đ');assert.equal(await page.locator('.pos-order-note textarea').inputValue(),'Ghi chú hóa đơn hai');
 await tab(1).click();await waitAmount('80.000 đ');await page.setViewportSize({width:1440,height:900});
 await page.locator('.pos-tender input').fill('80000');await page.locator('.pos-payment-footer .btn.primary').click();await page.waitForFunction(()=>window.printCount>0);
 await page.locator('.pos-saved-modal .pos-modal-close').click();await tab(2).click();await waitAmount('162.000 đ');assert.equal(await page.locator('.pos-order-note textarea').inputValue(),'Ghi chú hóa đơn hai');
 const orders=await f.db.select().from(salesOrders),receipts=await f.db.select().from(customerPayments);assert.equal(orders.length,1);assert.equal(orders[0].total,80000);assert.equal(orders[0].customerId,f.customerId);assert.equal(receipts.length,1);assert.equal(receipts[0].amount,80000);
 await page.getByRole('button',{name:'Đóng hóa đơn 1',exact:true}).click();assert.equal(await tab(1).count(),0);await waitAmount('162.000 đ');
 await page.getByRole('button',{name:'Thêm hóa đơn',exact:true}).click();await tab(3).waitFor();await page.getByRole('button',{name:'Đóng hóa đơn 3',exact:true}).click();await waitAmount('162.000 đ');
 await page.evaluate(()=>window.confirmAnswer=false);await page.getByRole('button',{name:'Đóng hóa đơn 2',exact:true}).click();assert.equal(await tab(2).count(),1);await page.evaluate(()=>window.confirmAnswer=true);
 await page.locator('.pos-payment-method[data-method=transfer]').click();await page.locator('.pos-create-qr').click();await page.locator('.pos-pc-qr-image').waitFor();
 const count=await page.locator('.pos-ref-invoice-select').count();await page.getByRole('button',{name:'Thêm hóa đơn',exact:true}).click();assert.equal(await page.locator('.pos-ref-invoice-select').count(),count);assert.match((await page.evaluate(()=>notices)).at(-1),/giao dịch|QR/);
 assert.equal(calls.filter(c=>c.path==='/pos/checkout').length,1,'switching, closing, restoring and QR drafting cannot create another sale');
 assert.deepEqual(errors,[]);await page.screenshot({path:shot+'/invoice-qr-lock.png'});
 console.log('PASS: separate rows/customer/notes, reload, mobile switching, payment isolation, close confirmation, monotonic tabs, QR lock; 0 pageerror');
} catch(error){console.log('DEBUG',errors,await page.evaluate(()=>notices));await page.screenshot({path:shot+'/invoices-failure.png'});throw error;}
finally{await context.close();await browser.close();await new Promise(r=>server.close(r));await f.client.close();}
