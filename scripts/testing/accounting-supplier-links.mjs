/** Real CRM + supplier portal + API, isolated PostgreSQL fixture. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { setupAccountingSupplier } from "../../tests/helpers/accounting-supplier-fixture.ts";
const { chromium } = await import(
    process.env.PLAYWRIGHT_MODULE || "playwright"
  ),
  f = await setupAccountingSupplier(),
  root = fileURLToPath(new URL("../../trial-ui/", import.meta.url)),
  out = "/tmp/accounting-supplier-links";
await mkdir(out, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/staff/")) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
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
  for (const [role, width, view] of [
    ["mgr", 390, "internal"],
    ["kt", 1440, "internal"],
    ["ncc", 390, "invoices"],
    ["ncc", 1440, "balances"],
    ["ncc2", 390, "invoices"],
    ["mgr", 1440, "revoke"],
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
    if (view === "internal" || view === "revoke") {
      await page.goto(origin + "/#/suppliers");
      await page
        .locator("#view-suppliers tbody tr")
        .filter({ hasText: "NCC a" })
        .click();
      await page.locator("[data-sup-accounting]").click();
      const host = page.locator(".sup-accounting");
      await host.locator(".sup-accounting-row").first().waitFor();
      assert((await host.innerText()).includes("INVOICE-A"));
      if (role === "mgr" && view === "internal") {
        await host.locator("[data-link]").click();
        await host.locator("[data-document]").selectOption(f.documentId);
        await host.locator("[data-confirm]").check();
        await host.locator("[data-shared]").check();
        await host.locator("[data-confirm-link]").click();
        await host.getByText(/Đã cho phép chia sẻ/).waitFor();
      }
      if (view === "revoke") {
        await host.locator("[data-revoke]").click();
        await host.locator("[data-reason]").fill("Kiểm thử thu hồi");
        await host.locator("[data-confirm-revoke]").click();
        await host.locator("[data-link]").waitFor();
        const r = await f.call(
          "/supplier-portal/workspace/invoices",
          f.cookies.ncc,
        );
        assert.equal(
          r.data.items[0].accountingStatus,
          "Chưa có đối chiếu được chia sẻ",
        );
      }
      const geometry = await page.locator(".sup-drawer").evaluate((d) => {
        const b = d.getBoundingClientRect();
        return {
          left: b.left,
          right: b.right,
          width: innerWidth,
          overflow: d.scrollWidth > d.clientWidth + 1,
        };
      });
      assert(
        geometry.left >= 0 && geometry.right <= width + 1 && !geometry.overflow,
        JSON.stringify(geometry),
      );
      await host.scrollIntoViewIfNeeded();
    } else {
      await page.goto(origin + "/supplier.html#" + view);
      await page.locator("#ncc-records").waitFor();
      await page
        .locator("#ncc-records .ncc-loading")
        .waitFor({ state: "hidden" });
      const text = await page.locator("#supplier-live-root").innerText();
      assert.doesNotMatch(
        text,
        /PRIVATE-ACCOUNTING|SECRET-INTERNAL|PRIVATE-PAYMENT|Kho tổng|1111111111/,
      );
      if (role === "ncc" && view === "invoices")
        assert(text.includes("Đã ghi sổ"));
      if (role === "ncc2") assert(!text.includes("INVOICE-A"));
      if (view === "balances")
        assert(!(await page.locator(".ncc-paused").count()));
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        false,
      );
    }
    await page.screenshot({
      path: out + "/" + role + "-" + width + "-" + view + ".png",
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    results.push({ role, width, view, errors });
    await context.close();
  }
  assert.equal(
    (await f.client.query("select count(*)::int n from stock_moves")).rows[0].n,
    0,
  );
  assert.equal(
    (await f.client.query("select count(*)::int n from supplier_payments"))
      .rows[0].n,
    1,
  );
  await writeFile(out + "/results.json", JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
  server.close();
  await f.client.close();
}
