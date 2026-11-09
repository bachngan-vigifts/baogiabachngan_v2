import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const { financeDefaults, financeRange, financeMetrics, financeKpiProgress } =
  await import(
    new URL("../../trial-ui/finance-model.js", import.meta.url).href
  );
const data = () => ({
  summary: {
    revenue: 1000,
    coveredRevenue: 1000,
    feeRevenue: 20,
    missingOrders: 0,
    unconfirmedOrders: 0,
    carrierUnknownOrders: 0,
  },
  company: { net: 320, reconciled: true },
  branches: [{ id: "store", net: 400 }],
  staff: { available: true, reconciled: true, partial: false },
  officeExpenses: { available: false, note: "Thiếu văn phòng" },
  cardFees: { available: false, note: "Thiếu phí thẻ" },
});
test("financial cards keep same net as server, use coverage basis, distinguish branch/common cost and partial payroll", () => {
  const d = data();
  const all = financeMetrics(d);
  assert.equal(all.net, 320);
  assert.equal(all.cost, 700);
  assert.equal(all.margin, 320 / 1020);
  assert.equal(all.notes.includes("Thiếu văn phòng"), true);
  const branch = financeMetrics(
    { ...d, staff: { ...d.staff, partial: true } },
    "store",
  );
  assert.equal(branch.net, 400);
  assert.equal(branch.cost, 620);
  assert.match(branch.notes.join(" "), /tháng lẻ/);
  assert.match(branch.notes.join(" "), /chi phí chung/);
  for (const summary of [
    { missingOrders: 1 },
    { unconfirmedOrders: 1 },
    { carrierUnknownOrders: 1 },
  ]) {
    const m = financeMetrics({ ...d, summary: { ...d.summary, ...summary } });
    assert.equal(m.revenue, 1000);
    assert.equal(m.net, null);
    assert.equal(m.cost, null);
    assert.equal(m.margin, null);
    assert.ok(m.warnings.length);
  }
  assert.equal(
    financeMetrics({ ...d, staff: { ...d.staff, reconciled: false } }).net,
    null,
  );
  assert.equal(financeMetrics(d, "missing").net, null);
  assert.equal(
    financeMetrics({
      ...d,
      summary: { ...d.summary, coveredRevenue: 0, feeRevenue: 0 },
    }).margin,
    null,
  );
});
test("VN date defaults cross midnight and leap dates; KPI progress does not replace canonical payroll points", () => {
  assert.deepEqual(financeDefaults(new Date("2026-10-31T17:00:00.000Z")), {
    from: "2026-11-01",
    to: "2026-11-01",
    branch: "",
  });
  assert.equal(financeRange("2024-02-29", "2024-02-29"), true);
  assert.equal(financeRange("2026-02-29", "2026-03-01"), false);
  assert.equal(financeRange("2024-01-01", "2026-01-01"), false);
  assert.equal(
    financeKpiProgress({ actual: 100, extra: 10, target: 100, points: 0.3 }),
    1.1,
  );
  assert.equal(
    financeKpiProgress({ actual: null, extra: 10, target: 100 }),
    null,
  );
  assert.equal(financeKpiProgress({ actual: 10, extra: 0, target: 0 }), null);
});
test("finance stays lazy, Manager-only, does not add a polling job or a second payroll formula", () => {
  const app = readFileSync(
      new URL("../../trial-ui/app.js", import.meta.url),
      "utf8",
    ),
    ui = readFileSync(
      new URL("../../trial-ui/finance.js", import.meta.url),
      "utf8",
    );
  assert.match(app, /view === 'finance' \? isManager\(\)/);
  assert.match(app, /import\('\.\/finance\.js'\)/);
  assert.doesNotMatch(app, /^import .* from '\.\/finance\.js'/m);
  assert.match(app, /typeof financeUi !== 'undefined'/);
  assert.doesNotMatch(ui, /setInterval|computePayslip|buildPayroll/);
  assert.match(ui, /compare: "0"/);
  assert.match(ui, /view: "overview"/);
});
