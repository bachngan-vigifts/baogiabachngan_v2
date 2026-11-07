/** Full shift-report page: filters, totals, paging, details, retries and store permissions. No production or external calls. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { setupShiftReports } from "../../tests/helpers/shift-report-fixture.ts";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const f = await setupShiftReports(),
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
  out = "/workspace/artifacts/shift-reports-page-20261107",
  results = [];
await mkdir(out, { recursive: true });
async function pageFor(
  cookie,
  width,
  hash = "#/shift-reports?from=2026-11-01&to=2026-11-30",
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
      localStorage.setItem("bn-api-region-manual-off", "1"); // Local fixture has no Edge region headers.
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
  await page.goto(origin + "/" + hash);
  return { page, context, errors };
}
try {
  for (let i = 0; i < 55; i++)
    await f.closed(
      "browser-" + String(i).padStart(2, "0"),
      1000,
      "emp",
      i === 0 ? -50 : 0,
    );
  await f.closed("browser-other", 2000, "cashier2");
  await f.open();
  for (const width of [390, 1440]) {
    const { page: p, context, errors } = await pageFor(f.mgr, width);
    await p.locator(".srp-stats").waitFor();
    assert.equal(
      await p.locator(".srp-stat").first().locator("strong").textContent(),
      "57",
    );
    assert.equal(await p.locator(".srp-shifts tbody tr").count(), 25);
    const summary = await p.locator(".srp-stats").innerText();
    await p.getByRole("button", { name: "Sau →", exact: true }).click();
    await p.waitForURL("**page=2");
    await p.locator(".srp-stats").waitFor();
    assert.equal(await p.locator(".srp-stats").innerText(), summary);
    await p
      .locator("#view-shift-reports")
      .getByLabel("Tổng hợp theo", { exact: true })
      .selectOption("member");
    await p.locator(".srp-groups tbody tr").nth(1).waitFor();
    await p
      .locator("#view-shift-reports")
      .getByLabel("Trạng thái", { exact: true })
      .selectOption("closed");
    await p
      .locator("#view-shift-reports")
      .getByLabel("Đối chiếu tiền mặt", { exact: true })
      .selectOption("shortage");
    await p.getByRole("button", { name: "Xem báo cáo", exact: true }).click();
    await p.locator(".srp-shifts tbody tr").waitFor();
    assert.equal(await p.locator(".srp-shifts tbody tr").count(), 1);
    assert.equal(
      await p.locator(".srp-stat").first().locator("strong").textContent(),
      "1",
    );
    await p.screenshot({
      path: out + "/filtered-" + width + ".png",
      fullPage: true,
    });
    await p.getByRole("button", { name: "Xem ca", exact: true }).click();
    await p.locator(".srp-detail .sr-card").first().waitFor();
    assert.equal(
      await p.locator("dialog[open]").count(),
      0,
      "detail is a full page",
    );
    await p.screenshot({
      path: out + "/detail-" + width + ".png",
      fullPage: true,
    });
    await p.reload();
    await p.locator(".srp-detail .sr-card").first().waitFor();
    await p
      .getByRole("button", { name: "← Danh sách ca", exact: true })
      .click();
    await p.locator(".srp-shifts tbody tr").waitFor();
    assert.equal(
      await p
        .locator("#view-shift-reports")
        .getByLabel("Đối chiếu tiền mặt", { exact: true })
        .inputValue(),
      "shortage",
    );
    await p.getByRole("button", { name: "Xóa bộ lọc", exact: true }).click();
    await p.locator(".srp-stats").waitFor();
    assert.equal(
      await p.locator(".srp-stat").first().locator("strong").textContent(),
      "57",
    );
    assert.equal(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await p
      .locator("#view-shift-reports")
      .getByLabel("Tìm trong báo cáo ca", { exact: true })
      .fill("unapplied-draft");
    await p.getByRole("button", { name: "Xóa bộ lọc", exact: true }).click();
    await p.locator(".srp-stats").waitFor();
    assert.equal(
      await p
        .locator("#view-shift-reports")
        .getByLabel("Tìm trong báo cáo ca", { exact: true })
        .inputValue(),
      "",
    );
    await p.screenshot({
      path: out + "/overview-" + width + ".png",
      fullPage: true,
    });
    await p.screenshot({ path: out + "/overview-top-" + width + ".png" });
    if (width === 390) {
      await p.goto(origin + "/#/tasks");
      await p.locator('.crm-mobile-nav [data-mobile-nav-group="work"]').click();
      await p
        .locator('.crm-nav-sheet[open] [data-mobile-nav="shift-reports"]')
        .click();
      await p.locator(".srp-stats").waitFor();
      assert.equal(await p.locator("dialog[open]").count(), 0);
    }
    assert.deepEqual(errors, []);
    results.push({
      width,
      filters: true,
      summaryAcrossPages: true,
      fullPageDetail: true,
      reload: true,
      noOverflow: true,
    });
    await context.close();
  }
  const own = await pageFor(f.emp, 390);
  await own.page.locator(".srp-stats").waitFor();
  assert.equal(
    await own.page.locator(".srp-stat").first().locator("strong").textContent(),
    "56",
  );
  assert.equal(
    await own.page
      .locator("#view-shift-reports")
      .getByLabel("Nhân viên mở ca", { exact: true })
      .locator("option")
      .count(),
    2,
  );
  await own.page.goto(origin + "/#/pos");
  await own.page.locator(".pos-product-tile .pos-product").first().click();
  assert.equal(
    await own.page.locator(".pos-cart-count").textContent(),
    "1 món",
  );
  await own.page.locator(".pos-more-menu summary").click();
  await own.page
    .getByRole("button", { name: "Báo cáo ca", exact: true })
    .click();
  await own.page.locator(".srp-stats").waitFor();
  assert.equal(await own.page.locator("dialog[open]").count(), 0);
  await own.page.goto(origin + "/#/pos");
  await own.page.locator(".pos-product-tile .pos-product").first().waitFor();
  assert.equal(
    await own.page.locator(".pos-cart-count").textContent(),
    "1 món",
  );
  results.push({ posEntryOpensPage: true, cartPreserved: true });
  await own.page.goto(origin + "/#/shift-reports?shiftId=browser-other");
  await own.page.locator(".srp-error").waitFor();
  assert.match(
    await own.page.locator(".srp-error").innerText(),
    /Không tìm thấy ca/,
  );
  assert.deepEqual(own.errors, []);
  await own.context.close();
  results.push({ ownerScope: true, foreignDetailDenied: true });
  const retry = await pageFor(f.mgr, 390);
  await retry.page.locator(".srp-stats").waitFor();
  let fail = true;
  await retry.page.route("**/api/staff/pos/shift-reports?*", (r) =>
    fail
      ? r.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({ error: "Lỗi tải thử nghiệm" }),
        })
      : r.continue(),
  );
  await retry.page
    .getByRole("button", { name: "Làm mới", exact: true })
    .click();
  await retry.page.locator(".srp-error").waitFor();
  assert.equal(
    await retry.page.locator(".srp-stats").count(),
    0,
    "do not show stale totals after failure",
  );
  fail = false;
  await retry.page
    .getByRole("button", { name: "Thử lại", exact: true })
    .click();
  await retry.page.locator(".srp-stats").waitFor();
  await retry.page
    .locator("#view-shift-reports")
    .getByLabel("Tìm trong báo cáo ca", { exact: true })
    .fill("khong-co-ca-nay");
  await retry.page
    .getByRole("button", { name: "Xem báo cáo", exact: true })
    .click();
  await retry.page
    .getByText("Không có ca phù hợp bộ lọc.", { exact: true })
    .waitFor();
  assert.equal(
    await retry.page
      .locator(".srp-stat")
      .first()
      .locator("strong")
      .textContent(),
    "0",
  );
  assert.deepEqual(retry.errors, []);
  await retry.context.close();
  results.push({ errorRetry: true, noStaleTotals: true, empty: true });
  console.log(JSON.stringify(results));
} finally {
  await writeFile(out + "/results.json", JSON.stringify(results, null, 2));
  await browser.close();
  server.close();
  await f.client.close();
}
