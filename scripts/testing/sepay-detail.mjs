import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { setupSepay } from "../../tests/helpers/sepay-fixture.ts";
import { customerPayments } from "../../src/modules/sales/schema.ts";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const f = await setupSepay(), root = fileURLToPath(new URL("../../trial-ui/", import.meta.url)), out = process.env.BROWSER_EVIDENCE_DIR || "/tmp/sepay-detail";
await mkdir(out, { recursive: true });
const a = await f.order("B2_ALPHA"), b = await f.order("B2_BETA"), c = await f.order("B2_CHARLIE");
for (let i = 0; i < 52; i++) await f.order("B2_PAGE_" + String(i).padStart(2, "0"));
const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://local");
    if (u.pathname.startsWith("/api/staff/")) {
      const chunks = [];
      for await (const x of req) chunks.push(x);
      const token = req.headers.authorization?.replace(/^Bearer /, "");
      const r = await f.call(u.pathname.slice(10) + u.search, token ? "__Host-bn-session=" + token : "", req.method, chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : void 0);
      res.writeHead(r.status, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(r.data));
      return;
    }
    const path = u.pathname === "/" ? "/index.html" : u.pathname;
    let data = await readFile(root + path);
    if (path === "/index.html") data = Buffer.from(data.toString().replace("<head>", '<head><meta name="bn-api" content="/api/staff">'));
    res.writeHead(200, { "content-type": path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".ttf") ? "font/ttf" : "text/html" }).end(data);
  } catch (e) {
    res.writeHead(500).end(e.message);
  }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const origin = "http://127.0.0.1:" + server.address().port, browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox"] }), results = [];
try {
  const user = (await f.call("/me", f.mgr)).data.user;
  for (const width of [390, 1280]) {
    const suffix = String(width), orders = width === 390 ? [a, b, c] : [await f.order("B2_ALPHA_PC"), await f.order("B2_BETA_PC"), await f.order("B2_CHARLIE_PC")], e = await f.incoming("B2 BROWSER " + suffix, 23e4);
    const context = await browser.newContext({ viewport: { width, height: 1e3 }, locale: "vi-VN" });
    await context.route("**/*", (r) => r.request().url().startsWith(origin + "/") ? r.continue() : r.abort());
    await context.addInitScript(({ token, user: user2 }) => {
      localStorage.setItem("bn-v2-session", token);
      localStorage.setItem("bn-v2-session-profile", JSON.stringify({ session: token, user: user2 }));
    }, { token: f.mgr.split("=")[1], user });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", (x) => errors.push(x.message));
    await page.goto(origin + "/#/sepay?from=2026-11-08&to=2026-11-08");
    await page.locator(`[data-open="${e.id}"]`).click();
    await page.locator(`a[href="#/sepay?allocation=${e.id}"]`).click();
    await page.locator("[data-search]").waitFor();
    const search = async (q) => {
      const response = page.waitForResponse((r) => r.url().includes("/allocation-candidates?") && r.url().includes("q=" + encodeURIComponent(q)));
      await page.locator("[data-search] [name=q]").fill(q);
      await page.locator("[data-search] button").click();
      await response;
      await page.waitForTimeout(100);
    };
    await search(orders[0].orderNo);
    await page.locator(`[data-add="${orders[0].id}"]`).click();
    await page.locator(`[data-line="${orders[0].id}"] [data-full]`).click();
    await search("B2_PAGE");
    const nextPage = page.waitForResponse((r) => r.url().includes("offset=50"));
    await page.locator('[data-page="50"]').click();
    await nextPage;
    await page.waitForTimeout(100);
    assert.equal(await page.locator("[data-line]").count(), 1, "selection survives search/page");
    for (let i = 1; i < 3; i++) {
      await search(orders[i].orderNo);
      await page.locator(`[data-add="${orders[i].id}"]`).click();
      const line = page.locator(`[data-line="${orders[i].id}"]`);
      if (i === 1) await line.locator("[data-full]").click();
      else await line.locator("[data-percent]").fill("30");
    }
    assert.match(await page.locator("[data-total-selected]").textContent(), /230[.]000/);
    assert.equal(await page.locator("[data-review]").isEnabled(), true);
    await page.locator("[data-review]").click();
    await page.locator("[data-verified]").check();
    let dropped = false;
    const keys = [];
    await page.route("**/api/staff/sepay/transactions/*/allocations", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      keys.push(route.request().postDataJSON().clientKey);
      if (!dropped) {
        dropped = true;
        await route.fetch();
        await route.abort("failed");
      } else await route.continue();
    });
    await page.locator("[data-confirm]").click();
    await page.locator("[data-retry]").waitFor();
    await page.screenshot({ path: `${out}/pending-${width}.png`, fullPage: true });
    const before = (await f.db.select().from(customerPayments)).length;
    await page.reload();
    await page.locator("[data-retry]").waitFor();
    await page.locator("[data-retry]").click();
    await page.waitForFunction(() => document.querySelectorAll(".sa-history").length === 3 && !document.querySelector("[data-retry]"));
    assert.equal((await f.db.select().from(customerPayments)).length, before);
    assert.equal(keys[0], keys[1]);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors.filter((x) => !x.includes("Failed to fetch")), []);
    await page.screenshot({ path: `${out}/complete-${width}.png`, fullPage: true });
    await page.locator("[data-void]").first().click();
    await page.locator("[data-void-id] textarea").fill("S\u1EEDa nh\u1EA7m ch\u1EE9ng t\u1EEB ki\u1EC3m th\u1EED");
    await page.locator("[data-void-id] input[type=checkbox]").check();
    await page.locator("[data-void-id] button").click();
    await page.waitForFunction(() => document.querySelector(".sa-history")?.parentElement.textContent.includes("\u0110\xE3 g\u1EE1:"));
    const staleOrder = await f.order("B2_STALE_" + width), staleBank = await f.incoming("STALE BANK " + crypto.randomUUID(), 1e5), stalePath = "/sepay/transactions/" + staleBank.id + "/allocations";
    await page.goto(origin + "/#/sepay?allocation=" + staleBank.id);
    await page.locator("[data-search]").waitFor();
    await search(staleOrder.orderNo);
    await page.locator(`[data-add="${staleOrder.id}"]`).click();
    await page.locator("[data-line] [data-money-proxy]").fill("1.000");
    assert.equal((await f.call(stalePath, f.mgr, "POST", { clientKey: crypto.randomUUID(), expectedRevision: 0, lines: [{ targetId: staleOrder.id, amount: 5e3 }] })).status, 200);
    await page.locator("[data-review]").click();
    await page.locator("[data-verified]").check();
    await page.locator("[data-confirm]").click();
    await page.waitForFunction(() => document.querySelector("[data-notice]")?.textContent.includes("v\u1EEBa thay \u0111\u1ED5i"));
    assert.equal(await page.locator("[data-amount]").inputValue(), "1000");
    assert.equal(await page.locator("[data-review]").isEnabled(), false);
    await page.locator("[data-reload]").click();
    await page.waitForFunction(() => document.querySelector("[data-review]") && !document.querySelector("[data-review]").disabled);
    await page.locator("[data-review]").click();
    await page.locator("[data-verified]").check();
    await page.locator("[data-confirm]").click();
    await page.waitForFunction(() => document.querySelectorAll(".sa-history").length === 2);
    assert.equal((await f.call(stalePath, f.mgr)).data.allocated, 6e3);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    results.push({ width, receipts: before, replayed: true, selectionPreserved: true, voided: true, staleRevisionRecovered: true });
    await context.close();
  }
  await writeFile(out + "/results.json", JSON.stringify(results, null, 2));
  console.log("PASS", JSON.stringify(results));
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  await f.client.close();
}
