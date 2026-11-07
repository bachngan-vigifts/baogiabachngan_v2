/** Real customer-center flows against synthetic PGlite only; no production requests. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { customerCenterFixture } from "../../tests/helpers/customer-center-fixture.ts";
const { chromium } = await import(
    process.env.PLAYWRIGHT_MODULE || "playwright"
  ),
  f = await customerCenterFixture();
await f.addCustomer("returning", "emp");
await f.order("period-purchase", "returning");
await f.addCustomer("recent", "emp");
await f.order("recent-purchase", "recent", f.today);
const root = fileURLToPath(new URL("../../trial-ui/", import.meta.url)),
  out =
    process.env.CUSTOMER_CENTER_SCREENSHOTS || "/tmp/customer-center-browser",
  writes = [];
await mkdir(out, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://localhost");
    if (u.pathname.startsWith("/api/staff/")) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      if (req.method !== "GET")
        writes.push({ path: u.pathname, method: req.method });
      const token = req.headers.authorization?.replace(/^Bearer /, "");
      const r = await f.call(
        u.pathname.slice(10) + u.search,
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
    let bytes = await readFile(root + path);
    if (path.endsWith(".html"))
      bytes = Buffer.from(
        bytes
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
    res.end(bytes);
  } catch (e) {
    res.writeHead(404).end(e.message);
  }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const origin = "http://127.0.0.1:" + server.address().port,
  browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  }),
  results = [],
  user = (await f.call("/me", f.mgr)).data.user;
try {
  for (const width of [1440, 390]) {
    const made = await f.call("/care", f.mgr, "POST", {
      customerId: "returning",
      ownerId: "emp",
      contactName: "Liên hệ kiểm thử",
      type: "call",
      result: "consulting",
      content: "Nhắc việc " + width,
      nextAt: f.today,
      remindBefore: "1d",
      completion: "not_completed",
    });
    assert.equal(made.status, 201, JSON.stringify(made.data));
    const activity = made.data.activity;
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
    await context.addInitScript(
      ({ user, token }) => {
        localStorage.setItem("bn-v2-session", token);
        localStorage.setItem(
          "bn-v2-session-profile",
          JSON.stringify({ session: token, user }),
        );
      },
      { user, token: f.mgr.split("=")[1] },
    );
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let linkFailure = width === 1440;
    await page.route(
      "**/customers/center/campaigns/*/targets/*/activity",
      async (route) => {
        if (linkFailure) {
          linkFailure = false;
          return route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "Gián đoạn thử nghiệm" }),
          });
        }
        return route.continue();
      },
    );
    await page.goto(origin + "/#/quotes");
    await page.locator("#view-quotes").waitFor();
    if (width > 850) {
      await page.locator("#nav-group-2 .nav-group-toggle").click();
      await page.locator(".sidebar [data-nav=customers]").click();
    } else {
      await page
        .locator(".crm-mobile-nav [data-mobile-nav-group=customers]")
        .click();
      await page.locator(".crm-nav-sheet [data-mobile-nav=customers]").click();
    }
    await page.waitForURL((url) => url.hash === "#/customers");
    await page.locator("#customer-directory").waitFor();
    assert.equal(await page.locator("#customer-center").isVisible(), false);
    await page.locator("[data-customer-tab=center]").click();
    const center = page.locator("#customer-center");
    await center.locator('[data-center-done="' + activity.id + '"]').waitFor();
    assert.equal(await page.locator("#view-quotes").isVisible(), false);
    assert.equal(await page.title(), "Trung tâm khách hàng · Bách Ngân");
    assert.equal(
      await center.locator("[data-center-opportunity=returning]").count(),
      1,
    );
    assert.ok(!(await center.innerText()).includes("minh họa"));
    assert.equal(
      await center.locator("[data-center-days]").inputValue(),
      "180",
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.screenshot({ path: out + "/" + width + "-center.png" });
    await center.locator("[data-center-search]").fill("khongcokhach");
    await page.waitForTimeout(600);
    await center
      .getByText("Chưa có khách phù hợp từ lịch sử đơn trên CRM.", {
        exact: true,
      })
      .waitFor();
    await center.locator("[data-center-search]").fill("");
    await center.locator("[data-center-opportunity=returning]").waitFor();
    await center.locator("[data-center-section=dormant]").last().click();
    await center.locator("[data-center-opportunity=returning]").waitFor();
    assert.equal(
      await center.locator("[data-center-opportunity=recent]").count(),
      0,
    );
    await center.locator("[data-center-section=campaign]").last().click();
    await center.locator("[data-campaign-new]").click();
    let dlg = page.locator(".center-campaign-dialog");
    await dlg.locator("[name=name]").fill("Chiến dịch kiểm thử " + width);
    await dlg.locator("[name=assigneeId]").selectOption("emp");
    await dlg.locator("[data-pick=returning]").check();
    await dlg.locator("[data-save]").click();
    await dlg.waitFor({ state: "detached" });
    await center.locator("[data-campaign-record]").waitFor();
    await center.locator("[data-campaign-record]").click();
    const care = page.locator(".care-dialog");
    await care.waitFor();
    assert.equal(await care.locator("[name=ownerId]").inputValue(), "emp");
    await care
      .locator("[name=content]")
      .fill("Đã gọi xác nhận nhu cầu " + width);
    await care.locator("[name=completion]").selectOption("completed");
    await page.waitForFunction(
      () =>
        document.querySelector(".care-dialog [name=contactChoice]")?.options
          .length > 0,
    );
    const contact = care.locator("[name=contactChoice]"),
      choices = await contact
        .locator("option")
        .evaluateAll((options) =>
          options.map((o) => ({ value: o.value, disabled: o.disabled })),
        );
    const choice = choices.find((o) => o.value && !o.disabled);
    if (choice) await contact.selectOption(choice.value);
    if (await care.locator("[name=contactName]").isVisible())
      await care.locator("[name=contactName]").fill("Chị Liên kiểm thử");
    await care.locator("[data-save]").click();
    await care.waitFor({ state: "detached" });
    if (width === 1440) {
      const recovery = page.locator(".center-campaign-dialog");
      await recovery.waitFor();
      assert.notEqual(
        await recovery.locator("[name=activityId]").inputValue(),
        "",
      );
      await recovery.locator("[data-save]").click();
      await recovery.waitFor({ state: "detached" });
    }
    await center.getByText("Đã kết nối", { exact: true }).waitFor();
    assert.ok(
      writes.some((w) => w.path.endsWith("/activity") && w.method === "PUT"),
    );
    await page.screenshot({ path: out + "/" + width + "-campaign.png" });
    await center.locator("[data-campaign-link]").click();
    dlg = page.locator(".center-campaign-dialog");
    await dlg.locator("[name=activityId]").selectOption({ index: 1 });
    await dlg.locator("[data-save]").click();
    await dlg.waitFor({ state: "detached" });
    await center.locator("[data-center-section=calendar]").last().click();
    await center.locator('[data-center-done="' + activity.id + '"]').click();
    await page.waitForFunction(
      (id) =>
        document.querySelector('[data-center-done="' + id + '"]')
          ?.textContent === "Đã hoàn tất",
      activity.id,
    );
    assert.ok(
      (await f.call("/care/" + activity.id, f.mgr)).data.activity.nextDoneAt,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.locator("[data-customer-tab=list]").click();
    await page.locator("#customer-directory").waitFor();
    await page.locator("#new-customer").click();
    await page.locator("#customer-dialog").waitFor();
    await page.locator("#customer-dialog [data-close]").first().click();
    assert.deepEqual(errors, []);
    results.push({
      width,
      defaultDirectory: true,
      realPurchaseQueries: true,
      dormant180: true,
      noSamples: true,
      campaignCreated: true,
      realCareLinked: true,
      linkRetry: true,
      donePersisted: true,
      noOverflow: true,
      directoryPreserved: true,
    });
    await context.close();
  }
  await writeFile(out + "/results.json", JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  await f.client.close();
}
