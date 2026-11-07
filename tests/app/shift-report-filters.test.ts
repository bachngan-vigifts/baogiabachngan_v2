import { test } from "node:test";
import assert from "node:assert/strict";
import { shiftReportFilters } from "../../src/modules/sales/domain/shift-report-filters.ts";
// @ts-ignore browser presentation helpers
import { reportPeriod, reportTotals } from "../../trial-ui/shift-reports.js";

test("report period follows Vietnam business dates, including previous month / leap year", () => {
  assert.deepEqual(reportPeriod("month", "2026-11-07"), {
    from: "2026-11-01",
    to: "2026-11-07",
  });
  assert.deepEqual(reportPeriod("previous", "2024-03-01"), {
    from: "2024-02-01",
    to: "2024-02-29",
  });
  assert.deepEqual(reportPeriod("week", "2026-01-03"), {
    from: "2025-12-28",
    to: "2026-01-03",
  });
  assert.deepEqual(reportPeriod("today", "2026-11-07"), {
    from: "2026-11-07",
    to: "2026-11-07",
  });
});
test("validate dates and bounded paging rather than trusting filter input", () => {
  const read = (s: string) =>
    shiftReportFilters(new URLSearchParams(s), "2026-11-07");
  assert.equal(read("").from, "2026-11-01");
  assert.equal(read("").pageSize, 25);
  for (const s of [
    "from=2026-13-01",
    "from=2026-02-30",
    "from=2026-11-09",
    "from=2020-01-01",
    "page=0",
    "pageSize=101",
    "page=1.2",
    "difference=bad",
    "groupBy=bad",
  ])
    assert.throws(() => read(s), { status: 400 }, s);
});
test("sales value, customer receipts and refunds remain separate, no opening cash or double discount", () => {
  assert.deepEqual(
    reportTotals({
      revenue: 1000,
      returnCredit: 100,
      cash: 600,
      transfer: 400,
      refundCash: 50,
      refundTransfer: 20,
      discount: 80,
      openingCash: 5000,
    }),
    { netRevenue: 900, received: 1000, refunded: 70 },
  );
  assert.deepEqual(reportTotals({}), {
    netRevenue: 0,
    received: 0,
    refunded: 0,
  });
});
