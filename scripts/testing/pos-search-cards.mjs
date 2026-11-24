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
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const f = await setup();
await f.open();
await f.db.transaction((tx) => postMoves(tx, "mgr", [{ sku: "00123", warehouseId: "pos-wh", qty: 200, kind: "opening", refType: "opening", refId: "workspace-stock" }]));
const user = (await f.call("/me", f.emp)).data.user;
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
const root = fileURLToPath(new URL("../../trial-ui/", import.meta.url)), calls = [], qrResults = [];
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
      if (path === "/api/pos/catalog" && u.searchParams.get("q")) await new Promise((r2) => setTimeout(r2, u.searchParams.get("q") === "00123" ? 350 : 100));
      const r = await f.call(path.slice(4) + u.search, f.emp, req.method, body);
      if (path === "/api/pos/catalog") for (const p of r.data.products || []) p.imageUrl = "https://pos-image.test/product.svg";
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
const shot = process.env.POS_SCREENSHOT_DIR || "/tmp/codex2-pos-search-cards";
await mkdir(shot, { recursive: true });
try {
  for (const [width, height] of [[1366, 768], [1440, 900], [1812, 1100], [390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, locale: "vi-VN" });
    await context.route("**/*", (r) => r.request().url().startsWith(origin + "/") ? r.continue() : r.request().url().startsWith("https://pos-image.test/") ? r.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#e8edf2"/><path d="M19 18h25v28H19zM44 22h6v15h-6" fill="#467f9c"/></svg>' }) : r.abort());
    const page = await context.newPage(), errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(origin);
    await page.waitForFunction(() => window.ready);
    const search = page.getByRole("searchbox", { name: "Tìm hoặc quét sản phẩm" });
    await search.fill("Bộ sản phẩm");
    await page.waitForFunction(() => document.querySelectorAll(".pos-product-tile").length >= 12 && !document.querySelector(".pos-grid").hidden && document.querySelector(".pos-product-name").getBoundingClientRect().height > 0);
    if (width > 850) {
      const boxes = await page.locator(".pos-product-tile").evaluateAll((ns) => ns.slice(0, 12).map((n) => {
        const b = n.getBoundingClientRect(), name = n.querySelector(".pos-product-name"), im = n.querySelector("img");
        return { top: b.top, bottom: b.bottom, height: b.height, width: b.width, name: name.getBoundingClientRect().height, display: getComputedStyle(name).display, img: im ? getComputedStyle(im).display : "missing" };
      }));
      assert.notEqual(boxes[0].img, "none", "product thumbnail is visible");
      assert.ok(boxes[0].name > 0, "name is visible");
      assert.ok(boxes[0].height <= 96, "compact horizontal card");
      assert.ok(boxes[0].width > boxes[0].height * 1.5, "horizontal proportions");
      const columns = boxes.filter((b) => Math.abs(b.top - boxes[0].top) < 2).length;
      assert.ok(columns >= 3);
      const grid = await page.locator(".pos-grid").boundingBox();
      assert.ok(boxes[columns].bottom <= grid.y + grid.height + 1, "second product row is fully visible");
      await page.locator(".pos-product").first().click();
      await page.waitForFunction(() => document.querySelectorAll(".pos-line").length === 1 && document.querySelector(".pos-pc-due strong")?.textContent === "108.000 đ");
      await page.locator(".pos-grid").evaluate((n) => n.scrollTop = n.scrollHeight);
      assert.equal(await page.locator(".pos-line").count(), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      console.log("PASS", JSON.stringify({ width, height, columns, cardHeight: boxes[0].height, gridHeight: grid.height, twoRows: true }));
    }
    assert.deepEqual(errors, []);
    await page.screenshot({ path: shot + "/products-" + width + ".png" });
    await context.close();
  }
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await f.client.close();
}
