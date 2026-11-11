/** Shared mobile layout audit: production CSS, real mobile annotator, synthetic long entity names. No production/API access. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { mobileProfilesP1 } from "../../trial-ui/mobile-profiles-p1.js";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const root = fileURLToPath(new URL("../../trial-ui/", import.meta.url)),
  out = process.env.BROWSER_EVIDENCE_DIR || "/tmp/mobile-name-layout",
  baseline = process.argv.includes("--baseline");
await mkdir(out, { recursive: true });
const company =
    "CÔNG TY TNHH SẢN XUẤT THƯƠNG MẠI DỊCH VỤ KIỂM THỬ TÊN KHÁCH HÀNG TRÊN ĐIỆN THOẠI",
  amount = "1.234.567.890.123 đ";
const actions =
  '<div class="row-actions"><button type="button" class="btn secondary small">Xem / Tải hồ sơ</button><button type="button" class="btn ghost small">Phiếu ĐG</button><button type="button" class="btn ghost small">Phiếu GH</button></div>';
const cases = [];
for (const p of mobileProfilesP1.filter((p) => p.card)) {
  const n = Math.max(...Object.values(p.card)) + 2,
    cells = Array.from({ length: n }, () => "<td>—</td>");
  for (const [role, index] of Object.entries(p.card)) {
    const value =
      role === "title"
        ? "<strong data-entity-name>" + company + "</strong>"
        : role === "meta"
          ? "11-05/09112026/HĐKT/VG-LAYOUT"
          : role === "amount"
            ? "<b data-money>" + amount + "</b>"
            : role === "status"
              ? '<span class="pill ok">Đã duyệt</span>'
              : role === "substatus"
                ? '<span class="pill warn">Chờ đặt cọc</span><small>Cọc 0 đ / ' +
                  amount +
                  "</small>"
                : role === "owner"
                  ? "VIGIFTS · Nhân viên kiểm thử"
                  : role === "note"
                    ? "Địa chỉ, nội dung giao dịch dài cần đọc đầy đủ"
                    : "Thông tin phụ";
    cells[index] =
      "<td" +
      (p.root === "#view-customers" && role === "title"
        ? ' class="first"'
        : "") +
      ">" +
      value +
      "</td>";
  }
  cells[n - 1] = '<td class="actions-cell">' + actions + "</td>";
  if (p.root === "#view-orders")
    cells[5] =
      '<td class="orders-shipping-cell has-ghn-tracking"><span class="ghn-order-tracking">GHN: TEST-TRACK · Đang giao hàng</span></td>';
  const tbody =
    p.root === "#view-care"
      ? "<tbody data-list>"
      : '<tbody id="' + p.rows.match(/#([^ >]+)/)[1] + '">';
  cases.push({
    name: p.root.slice(6) + "-cards",
    root: p.root,
    profile: p,
    html:
      '<div class="table-wrap"><table class="data-table"><thead><tr><th>Khách hàng</th></tr></thead>' +
      tbody +
      "<tr>" +
      cells.join("") +
      "</tr></tbody></table></div>",
    kind: "card",
  });
}
for (const name of [
  "deliveries",
  "packing",
  "receivables",
  "cashbook",
  "purchases",
  "receiving",
  "suppliers",
])
  cases.push({
    name: name + "-table",
    root: "#view-" + name,
    html:
      '<div class="table-wrap"><table class="data-table"><thead><tr><th>Mã</th><th>Khách</th></tr></thead><tbody><tr><td>DOC-LAYOUT</td><td><strong data-entity-name>' +
      company +
      "</strong></td><td><b data-money>" +
      amount +
      "</b></td><td>Chờ xử lý</td><td>" +
      actions +
      "</td></tr></tbody></table></div>",
    kind: "simple",
  });
for (const name of [
  "order-detail",
  "contract-detail",
  "customer-detail",
  "supplier-detail",
])
  cases.push({
    name,
    root: "#view-" + (name.includes("contract") ? "order" : name.split("-")[0]),
    html:
      '<section class="card"><dl class="kv"><dt>Tên khách hàng / công ty</dt><dd data-entity-name>' +
      company +
      "</dd><dt>Giá trị / còn phải thu</dt><dd><b data-money>" +
      amount +
      "</b></dd><dt>Điều khoản thanh toán và giao hàng</dt><dd>Thanh toán khi nhận đủ hàng theo hợp đồng</dd></dl></section>",
    kind: "kv",
  });
for (const name of [
  "approve-contract",
  "approve-order",
  "approve-quote",
  "payment-confirm",
  "delivery-confirm",
  "supplier-payment",
])
  cases.push({
    name,
    root: "#view-test",
    dialog: true,
    html:
      '<dialog class="modal verify-dialog"><form><div class="modal-head"><h2>Kiểm tra trước khi xác nhận</h2></div><div class="modal-body"><dl class="kv verify-summary"><dt>Khách hàng / công ty</dt><dd data-entity-name>' +
      company +
      "</dd><dt>Đơn / HĐKT</dt><dd>11-05/09112026/HĐKT/VG-LAYOUT</dd><dt>Số tiền cần xác nhận</dt><dd><b data-money>" +
      amount +
      '</b></dd></dl><label><input type="checkbox">Đã kiểm tra thông tin</label></div><div class="modal-foot"><button type="button" class="btn secondary">Quay lại kiểm tra</button><button type="button" class="btn primary">Xác nhận</button></div></form></dialog>',
    kind: "kv",
  });
cases.push({
  name: "product-picker",
  root: "#view-test",
  dialog: true,
  html:
    '<dialog class="modal" id="picker-dialog"><div class="modal-head"><h2>Chọn sản phẩm</h2></div><div class="modal-body"><ul class="picker-list"><li><span class="thumb">Ảnh</span><span class="prod-text"><strong data-entity-name>BỘ TRÀ SỨ KIỂM THỬ SẢN PHẨM CÓ TÊN DÀI VÀ HOẠ TIẾT NHIỀU CHỮ</strong><small>MÃ-SẢN-PHẨM</small></span><span class="price" data-money>' +
    amount +
    '</span><input type="number" value="1" aria-label="Số lượng"><button type="button" class="btn pick-add">Thêm vào báo giá</button></li></ul></div></dialog>',
  kind: "picker",
});
cases.push({
  name: "quote-picker",
  root: "#view-test",
  dialog: true,
  html:
    '<dialog class="modal"><div class="modal-head"><h2>Chọn báo giá</h2></div><div class="modal-body"><ul class="pick-list"><li><button type="button"><b>HRC_BG_001_09112026</b><span data-entity-name>' +
    company +
    "</span><small>" +
    amount +
    "</small></button></li></ul></div></dialog>",
  kind: "pick-list",
});
cases.push({
  name: "task-row",
  root: "#view-tasks",
  html:
    '<div id="tasks-view"></div><div id="tasks-list" class="task-list"><div class="task-row"><span class="task-check"><input type="checkbox" aria-label="Hoàn thành"></span><div class="task-main"><div class="task-title" data-entity-name>Giao hàng cho ' +
    company +
    '</div><div class="task-meta">Giao hàng · Tự động</div></div><div class="task-people">Nhân viên kiểm thử</div><div class="task-due">09/11/2026<br>Quá hạn 15 ngày</div></div></div>',
  kind: "task",
});
cases.push({
  name: "payment-summary",
  root: "#view-order",
  html:
    '<section class="card"><div class="pay-summary"><span data-entity-name>Còn phải thu sau khi xác nhận giao hàng</span><b data-money>' +
    amount +
    "</b></div></section>",
  kind: "summary",
});

// Actual shared product structures; stock columns remain a horizontally scrollable table.
const productName =
  "Bộ trà Hoàng Cung 0.65 L – Hoa văn trang trí vành vàng – Bộ sản phẩm phiên bản kiểm thử tên dài có đầy đủ phụ kiện";
for (const supplier of [false, true]) {
  const headers = [
    "Sản phẩm",
    "Cần",
    "Tồn kho",
    "Hàng đang giữ",
    "Khả dụng cho báo giá",
    ...(supplier ? ["Kho NCC"] : []),
    "Hàng chờ về",
    "Kết quả",
  ];
  const values = [
    "100.000",
    "250.000",
    '70<small><a href="#/contracts/test">11-05/09112026/HĐKT/VG-LAYOUT</a></small>',
    "249.930",
    ...(supplier ? ["123.456"] : []),
    "10<small>DMH-KIEM-THU · Nhà cung cấp</small>",
    '<span class="pill ok">Đủ</span>',
  ];
  cases.push({
    name: "quote-stock-" + (supplier ? "supplier" : "physical"),
    root: "#view-editor",
    dialog: true,
    kind: "stock-table",
    html:
      '<dialog id="stock-check-dialog" class="modal wide"><div class="modal-head"><h2>Kiểm tồn báo giá</h2></div><div class="modal-body"><div id="stock-check-body"><div class="table-wrap"><table class="data-table stock-check-table"><thead><tr>' +
      headers.map((h) => "<th>" + h + "</th>").join("") +
      "</tr></thead><tbody><tr><td><span data-entity-name>" +
      productName +
      "</span><small>LHC-KIEM-THU · Bộ</small></td>" +
      values.map((v) => '<td class="right">' + v + "</td>").join("") +
      '</tr></tbody></table></div></div></div><div class="modal-foot"><button class="btn secondary" type="button">Đóng</button></div></dialog>',
  });
}
for (const [name, html] of [
  [
    "product-suggestion",
    '<ul class="suggest"><li><span class="prod-opt"><span class="thumb">Ảnh</span><span class="prod-text"><b data-entity-name>' +
      productName +
      '</b><small>ML-TEST · Bộ · tồn 123.456</small></span><span class="price" data-money>' +
      amount +
      "</span></span></li></ul>",
  ],
  [
    "stock-lookup-product",
    '<article class="card lookup-item"><div class="lookup-top"><img alt="" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E"><div><b class="lookup-sku">LHC-TEST</b><span class="lookup-name" data-entity-name>' +
      productName +
      '</span></div><div class="lookup-total"><strong>123.456</strong><small>Bộ</small></div></div></article>',
  ],
  [
    "receiving-product",
    '<article class="recv-card"><div class="recv-head"><div><b>LHC-TEST</b><small class="sup-sub" data-entity-name>' +
      productName +
      '</small></div><div class="recv-need"><small>Cần nhận</small><strong>123.456</strong></div></div></article>',
  ],
  [
    "pos-cart-product",
    '<section class="pos-checkout" style="width:min(100%,360px)"><article class="pos-line"><div class="pos-line-top"><b class="pos-line-name" data-entity-name>' +
      productName +
      "</b><strong data-money>" +
      amount +
      '</strong><button class="btn ghost small" aria-label="Bỏ sản phẩm" type="button">×</button></div></article></section>',
  ],
  [
    "order-line-product",
    '<div class="table-wrap"><table class="data-table"><tbody id="order-lines"><tr><td><a data-entity-name>' +
      productName +
      '</a><small>ML-TEST · Bộ</small></td><td class="right">100.000</td><td class="right">10.000</td><td class="right">100.000 đ</td><td class="right">8%</td><td class="right" data-money>' +
      amount +
      "</td></tr></tbody></table></div>",
  ],
  [
    "packing-product",
    '<div class="table-wrap"><table class="data-table pick-table"><tbody><tr class="pick-row"><td class="pick-col"><input type="checkbox" aria-label="Đã lấy"></td><td><span data-entity-name>' +
      productName +
      '</span><small>ML-TEST</small></td><td class="right"><b class="pick-qty">123.456</b> Bộ</td><td>Hộp 12 cái</td><td class="right">250 kg</td></tr></tbody></table></div>',
  ],
])
  cases.push({ name, root: "#view-test", kind: "product", html });
const index = await readFile(root + "index.html", "utf8"),
  styles = [...index.matchAll(/<link[^>]+href="([^"?]+\.css)[^"]*"/g)].map(
    (m) => m[1],
  );
const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://localhost");
    if (u.pathname === "/") {
      const c = cases[Number(u.searchParams.get("case")) || 0];
      const profile = c.profile ? [c.profile] : [];
      const content = c.dialog
        ? c.html
        : '<section class="view" id="' +
          c.root.slice(1) +
          '">' +
          c.html +
          "</section>";
      res
        .writeHead(200, { "content-type": "text/html;charset=utf-8" })
        .end(
          '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">' +
            styles
              .map((s) => '<link rel="stylesheet" href="/' + s + '">')
              .join("") +
            '<style>body{margin:0}main.main{margin:0;width:100%;max-width:none}</style></head><body><div id="workspace"><main class="main">' +
            content +
            '</main></div><script type="module">import {installMobileDesign} from "/mobile-design.js";installMobileDesign(' +
            JSON.stringify(profile) +
            ");" +
            (c.dialog
              ? 'document.querySelector("dialog.modal").showModal();'
              : "") +
            'document.querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{window.__layoutClicks=(window.__layoutClicks||0)+1}));window.__layoutReady=true;</script></body></html>',
        );
      return;
    }
    const path = u.pathname.slice(1);
    assert.ok(!path.includes(".."));
    const data = await readFile(
      process.env.BASELINE_CSS && path === "mobile-design.css"
        ? process.env.BASELINE_CSS
        : root + path,
    );
    res
      .writeHead(200, {
        "content-type": path.endsWith(".js")
          ? "text/javascript"
          : path.endsWith(".css")
            ? "text/css"
            : path.endsWith(".woff2")
              ? "font/woff2"
              : "application/octet-stream",
      })
      .end(data);
  } catch (e) {
    res.writeHead(404).end(String(e.message));
  }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const origin = "http://127.0.0.1:" + server.address().port,
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  }),
  report = [];
try {
  const widths = (
    process.env.AUDIT_WIDTHS ||
    (baseline ? "390" : "320,360,390,430,768,850,1280")
  )
    .split(",")
    .map(Number);
  for (const width of widths) {
    const context = await browser.newContext({
      viewport: { width, height: 932 },
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
    const p = await context.newPage(),
      errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    for (const [i, c] of cases.entries()) {
      await p.goto(origin + "/?case=" + i);
      await p.waitForFunction(() => window.__layoutReady);
      await p.waitForTimeout(45);
      const facts = await p.evaluate(() => {
        const rect = (n) => {
          const r = n.getBoundingClientRect();
          return {
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            right: r.right,
            bottom: r.bottom,
          };
        };
        const n = document.querySelector("[data-entity-name]"),
          box =
            n.closest(
              "td,dd,.task-main,.prod-text,.lookup-top>div,.recv-head>div",
            ) || n;
        return {
          width: innerWidth,
          name: rect(n),
          box: rect(box),
          nameText: n.textContent,
          nameScroll: n.scrollWidth,
          nameClient: n.clientWidth,
          pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
          money: [...document.querySelectorAll("[data-money]")]
            .filter((n) => n.getClientRects().length)
            .map((n) => ({
              box: rect(n),
              scroll: n.scrollWidth,
              client: n.clientWidth,
              host: rect(
                n.closest("td,dd,.price,.pay-summary") || n.parentElement,
              ),
            })),
          actions: [...document.querySelectorAll(".crm-card-actions")].map(
            rect,
          ),
          owner: [...document.querySelectorAll(".crm-card-owner")]
            .filter((n) => n.getClientRects().length)
            .map(rect),
          shipping: [...document.querySelectorAll(".has-ghn-tracking")]
            .filter((n) => n.getClientRects().length)
            .map(rect),
          buttons: [...document.querySelectorAll(".crm-card-actions button")]
            .filter((n) => n.getClientRects().length)
            .map((n) => ({
              box: rect(n),
              host: rect(n.closest(".crm-card-actions")),
            })),
        };
      });
      const issues = [];
      if (width <= 850 && facts.box.width < Math.min(160, width * 0.5))
        issues.push("narrow-name");
      if (c.kind === "product" && facts.box.width < 160)
        issues.push("narrow-product-name");
      if (c.kind === "stock-table" && facts.box.width < 240)
        issues.push("narrow-product-column");
      if (facts.pageOverflow) issues.push("page-overflow");
      if (
        width <= 850 &&
        facts.money.some(
          (m) =>
            m.scroll > m.client + 1 ||
            m.box.right > m.host.right + 1 ||
            m.box.x < m.host.x - 1,
        )
      )
        issues.push("clipped-money");
      if (
        width <= 850 &&
        c.kind === "card" &&
        facts.box.width < (width - 70) * 0.8
      )
        issues.push("name-not-full-row");
      if (errors.length) issues.push(...errors.splice(0));
      if (width <= 850 && c.kind === "card") {
        if (
          facts.actions.some((a) =>
            [...facts.owner, ...facts.shipping].some((o) => a.y < o.bottom - 1),
          )
        )
          issues.push("overlapping-actions");
        if (
          facts.shipping.some((s) =>
            facts.owner.some((o) => s.y < o.bottom - 1),
          )
        )
          issues.push("overlapping-shipping");
        if (
          facts.buttons.some(
            (b) => b.box.x < b.host.x - 1 || b.box.right > b.host.right + 1,
          )
        )
          issues.push("overflowing-actions");
        const button = p.locator(".crm-card-actions button").last();
        await button.click();
        assert.equal(
          await p.evaluate(() => window.__layoutClicks),
          1,
          "Action remains clickable",
        );
      }
      report.push({ case: c.name, kind: c.kind, width, issues, ...facts });
      if ((baseline && issues.length) || (!baseline && width === 390))
        await p.screenshot({
          path:
            out +
            "/" +
            (baseline ? "before" : "after") +
            "-" +
            c.name +
            "-" +
            width +
            ".png",
          fullPage: true,
        });
    }
    await context.close();
  }
  await writeFile(
    out + "/" + (baseline ? "before" : "after") + "-report.json",
    JSON.stringify(report, null, 2),
  );
  const failed = report.filter((r) => r.issues.length);
  console.log(
    JSON.stringify({
      cases: cases.length,
      checks: report.length,
      failed: failed.map((r) => ({
        case: r.case,
        width: r.width,
        issues: r.issues,
        nameWidth: r.box.width,
      })),
    }),
  );
  if (baseline)
    assert.ok(failed.length > 0, "Baseline must reproduce a layout failure");
  else
    assert.deepEqual(
      failed.map((r) => ({ case: r.case, width: r.width, issues: r.issues })),
      [],
    );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
