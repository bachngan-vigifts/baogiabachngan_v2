/** Mobile Work menu opens existing shift reports through the local router/PGlite. No production or external calls. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { setup } from "../../tests/helpers/pos-fixture.ts";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const f = await setup(),
  root = fileURLToPath(new URL("../../trial-ui/", import.meta.url));
const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://localhost");
    if (u.pathname.startsWith("/api/staff/")) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length
          ? JSON.parse(Buffer.concat(chunks).toString())
          : undefined,
        token = req.headers.authorization?.replace(/^Bearer /, ""),
        r = await f.call(
          u.pathname.slice("/api/staff".length) + u.search,
          token ? "__Host-bn-session=" + token : "",
          req.method,
          body,
        );
      res
        .writeHead(r.status, { "content-type": "application/json" })
        .end(JSON.stringify(r.data));
      return;
    }
    const path = u.pathname === "/" ? "/index.html" : u.pathname;
    let data = await readFile(root + path);
    if (path.endsWith(".html"))
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
          : path.endsWith(".ttf")
            ? "font/ttf"
            : "text/html;charset=utf-8",
    );
    res.end(data);
  } catch (e) {
    res.writeHead(500).end(String(e.message));
  }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const origin = "http://127.0.0.1:" + server.address().port,
  browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox"],
  }),
  out = "/workspace/artifacts/mobile-work-shift-reports-20261107",
  results = [];
await mkdir(out, { recursive: true });
async function pageFor(cookie, width = 390) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
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
  const user = (await f.call("/me", cookie)).data.user;
  await context.addInitScript(
    ({ user, token }) => {
      localStorage.setItem("bn-v2-session", token);
      localStorage.setItem(
        "bn-v2-session-profile",
        JSON.stringify({ session: token, user }),
      );
    },
    { user, token: cookie.split("=")[1] },
  );
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin + "/#/tasks");
  await page.locator(".crm-mobile-nav:not([hidden])").waitFor();
  return { page, context, errors };
}
try {
  await f.open();
  for (const [role, cookie] of [
    ["manager", f.mgr],
    ["cashier", f.emp],
  ]) {
    const { page: p, context, errors } = await pageFor(cookie),
      requests = [];
    p.on("request", (r) => {
      if (r.url().includes("/api/staff/pos/"))
        requests.push(new URL(r.url()).pathname);
    });
    await p.locator('.crm-mobile-nav [data-mobile-nav-group="work"]').click();
    const sheet = p.locator(".crm-nav-sheet[open]");
    await sheet.locator('[data-mobile-nav="shift-reports"]').click();
    const list = p.locator(".pos-modal[open]");
    await list
      .getByRole("heading", { name: "Báo cáo ca", exact: true })
      .waitFor();
    assert.equal(new URL(p.url()).hash, "#/tasks");
    await list.getByLabel("Nhân viên").selectOption({ index: 1 });
    assert.equal(await list.locator(".pos-shift-list button").count(), 1);
    await p.screenshot({ path: out + "/" + role + "-list.png" });
    await list.locator(".pos-shift-list button").click();
    await p.locator(".pos-modal[open] .sr-card").first().waitFor();
    assert.equal(await p.locator(".pos-modal[open]").count(), 1);
    assert.equal(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    assert.equal(
      requests.some((x) => /catalog|stock-snapshot|orders$/.test(x)),
      false,
      "report shortcut must not load POS catalog/order board",
    );
    await p.screenshot({ path: out + "/" + role + "-detail.png" });
    await p.locator(".pos-modal[open] .pos-modal-close").click();
    await p.locator('.crm-mobile-nav [data-mobile-nav-group="work"]').click();
    await p.screenshot({ path: out + "/" + role + "-menu.png" });
    assert.deepEqual(errors, []);
    results.push({
      role,
      opensFromWork: true,
      realShiftReport: true,
      onlyReportRequests: true,
      noOverflow: true,
    });
    await context.close();
  }
  const retry = await pageFor(f.mgr),
    retryPage = retry.page;
  let failed = false;
  await retryPage.route("**/api/staff/pos/options?stock=0", async (route) => {
    if (failed) return route.continue();
    failed = true;
    await route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ error: "Lỗi báo cáo thử nghiệm" }),
    });
  });
  const openReport = async () => {
    await retryPage
      .locator('.crm-mobile-nav [data-mobile-nav-group="work"]')
      .click();
    await retryPage
      .locator('.crm-nav-sheet[open] [data-mobile-nav="shift-reports"]')
      .click();
  };
  await openReport();
  await retryPage
    .getByText("Lỗi báo cáo thử nghiệm", { exact: true })
    .waitFor();
  assert.equal(await retryPage.locator(".pos-modal[open]").count(), 0);
  await openReport();
  await retryPage
    .locator(".pos-modal[open] .pos-shift-list button")
    .first()
    .waitFor();
  await retryPage.locator(".pos-modal[open] .pos-modal-close").click();
  await retryPage.route("**/api/staff/pos/options?stock=0", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ shifts: [] }),
    }),
  );
  await openReport();
  await retryPage
    .getByText("Không có ca phù hợp bộ lọc.", { exact: true })
    .waitFor();
  assert.deepEqual(retry.errors, []);
  results.push({ reportFailureCanRetry: true, emptyShiftsHandled: true });
  await retry.context.close();
  const cart = await pageFor(f.emp),
    p = cart.page;
  await p.goto(origin + "/#/pos");
  await p.locator(".pos-product-tile .pos-product").first().click();
  assert.equal(await p.locator(".pos-cart-count").textContent(), "1 món");
  await p.getByRole("button", { name: "← Về CRM", exact: true }).click();
  await p.locator('.crm-mobile-nav [data-mobile-nav-group="work"]').click();
  await p
    .locator('.crm-nav-sheet[open] [data-mobile-nav="shift-reports"]')
    .click();
  await p.locator(".pos-modal[open] .pos-shift-list button").first().waitFor();
  await p.locator(".pos-modal[open] .pos-modal-close").click();
  await p.goto(origin + "/#/pos");
  await p.locator(".pos-product-tile .pos-product").first().waitFor();
  assert.equal(await p.locator(".pos-cart-count").textContent(), "1 món");
  assert.deepEqual(cart.errors, []);
  results.push({ cartPreserved: true });
  await cart.context.close();
  await f.db.execute(
    "UPDATE staff_members SET position_id = 'warehouse' WHERE id = 'cashier2'",
  );
  const restricted = await pageFor(f.other);
  await restricted.page
    .locator('.crm-mobile-nav [data-mobile-nav-group="work"]')
    .click();
  assert.equal(
    await restricted.page.locator('[data-mobile-nav="shift-reports"]').count(),
    0,
  );
  assert.deepEqual(restricted.errors, []);
  results.push({ role: "no-pos-access", reportShortcutHidden: true });
  await restricted.context.close();
  console.log(JSON.stringify(results));
} finally {
  await writeFile(out + "/results.json", JSON.stringify(results, null, 2));
  await browser.close();
  server.close();
  await f.client.close();
}
