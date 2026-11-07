import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { setupShiftReports } from "../helpers/shift-report-fixture.ts";
import { salesOrders } from "../../src/modules/sales/schema.ts";
import { employees } from "../../src/modules/staff/schema.ts";
import type { ShiftReportsPage } from "../../src/modules/sales/domain/shift-report-filters.ts";
import { posRegisters } from "../../src/modules/sales/pos-schema.ts";
import { cashDrawers } from "../../src/modules/sales/cash-schema.ts";

test("shift reports: full filtered totals, immutable closed snapshots, live figures, paging and authorization", async () => {
  const f = await setupShiftReports();
  for (let i = 0; i < 55; i++)
    await f.closed(
      "history-" + String(i).padStart(2, "0"),
      1000,
      "emp",
      i === 0 ? -20 : i === 1 ? 30 : 0,
    );
  await f.closed("other-shift", 2000, "cashier2");
  const opened = await f.open();
  const sale = await f.call("/pos/checkout", f.emp, "POST", f.cart(opened.id));
  assert.equal(sale.status, 201, JSON.stringify(sale.data));
  const expense = await f.call("/cash/entries", f.emp, "POST", {
    key: crypto.randomUUID(),
    kind: "petty_expense",
    amount: 1000,
    reason: "Chi kiểm thử",
  });
  assert.equal(expense.status, 201, JSON.stringify(expense.data));
  const url = "/pos/shift-reports?from=2026-11-01&to=2026-11-30";
  const call = async (suffix = "", cookie = f.mgr) => {
    const r = await f.call(url + suffix, cookie);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data as ShiftReportsPage;
  };
  const all = await call("&pageSize=25");
  assert.equal(all.rows.length, 25);
  assert.equal(
    all.summary.shiftCount,
    57,
    "summary includes more than 50 shifts / all pages",
  );
  assert.equal(all.summary.closedCount, 56);
  assert.equal(all.summary.openCount, 1);
  assert.equal(all.summary.revenue, 57000 + sale.data.total);
  assert.equal(all.summary.shortage, -20);
  assert.equal(all.summary.surplus, 30);
  assert.equal(all.summary.differenceCount, 2);
  const second = await call("&page=2&pageSize=25");
  assert.deepEqual(second.summary, all.summary);
  assert.equal(
    new Set([...all.rows, ...second.rows].map((r) => r.id)).size,
    50,
    "stable tie-breaker prevents duplicate pages",
  );
  const live = await call("&status=open");
  const detail = (await f.call("/pos/shifts/" + opened.id, f.emp)).data;
  assert.equal(live.summary.revenue, detail.bills.revenue);
  assert.equal(live.summary.cash, detail.cash);
  assert.equal(live.summary.transfer, detail.transfer);
  assert.equal(live.summary.manualOut, 1000);
  assert.equal(live.rows[0]!.expected_cash, detail.expectedCash);
  assert.equal(
    live.rows[0]!.cash_difference,
    null,
    "open shifts are not treated as matched",
  );
  const closed = await call("&status=closed");
  assert.equal(closed.summary.revenue, 57000);
  assert.equal(closed.summary.returnCredit, 5600);
  assert.equal(closed.summary.manualIn, 1120);
  assert.equal(closed.summary.refundCash, 1680);
  assert.equal(closed.summary.refundTransfer, 1120);
  assert.equal((await call("&difference=shortage")).summary.shiftCount, 1);
  assert.equal((await call("&difference=surplus")).summary.shiftCount, 1);
  assert.equal((await call("&difference=matched")).summary.shiftCount, 54);
  const byPerson = await call("&groupBy=member");
  assert.equal(byPerson.groups.length, 2);
  assert.equal(
    byPerson.groups.reduce((n, g) => n + g.revenue, 0),
    all.summary.revenue,
  );
  const own = await call("", f.emp);
  assert.equal(own.scope, "own");
  assert.equal(own.summary.shiftCount, 56);
  assert.equal(own.members.length, 1);
  assert.equal(own.members[0]!.id, "emp");
  assert.equal((await f.call(url + "&memberId=cashier2", f.emp)).status, 403);
  assert.equal((await f.call("/pos/shifts/other-shift", f.emp)).status, 404);
  assert.equal((await f.call("/pos/shifts/missing-shift", f.mgr)).status, 404);
  const empty = await call("&q=khong-co-ca-nay");
  assert.equal(empty.summary.shiftCount, 0);
  assert.deepEqual(empty.rows, []);
  assert.deepEqual(empty.groups, []);
  const injection = await call("&q=" + encodeURIComponent("' or true --"));
  assert.equal(injection.summary.shiftCount, 0);
  assert.equal(
    (await f.call("/pos/shift-reports?from=2026-02-30", f.mgr)).status,
    400,
  );
  assert.equal((await f.call(url + "&status=unknown", f.mgr)).status, 400);
  assert.equal((await f.call(url + "&pageSize=1000", f.mgr)).status, 400);
  assert.equal((await f.call(url, "")).status, 401);
  await f.db
    .update(employees)
    .set({ positionId: "warehouse" })
    .where(eq(employees.id, "cashier2"));
  assert.equal((await f.call(url, f.other)).status, 403);
  // Later live data must not be substituted for the immutable report of a closed shift.
  await f.db
    .update(salesOrders)
    .set({ total: 1 })
    .where(eq(salesOrders.shiftId, opened.id));
  assert.equal((await call("&status=closed")).summary.revenue, 57000);
  const [register] = await f.db
    .select()
    .from(posRegisters)
    .where(eq(posRegisters.id, f.registerId));
  await f.db.insert(cashDrawers).values({
    id: "foreign-drawer",
    name: "Két Minh Long",
    updatedAt: new Date().toISOString(),
  });
  await f.db.insert(posRegisters).values({
    ...register!,
    id: "foreign-register",
    name: "Quầy Minh Long",
    cashDrawerId: "foreign-drawer",
  });
  await f.closed("foreign-store-history", 9999, "emp", 0, "foreign-register");
  assert.equal(
    (await call("", f.emp)).summary.shiftCount,
    56,
    "store scope still excludes own historical shifts in a foreign store",
  );
  assert.equal(
    (await f.call(url + "&registerId=foreign-register", f.emp)).status,
    403,
  );
  assert.equal(
    (await f.call("/pos/shifts/foreign-store-history", f.emp)).status,
    403,
  );
  await f.db
    .update(posRegisters)
    .set({ name: "Quầy khác" })
    .where(eq(posRegisters.id, f.registerId));
  const noStore = await call("", f.emp);
  assert.equal(
    noStore.summary.shiftCount,
    0,
    "empty store scope must never mean all stores",
  );
  assert.deepEqual(noStore.registers, []);
  assert.deepEqual(noStore.members, []);
});
