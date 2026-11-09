/** Real CRM router + PGlite synthetic fixtures. Never calls production. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { cashEntries } from "../../src/modules/sales/cash-schema.ts";
import { setupFinance } from "../../tests/helpers/finance-fixture.ts";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const f = await setupFinance(),
  root = fileURLToPath(new URL("../../trial-ui/", import.meta.url));
const salary = await f.call("/hr/members/emp/salary", f.mgr, "PUT", {
  effectiveMonth: "2026-11",
  payrollGroup: "sale",
  kpiEnabled: true,
  baseSalary: 1000000,
  revenueTarget: 2000,
  changeReason: "Chỉ tiêu dữ liệu giả để kiểm thử giao diện",
});
assert.equal(salary.status, 200, JSON.stringify(salary.data));
const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://localhost");
    if (u.pathname.startsWith("/api/staff/")) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
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
  out = "/workspace/artifacts/finance-kpi-20261109",
  results = [];
await mkdir(out, { recursive: true });
async function pageFor(
  cookie,
  width,
  hash = "#/finance?from=2026-11-09&to=2026-11-09",
) {
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
  const user = (await f.call("/me", cookie)).data.user;
  await context.addInitScript(
    ({ user, token }) => {
      localStorage.setItem("bn-api-region-manual-off", "1");
      localStorage.setItem("bn-v2-session", token);
      localStorage.setItem(
        "bn-v2-session-profile",
        JSON.stringify({ session: token, user }),
      );
    },
    { user, token: cookie.split("=")[1] },
  );
  const p = await context.newPage(),
    errors = [],
    calls = [];
  let inflight = 0,
    max = 0;
  p.on("pageerror", (e) => errors.push(e.message));
  const relevant = (u) =>
    /\/api\/staff\/(finance\/|profit\?|dashboard\/kpi)/.test(u);
  p.on("request", (r) => {
    if (relevant(r.url())) {
      calls.push(r.url());
      max = Math.max(max, ++inflight);
    }
  });
  p.on("requestfinished", (r) => {
    if (relevant(r.url())) inflight--;
  });
  p.on("requestfailed", (r) => {
    if (relevant(r.url())) inflight--;
  });
  await p.goto(origin + "/" + hash);
  return { p, context, errors, calls, max: () => max };
}
const loaded = async (p) => {
  await p.locator("#view-finance [data-debt] .fn-stamp").waitFor();
  await p.waitForFunction(
    () =>
      document.querySelector("#view-finance")?.getAttribute("aria-busy") ===
      "false",
  );
};
try {
  for (const width of [390, 1440]) {
    const { p, context, errors, calls, max } = await pageFor(f.mgr, width);
    await loaded(p);
    assert.equal(
      calls.filter(
        (c) => c.includes("/profit?") || c.includes("/dashboard/kpi"),
      ).length,
      0,
      "heavy reports must be explicit",
    );
    assert.equal(max(), 1, "finance reads are serialized");
    assert.match(
      await p.locator("#view-finance [data-flow]").innerText(),
      /1\.137/,
    );
    assert.match(
      await p.locator("#view-finance [data-debt]").innerText(),
      /800/,
    );
    assert.equal(
      await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      "no horizontal overflow",
    );
    await p.screenshot({
      path: out + "/overview-" + width + ".png",
      fullPage: true,
    });
    const initialCalls = calls.length;
    await p.locator("#view-finance [name=branch]").selectOption("crm");
    await p.waitForTimeout(150);
    assert.equal(
      calls.length,
      initialCalls,
      "editing a filter does not fire API",
    );
    await p.getByRole("button", { name: "Xem báo cáo", exact: true }).click();
    await loaded(p);
    assert.match(
      await p.locator("#view-finance [data-flow]").innerText(),
      /400/,
    );
    assert.doesNotMatch(
      await p.locator("#view-finance [data-flow]").innerText(),
      /1\.137/,
    );
    await p
      .getByRole("button", { name: "Tính lợi nhuận", exact: true })
      .click();
    await p.locator("#view-finance [data-profit-content] .fn-four").waitFor();
    assert.match(
      await p.locator("#view-finance [data-profit-content]").innerText(),
      /thiếu giá vốn/,
    );
    assert.match(
      await p.locator("#view-finance [data-profit-content]").innerText(),
      /Chưa đủ dữ liệu/,
    );
    assert.match(
      await p.locator("#view-finance [data-profit-content]").innerText(),
      /tháng lẻ/,
    );
    await p.getByRole("button", { name: "Xem KPI", exact: true }).click();
    await p.locator("#view-finance [name=kpiMember]").waitFor();
    assert.equal(await p.locator("#view-finance .fn-kpi-parts>div").count(), 4);
    assert.match(
      await p.locator("#view-finance [data-kpi-content]").innerText(),
      /riêng/,
    );
    assert.equal(
      await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await p.screenshot({
      path: out + "/details-" + width + ".png",
      fullPage: true,
    });
    await p.locator("#view-finance [name=from]").fill("2026-11-10");
    await p.getByRole("button", { name: "Xem báo cáo", exact: true }).click();
    await p
      .locator("#view-finance .fn-filter-error")
      .filter({ hasText: "Khoảng" })
      .count();
    assert.match(
      await p.locator("#view-finance .fn-filter-error").innerText(),
      /khoảng ngày/i,
    );
    await p.locator("#view-finance [name=from]").fill("2026-11-09");
    await p.route("**/api/staff/finance/cashflow?**", (r) =>
      r.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Nguồn thu chi đang bận" }),
      }),
    );
    await p
      .getByRole("button", { name: "Làm mới số liệu", exact: true })
      .click();
    await p.locator("#view-finance [data-flow] [role=alert]").waitFor();
    await loaded(p);
    assert.doesNotMatch(
      await p.locator("#view-finance [data-flow]").innerText(),
      /400 ₫/,
      "errors must not look like old valid totals",
    );
    await p.unroute("**/api/staff/finance/cashflow?**");
    await p
      .getByRole("button", { name: "Làm mới số liệu", exact: true })
      .click();
    await loaded(p);
    assert.match(
      await p.locator("#view-finance [data-flow]").innerText(),
      /400/,
    );
    // An in-flight old page cannot restart the next read or repopulate private content.
    let blocked;
    const arrived = new Promise((r) => (blocked = r));
    await p.route("**/api/staff/finance/cashflow?**", async (r) => {
      blocked(r);
    });
    await p
      .getByRole("button", { name: "Làm mới số liệu", exact: true })
      .click();
    const delayed = await arrived;
    await p.evaluate(() => (location.hash = "#/home"));
    await p.waitForFunction(
      () => document.querySelector("#view-finance").hidden,
    );
    const before = calls.length;
    await delayed.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{}",
    });
    await p.waitForTimeout(150);
    assert.equal(
      calls.length,
      before,
      "route exit stops remaining finance reads",
    );
    assert.equal(await p.locator("#view-finance").innerText(), "");
    assert.deepEqual(errors, []);
    results.push({
      width,
      serializedMax: max(),
      reads: calls.length,
      checks:
        "totals, filters, explicit profit/KPI, no overflow, failure/retry, stale request isolation passed",
    });
    await context.close();
  }
  await f.db
    .update(cashEntries)
    .set({ reason: "Trả NCC vật tư" })
    .where(eq(cashEntries.id, "finance-petty"));
  const uncertain = await pageFor(f.mgr, 390);
  await loaded(uncertain.p);
  await uncertain.p
    .getByRole("button", { name: "Làm mới số liệu", exact: true })
    .click();
  await loaded(uncertain.p);
  assert.equal(
    await uncertain.p
      .locator("#view-finance [data-flow] .fn-metric strong")
      .allTextContents()
      .then((a) => a.filter((x) => x === "Cần đối chiếu").length),
    2,
  );
  assert.match(
    await uncertain.p.locator("#view-finance [data-flow]").innerText(),
    /có thể trùng/,
  );
  assert.deepEqual(uncertain.errors, []);
  await uncertain.context.close();
  const employee = await pageFor(f.emp, 390);
  await employee.p.waitForFunction(
    () => !location.hash.startsWith("#/finance"),
  );
  assert.equal(employee.calls.length, 0);
  assert.equal(
    await employee.p.locator("[data-nav=finance]").isVisible(),
    false,
  );
  assert.deepEqual(employee.errors, []);
  await employee.context.close();
  const unknown = await pageFor(
    f.mgr,
    1440,
    "#/finance?from=2026-11-09&to=2026-11-09&branch=unknown",
  );
  await unknown.p.locator("#view-finance [data-flow] [role=alert]").waitFor();
  assert.equal(
    await unknown.p.locator("#view-finance [data-profit]").isDisabled(),
    true,
  );
  assert.equal(
    unknown.calls.filter((c) => c.includes("/finance/cashflow")).length,
    0,
  );
  await unknown.context.close();
  await writeFile(out + "/results.json", JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
  server.close();
  await f.client.close();
}
