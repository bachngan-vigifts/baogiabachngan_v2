/** Actual CRM app + API router + PostgreSQL WASM, isolated synthetic data only. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { setupEarly } from "../../tests/helpers/purchase-early-fixture.ts";
import {
  salesOrders,
  salesOrderLines,
} from "../../src/modules/sales/schema.ts";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const f = await setupEarly(),
  root = fileURLToPath(new URL("../../trial-ui/", import.meta.url)),
  out = "/tmp/accounting-workspace";
await mkdir(out, { recursive: true });
async function post(path, body) {
  const r = await f.call("/accounting" + path, f.cookies.mgr, "POST", body);
  assert.ok(r.status < 300, JSON.stringify(r.data));
  return r.data;
}
const entity = await post("/entities", {
  name: "CÔNG TY THỬ NGHIỆM",
  taxCode: "0123456789",
  confirmed: true,
});
assert.equal(
  (
    await f.call("/accounting/books/accounting-vigifts", f.cookies.mgr, "PUT", {
      name: "Kho tổng Vigifts",
      entityId: entity.id,
      invoiceProvider: "viettel",
      revision: 1,
    })
  ).status,
  200,
);
const draft = await post("/books/accounting-vigifts/documents", {
  kind: "opening",
  reference: "OPEN-DEMO",
  date: "2026-11-01",
  lines: [
    {
      sku: "DEMO-A",
      name: "Bộ trà thử nghiệm",
      unit: "Bộ",
      quantity: 20,
      netValue: 2000000,
      taxRate: 8,
    },
  ],
});
await post("/documents/" + draft.id + "/post", {
  revision: 1,
  confirmed: true,
});
const stamp = new Date().toISOString();
await f.db
  .insert(salesOrders)
  .values({
    id: "demo-order",
    orderNo: "DEMO-ORDER",
    quoteType: "HRC",
    customerName: "Test",
    ownerId: "mgr",
    createdBy: "mgr",
    orderDate: "2026-11-05",
    status: "delivered",
    subtotal: 120000,
    tax: 9600,
    total: 129600,
    createdAt: stamp,
    updatedAt: stamp,
  });
await f.db
  .insert(salesOrderLines)
  .values({
    id: "demo-order-line",
    orderId: "demo-order",
    lineNo: 1,
    sku: "DEMO-A",
    name: "Bộ trà thử nghiệm",
    unit: "Bộ",
    qty: 1,
    unitPrice: 120000,
    amount: 120000,
    taxRate: 8,
    deliveredQty: 1,
  });
const before = await f.client.query("select * from stock_moves");
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/staff/")) {
      const chunks = [];
      for await (const ch of req) chunks.push(ch);
      const body = chunks.length
          ? JSON.parse(Buffer.concat(chunks))
          : undefined,
        bearer = req.headers.authorization?.replace(/^Bearer /, "") || "",
        r = await f.call(
          url.pathname.slice("/api/staff".length) + url.search,
          bearer ? "__Host-bn-session=" + bearer : "",
          req.method,
          body,
        );
      res
        .writeHead(r.status, { "content-type": "application/json" })
        .end(JSON.stringify(r.data));
      return;
    }
    const path = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (path.includes("..")) throw Error("path");
    let data = await readFile(root + path);
    if (path === "index.html")
      data = Buffer.from(
        data
          .toString()
          .replace("<head>", '<head><meta name="bn-api" content="/api/staff">'),
      );
    res.setHeader(
      "content-type",
      path.endsWith(".js")
        ? "text/javascript"
        : path.endsWith(".css")
          ? "text/css"
          : "text/html",
    );
    res.end(data);
  } catch (e) {
    res.writeHead(500).end(e.message);
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = "http://127.0.0.1:" + server.address().port,
  browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox"],
  }),
  results = [];
try {
  for (const [width, role] of [
    [320, "mgr"],
    [390, "mgr"],
    [430, "kt"],
    [1440, "mgr"],
    [390, "kho"],
    [1440, "sa"],
  ]) {
    const user = (await f.call("/me", f.cookies[role])).data.user,
      token = f.cookies[role].split("=")[1],
      context = await browser.newContext({
        viewport: { width, height: 950 },
        isMobile: width < 900,
        hasTouch: width < 900,
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
      ({ user, token }) => {
        localStorage.setItem("bn-v2-session", token);
        localStorage.setItem(
          "bn-v2-session-profile",
          JSON.stringify({ session: token, user }),
        );
      },
      { user, token },
    );
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(origin + "/#/accounting");
    if (["mgr", "kt"].includes(role)) {
      await page.locator("#view-accounting h1").waitFor();
      await page.locator("#view-accounting .ac-stats").waitFor();
      assert(
        await page
          .getByText("Kho tổng Vigifts", { exact: true })
          .first()
          .isVisible(),
      );
      const geometry = await page.locator("#view-accounting").evaluate((r) => ({
        width: r.clientWidth,
        scroll: r.scrollWidth,
        page: document.documentElement.scrollWidth,
        viewport: innerWidth,
      }));
      assert(
        geometry.scroll <= geometry.width + 1 &&
          geometry.page <= geometry.viewport + 1,
        JSON.stringify({ width, role, geometry }),
      );
      await page
        .locator("#view-accounting [name=bookId]")
        .selectOption("accounting-vigifts");
      await page.locator("#view-accounting .ac-filters button").click();
      await page.locator("[data-action=document]").waitFor();
      await page.screenshot({ path: out + "/" + role + "-" + width + ".png" });
      await page.locator("[data-action=document]").click();
      const d = page.locator("dialog.ac-dialog");
      await d.waitFor();
      await d.locator("[name=reference]").fill("UI-DRAFT");
      await d.locator("[data-key=sku]").fill("TEST");
      await d.locator("[data-key=name]").fill("Hàng thử");
      await d.locator("[data-key=unit]").fill("Cái");
      await d.locator("[data-key=quantity]").fill("2");
      await d.locator("[data-key=netValue]").fill("10000");
      await d.locator("[data-key=taxRate]").fill("8");
      const g = await d.evaluate((r) => {
        const b = r.getBoundingClientRect(),
          f = r.querySelector("footer").getBoundingClientRect();
        return {
          width: b.width,
          height: b.height,
          right: b.right,
          left: b.left,
          footer: f.bottom,
          overflow: r.scrollWidth > r.clientWidth + 1,
        };
      });
      assert(
        g.left >= 0 && g.right <= width + 1 && g.footer <= 950 && !g.overflow,
        JSON.stringify(g),
      );
      if (width === 1440) assert(Math.abs(g.width / g.height - 16 / 9) < 0.04);
      await page.screenshot({
        path: out + "/" + role + "-" + width + "-dialog.png",
      });
      await d.locator("[data-close]").last().click();
      await d.waitFor({ state: "detached" });
      await page.locator("[data-action=document]").click();
      assert.equal(
        await page.locator("dialog.ac-dialog [name=reference]").inputValue(),
        "",
      );
      await page.locator("dialog.ac-dialog [data-close]").last().click();
      if (width === 390 && role === "mgr") {
        await page.locator("[data-action=document]").click();
        const edit = page.locator("dialog.ac-dialog");
        await edit.locator("[name=kind]").selectOption("purchase");
        await edit.locator("[name=date]").fill("2026-11-02");
        await edit.locator("[name=reference]").fill("PURCHASE-UI");
        await edit.locator("[name=note]").fill("Chứng từ thử nghiệm");
        for (const [key, value] of Object.entries({
          sku: "DEMO-A",
          name: "Bộ trà thử nghiệm",
          unit: "Bộ",
          quantity: "2",
          netValue: "200000",
          taxRate: "8",
        }))
          await edit.locator("[data-key=" + key + "]").fill(value);
        await edit.locator("button[type=submit]").click();
        await edit.waitFor({ state: "detached" });
        await page
          .getByRole("button", { name: "PURCHASE-UI", exact: true })
          .click();
        const detail = page.locator("dialog.ac-dialog");
        await detail.locator("[name=confirmed]").check();
        await detail
          .getByRole("button", { name: "Duyệt ghi sổ", exact: true })
          .click();
        await detail.waitFor({ state: "detached" });
        await page.locator(".ac-stats").waitFor();
        const report = await f.call(
          "/accounting/report?entityId=" +
            entity.id +
            "&bookId=accounting-vigifts&from=2026-11-01&to=2026-11-30",
          f.cookies.mgr,
        );
        assert.equal(report.data.stock[0].quantity, 22);
        assert.equal(report.data.totals.stockValue, 2200000);
      }
      if (width === 1440 && role === "mgr") {
        await page.locator("[data-action=source]").click();
        const edit = page.locator("dialog.ac-dialog");
        await edit.locator("[name=q]").fill("DEMO-ORDER");
        await edit.locator("[data-search]").click();
        await edit.locator("[data-results] button").first().click();
        await edit.locator("[data-proposal] h3").waitFor();
        assert(
          (await edit.locator("[data-proposal]").innerText()).includes(
            "DEMO-A",
          ),
        );
        await edit.locator("[name=reference]").fill("SOURCE-UI");
        await edit.locator("[name=confirmedEntity]").check();
        await edit.locator("button[type=submit]").click();
        await edit.waitFor({ state: "detached" });
        await page
          .getByRole("button", { name: "SOURCE-UI", exact: true })
          .waitFor();
      }
      if (role === "kt")
        assert.equal(await page.locator("[data-action=entity]").count(), 0);
    } else {
      await page.waitForURL((u) => u.hash !== "#/accounting");
      assert.equal(await page.locator("#view-accounting").innerText(), "");
      assert(
        await page.locator("[data-nav=accounting]").evaluate((e) => e.hidden),
      );
    }
    assert.deepEqual(errors, []);
    results.push({
      width,
      role,
      allowed: ["mgr", "kt"].includes(role),
      errors,
    });
    await context.close();
  }
  assert.deepEqual(
    (await f.client.query("select * from stock_moves")).rows,
    before.rows,
  );
  await writeFile(out + "/results.json", JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
  server.close();
  await f.client.close();
}
