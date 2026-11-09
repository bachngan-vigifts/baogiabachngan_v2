/** Real SePay UI module + real CRM router/PGlite; every external request is blocked. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { setupSepay } from "../../tests/helpers/sepay-fixture.ts";
import {
  customerPayments,
  salesContracts,
} from "../../src/modules/sales/schema.ts";
import { webStoreOrders } from "../../src/modules/sales/pos-schema.ts";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const f = await setupSepay(),
  shift = await f.open(),
  at = "2026-11-08T03:00:00.000Z";
f.env.nowSec = () => Date.parse("2026-11-08T03:06:00.000Z") / 1000;
for (let i = 0; i < 23; i++) await f.order("CRM_PAGE_" + i);
const root = fileURLToPath(new URL("../../trial-ui/", import.meta.url)),
  out = process.env.BROWSER_EVIDENCE_DIR || "/tmp/sepay-proximity";
await mkdir(out, { recursive: true });
const calls = [];
let failSearch = false;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/staff/")) {
      const route = url.pathname.slice("/api/staff".length) + url.search;
      calls.push({ route, method: req.method });
      if (failSearch && url.pathname === "/api/staff/sepay/orders") {
        failSearch = false;
        res
          .writeHead(503, { "content-type": "application/json" })
          .end(JSON.stringify({ error: "Lỗi mạng giả lập" }));
        return;
      }
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const cookie = url.searchParams.has("accountant") ? f.other : f.mgr;
      const r = await f.call(
        route.replace("&accountant=1", ""),
        cookie,
        req.method,
        chunks.length
          ? JSON.parse(Buffer.concat(chunks).toString())
          : undefined,
      );
      res
        .writeHead(r.status, { "content-type": "application/json" })
        .end(JSON.stringify(r.data));
      return;
    }
    if (url.pathname === "/") {
      const accountant = url.searchParams.has("accountant");
      res
        .writeHead(200, { "content-type": "text/html;charset=utf-8" })
        .end(
          `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/typography.css"><link rel="stylesheet" href="/mobile-design.css"></head><body><main style="padding:16px"><section id="view-sepay"></section></main><script type="module">import {initSepay} from '/sepay.js';const api=async(path,method='GET',body)=>{const r=await fetch('/api/staff'+path+(${accountant}?(path.includes('?')?'&accountant=1':'?accountant=1'):''),{method,headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw Error(data.error||'API error');return data};window.page=initSepay({api,root:document.querySelector('#view-sepay'),go:hash=>page.show(hash.split('?')[1]||''),canOpenOrders:()=>true});await page.show('from=2026-11-08&to=2026-11-08');window.ready=true;</script></body></html>`,
        );
      return;
    }
    const path = url.pathname.slice(1);
    if (path.includes("..")) throw Error("Invalid path");
    const data = await readFile(root + path);
    res
      .writeHead(200, {
        "content-type": path.endsWith(".js")
          ? "text/javascript"
          : path.endsWith(".css")
            ? "text/css"
            : "application/octet-stream",
      })
      .end(data);
  } catch (e) {
    res.writeHead(500).end(e.message);
  }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const origin = "http://127.0.0.1:" + server.address().port,
  browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox"],
  }),
  report = [];
try {
  for (const width of [1440, 390]) {
    const pos = await f.order("POS_PICK_" + width, {
        channel: "pos",
        shiftId: shift.id,
        status: "delivered",
      }),
      receiptId = crypto.randomUUID();
    await f.db.insert(customerPayments).values({
      id: receiptId,
      orderId: pos.id,
      customerId: f.customerId,
      shiftId: shift.id,
      amount: 100000,
      method: "transfer",
      paymentSource: "pos",
      paidAt: "2026-11-08",
      createdBy: "emp",
      createdAt: at,
    });
    const webId = crypto.randomUUID();
    await f.db.insert(webStoreOrders).values({
      id: webId,
      source: "minhlong",
      externalId: "WEB_PICK_" + width,
      orderNo: "WEB_PICK_" + width,
      registerId: f.registerId,
      status: "on-hold",
      paymentMethod: "Chuyển khoản",
      total: 100000,
      currency: "VND",
      customerName: "CÔNG TY KIỂM THỬ KHÁCH HÀNG CÓ TÊN DÀI TRÊN ĐIỆN THOẠI",
      orderedAt: at,
      orderedAtVerified: true,
      updatedAt: at,
      financialSnapshot: JSON.stringify({
        version: 1,
        coupons: [],
        fees: [],
        shipping: [],
        payment: { paidAt: null },
      }),
    });
    const pending = await f.incoming("Khach khong ghi ma " + width, 100000, {
      id: "pending-" + width,
    });
    assert.equal(pending.status, "review");
    const webPending = await f.incoming("Khach can chon don " + width, 100000, {
      id: "web-" + width,
      transactionDate: "2026-11-08 09:00:00",
    });
    const contract = await f.order("CRM_CONTRACT_" + width, { total: 150000 });
    await f.db.insert(salesContracts).values({
      id: crypto.randomUUID(),
      orderId: contract.id,
      contractNo: "HDKT_PICK_" + width,
      legalEntity: "BN",
      status: "signed",
      createdBy: "mgr",
      createdAt: at,
      updatedAt: at,
    });
    const crmPending = await f.incoming("Khach tra mot phan " + width, 50000, {
      id: "crm-" + width,
      transactionDate: "2026-11-08 09:00:00",
    });
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      locale: "vi-VN",
    });
    await context.route("**/*", (r) =>
      r
        .request()
        .url()
        .startsWith(origin + "/")
        ? r.continue()
        : r.abort(),
    );
    const p = await context.newPage(),
      errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    const start = Date.now(),
      beforeCalls = calls.length;
    await p.goto(origin);
    await p.waitForFunction(() => window.ready);
    const readyMs = Date.now() - start;
    assert.equal(
      calls.length - beforeCalls,
      1,
      "opening SePay only loads its list",
    );
    async function open(event) {
      await p.locator('[data-open="' + event.id + '"]').click();
      await p.locator("[data-order-results] li").first().waitFor();
    }
    async function filter(source, query = "") {
      await p.locator("[data-order-search] [name=source]").selectOption(source);
      await p.locator("[name=orderQuery]").fill(query);
      await p.locator("[data-order-search] button[type=submit]").click();
      await p.locator("[data-order-results] li").first().waitFor();
    }
    async function approve() {
      await p
        .locator("[name=reason]")
        .fill("Đã kiểm tra giao dịch ngân hàng và chọn đúng chứng từ nguồn.");
      await p.locator("[name=verified]").check();
      await p.locator("[data-approval-form] button[type=submit]").click();
      await p.locator("[data-confirm]").click();
      await p.locator(".sp-success").waitFor();
    }
    await open(pending);
    assert.equal(await p.locator("[data-order-results] li").count(), 20);
    await p.locator("[data-more-orders]").click();
    await p.waitForFunction(
      () => document.querySelectorAll("[data-order-results] li").length > 20,
    );
    await filter("pos");
    await p.locator('[data-choose="' + pos.id + '"]').click();
    await p.locator("[data-approval-form]").waitFor();
    assert.equal(
      await p.locator("[name=existingPaymentId]").inputValue(),
      receiptId,
    );
    const receiptsBefore = (await f.db.select().from(customerPayments)).length;
    await approve();
    assert.equal(
      (await f.db.select().from(customerPayments)).length,
      receiptsBefore,
    );
    await p.screenshot({ path: out + "/pos-linked-" + width + ".png" });
    await open(webPending);
    await filter("web", "WEB_PICK_" + width);
    await p.locator('[data-choose="web:' + webId + '"]').click();
    await p.locator("[data-approval-form]").waitFor();
    await approve();
    assert.equal(
      (await f.db.select().from(customerPayments)).length,
      receiptsBefore,
    );
    const doc = await f.call("/orders/web:" + webId, f.mgr);
    assert.equal(doc.data.document.paid, 100000);
    await p.screenshot({ path: out + "/web-linked-" + width + ".png" });
    await open(crmPending);
    await filter("contract", "HDKT_PICK_" + width);
    await p.locator('[data-choose="' + contract.id + '"]').click();
    await p.locator("[data-approval-form]").waitFor();
    await approve();
    assert.equal(
      (await f.db.select().from(customerPayments)).length,
      receiptsBefore + 1,
    );
    assert.deepEqual(errors, []);
    const overflow = await p.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    );
    assert.equal(overflow, false);
    report.push({
      width,
      readyMs,
      initialRequests: 1,
      posReceiptReused: true,
      webSnapshotUnchanged: true,
      crmPartialPayment: true,
      pagination: true,
      overflow,
      errors,
    });
    await context.close();
  }
  const c = await browser.newContext({ viewport: { width: 390, height: 900 } });
  await c.route("**/*", (r) =>
    r
      .request()
      .url()
      .startsWith(origin + "/")
      ? r.continue()
      : r.abort(),
  );
  const p = await c.newPage();
  await p.goto(origin + "/?accountant=1");
  await p.waitForFunction(() => window.ready);
  await p.locator("[data-open]").first().click();
  await p.locator(".sp-readonly").waitFor();
  assert.equal(await p.locator("[data-order-search]").count(), 0);
  await c.close();
  console.log(JSON.stringify(report));
  await writeFile(out + "/results.json", JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  await f.client.close();
}
