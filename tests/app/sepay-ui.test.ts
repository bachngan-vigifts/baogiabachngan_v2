import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stampVersion } from "../../scripts/stamp-ui-version.ts";
const { sepayDefaults, sepayStateLabel } = await import(
  new URL("../../trial-ui/sepay.js", import.meta.url).href
);
test("SePay default calendar is VN, status labels distinguish voided/missing receipts", () => {
  assert.deepEqual(sepayDefaults(new Date("2026-11-08T17:10:00Z")), {
    from: "2026-11-01",
    to: "2026-11-09",
  });
  assert.equal(sepayStateLabel("receipt_issue"), "Phiếu thu cần kiểm tra");
  assert.equal(sepayStateLabel("matched"), "Đã ghi thu");
  assert.equal(sepayStateLabel("unknown"), "Cần kiểm tra");
});
test("SePay page is lazy, versions CSS and closes on logout/navigation without polling or demo transactions", () => {
  const root = new URL("../../trial-ui/", import.meta.url),
    app = readFileSync(new URL("app.js", root), "utf8"),
    page = readFileSync(new URL("sepay.js", root), "utf8"),
    html = readFileSync(new URL("index.html", root), "utf8");
  assert.ok(app.includes("import('./sepay.js')"));
  assert.ok(!/^import .*sepay/m.test(app));
  assert.ok(app.includes("sepay: 'page.sepay'"));
  assert.ok(app.includes("view !== 'sepay'"));
  assert.ok(app.includes("typeof sepayUi !== 'undefined'"));
  assert.ok(html.includes('id="view-sepay"'));
  assert.ok(stampVersion(page, "test", "js").includes("sepay.css?v=test"));
  assert.ok(!page.includes("setInterval("));
  assert.ok(!page.includes("Dữ liệu minh hoạ"));
  assert.ok(page.includes("Chưa xác nhận được kết quả"));
  assert.ok(page.includes('root.setAttribute("data-no-busy", "")'));
});
