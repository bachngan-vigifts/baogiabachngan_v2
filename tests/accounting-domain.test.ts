import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ledger,
  kAssessment,
  validateLines,
  day,
  periodMonths,
  canUseAccounting,
  type Document,
} from "../src/modules/accounting/domain/accounting.ts";
import { accountingAssistant } from "../src/modules/accounting/api/assistant.ts";
const doc = (
  id: string,
  kind: Document["kind"],
  date: string,
  quantity: number,
  netValue: number,
): Document => ({
  id,
  bookId: "b",
  kind,
  state: "posted",
  date,
  reference: id,
  createdAt: date,
  lines: [{ sku: "A", name: "A", unit: "Cái", quantity, netValue, taxRate: 8 }],
});
test("weighted average, before-VAT sales and historical opening, deterministic order", () => {
  const rows = [
    doc("o", "opening", "2026-10-01", 10, 1000),
    doc("p", "purchase", "2026-10-02", 10, 2000),
    doc("s", "sale", "2026-10-03", 4, 1000),
  ];
  const r = ledger(rows, "2026-10-01", "2026-10-31");
  assert.equal(r.stock[0]?.value, 2400);
  assert.equal(r.stock[0]?.quantity, 16);
  assert.equal(r.stock[0]?.costSold, 600);
  assert.equal(r.sales, 1000);
  assert.equal(r.openingValue, 1000);
  assert.equal(r.purchases, 2000);
  assert.deepEqual(ledger([...rows].reverse(), "2026-10-01", "2026-10-31"), r);
  const next = ledger(rows, "2026-11-01", "2026-11-30");
  assert.equal(next.openingValue, 2400);
  assert.equal(next.sales, 0);
});
test("never counts drafts/voids, negative stock flags and unknown K", () => {
  const r = ledger(
    [
      { ...doc("d", "purchase", "2026-10-01", 100, 10000), state: "draft" },
      doc("s", "sale", "2026-10-02", 1, 200),
    ],
    "2026-10-01",
    "2026-10-31",
  );
  assert.equal(r.stock[0]?.quantity, -1);
  assert.ok(r.anomalies.some((a) => a.code === "negative_stock"));
  assert.equal(kAssessment(r, true, 2).state, "unknown");
  const good = ledger(
    [doc("o", "opening", "2026-10-01", 10, 1000)],
    "2026-10-01",
    "2026-10-31",
  );
  assert.equal(kAssessment(good, false, 2).ratio, null);
  assert.equal(kAssessment(good, true, null).state, "unconfigured");
});
test("input precision, date, month coverage and exact roles", () => {
  assert.throws(() =>
    validateLines([
      {
        sku: "A",
        name: "A",
        unit: "Cái",
        quantity: 0.0001,
        netValue: 1,
        taxRate: 8,
      },
    ]),
  );
  assert.throws(() => day("2026-02-30"));
  assert.throws(() => periodMonths("2025-01-01", "2026-01-01"));
  assert.equal(canUseAccounting({ role: "manager" }), true);
  assert.equal(
    canUseAccounting({ role: "employee", positionId: "accounting" }),
    true,
  );
  assert.equal(
    canUseAccounting({ role: "employee", positionId: "warehouse" }),
    false,
  );
  assert.equal(
    canUseAccounting({ role: "supplier", positionId: "accounting" }),
    false,
  );
});
test("AI disabled by default; sends only numeric alert facts and has no write capabilities", async () => {
  const facts = {
    code: "negative_stock",
    value: 2,
    kState: "unknown",
    coverage: false,
  };
  await assert.rejects(() => accountingAssistant(undefined, facts));
  let sent: any;
  const config = {
    apiKey: "test-not-real",
    model: "test",
    fetch: async (input: any, init: any) => {
      assert.equal(input, "https://api.openai.com/v1/chat/completions");
      sent = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: "Đối soát phiếu gốc",
                  checks: ["Kiểm tra ngày nhập trước ngày xuất"],
                }),
              },
            },
          ],
        }),
      );
    },
  };
  const r = await accountingAssistant(config as any, facts);
  assert.equal(r.canIssue, false);
  assert.equal(r.requiresHumanReview, true);
  assert.deepEqual(JSON.parse(sent.messages[1].content), facts);
  assert.equal(sent.tools, undefined);
  assert.ok(!JSON.stringify(sent).includes("test-not-real"));
});
