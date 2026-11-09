/** Real local CRM router + fresh PGlite database; no production requests or carrier actions. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { setup } from "../../tests/helpers/pos-fixture.ts";
import { customers } from "../../src/modules/customers/schema.ts";
import { salesOrders } from "../../src/modules/sales/schema.ts";
import { eq } from "drizzle-orm";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const root =
  process.env.UI_SOURCE ||
  fileURLToPath(new URL("../../trial-ui/", import.meta.url));
const f = await setup(),
  ok = (r, status = 200) => {
    assert.equal(r.status, status, JSON.stringify(r.data));
    return r.data;
  };
const customerId = "design-customer";
await f.db.insert(customers).values({
  id: customerId,
  name: "CÔNG TY TNHH SẢN XUẤT THƯƠNG MẠI DỊCH VỤ KIỂM THỬ TÊN KHÁCH HÀNG TRÊN ĐIỆN THOẠI",
  contact: "Anh Minh",
  phone: "0903123218",
  email: "minh@example.invalid",
  address: "12 Nguyễn Huệ, Cần Thơ",
  taxCode: "0101234567",
  customerCode: "BN-CUZN04196",
  search: "phuoc duc anh minh",
  sourceVersion: 0,
  syncedAt: "",
});
async function quote(no) {
  return ok(
    await f.call("/quotes", f.mgr, "POST", {
      type: "HRC",
      quoteNo: no,
      date: "2026-10-25",
      customer:
        "CÔNG TY TNHH SẢN XUẤT THƯƠNG MẠI DỊCH VỤ KIỂM THỬ TÊN KHÁCH HÀNG TRÊN ĐIỆN THOẠI",
      customerId,
      contact: "Anh Minh",
      phone: "0903123218",
      vat: 8,
      rows: [
        {
          sku: "00123",
          name: "Bộ trà Hoàng Cung 0.65L",
          unit: "Bộ",
          qty: 2,
          price: 185000,
          taxRate: 8,
        },
        {
          sku: "LY-X",
          name: "Khăn lụa Hoàng Cung",
          unit: "Cái",
          qty: 1,
          price: 85000,
          taxRate: 8,
        },
      ],
    }),
    201,
  );
}
await quote("HRC_BG_DRAFT_25102026");
const q = await quote("HRC_BG_001_25102026");
ok(
  await f.call("/quotes/" + q.id + "/approve", f.mgr, "POST", { revision: 1 }),
);
const contract = ok(
  await f.call("/contracts", f.mgr, "POST", {
    quoteId: q.id,
    legalEntity: "BN",
    depositRate: 30,
  }),
  201,
);
const oq = await quote("HRC_BG_002_25102026");
ok(
  await f.call("/quotes/" + oq.id + "/approve", f.mgr, "POST", { revision: 1 }),
);
const order = ok(
  await f.call("/orders", f.mgr, "POST", { quoteId: oq.id }),
  201,
);
for (const id of [contract.orderId, order.id])
  await f.db
    .update(salesOrders)
    .set({ status: "confirmed", warehouseId: "pos-wh" })
    .where(eq(salesOrders.id, id));
ok(
  await f.call("/tasks", f.mgr, "POST", {
    title: "Gọi xác nhận đơn cho Anh Minh",
    assigneeId: "mgr",
    dueDate: "2026-10-25",
  }),
  201,
);
const cfg = ok(await f.call("/care/config", f.mgr));
ok(
  await f.call("/care", f.mgr, "POST", {
    customerId,
    contactName: "Anh Minh",
    remindBefore: "1d",
    type: cfg.types[0].key,
    content: "Gửi lại báo giá bộ trà, hẹn khách xác nhận",
    result: cfg.results[0].key,
    nextAt: new Date(Date.now() + 864e5).toISOString().slice(0, 10),
  }),
  201,
);
const user = ok(await f.call("/me", f.mgr)).user,
  token = f.mgr.split("=")[1];
const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://localhost"),
      path = u.pathname;
    if (path.startsWith("/api/staff/")) {
      const route = u.pathname.slice("/api/staff".length) + u.search;
      let body;
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      if (chunks.length) body = JSON.parse(Buffer.concat(chunks).toString());
      const auth = req.headers.authorization?.replace(/^Bearer /, "") || "",
        r = await f.call(
          route,
          auth ? "__Host-bn-session=" + auth : "",
          req.method,
          body,
        );
      const data = { ...r.data };
      if (r.cookie) data.sessionToken = r.cookie.split("=")[1];
      if (route === "/logout") data.sessionToken = "";
      res
        .writeHead(r.status, { "content-type": "application/json" })
        .end(JSON.stringify(data));
      return;
    }
    res.setHeader(
      "Content-Type",
      path.endsWith(".js")
        ? "text/javascript"
        : path.endsWith(".css")
          ? "text/css"
          : path.endsWith(".ttf")
            ? "font/ttf"
            : "text/html;charset=utf-8",
    );
    let data = await readFile(root + (path === "/" ? "index.html" : path));
    if (path === "/" || path === "/index.html")
      data = Buffer.from(
        data
          .toString()
          .replace("<head>", '<head><meta name="bn-api" content="/api/staff">'),
      );
    res.end(data);
  } catch (e) {
    res.writeHead(500).end(String(e.message));
  }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const origin = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const screenshotDir =
  process.env.MOBILE_SCREENSHOT_DIR || "/tmp/mobile-name-routes";
await mkdir(screenshotDir, { recursive: true });
const routes = [
  ["quotes", "#/quotes"],
  ["quote-new", "#/quotes/new"],
  ["contracts", "#/contracts"],
  ["contract-detail", "#/contracts/" + contract.orderId],
  ["tasks", "#/tasks"],
  ["orders", "#/orders"],
  ["order-detail", "#/orders/" + order.id],
  ["customers", "#/customers"],
  ["customer-detail", "#/customers/" + customerId],
  ["care", "#/care"],
  ["pos", "#/pos"],
  ["deliveries", "#/deliveries"],
  ["packing", "#/packing"],
  ["receivables", "#/receivables"],
  ["cash", "#/cash"],
  ["cashbook", "#/cashbook"],
  ["purchases", "#/purchases"],
  ["receiving", "#/receiving"],
  ["suppliers", "#/suppliers"],
  ["incoming", "#/purchases?mode=incoming"],
  ["kho", "#/kho"],
  ["stock-moves", "#/stock-moves"],
  ["inventory", "#/inventory"],
  ["transfers", "#/transfers"],
  ["products", "#/products"],
  ["staff", "#/staff"],
  ["payroll", "#/payroll"],
  ["permissions", "#/permissions"],
  ["flow", "#/flow"],
  ["dashboard", "#/dashboard"],
];
const report = [];
try {
  for (const width of (process.env.AUDIT_WIDTHS || "390,1280")
    .split(",")
    .map(Number)) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
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
    await context.addInitScript(
      ({ token, user }) => {
        document.addEventListener("click", (e) => {
          if (e.target.closest?.('a[href^="tel:"]')) e.preventDefault();
        });
        localStorage.setItem("bn-v2-session", token);
        localStorage.setItem(
          "bn-v2-session-profile",
          JSON.stringify({ session: token, user }),
        );
      },
      { token, user },
    );
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(origin + "/index.html#/tasks");
    await page.locator("#workspace").waitFor({ state: "visible" });
    for (const [name, hash] of routes) {
      await page.evaluate((h) => (location.hash = h), hash);
      await page.waitForTimeout(650);
      await page.waitForLoadState("networkidle");
      await page.screenshot({
        path: screenshotDir + "/" + name + "-" + width + ".png",
      });
      const facts = await page.evaluate(() => {
        const shown = (n) =>
          !!n.getClientRects().length && !n.closest("[hidden]");
        const view = [...document.querySelectorAll("main>.view")].find(shown);
        return {
          hash: location.hash,
          view: view?.id,
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
          names: [...document.querySelectorAll("td,dd,strong,b,a,p,span,div")]
            .filter(
              (n) =>
                (n.children.length === 0 ||
                  n.matches(".crm-card-title,.kv dd")) &&
                n.textContent.includes("CÔNG TY TNHH SẢN XUẤT") &&
                shown(n) &&
                !n.closest(".topbar,.chat-launcher"),
            )
            .map((n) => {
              const box = n.closest("td,dd,.task-main") || n,
                r = box.getBoundingClientRect();
              return { text: n.textContent, width: r.width, height: r.height };
            }),
        };
      });
      report.push({ name, width, ...facts });
      console.log(
        JSON.stringify({
          name,
          width,
          overflow: facts.overflow,
          names: facts.names.length,
        }),
      );
    }

    assert.deepEqual(errors, [], `Browser errors at ${width}px`);
    await context.close();
  }
  await writeFile(
    screenshotDir + "/live-report.json",
    JSON.stringify(report, null, 2),
  );
  const failures = report.filter(
    (r) => r.overflow || r.names.some((n) => n.width < 160),
  );
  console.log(
    JSON.stringify({
      routes: report.length,
      withNames: report.filter((r) => r.names.length).length,
      failures,
    }),
  );
  assert.deepEqual(failures, []);
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  await f.client.close();
}
