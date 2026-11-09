/** GY-0008: row alignment and action targets in CRM/POS/web orders and contracts. Synthetic data only. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { setup } from "../../tests/helpers/pos-fixture.ts";
import { posRegisters } from "../../src/modules/sales/pos-schema.ts";
import {
  salesOrders,
  salesOrderLines,
  paymentSchedules,
  salesContracts,
} from "../../src/modules/sales/schema.ts";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const f = await setup(),
  root = fileURLToPath(new URL("../../trial-ui/", import.meta.url)),
  out = process.env.BROWSER_EVIDENCE_DIR || "/tmp/order-actions-alignment";
await mkdir(out, { recursive: true });

const orderIds = [],
  contractOrders = [];
for (let i = 0; i < 6; i++) {
  const id = "geometry-order-" + i,
    stamp = "2026-11-09T09:00:00.000Z";
  await f.db.insert(salesOrders).values({
    id,
    orderNo: "DH_GEOMETRY_" + i,
    quoteType: "HRC",
    customerId: f.customerId,
    customerName:
      i % 3 === 0
        ? "CÔNG TY TNHH SẢN XUẤT THƯƠNG MẠI DỊCH VỤ VÀ PHÂN PHỐI QUÀ TẶNG DOANH NGHIỆP KIỂM THỬ NHIỀU DÒNG"
        : "Khách kiểm thử " + i,
    contact: "Người nhận kiểm thử",
    phone: "0900000000",
    ownerId: "mgr",
    createdBy: "mgr",
    orderDate: "2026-11-09",
    createdAt: stamp,
    updatedAt: stamp,
    status: i % 3 === 2 ? "cancelled" : "confirmed",
    channel: i === 1 ? "pos" : "crm",
    subtotal: 100000,
    total: 108000,
    tax: 8000,
    sapoOrderId: i % 3 === 1 ? "987654" : null,
    sapoOrderCode: i % 3 === 1 ? "SON987654" : null,
  });
  await f.db.insert(salesOrderLines).values({
    id: "geometry-line-" + i,
    orderId: id,
    lineNo: 1,
    sku: "00123",
    name: "Ly kiểm thử",
    unit: "cái",
    qty: 1,
    unitPrice: 100000,
    taxRate: 8,
    amount: 100000,
  });
  await f.db.insert(paymentSchedules).values({
    id: "geometry-payment-" + i,
    orderId: id,
    kind: "balance",
    amount: 108000,
    createdAt: stamp,
  });
  if (i < 3) orderIds.push(id);
  else {
    contractOrders.push(id);
    await f.db.insert(salesContracts).values({
      id: "geometry-contract-" + i,
      contractNo: "09-11/09112026/HĐKT/BN-TEST" + i,
      orderId: id,
      legalEntity: "BN",
      status: "signed",
      value: 108000,
      depositRate: 30,
      depositAmount: 32400,
      signedDate: "2026-11-09",
      createdBy: "mgr",
      createdAt: stamp,
      updatedAt: stamp,
    });
  }
}

await f.db
  .update(posRegisters)
  .set({ name: "CỬA HÀNG LOCKNLOCK CẦN THƠ" })
  .where(eq(posRegisters.id, f.registerId));
const incoming = await f.call(
  "/integrations/woocommerce/lock/order?token=test-lock-token",
  "",
  "POST",
  {
    id: 990008,
    number: "990008",
    status: "on-hold",
    total: "108000",
    currency: "VND",
    billing: { first_name: "Khách web kiểm thử căn hàng", phone: "0900000000" },
    line_items: [
      {
        sku: "00123",
        name: "Ly kiểm thử",
        quantity: 1,
        subtotal: "100000",
        subtotal_tax: "8000",
        total: "100000",
        total_tax: "8000",
      },
    ],
    shipping_total: "0",
    shipping_tax: "0",
    discount_total: "0",
    discount_tax: "0",
    total_tax: "8000",
    coupon_lines: [],
    fee_lines: [],
    shipping_lines: [],
    date_created_gmt: "2026-11-09T03:00:00Z",
  },
);
assert.equal(incoming.status, 200, JSON.stringify(incoming.data));
const listed = await f.call("/orders?flow=order", f.mgr);
const webOrder = listed.data.orders.find((o) => o.external);
assert.ok(webOrder);
orderIds.push(webOrder.id);

const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://localhost");
    if (u.pathname.startsWith("/api/staff/")) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const token = req.headers.authorization?.replace(/^Bearer /, ""),
        r = await f.call(
          u.pathname.slice("/api/staff".length) + u.search,
          token ? "__Host-bn-session=" + token : "",
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
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const results = [];
async function contextFor(cookie, width) {
  const context = await browser.newContext({
    viewport: { width, height: 953 },
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
    errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(origin + "/#/quotes");
  await p.locator("#workspace").waitFor({ state: "visible" });
  return { context, p, errors };
}

async function openList(p, key) {
  await p.evaluate((k) => {
    location.hash = "#/" + k;
  }, key);
  await p
    .locator("#" + key + "-list tr[data-href]")
    .first()
    .waitFor();
}
async function geometry(p, key) {
  return p.locator("#" + key + "-list tr[data-href]").evaluateAll((rows) =>
    rows.map((row) => {
      const r = row.getBoundingClientRect(),
        cell = row.lastElementChild,
        c = cell.getBoundingClientRect();
      return {
        id: row.dataset.href,
        rowHeight: r.height,
        cellHeight: c.height,
        topDelta: c.top - r.top,
        bottomDelta: r.bottom - c.bottom,
        display: getComputedStyle(cell).display,
      };
    }),
  );
}
try {
  for (const width of [1920, 1378, 1024]) {
    const c = await contextFor(f.mgr, width),
      p = c.p;
    for (const key of ["orders", "contracts"]) {
      await openList(p, key);
      const g = await geometry(p, key);
      {
        for (const x of g) {
          assert.equal(x.display, "table-cell");
          assert.ok(
            Math.abs(x.topDelta) < 1 && Math.abs(x.bottomDelta) < 1,
            JSON.stringify(x),
          );
        }
      }
      const wrap = p.locator("#view-" + key + " .table-wrap").first();
      await wrap.evaluate((el) => {
        el.scrollLeft = el.scrollWidth;
      });
      await p.locator("#" + key + "-list").screenshot({
        path: out + "/" + "after" + "-" + key + "-" + width + ".png",
      });
      for (const x of await geometry(p, key))
        assert.ok(Math.abs(x.bottomDelta) < 1);
      results.push({
        case: "aligned" + " " + key + " at " + width,
        pass: true,
        geometry: g,
      });
    }
    if (width === 1920) {
      await openList(p, "orders");
      const id = orderIds[0],
        b = p.locator('[data-order-print-for="' + id + '"]');
      await b.scrollIntoViewIfNeeded();
      assert.equal(
        await b.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return document
            .elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
            ?.closest("tr")?.dataset.href;
        }),
        "#/orders/" + id,
      );
      const requested = p.waitForRequest(
        (r) =>
          new URL(r.url()).pathname === "/api/staff/orders/" + id &&
          r.method() === "GET",
      );
      await b.click();
      await requested;
      assert.equal(
        new URL(p.url()).hash,
        "#/orders",
        "print click must not open a neighbouring order",
      );
      results.push({
        case: "print click requests the selected order and keeps the list route",
        pass: true,
      });
    }
    assert.deepEqual(c.errors, []);
    await c.context.close();
  }
  {
    const c = await contextFor(f.mgr, 390),
      p = c.p;
    for (const [key, ids, attr] of [
      ["orders", orderIds, "data-order-print-for"],
      ["contracts", contractOrders, "data-contract-docs-for"],
    ]) {
      await openList(p, key);
      await p.waitForFunction(
        (k) =>
          document
            .querySelector("#" + k + "-list tr")
            ?.classList.contains("crm-list-card"),
        key,
      );
      for (const id of ids) {
        const row = p.locator(
          "#" + key + '-list tr[data-href="#/' + key + "/" + id + '"]',
        );
        assert.equal(
          await row.locator("[" + attr + '="' + id + '"]').count(),
          1,
        );
        assert.equal(await row.locator(".crm-card-actions").count(), 1);
      }
      assert.ok(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await p.screenshot({
        path: out + "/after-" + key + "-390.png",
        fullPage: true,
      });
      results.push({
        case:
          "mobile " +
          key +
          " retains each order action once without horizontal page overflow",
        pass: true,
      });
    }
    assert.deepEqual(c.errors, []);
    await c.context.close();
  }
  await writeFile(
    out + "/" + "browser-results" + ".json",
    JSON.stringify(results, null, 2),
  );
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  await f.client.close();
}
