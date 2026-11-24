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
await f.db.update(posRegisters).set({name:'CỬA HÀNG LOCKNLOCK CẦN THƠ'}).where(eq(posRegisters.id,f.registerId));
await f.open(f.mgr);
await f.db.update(products).set({name:'Chén cơm 11.2cm Jas Lys — bộ sưu tập gốm sứ hoa văn dành cho khách hàng doanh nghiệp, màu trắng ngà',unit:'Cái'}).where(eq(products.sku,'00123'));
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
const targetStore=await f.call('/pos/registers',f.mgr,'POST',{name:'CỬA HÀNG LOCKNLOCK CẦN THƠ',warehouseId:'pos-wh',pricePolicyId:'retail-vat',secondPricePolicyId:'retail',taxRate:8,bankCode:'VCB',bankAccount:'123456',bankAccountName:'FIXTURE'});
assert.equal(targetStore.status,200);
const root = process.env.POS_UI_ROOT || fileURLToPath(new URL("../../trial-ui/", import.meta.url)), calls = [], qrResults = [];
const html = `<!doctype html><html class="app-shell"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/pos.css"><link rel="stylesheet" href="/typography.css"><link rel="stylesheet" href="/mobile-actions.css"><script type="module" src="/mobile-actions-init.js"><\/script><button id="approval-launcher" class="approval-launcher" aria-label="Cần duyệt: 42 việc">42</button><div class="workspace"><main class="main"><section id="view-pos"></section></main></div><script type="module">
import {initPos} from '/pos.js';location.hash='#/pos';window.notices=[];window.confirmCount=0;window.printCount=0;window.printedBills=[];new MutationObserver(list=>{for(const m of list)for(const n of m.addedNodes)if(n.tagName==='IFRAME')n.contentWindow.print=()=>{window.printCount++;window.printedBills.push({text:n.contentDocument.body.textContent,qr:n.contentDocument.querySelector('.qr-pay img')?.src||''});n.contentWindow.dispatchEvent(new n.contentWindow.Event('afterprint'));};}).observe(document.body,{childList:true});
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
const shot = process.env.POS_SCREENSHOT_DIR || "/workspace/artifacts/pos-transfer-actions";
await mkdir(shot, { recursive: true });
const results=[];
try {
 for(const [index,width] of [2126,1280,390].entries()){
  const chooseStore=width===1280;
  await f.db.update(posRegisters).set({name:chooseStore?'Sale Admin':'CỬA HÀNG LOCKNLOCK CẦN THƠ'}).where(eq(posRegisters.id,f.registerId));
  const context=await browser.newContext({viewport:{width,height:width===390?844:1000},locale:'vi-VN'});
  await context.route('**/*',r=>r.request().url().startsWith('https://img.vietqr.io/')?r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="white"/><path d="M15 15h55v55H15zm115 0h55v55h-55zM15 130h55v55H15z" fill="#123"/><text x="82" y="112" font-size="20">TEST</text></svg>'}):r.request().url().startsWith(origin+'/')?r.continue():r.abort());
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.goto(origin);await page.waitForFunction(()=>window.ready);
   const input=page.getByRole('searchbox',{name:'Tìm hoặc quét sản phẩm'});await input.fill('00123');await input.press('Enter');
   await page.waitForFunction(()=>document.querySelector('.pos-qty input'));
   const qty=page.locator('.pos-qty input').first();await qty.fill(String(4+index));await qty.dispatchEvent('change');
   await page.locator('.pos-customer-trigger').click();await page.locator('.pos-customer-option').filter({hasText:'Nguyễn Khách kiểm thử'}).click();
   if(width===390){await page.waitForFunction(()=>!document.querySelector('.pos-open-payment').disabled);await page.locator('.pos-open-payment').click();}
   const host=page.locator(width>850?'.pos-checkout .pos-payment-transfer':'.pos-payment-modal .pos-payment-transfer');
   await page.locator(width>850?'.pos-checkout [data-method=transfer]':'.pos-payment-modal [data-method=transfer]').click();
   assert.equal(await host.locator('.pos-transfer-send').count(),1,'direct send action beside transfer confirmation');
   assert.equal(await host.locator('.pos-transfer-send').isDisabled(),true,'must create an existing QR before sharing');
   await host.locator('.pos-create-qr').click();await page.waitForFunction(()=>document.querySelector('.pos-transfer-send')?.disabled===false);
   const qr=qrResults.at(-1);assert.ok(qr?.id);
   if(await page.locator('.pos-qr-modal').isVisible())await page.locator('.pos-qr-modal .pos-modal-close').click();
   const qrCount=calls.filter(c=>c.path==='/pos/qr'&&c.method==='POST').length,sharesBefore=calls.filter(c=>c.path.endsWith('/share')).length;
   await host.locator('.pos-transfer-send').evaluate(n=>{n.click();n.click();});
   const dialog=page.locator('.pos-qr-modal');await dialog.waitFor();
   if(chooseStore){
    assert.equal(calls.filter(c=>c.path.endsWith('/share')).length,sharesBefore,'manager chooses target before any send');
    await dialog.getByRole('combobox',{name:'Cửa hàng nhận mã QR'}).selectOption(targetStore.data.id);
    await dialog.locator('.pos-qr-send').click();
   }
   await page.waitForFunction(()=>document.querySelector('.pos-qr-share')?.textContent.includes('Đã gửi'));
   assert.equal(calls.filter(c=>c.path.endsWith('/share')).length,sharesBefore+1,'one explicit send');
   assert.equal(calls.filter(c=>c.path==='/pos/qr'&&c.method==='POST').length,qrCount,'sharing cannot create a different QR');
   const phone=(await f.call('/pos/qr-display/pending',f.emp)).data.display;
   assert.equal(phone.id,qr.id);assert.equal(phone.url,qr.url);assert.equal(phone.amount,qr.amount);
   await dialog.locator('.pos-modal-close').click();
   const printed=await page.evaluate(()=>window.printCount);await host.locator('.pos-transfer-print').click();
   await page.waitForFunction(n=>window.printCount>n,printed);
   const bill=await page.evaluate(()=>window.printedBills.at(-1));assert.match(bill.text,/BILL TẠM TÍNH - CHƯA THANH TOÁN/);assert.equal(bill.qr,qr.url);
   assert.equal(await host.locator('.pos-transfer-confirm input').isChecked(),false,'printing and sharing cannot confirm receipt');
   assert.equal((await f.db.select().from(salesOrders)).length,0);assert.equal((await f.db.select().from(customerPayments)).length,0);
   await page.screenshot({path:shot+`/${width}-actions.png`});
   await page.clock.setFixedTime(new Date(Date.now()+60*60*1000));
   if(width>850)await page.waitForFunction(()=>document.querySelector('.pos-transfer-send')?.disabled);
   const beforeExpiryClick=calls.filter(c=>c.path.endsWith('/share')||c.path==='/pos/qr').length;
   await host.locator('.pos-transfer-send').evaluate(n=>n.click());await page.waitForTimeout(100);
   assert.equal(calls.filter(c=>c.path.endsWith('/share')||c.path==='/pos/qr').length,beforeExpiryClick,'expired QR cannot be sent or recreated by send');
   assert.deepEqual(errors,[]);results.push({width,chooseStore,sameQrOnPhone:true,unpaidBillWithQr:true,noPaymentWrite:true});
  }catch(e){console.log('DEBUG',{errors,notices:await page.evaluate(()=>window.notices)});await page.screenshot({path:shot+`/${width}-failure.png`});throw e;}finally{await context.close();}
 }
 console.log(JSON.stringify(results,null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));await f.client.close();}
