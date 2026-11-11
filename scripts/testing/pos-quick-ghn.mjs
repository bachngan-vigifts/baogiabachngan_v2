/** Quick GHN action: real CRM/router, synthetic orders, no external browser requests. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { setup } from "../../tests/helpers/pos-fixture.ts";
import {
  posRegisters,
  webStoreOrders,
} from "../../src/modules/sales/pos-schema.ts";
import { customerPayments } from "../../src/modules/sales/schema.ts";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const f = await setup(),
  root = fileURLToPath(new URL("../../trial-ui/", import.meta.url)),
  out = process.env.BROWSER_EVIDENCE_DIR || "/tmp/pos-quick-ghn",
  requests = [],
  bridge = [];
await mkdir(out, { recursive: true });
await f.db
  .update(posRegisters)
  .set({ name: "CỬA HÀNG LOCKNLOCK CẦN THƠ" })
  .where(eq(posRegisters.id, f.registerId));
const ml = await f.call("/pos/registers", f.mgr, "POST", {
  name: "Showroom Minh Long thử",
  warehouseId: "pos-wh",
  pricePolicyId: "retail-vat",
  secondPricePolicyId: "retail",
});
assert.equal(ml.status, 200);
f.env.ghnMlToken = "synthetic-only";
f.env.ghnMlShopId = "123";
f.env.ghnFetch = async (url) => {
  const path = new URL(url).pathname;
  assert.ok(
    path.includes("/master-data/"),
    "this fixture only permits carrier address reads",
  );
  return Response.json({
    code: 200,
    data: path.endsWith("/district")
      ? [{ DistrictID: 1572, DistrictName: "Quận Ninh Kiều" }]
      : path.endsWith("/ward")
        ? [{ WardCode: "550104", WardName: "Phường An Hội" }]
        : [{ ProvinceID: 220, ProvinceName: "Cần Thơ" }],
  });
};
f.env.webOrderAction = {
  token: "synthetic-bridge",
  lockUrl: "https://bridge.test/action",
  minhlongUrl: "",
  fetch: async (url, init) => {
    const body = JSON.parse(init.body);
    bridge.push(body);
    assert.equal(body.action, "confirm");
    await new Promise((r) => setTimeout(r, 150));
    return Response.json({
      status: "processing",
      ghnOrderCode: "GYQUICK8",
      ghnStatus: "ready_to_pick",
      ghnFee: 33000,
    });
  },
};
for (const source of ["lock", "minhlong"])
  for (const [suffix, status, code, carrier] of [
    ["pending", "pending", "", ""],
    ["existing", "processing", "GYEXIST", "ready_to_pick"],
    ["complete", "completed", "GYDONE", "delivered"],
    ["cancel", "cancelled", "", ""],
  ]) {
    await f.db.insert(webStoreOrders).values({
      id: source + "-" + suffix,
      source,
      externalId: source + "-" + suffix,
      registerId: source === "lock" ? f.registerId : ml.data.id,
      orderNo: (source === "lock" ? "21662" : "ML21662") + "-" + suffix,
      customerName: "Khách kiểm thử " + source,
      phone: "0900000000",
      address: "123 Nguyễn Trãi",
      total: 108000,
      currency: "VND",
      status,
      ghnOrderCode: code,
      ghnStatus: carrier,
      lines: JSON.stringify([
        {
          sku: "00123",
          name: "Ly sứ",
          quantity: 1,
          total: "100000",
          total_tax: "8000",
        },
      ]),
      ghnAddressSnapshot: JSON.stringify({
        addressLine: "123 Nguyễn Trãi",
        provinceId: 220,
        provinceName: "Cần Thơ",
        districtId: 1572,
        districtName: "Quận Ninh Kiều",
        wardCode: "550104",
        wardName: "Phường An Hội",
      }),
      orderedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://localhost");
    if (u.pathname.startsWith("/api/staff/")) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      requests.push({
        path: u.pathname,
        method: req.method,
        body: chunks.length
          ? JSON.parse(Buffer.concat(chunks).toString())
          : undefined,
      });
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
  await p.goto(origin + "/#/pos");
  await p.locator("#workspace").waitFor({ state: "visible" });
  return { context, p, errors };
}

async function boardFor(cookie, width, source) {
  const c = await contextFor(cookie, width);
  const board = c.p.locator(".pos-order-board");
  await board.locator(".pos-order-row").first().waitFor();
  if (source === "minhlong") {
    await board
      .getByRole("combobox", { name: "Lọc đơn theo cửa hàng" })
      .selectOption(ml.data.id);
    await c.p.waitForFunction(() =>
      document
        .querySelector(".pos-order-list")
        ?.textContent.includes("ML21662"),
    );
  }
  await c.p.waitForFunction(
    () =>
      document.querySelector(".pos-order-board")?.getAttribute("aria-busy") ===
      "false",
  );
  return { ...c, board };
}
try {
  for (const width of [1378, 390])
    for (const source of ["lock", "minhlong"]) {
      const c = await boardFor(f.mgr, width, source),
        p = c.p,
        board = c.board,
        id = source + "-pending";
      const row = board.locator(".pos-order-row").filter({
          hasText: (source === "lock" ? "21662" : "ML21662") + "-pending",
        }),
        quick = row.getByRole("button", {
          name:
            "Xử lý GHN đơn " +
            (source === "lock" ? "21662" : "ML21662") +
            "-pending",
          exact: true,
        });
      assert.equal(
        await board.locator(".pos-order-quick-ghn").count(),
        1,
        "existing/completed/cancelled orders never get a create shortcut",
      );
      await row.scrollIntoViewIfNeeded();
      await row.click({ position: { x: 20, y: 20 } });
      await p.waitForURL("**/#/orders/" + encodeURIComponent("web:" + id));
      assert.equal(await p.locator(".pos-step-modal[open]").count(), 0);
      await p.evaluate(() => {
        location.hash = "#/pos";
      });
      await board.locator(".pos-order-row").first().waitFor();
      if (
        source === "minhlong" &&
        !(await board.textContent()).includes("ML21662")
      ) {
        await board
          .getByRole("combobox", { name: "Lọc đơn theo cửa hàng" })
          .selectOption(ml.data.id);
        await p.waitForFunction(() =>
          document
            .querySelector(".pos-order-list")
            ?.textContent.includes("ML21662"),
        );
      }
      await p.waitForFunction(
        () =>
          document
            .querySelector(".pos-order-board")
            ?.getAttribute("aria-busy") === "false",
      );
      for (const key of ["Enter", " "]) {
        const before = requests.length;
        await quick.focus();
        await quick.press(key);
        const form = p.locator(".pos-step-modal[open]");
        await form.waitFor();
        assert.equal(new URL(p.url()).hash, "#/pos");
        assert.ok(
          (await form.textContent()).includes(
            (source === "lock" ? "21662" : "ML21662") + "-pending",
          ),
        );
        await p.waitForFunction(() =>
          [...document.querySelectorAll(".pos-step-modal[open] select")].some(
            (s) => s.value === "550104",
          ),
        );
        assert.equal(
          requests
            .slice(before)
            .some((r) => r.path.startsWith("/api/staff/orders/")),
          false,
          "shortcut does not load the heavy order detail",
        );
        assert.equal(bridge.length, 0, "opening does not create GHN");
        await p.screenshot({
          path:
            out +
            "/" +
            source +
            "-" +
            width +
            "-" +
            (key === " " ? "space" : "enter") +
            ".png",
          fullPage: true,
        });
        await form
          .locator(".pos-step-footer")
          .getByRole("button", { name: "Đóng", exact: true })
          .click();
        await form.waitFor({ state: "detached" });
        await p.waitForFunction(
          (label) => {
            const b = [
              ...document.querySelectorAll(".pos-order-quick-ghn"),
            ].find((b) => b.getAttribute("aria-label") === label);
            return b && !b.disabled;
          },
          await quick.getAttribute("aria-label"),
        );
      }
      await quick.evaluate((b) => {
        b.click();
        b.click();
      });
      assert.equal(await p.locator(".pos-step-modal[open]").count(), 1);
      await p
        .locator(".pos-step-modal[open] .pos-step-footer")
        .getByRole("button", { name: "Đóng", exact: true })
        .click();
      assert.deepEqual(c.errors, []);
      results.push({
        source,
        width,
        rowOpensCrm: true,
        quickOpensOnlyGhn: true,
        keyboard: true,
        noDetailFetch: true,
        noCreateOnOpen: true,
        noDuplicatePopup: true,
      });
      await c.context.close();
    }
  const c = await boardFor(f.mgr, 1378, "lock"),
    p = c.p,
    row = c.board
      .locator(".pos-order-row")
      .filter({ hasText: "21662-pending" }),
    quick = row.locator(".pos-order-quick-ghn");
  const paymentCount = (await f.db.select().from(customerPayments)).length;
  await quick.click();
  const form = p.locator(".pos-step-modal[open]");
  await form.waitFor();
  await p.waitForFunction(() =>
    [...document.querySelectorAll(".pos-step-modal[open] select")].some(
      (s) => s.value === "550104",
    ),
  );
  await form.getByRole("button", { name: "Kiểm tra lại", exact: true }).click();
  assert.equal(bridge.length, 0, "review does not create a shipment");
  await form
    .getByRole("button", { name: "Xác nhận & tạo vận đơn GHN", exact: true })
    .evaluate((b) => {
      b.click();
      b.click();
    });
  await p
    .getByRole("heading", { name: "Đã tạo vận đơn GHN", exact: true })
    .waitFor();
  assert.equal(bridge.length, 1);
  assert.equal(new URL(p.url()).hash, "#/pos");
  const [saved] = await f.db
    .select()
    .from(webStoreOrders)
    .where(eq(webStoreOrders.id, "lock-pending"));
  assert.equal(saved.ghnOrderCode, "GYQUICK8");
  assert.equal(
    (await f.db.select().from(customerPayments)).length,
    paymentCount,
    "shipping must not write a payment",
  );
  assert.deepEqual(c.errors, []);
  results.push({
    case: "real action endpoint: explicit review, double-submit creates once, no receipt written",
    pass: true,
  });
  await c.context.close();
  await writeFile(out + "/results.json", JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  await f.client.close();
}
