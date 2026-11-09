/** Local browser tests against the real CRM router and synthetic PGlite data. No production calls. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { setupSepay } from "../../tests/helpers/sepay-fixture.ts";
import { customerPayments } from "../../src/modules/sales/schema.ts";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const f = await setupSepay(),
  root = fileURLToPath(new URL("../../trial-ui/", import.meta.url));
const out = process.env.BROWSER_EVIDENCE_DIR || "/tmp/sepay-page-browser";
await mkdir(out, { recursive: true });
const a = await f.order("SEPAY_CRM_001"),
  b = await f.order("SEPAY_CRM_002"),
  c = await f.order("SEPAY_CRM_003"),
  mobileOrder = await f.order("SEPAY_CRM_MOBILE"),
  staleOrder = await f.order("SEPAY_CRM_STALE");
const unknown = await f.incoming("Khách kiểm thử gửi thiếu mã đơn", 100000, {
  transactionDate: "2026-11-08 15:00:00",
});
const manual = await f.incoming("Khoản đã được kế toán nhập trước", 100000, {
  transactionDate: "2026-11-08 14:00:00",
});
const manualId = crypto.randomUUID();
await f.db.insert(customerPayments).values({
  id: manualId,
  orderId: b.id,
  amount: 100000,
  paidAt: "2026-11-08",
  method: "transfer",
  reference: "BANK-MANUAL-TEST",
  createdBy: "mgr",
  createdAt: f.stamp,
});
const lost = await f.incoming(
  "Khoản thử mất phản hồi sau khi ghi thu",
  100000,
  { transactionDate: "2026-11-08 13:00:00" },
);
await f.incoming(
  'Nội dung không tin cậy <img src=x onerror="window.__sepayXss=1">',
  1000,
);
await f.incoming("Tài khoản chưa cấu hình", 50000, { accountNumber: "999999" });
let mobileEvent, staleEvent, supersede;
for (let i = 0; i < 5; i++) {
  const e = await f.incoming("Giao dịch phân trang " + i, 2000);
  if (i === 0) mobileEvent = e;
  if (i === 1) staleEvent = e;
  if (i === 2) supersede = e;
}
const options = {
  listError: false,
  loseNextConfirm: false,
  delayList: 0,
  delayDetailId: "",
};
const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://localhost");
    if (u.pathname.startsWith("/api/staff/")) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const isList = u.pathname === "/api/staff/sepay/transactions";
      if (
        options.delayDetailId &&
        u.pathname ===
          "/api/staff/sepay/transactions/" + options.delayDetailId &&
        req.method === "GET"
      )
        await new Promise((r) => setTimeout(r, 700));
      if (isList && options.delayList)
        await new Promise((r) => setTimeout(r, options.delayList));
      if (isList && options.listError) {
        res
          .writeHead(503, { "content-type": "application/json" })
          .end(JSON.stringify({ error: "Lỗi mạng giả lập để kiểm thử" }));
        return;
      }
      const token = req.headers.authorization?.replace(/^Bearer /, "");
      const r = await f.call(
        u.pathname.slice("/api/staff".length) + u.search,
        token ? "__Host-bn-session=" + token : "",
        req.method,
        chunks.length
          ? JSON.parse(Buffer.concat(chunks).toString())
          : undefined,
      );
      if (u.pathname.endsWith("/confirm") && options.loseNextConfirm) {
        options.loseNextConfirm = false;
        res.writeHead(503, { "content-type": "application/json" }).end(
          JSON.stringify({
            error: "Mất phản hồi giả lập sau khi máy chủ xử lý",
          }),
        );
        return;
      }
      res
        .writeHead(r.status, { "content-type": "application/json" })
        .end(JSON.stringify(r.data));
      return;
    }
    const path = u.pathname === "/" ? "/index.html" : u.pathname;
    let body = await readFile(root + path);
    if (path.endsWith(".html"))
      body = Buffer.from(
        body
          .toString()
          .replace("<head>", '<head><meta name="bn-api" content="/api/staff">'),
      );
    res
      .writeHead(200, {
        "content-type": path.endsWith(".js")
          ? "text/javascript"
          : path.endsWith(".css")
            ? "text/css"
            : path.endsWith(".ttf")
              ? "font/ttf"
              : "text/html;charset=utf-8",
      })
      .end(body);
  } catch (e) {
    res.writeHead(500).end(String(e.message));
  }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const origin = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const results = [];
async function pageFor(cookie, width, hash = "#/quotes") {
  const context = await browser.newContext({
    viewport: { width, height: 960 },
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
  const user = (await f.call("/me", cookie)).data.user,
    token = cookie.split("=")[1];
  await context.addInitScript(
    ({ user, token }) => {
      localStorage.setItem("bn-api-region-manual-off", "1");
      localStorage.setItem("bn-v2-session", token);
      localStorage.setItem(
        "bn-v2-session-profile",
        JSON.stringify({ session: token, user }),
      );
    },
    { user, token },
  );
  const p = await context.newPage(),
    errors = [],
    calls = [],
    assets = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("request", (r) => {
    if (r.url().includes("/api/staff/sepay/"))
      calls.push({ url: r.url(), method: r.method() });
    if (/\/sepay\.(js|css)/.test(r.url())) assets.push(r.url());
  });
  await p.goto(origin + "/" + hash);
  await p.locator("#workspace").waitFor({ state: "visible" });
  return { p, context, errors, calls, assets };
}
async function detail(p, id) {
  await p.locator(`[data-open="${id}"]`).click();
  await p.locator("[data-detail] .sp-bank-amount").waitFor();
}
async function choose(p, no) {
  await p.locator("[data-order-search] input").fill(no);
  await p.locator("[data-order-search] button[type=submit]").click();
  await p.locator("[data-order-results] [data-choose]").first().click();
  await p.locator("[data-approval-form]").waitFor();
}
async function review(p) {
  const check = await p.locator(".sp-check").boundingBox(),
    input = await p.locator(".sp-check input").boundingBox();
  assert.ok(
    check.height < 100 && check.width > 150 && input.width <= 24,
    "confirmation checkbox and text must fit in a readable row",
  );
  await p
    .locator("[data-approval-form] textarea")
    .fill("Đã đối chiếu sao kê ngân hàng và xác nhận đúng khách, đúng đơn.");
  await p.locator("[data-approval-form] input[type=checkbox]").check();
  await p.locator("[data-approval-form] button[type=submit]").click();
  await p.locator("[data-confirm]").waitFor();
}
try {
  const m = await pageFor(f.mgr, 1500);
  const p = m.p;
  assert.equal(m.calls.length, 0);
  assert.equal(
    m.assets.length,
    0,
    "SePay assets must stay lazy on other pages",
  );
  if (!(await p.locator(".side-nav [data-nav=sepay]").isVisible()))
    await p.locator("#nav-group-4 .nav-group-toggle").click();
  await p.locator(".side-nav [data-nav=sepay]").click();
  await p.locator("[data-list] table").waitFor();
  assert.equal(await p.locator("[data-open]").count(), 10);
  assert.equal(await p.locator("#view-sepay img").count(), 0);
  assert.equal(await p.evaluate(() => window.__sepayXss), undefined);
  await p.screenshot({ path: out + "/manager-desktop.png", fullPage: true });
  const before = (await f.db.select().from(customerPayments)).length;
  await detail(p, unknown.id);
  await choose(p, a.orderNo);
  await review(p);
  await p
    .locator("[data-detail]")
    .screenshot({ path: out + "/manager-confirmation.png" });
  assert.equal(
    (await f.db.select().from(customerPayments)).length,
    before,
    "preview must not write money",
  );
  await p.locator("[data-confirm]").evaluate((b) => {
    b.click();
    b.click();
  });
  await p.locator("[data-notice] .sp-success").waitFor();
  assert.equal((await f.db.select().from(customerPayments)).length, before + 1);
  assert.equal(
    m.calls.filter((r) => r.method === "POST" && r.url.endsWith("/confirm"))
      .length,
    1,
  );
  await detail(p, manual.id);
  await choose(p, b.orderNo);
  assert.equal(
    await p.locator("[data-approval-form] select").inputValue(),
    manualId,
  );
  await review(p);
  await p.locator("[data-confirm]").click();
  await p.locator("[data-notice] .sp-success").waitFor();
  assert.equal(
    (await f.db.select().from(customerPayments)).length,
    before + 1,
    "linking a manual receipt must not add money",
  );
  options.listError = true;
  await p.locator("[data-refresh]").click();
  await p.locator("[data-list] [role=alert]").waitFor();
  assert.equal(
    await p.locator("[data-stats] strong").first().textContent(),
    "—",
  );
  options.listError = false;
  await p.locator("[data-refresh]").click();
  await p.locator("[data-list] table").waitFor();
  await detail(p, lost.id);
  await choose(p, c.orderNo);
  await review(p);
  options.loseNextConfirm = true;
  await p.locator("[data-confirm]").click();
  await p.locator("[data-reload-detail]").waitFor();
  assert.equal(
    (
      await f.db
        .select()
        .from(customerPayments)
        .where(eq(customerPayments.orderId, c.id))
    ).length,
    1,
  );
  await p.locator("[data-reload-detail]").click();
  await p.locator("[data-detail] .sp-matched").waitFor();
  assert.equal(await p.locator("[data-confirm]").count(), 0);
  await detail(p, staleEvent.id);
  await choose(p, staleOrder.orderNo);
  await review(p);
  options.delayDetailId = staleEvent.id;
  const pendingDetail = p.waitForRequest(
    (r) =>
      r.method() === "GET" &&
      r.url().includes("/sepay/transactions/" + staleEvent.id),
  );
  await p.locator("[data-confirm]").click();
  await pendingDetail;
  await p.locator(`[data-open="${supersede.id}"]`).evaluate((b) => b.click());
  await p.locator("[data-detail] .sp-bank-amount").waitFor();
  await p.waitForTimeout(900);
  assert.ok(
    (await p.locator("[data-detail]").textContent()).includes(
      supersede.providerId,
    ),
  );
  assert.equal(
    await p.locator("[data-notice] .sp-success").count(),
    0,
    "a success acknowledgement for another transaction must not appear in this detail",
  );
  options.delayDetailId = "";
  options.delayList = 700;
  await p.locator("[data-refresh]").click();
  await p.waitForTimeout(100);
  const oldCalls = m.calls.length;
  await p.evaluate(() => (location.hash = "#/quotes"));
  await p.waitForTimeout(1000);
  options.delayList = 0;
  assert.equal(
    await p.locator("#view-sepay").innerHTML(),
    "",
    "late list response must not repaint a closed private page",
  );
  assert.equal(m.calls.length, oldCalls, "leaving page must not poll SePay");
  assert.equal(m.errors.length, 0, m.errors.join("\n"));
  results.push({
    case: "manager create/link, double click, lost ACK, list error, lazy assets, no polling, XSS",
    pass: true,
  });
  await m.context.close();
  const account = await pageFor(f.accountant, 1500, "#/sepay");
  await account.p.locator("[data-list] table").waitFor();
  await detail(account.p, unknown.id);
  assert.equal(await account.p.locator("[data-order-search]").count(), 0);
  assert.ok(
    (await account.p.locator("[data-detail]").textContent()).includes(
      "Chỉ Manager",
    ),
  );
  const denied = await account.p.evaluate(
    async ({ id, orderId }) => {
      const r = await fetch(
        "/api/staff/sepay/transactions/" + id + "/confirm",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer " + localStorage.getItem("bn-v2-session"),
          },
          body: JSON.stringify({
            orderId,
            reason: "Thử quyền kế toán ghi nhận",
            confirmed: true,
          }),
        },
      );
      return r.status;
    },
    { id: unknown.id, orderId: a.id },
  );
  assert.equal(denied, 403);
  assert.equal(account.errors.length, 0, account.errors.join("\n"));
  await account.p.screenshot({
    path: out + "/accounting-desktop.png",
    fullPage: true,
  });
  results.push({
    case: "Accounting reads only, direct confirmation forbidden",
    pass: true,
  });
  await account.context.close();
  const mobile = await pageFor(f.mgr, 390, "#/sepay?limit=2");
  await mobile.p.locator("[data-list] table").waitFor();
  assert.equal(await mobile.p.locator("[data-open]").count(), 2);
  await mobile.p.locator("[data-next]").click();
  await mobile.p.waitForFunction(
    () =>
      new URLSearchParams(location.hash.split("?")[1]).get("offset") === "2",
  );
  await mobile.p.locator("[data-list] table").waitFor();
  assert.ok(
    await mobile.p.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "mobile must not overflow horizontally",
  );
  await mobile.p.screenshot({
    path: out + "/manager-mobile.png",
    fullPage: true,
  });
  await mobile.p
    .locator(".crm-mobile-nav button")
    .filter({ hasText: "Tiền" })
    .click();
  await mobile.p
    .locator(".crm-nav-sheet [data-mobile-nav=sepay]")
    .waitFor({ state: "visible" });
  await mobile.p.locator(".crm-nav-sheet .icon-btn").click();
  await mobile.p
    .locator("[data-filters] [name=q]")
    .fill(mobileEvent.providerId);
  await mobile.p.locator("[data-filters] button[type=submit]").click();
  await mobile.p.locator(`[data-open="${mobileEvent.id}"]`).waitFor();
  await detail(mobile.p, mobileEvent.id);
  await choose(mobile.p, mobileOrder.orderNo);
  await review(mobile.p);
  await mobile.p.locator("[data-confirm]").scrollIntoViewIfNeeded();
  await mobile.p.screenshot({ path: out + "/manager-mobile-confirm.png" });
  await mobile.p.locator("[data-confirm]").click();
  await mobile.p.locator("[data-notice] .sp-success").waitFor();
  assert.equal(
    (
      await f.db
        .select()
        .from(customerPayments)
        .where(eq(customerPayments.orderId, mobileOrder.id))
    )[0].amount,
    2000,
  );
  assert.equal(mobile.errors.length, 0, mobile.errors.join("\n"));
  results.push({
    case: "390px responsive layout, server pagination, footer menu and real confirmation",
    pass: true,
  });
  await mobile.context.close();
  const emp = await pageFor(f.emp, 1100, "#/sepay");
  await emp.p.waitForTimeout(500);
  assert.ok(!emp.p.url().includes("#/sepay"));
  assert.equal(emp.calls.length, 0);
  assert.equal(emp.assets.length, 0);
  assert.equal(emp.errors.length, 0, emp.errors.join("\n"));
  results.push({
    case: "Sales cannot navigate to or load private SePay page",
    pass: true,
  });
  await emp.context.close();
  await writeFile(
    out + "/browser-results.json",
    JSON.stringify(results, null, 2),
  );
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  await f.client.close();
}
