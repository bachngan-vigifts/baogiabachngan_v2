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
const shot = process.env.POS_SCREENSHOT_DIR || "/tmp/codex2-pos-b1-browser";
await mkdir(shot, { recursive: true });
try {
  for (const [width, height] of [[1440, 900], [1366, 768], [390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, locale: "vi-VN" });
    await context.route("**/*", (r) => r.request().url().startsWith(origin + "/") ? r.continue() : r.abort());
    const page = await context.newPage(), errors = [];
    page.on("pageerror", (e) => {
      errors.push(e.message);
      console.log("PAGEERROR", e.message);
    });
    await page.goto(origin);
    await page.waitForFunction(() => window.ready);
    const input = page.getByRole("searchbox", { name: "Tìm hoặc quét sản phẩm" }), scan = async (code) => {
      await input.fill(code);
      await input.press("Enter");
      await page.waitForFunction(() => document.querySelector(".pos-qty input"));
      await page.waitForTimeout(250);
    };
    if (width > 850) {
      await page.getByRole("button", { name: "Quét nhanh", exact: true }).waitFor();
      await page.keyboard.press("F2");
      assert.equal(await input.evaluate((n) => n === document.activeElement), true);
    }
    await scan("00123");
    if (width > 850) {
      await page.keyboard.press("F11");
      await input.fill("00123");
      await input.press("Enter");
      await page.getByRole("dialog", { name: /Nhập số lượng/ }).waitFor();
      await page.locator(".pos-modal[open] input[type=number]").fill("2");
      await page.locator(".pos-modal[open] button[type=submit]").click();
      await page.waitForFunction(() => document.querySelector(".pos-qty input").value === "3");
      await page.keyboard.press("F11");
      assert.match(await page.locator(".pos-scan-status").textContent(), /00123.*3/);
    }
    if (width > 850) {
      const before = await page.evaluate(() => window.confirmCount);
      await page.evaluate(() => window.confirmAnswer = false);
      await page.keyboard.press("F12");
      assert.equal(await page.evaluate(() => window.confirmCount), before + 1);
      assert.equal(await page.locator(".pos-qty input").first().inputValue(), "3");
      await page.evaluate(() => window.confirmAnswer = true);
      if (width === 1440) {
        for (let i = 0; i < 20; i++) await scan("P" + i);
        await page.locator(".pos-lines").evaluate((n) => n.scrollTop = n.scrollHeight);
        assert.equal(await page.locator(".pos-line").count(), 21);
        await page.screenshot({ path: shot + "/long-cart-" + width + ".png" });
        const r = await page.locator(".pos-checkout .pos-payment-footer .btn.primary").boundingBox();
        assert.ok(r.y + r.height <= height);
        for (let i = 0; i < 20; i++) await page.locator(".pos-line[data-sku^=P] button[aria-label^=Bỏ]").first().click();
      }
    }
    if (width <= 850) await page.locator(".pos-mobile-cart-open").click();
    await page.screenshot({ path: shot + "/before-customer-" + width + ".png" });
    console.log("PANEL", await page.locator(".pos-checkout").evaluate((n) => ({ height: n.clientHeight, body: n.querySelector(".pos-checkout-scroll")?.clientHeight, rect: n.getBoundingClientRect().toJSON() })));
    await page.locator(".pos-customer-trigger").click();
    await page.getByRole("combobox", { name: "Tìm khách hàng", exact: true }).fill("Nguyễn");
    await page.locator(".pos-customer-option").first().click();
    await page.waitForTimeout(350);
    if (width > 850) {
      await page.keyboard.press("F4");
      await page.locator(".pos-voucher input[type=number]").fill("1000");
      await page.waitForTimeout(350);
      await page.locator(".pos-order-note textarea").fill("Ghi chú giữ nháp " + width);
      await page.locator(".pos-workspace-extras summary").click();
      await page.reload();
      await page.waitForFunction(() => window.ready && document.querySelector(".pos-qty input")?.value === "3");
      assert.match(await page.locator(".pos-customer-trigger").textContent(), /Nguyễn/);
      assert.equal(await page.locator(".pos-order-note textarea").inputValue(), "Ghi chú giữ nháp " + width);
      assert.equal(await page.locator(".pos-voucher input[type=number]").inputValue(), "1000");
      const pay = page.locator(".pos-checkout .pos-payment-footer .btn.primary");
      await pay.waitFor();
      const rect = await pay.boundingBox();
      await page.screenshot({ path: shot + "/geometry-" + width + ".png" });
      console.log("GEOMETRY", width, JSON.stringify(rect), await page.locator(".pos-workspace").evaluate((n) => ({ height: n.clientHeight, top: n.getBoundingClientRect().top, scroll: n.scrollHeight })));
      assert.ok(rect && rect.y >= 0 && rect.y + rect.height <= height, "primary action stays in viewport");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: shot + "/scan-" + width + ".png" });
      const noCheckout = calls.filter((c) => c.path === "/pos/checkout").length;
      await page.keyboard.press("F10");
      await page.waitForFunction(() => window.printCount > 0);
      assert.equal(calls.filter((c) => c.path === "/pos/checkout").length, noCheckout);
      await page.keyboard.press("F8");
      await page.keyboard.press("F9");
      await page.locator(".pos-cod-modal").waitFor();
      await page.locator(".pos-cod-modal .pos-modal-close").click();
      await page.keyboard.press("F6");
      await page.keyboard.press("F7");
      await page.locator(".pos-create-qr").click();
      await page.waitForFunction(() => document.querySelector(".pos-pc-qr-image"));
      const qrs = calls.filter((c) => c.path === "/pos/qr" && c.method === "POST").length;
      const image = await page.locator(".pos-pc-qr-image").getAttribute("src");
      await page.locator(".pos-create-qr").click();
      await page.locator(".pos-qr-modal").waitFor();
      assert.equal(calls.filter((c) => c.path === "/pos/qr" && c.method === "POST").length, qrs, "opening QR tools reuses reserved request");
      await page.locator(".pos-qr-modal .pos-modal-close").click();
      await page.reload();
      await page.waitForFunction(() => window.ready && document.querySelector(".pos-pc-qr-image"));
      assert.equal(await page.locator(".pos-pc-qr-image").getAttribute("src"), image);
      assert.equal(calls.filter((c) => c.path === "/pos/qr" && c.method === "POST").length, qrs, "recovery checks status; never generates a QR");
      assert.equal(await page.locator(".pos-transfer-confirm input").isChecked(), false);
      if (width === 1366) {
        const q = qrResults.at(-1);
        await f.db.update(posPaymentRequests).set({ confirmedAt: (/* @__PURE__ */ new Date()).toISOString() }).where(eq(posPaymentRequests.id, q.id));
        await page.waitForFunction(() => document.querySelector(".pos-transfer-confirm input").checked);
        assert.equal(await page.locator("[data-method=cash]").isDisabled(), true);
      } else await page.locator(".pos-transfer-confirm input").check();
      let dropped = false;
      const sent = [];
      await page.route("**/api/pos/checkout", async (route) => {
        sent.push(route.request().postDataJSON());
        if (!dropped) {
          dropped = true;
          await route.fetch();
          await route.abort("failed");
        } else await route.continue();
      });
      await page.keyboard.press("F9");
      await page.getByRole("button", { name: "Kiểm tra lại giao dịch", exact: true }).waitFor();
      const count = (await f.db.select().from(salesOrders)).length;
      await page.reload();
      await page.waitForFunction(() => window.ready);
      await page.getByRole("button", { name: "Kiểm tra lại giao dịch", exact: true }).click();
      await page.locator(".pos-saved-modal").waitFor();
      assert.equal((await f.db.select().from(salesOrders)).length, count);
      assert.equal(sent[0].key, sent[1].key);
      assert.equal(sent[0].paymentRequestId, sent[1].paymentRequestId);
      assert.ok(sent[0].paymentRequestId);
      assert.equal((await f.db.select().from(customerPayments)).length, count);
      await page.screenshot({ path: shot + "/saved-" + width + ".png" });
    } else {
      await page.getByRole("button", { name: "THANH TOÁN", exact: true }).click();
      await page.locator(".pos-payment-modal").waitFor();await page.screenshot({path:shot+"/mobile-390.png"});
      assert.equal(await page.locator(".pos-payment-modal").isVisible(), true);
      await page.locator(".pos-payment-modal .pos-modal-close").click();
      assert.equal(await page.locator(".pos-qty input").inputValue(), "1");
    }
    assert.deepEqual(errors, []);
    console.log("PASS", JSON.stringify({ width, height, draft: width > 850, quantityPrompt: width > 850, qrReuse: width > 850, replay: width > 850, mobileModal: width <= 850, errors }));
    await context.close();
  }
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await f.client.close();
}
