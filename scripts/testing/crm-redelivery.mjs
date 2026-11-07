/** Real local router/PGlite: staff request/receive, Manager approve/refund. No production or external calls. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { setupCrmReturns } from "../../tests/helpers/crm-return-fixture.ts";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const f = await setupCrmReturns(),
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
  out = "/workspace/artifacts/crm-return-redelivery-20261107",
  results = [];
await mkdir(out, { recursive: true });
async function pageFor(width, cookie, id) {
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
  const user = f.ok(await f.call("/me", cookie)).user;
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
  await page.goto(origin + "/#/orders/" + id);
  await page.locator("[data-crm-returns]").waitFor();
  await page.locator("[data-crm-returns]").click();
  await page.locator(".pos-return-modal[open] form").waitFor();
  return { page, context, errors };
}
try {
  for (const width of [390, 1440]) {
    const id = "browser-redelivery-" + width;
    await f.seed(id);
    const before = f.ok(await f.call("/orders/" + id, f.mgr));
    const mgr = await pageFor(width, f.mgr, id),
      p = mgr.page,
      dlg = p.locator(".pos-return-modal[open]");
    assert.equal(
      await dlg.getByLabel("Mục đích nhận hàng").inputValue(),
      "redelivery",
    );
    await dlg
      .locator(".pos-return-line")
      .filter({ hasText: "22566" })
      .locator("input[type=number]")
      .fill("2");
    await dlg.getByLabel("Kho thực nhận").selectOption("pos-wh");
    await dlg
      .getByLabel("Lý do trả hàng")
      .fill("Nhận về để giao lại, giữ tiền trên hợp đồng");
    await dlg
      .getByRole("button", { name: "Gửi yêu cầu trả hàng", exact: true })
      .click();
    await dlg
      .getByRole("button", { name: "Duyệt phiếu trả", exact: true })
      .click();
    await dlg.getByRole("button", { name: "Duyệt", exact: true }).click();
    await dlg
      .getByRole("button", { name: "Nhận hàng trả về kho", exact: true })
      .click();
    await dlg
      .getByText("Giữ nguyên tiền đã thu và công nợ.", { exact: false })
      .waitFor();
    await dlg
      .getByRole("button", { name: "Đã nhận đủ hàng", exact: true })
      .click();
    await dlg
      .getByText("Nhận để giao lại — không giảm công nợ, không hoàn tiền", {
        exact: true,
      })
      .waitFor();
    assert.equal(
      await dlg.getByRole("button", { name: "Hoàn tiền", exact: true }).count(),
      0,
    );
    const done = f.ok(await f.call("/orders/" + id, f.mgr));
    assert.equal(done.receivable.balance, before.receivable.balance);
    assert.equal(done.lines[1].deliveredQty, 0);
    assert.equal(done.lines[1].historicalDeliveredQty, 2);
    assert.equal(
      await dlg.evaluate((n) => n.scrollWidth > n.clientWidth + 1),
      false,
    );
    await p.screenshot({ path: out + "/redelivery-" + width + ".png" });
    await mgr.context.close();
    const legacy = "browser-legacy-" + width;
    await f.seed(legacy);
    const r = (
      await f.create(legacy, [
        { orderLineId: legacy + "-b", qty: 2, disposition: "restock" },
      ])
    ).data;
    await f.receive(legacy, r.id);
    const old = await pageFor(width, f.mgr, legacy),
      op = old.page,
      od = op.locator(".pos-return-modal[open]");
    await od
      .getByRole("button", {
        name: "Chuyển sang nhận để giao lại",
        exact: true,
      })
      .click();
    await od
      .getByRole("button", {
        name: "Xác nhận chuyển sang giao lại",
        exact: true,
      })
      .click();
    await od
      .getByText("Nhận để giao lại — không giảm công nợ, không hoàn tiền", {
        exact: true,
      })
      .waitFor();
    assert.equal(
      f.ok(await f.call("/orders/" + legacy, f.mgr)).receivable.balance,
      2186125,
    );
    await od.getByRole("button", { name: "Đóng", exact: true }).click();
    await op.locator("[data-crm-returns]").waitFor();
    await op.screenshot({ path: out + "/legacy-corrected-" + width + ".png" });
    assert.deepEqual([...mgr.errors, ...old.errors], []);
    results.push({
      width,
      defaultLogistics: true,
      noAutomaticCredit: true,
      noRefundButton: true,
      legacyRestored: true,
      historicalDeliveriesPreserved: true,
      noOverflow: true,
    });
    await old.context.close();
  }
  console.log(JSON.stringify(results));
} finally {
  await writeFile(out + "/results.json", JSON.stringify(results, null, 2));
  await browser.close();
  server.close();
  await f.client.close();
}
