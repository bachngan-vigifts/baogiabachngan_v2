import { customerPayments } from "../../src/modules/sales/schema.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { setupFinance } from "../helpers/finance-fixture.ts";
import { financeFilters } from "../../src/app/finance-filters.ts";
import {
  salesOrders,
  paymentSchedules,
} from "../../src/modules/sales/schema.ts";
import { cashEntries } from "../../src/modules/sales/cash-schema.ts";
import { posReturns } from "../../src/modules/sales/return-schema.ts";
import {
  financeCashflow,
  financeReceivables,
} from "../../src/app/finance-readers.ts";
import { netReceivables } from "../../src/modules/sales/api/pos-return-credit.ts";
const range = "/finance/cashflow?from=2026-11-09&to=2026-11-09";
const ok = (r: { status: number; data: any }) => {
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
};
test("strict dates: leap days, reversed/overlong periods and injection-shaped branches", () => {
  for (const q of [
    "from=2026-02-30&to=2026-03-01",
    "from=2026-11-10&to=2026-11-09",
    "from=2024-01-01&to=2026-01-01",
    "from=x&to=y",
  ])
    assert.throws(() => financeFilters(new URLSearchParams(q)));
  assert.equal(
    financeFilters(new URLSearchParams("from=2024-02-29&to=2024-02-29")).from,
    "2024-02-29",
  );
});
test("finance enforces Manager server-side, validates branches, and sums physical movements once within VN days", async () => {
  const f = await setupFinance();
  for (const path of ["/finance/options", range, "/finance/receivables"]) {
    assert.equal((await f.call(path)).status, 401);
    assert.equal((await f.call(path, f.emp)).status, 403);
    assert.equal((await f.call(path, f.ncc)).status, 403);
  }
  assert.equal((await f.call(range + "&branch=missing", f.mgr)).status, 400);
  assert.equal(
    (
      await f.call(
        range + "&branch=%27%3Bdrop%20table%20sales_orders%3B--",
        f.mgr,
      )
    ).status,
    400,
  );
  const d = ok(await f.call(range, f.mgr));
  assert.equal(d.flow.in, 1137);
  assert.equal(d.flow.out, 150);
  assert.equal(d.flow.net, 987);
  assert.equal(d.flow.transfersOut, 200);
  assert.equal(d.flow.adjustments, 12);
  assert.equal(d.flow.unassignedSupplier, 80);
  assert.equal(d.openingBalance, null);
  assert.equal(d.closingBalance, null);
  assert.equal(ok(await f.call(range, f.mgr)).cache.hit, true);
  assert.equal(ok(await f.call(range + "&refresh=1", f.mgr)).cache.hit, false);
  const crm = ok(await f.call(range + "&branch=crm", f.mgr)).flow;
  assert.equal(crm.in, 400);
  assert.equal(crm.out, 50);
  assert.equal(crm.unassignedOut, 80);
  const store = ok(await f.call(range + "&branch=" + f.registerId, f.mgr)).flow;
  assert.equal(store.in, 737);
  assert.equal(store.out, 20);
  assert.equal(ok(await f.call("/finance/options", f.mgr)).branches.length, 2);
  await f.db.insert(customerPayments).values([
    {
      id: "test-ghn",
      orderId: "finance-draft",
      amount: 333,
      method: "other",
      paymentSource: "ghn_cod",
      paidAt: "2026-11-09",
      createdBy: "mgr",
      createdAt: f.stamp,
    },
    {
      id: "test-other",
      orderId: "finance-draft",
      amount: 222,
      method: "other",
      paidAt: "2026-11-09",
      createdBy: "mgr",
      createdAt: f.stamp,
    },
  ]);
  const unmapped = ok(await f.call(range + "&refresh=1", f.mgr)).flow;
  assert.equal(unmapped.in, 1137);
  assert.equal(unmapped.carrierCollected, 333);
  assert.equal(unmapped.otherReceipts, 222);
  await f.db
    .update(cashEntries)
    .set({ reason: "Trả NCC vật tư" })
    .where(eq(cashEntries.id, "finance-petty"));
  const review = ok(await f.call(range + "&refresh=1", f.mgr));
  assert.equal(
    review.flow.unlinkedOut,
    20,
    "unlinked manual supplier voucher must be flagged, never silently treated as reconciled",
  );
});
test("current receivables use canonical return rules; redelivery receipt does not reduce debt, financial credit does", async () => {
  const f = await setupFinance();
  const read = async () =>
    ok(await f.call("/finance/receivables?refresh=1", f.mgr));
  const canonical = await netReceivables(
    f.db,
    ["finance-crm", "finance-pos"],
    "2026-11-09",
  );
  const d = await read();
  assert.equal(d.basis, "current");
  assert.equal(
    d.totals.balance,
    [...canonical.values()].reduce((s, r) => s + r.balance, 0),
  );
  assert.equal(d.totals.orders, 2);
  // Refund reduces effective paid by 50; receipt of returned goods alone leaves full schedule intact.
  assert.equal(d.totals.balance, 800);
  assert.equal(d.totals.overdue, 800);
  await f.db
    .update(posReturns)
    .set({ creditEffectiveAt: f.stamp })
    .where(eq(posReturns.id, "finance-return"));
  assert.equal((await read()).totals.balance, 700);
  const rows = Array.from({ length: 2001 }, (_, i) => f.order("bulk-" + i));
  for (let i = 0; i < rows.length; i += 200)
    await f.db.insert(salesOrders).values(rows.slice(i, i + 200));
  for (let i = 0; i < rows.length; i += 200)
    await f.db.insert(paymentSchedules).values(
      rows.slice(i, i + 200).map((o) => ({
        id: "sch-" + o.id,
        orderId: o.id,
        kind: "balance" as const,
        amount: 1,
        dueDate: null,
        createdAt: f.stamp,
      })),
    );
  let queries = 0;
  const originalQuery = f.client.query.bind(f.client);
  f.client.query = ((...args: Parameters<typeof f.client.query>) => {
    queries++;
    return originalQuery(...args);
  }) as typeof f.client.query;
  const started = performance.now();
  const direct = await financeReceivables(f.db, "", "2026-11-09");
  assert.equal(direct.balance, 2701);
  assert.ok(queries <= 8, "bulk receivables query budget: " + queries);
  queries = 0;
  const flow = await financeCashflow(f.db, {
    from: "2026-11-09",
    to: "2026-11-09",
    branch: "",
  });
  assert.equal(flow.in, 1137);
  assert.equal(queries, 5, "four cashflow sources plus one bulk GHN evidence query");
  f.client.query = originalQuery;
  console.log(
    "finance synthetic 2003-order bulk read ms",
    Math.round(performance.now() - started),
  );
  const large = await read();
  assert.equal(large.totals.orders, 2003);
  assert.equal(
    large.totals.balance,
    2701,
    "must never use first-page 2000-order total",
  );
  const p = ok(
    await f.call("/profit?from=2026-11-01&to=2026-11-30&compare=0", f.mgr),
  );
  const compact = ok(
    await f.call(
      "/profit?from=2026-11-01&to=2026-11-30&compare=0&view=overview",
      f.mgr,
    ),
  );
  assert.deepEqual(compact.summary, p.summary);
  assert.equal(compact.company.net, p.branchCosts.company.net);
  assert.equal(compact.cache.hit, true);
  for (const key of ["orders", "owners", "customers", "products", "payroll"])
    assert.equal(key in compact, false);
  assert.equal("payroll" in compact.staff, false);
});

test("query errors fail explicitly rather than returning zero financial totals", async () => {
  const f = await setupFinance(),
    old = f.env.db.transaction;
  f.env.db.transaction = async () => {
    throw new Error("Synthetic read unavailable");
  };
  try {
    const r = await f.call(
      "/finance/cashflow?from=2026-11-09&to=2026-11-09&refresh=1",
      f.mgr,
    );
    assert.equal(r.status, 500);
    assert.equal("flow" in r.data, false);
    assert.ok(r.data.error);
  } finally {
    f.env.db.transaction = old;
  }
});
