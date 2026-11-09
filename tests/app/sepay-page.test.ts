import { test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { setupSepay } from "../helpers/sepay-fixture.ts";
import {
  salesOrders,
  salesContracts,
  customerPayments,
  paymentSchedules,
} from "../../src/modules/sales/schema.ts";
import { sepayTransactions } from "../../src/modules/integrations/schema.ts";
import { cashCollections } from "../../src/modules/sales/cash-collection-schema.ts";
import { auditLogs } from "../../src/core/db/schema.ts";
import {
  sepayPageFilters,
  sepayManualChoice,
} from "../../src/modules/sales/domain/sepay-page.ts";

const path = "/sepay/transactions?from=2026-11-08&to=2026-11-08";
test("SePay filters validate dates, money, bounds and choices fail closed", () => {
  for (const q of [
    "from=2026-02-30",
    "from=2026-11-10&to=2026-11-01",
    "from=2024-01-01&to=2026-01-01",
    "status=bad",
    "min=-1",
    "min=2&max=1",
    "limit=0",
    "limit=1000",
    "offset=1000001",
    "account=abc%27%3B",
  ])
    assert.throws(() => sepayPageFilters(new URLSearchParams(q), "2026-11-09"));
  assert.equal(
    sepayPageFilters(
      new URLSearchParams("from=2024-02-29&to=2024-02-29"),
      "2026-11-09",
    ).start,
    "2024-02-28T17:00:00.000Z",
  );
  for (const body of [
    {},
    { orderId: "a", reason: "short", confirmed: true },
    { orderId: "a", reason: "valid reason longer", confirmed: false },
    {
      orderId: "a",
      reason: "valid reason longer",
      confirmed: true,
      existingPaymentId: 3,
    },
  ])
    assert.throws(() => sepayManualChoice(body));
});
test("Manager/Accounting may read; employees/suppliers cannot and Accounting cannot confirm or use pickers", async () => {
  const f = await setupSepay(),
    e = await f.incoming("Chưa rõ mã đơn trong chuyển khoản");
  assert.equal((await f.call(path)).status, 401);
  for (const cookie of [f.emp, f.ncc])
    assert.equal((await f.call(path, cookie)).status, 403);
  for (const cookie of [f.mgr, f.accountant]) {
    const r = await f.call(path, cookie);
    assert.equal(r.status, 200);
    assert.equal(r.data.pagination.total, 1);
    assert.ok(!JSON.stringify(r.data).includes("payload"));
    assert.equal(r.data.capabilities.canConfirm, cookie === f.mgr);
    assert.equal(
      (await f.call("/sepay/transactions/" + e.id, cookie)).status,
      200,
    );
  }
  const o = await f.order("PERMISSION101");
  assert.equal(
    (await f.confirm(e.id, f.choice(o.id), f.accountant)).status,
    403,
  );
  assert.equal((await f.call("/sepay/orders?q=PE", f.accountant)).status, 403);
  assert.equal(
    (
      await f.call(
        "/sepay/orders/" + o.id + "?transactionId=" + e.id,
        f.accountant,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await f.call(
        "/admin/sepay-transactions/" + e.id + "/reconcile",
        f.accountant,
        "POST",
        {},
      )
    ).status,
    403,
  );
  assert.equal((await f.db.select().from(customerPayments)).length, 0);
});
test("summary spans all pages, strict VN-day boundaries, money/account/search filters and empty results are accurate", async () => {
  const f = await setupSepay();
  for (let i = 0; i < 28; i++)
    await f.incoming("Giao dịch đối soát tập số " + i, 1000);
  await f.incoming("Ngoài ngày lọc", 2000, {
    transactionDate: "2026-11-09 00:00:00",
  });
  await f.incoming("Đầu ngày Việt Nam", 3000, {
    transactionDate: "2026-11-07T17:00:00Z",
    accountNumber: "999999",
  });
  const a = await f.call(path + "&limit=10", f.mgr);
  assert.equal(a.status, 200);
  assert.equal(a.data.summary.count, 29);
  assert.equal(a.data.summary.amount, 31000);
  assert.equal(a.data.summary.pendingCount, 29);
  assert.equal(a.data.transactions.length, 10);
  assert.equal(a.data.pagination.hasMore, true);
  const b = await f.call(path + "&limit=10&offset=10", f.mgr);
  assert.ok(
    !b.data.transactions.some((r: { id: string }) =>
      a.data.transactions.some((x: { id: string }) => x.id === r.id),
    ),
  );
  const c = await f.call(
    path + "&account=999999&min=3000&max=3000&q=đầu",
    f.accountant,
  );
  assert.equal(c.data.summary.count, 1);
  assert.equal(c.data.summary.amount, 3000);
  const none = await f.call(path + "&q=khôngtồn", f.mgr);
  assert.equal(none.data.summary.count, 0);
  assert.deepEqual(none.data.transactions, []);
  assert.equal(
    (await f.call(path + "&status=matched", f.mgr)).data.summary.count,
    0,
  );
});
test("voided and missing receipts are not reported as posted money", async () => {
  const f = await setupSepay(),
    o = await f.order("POSTED102"),
    e = await f.incoming(o.orderNo);
  let r = await f.call(path, f.accountant);
  assert.equal(r.data.summary.postedAmount, 100000);
  await f.db
    .update(customerPayments)
    .set({
      voidedAt: f.stamp,
      voidedBy: "mgr",
      voidReason: "Kiểm thử huỷ phiếu",
    })
    .where(eq(customerPayments.id, e.paymentId!));
  r = await f.call(path + "&status=receipt_issue", f.accountant);
  assert.equal(r.data.summary.postedAmount, 0);
  assert.equal(r.data.summary.issueAmount, 100000);
  assert.equal(r.data.transactions[0].status, "receipt_issue");
  assert.equal(
    (await f.call("/sepay/transactions/" + e.id, f.mgr)).data.capabilities
      .canConfirm,
    false,
  );
  assert.equal((await f.confirm(e.id, f.choice(o.id))).status, 409);
  await f.db
    .delete(customerPayments)
    .where(eq(customerPayments.id, e.paymentId!));
  assert.equal((await f.call(path, f.mgr)).data.summary.issueCount, 1);
});
test("Manager binds unknown content to a valid CRM order, audits the reason, preserves proof and retries exactly once", async () => {
  const f = await setupSepay(),
    o = await f.order("MANUAL103"),
    other = await f.order("OTHER103"),
    e = await f.incoming("Khách chuyển theo thoả thuận, thiếu mã đơn");
  const r = await f.confirm(e.id, f.choice(o.id));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.status, "matched");
  assert.equal(
    r.data.duplicate,
    false,
    "first manual confirmation creates its receipt",
  );
  assert.equal((await f.confirm(e.id, f.choice(o.id))).data.duplicate, true);
  assert.equal((await f.confirm(e.id, f.choice(other.id))).status, 409);
  const ps = await f.db.select().from(customerPayments);
  assert.equal(ps.length, 1);
  assert.equal(ps[0]!.amount, e.amount);
  assert.equal(ps[0]!.paidAt, "2026-11-08");
  assert.equal(ps[0]!.createdBy, "mgr");
  const [stored] = await f.db
    .select()
    .from(sepayTransactions)
    .where(eq(sepayTransactions.id, e.id));
  assert.equal(stored!.payload, e.payload);
  assert.equal(stored!.content, e.content);
  assert.equal(stored!.orderId, o.id);
  const history = await f.call("/sepay/transactions/" + e.id, f.accountant);
  assert.equal(history.data.history[0].reason, f.choice(o.id).reason);
  assert.equal(
    (
      await f.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, "sepay.confirm"))
    ).length,
    1,
  );
});
test("manual creation cannot bypass account approval, debt, held cash, status, POS, or required confirmation", async () => {
  const f = await setupSepay(),
    e = await f.incoming("Khoản chưa khớp 104"),
    o = await f.order("GUARDS104");
  for (const patch of [
    { reason: "" },
    { reason: "ngắn" },
    { confirmed: false },
    { orderId: "" },
  ])
    assert.equal((await f.confirm(e.id, f.choice(o.id, patch))).status, 400);
  assert.equal((await f.confirm("missing", f.choice(o.id))).status, 404);
  f.env.sepayReceiptAccounts = [];
  assert.equal((await f.confirm(e.id, f.choice(o.id))).status, 409);
  f.env.sepayReceiptAccounts = ["123456"];
  for (const extra of [
    { status: "draft" as const },
    { status: "cancelled" as const },
    { channel: "pos" },
    { total: 50000 },
  ]) {
    const bad = await f.order("BAD" + crypto.randomUUID(), extra);
    assert.equal((await f.confirm(e.id, f.choice(bad.id))).status, 409);
  }
  await f.db.insert(cashCollections).values({
    id: crypto.randomUUID(),
    orderId: o.id,
    requestKey: crypto.randomUUID(),
    amount: 1,
    paidAt: "2026-11-08",
    collectedBy: "emp",
    createdAt: f.stamp,
  });
  assert.equal((await f.confirm(e.id, f.choice(o.id))).status, 409);
  assert.equal((await f.db.select().from(customerPayments)).length, 0);
});
test("existing manual receipt may be linked without adding money; cannot reuse or link invalid/voided/foreign receipts", async () => {
  const f = await setupSepay(),
    o = await f.order("LINK105"),
    e = await f.incoming("Nhập tay trước khi đồng bộ 105");
  const id = crypto.randomUUID();
  await f.db.insert(customerPayments).values({
    id,
    orderId: o.id,
    amount: 100000,
    paidAt: "2026-11-08",
    method: "transfer",
    createdBy: "mgr",
    createdAt: f.stamp,
  });
  assert.equal((await f.confirm(e.id, f.choice(o.id))).status, 409);
  const linked = await f.confirm(
    e.id,
    f.choice(o.id, { existingPaymentId: id }),
  );
  assert.equal(linked.status, 200, JSON.stringify(linked.data));
  assert.equal(linked.data.paymentId, id);
  assert.equal((await f.db.select().from(customerPayments)).length, 1);
  const e2 = await f.incoming("Không được gắn phiếu này hai lần 105");
  assert.equal(
    (await f.confirm(e2.id, f.choice(o.id, { existingPaymentId: id }))).status,
    409,
  );
  await f.db
    .update(customerPayments)
    .set({
      voidedAt: f.stamp,
      voidedBy: "mgr",
      voidReason: "Kiểm thử phiếu huỷ",
    })
    .where(eq(customerPayments.id, id));
  assert.equal(
    (await f.confirm(e.id, f.choice(o.id, { existingPaymentId: id }))).status,
    409,
  );
  const other = await f.order("FOREIGN105");
  assert.equal(
    (await f.confirm(e2.id, f.choice(other.id, { existingPaymentId: id })))
      .status,
    409,
  );
});

test("QR POS and transactions identified to POS cannot be reassigned to CRM", async () => {
  const f = await setupSepay(),
    crm = await f.order("GUARDPOS110");
  const qr = await f.incoming("Thanh toán đơn POS_001_08112026");
  assert.equal(
    (await f.call("/sepay/transactions/" + qr.id, f.mgr)).data.capabilities
      .canConfirm,
    false,
  );
  assert.equal((await f.confirm(qr.id, f.choice(crm.id))).status, 409);
  const pos = await f.order("SOURCEPOS110", {
      channel: "pos",
      sapoOrderCode: "440004499",
    }),
    known = await f.incoming("Chuyen 440004499");
  assert.equal(known.orderId, pos.id);
  assert.equal((await f.confirm(known.id, f.choice(crm.id))).status, 409);
  assert.equal((await f.db.select().from(customerPayments)).length, 0);
});
test("preview is read-only and fresh debt is rechecked at confirmation; search excludes invalid documents", async () => {
  const f = await setupSepay(),
    o = await f.order("PREVIEW106"),
    e = await f.incoming("Chờ chọn đúng khách 106");
  await f.order("PREVIEW106POS", { channel: "pos" });
  await f.order("PREVIEW106DRAFT", { status: "draft" });
  await f.order("PREVIEW106CANCELLED", { status: "cancelled" });
  const search = await f.call("/sepay/orders?q=PREVIEW106", f.mgr);
  assert.equal(search.data.orders.length, 1);
  const preview = await f.call(
    "/sepay/orders/" + o.id + "?transactionId=" + e.id,
    f.mgr,
  );
  assert.equal(preview.status, 200);
  assert.equal(preview.data.canCreate, true);
  assert.equal(preview.data.debt.available, 100000);
  assert.equal((await f.db.select().from(customerPayments)).length, 0);
  await f.db.insert(customerPayments).values({
    id: crypto.randomUUID(),
    orderId: o.id,
    amount: 20000,
    paidAt: "2026-11-08",
    method: "transfer",
    createdBy: "mgr",
    createdAt: f.stamp,
  });
  assert.equal((await f.confirm(e.id, f.choice(o.id))).status, 409);
  assert.equal((await f.db.select().from(customerPayments)).length, 1);
  assert.equal((await f.call("/sepay/orders?q=x", f.mgr)).status, 400);
  assert.equal(
    (await f.call("/sepay/transactions/missing", f.accountant)).status,
    404,
  );
});
test("failed audit rolls back bank match and receipt together, retry after recovery posts once", async () => {
  const f = await setupSepay(),
    o = await f.order("ATOMIC107"),
    e = await f.incoming("Chờ xác nhận 107");
  await f.client.exec(
    "create function test_sepay_page_fail() returns trigger language plpgsql as $$ begin if NEW.action='sepay.confirm' then raise exception 'test audit failure'; end if; return NEW; end $$; create trigger test_sepay_page_fail before insert on audit_logs for each row execute function test_sepay_page_fail()",
  );
  assert.equal((await f.confirm(e.id, f.choice(o.id))).status, 500);
  assert.equal((await f.db.select().from(customerPayments)).length, 0);
  assert.equal(
    (
      await f.db
        .select()
        .from(sepayTransactions)
        .where(eq(sepayTransactions.id, e.id))
    )[0]!.status,
    "unmatched",
  );
  await f.client.exec("drop trigger test_sepay_page_fail on audit_logs");
  assert.equal((await f.confirm(e.id, f.choice(o.id))).status, 200);
});
test(
  "real PostgreSQL: confirmations against same event or same remaining debt serialize with webhook retries",
  { skip: !process.env.TEST_PG_URL },
  async () => {
    const f = await setupSepay();
    await f.client.exec(
      "create function test_sp_delay() returns trigger language plpgsql as $$ begin perform pg_sleep(0.2); return NEW; end $$; create trigger test_sp_delay before insert on customer_payments for each row execute function test_sp_delay()",
    );
    const a = await f.order("RACE108A"),
      b = await f.order("RACE108B"),
      event = await f.incoming("Cùng giao dịch chờ xác nhận 108");
    const rs = await Promise.all([
      f.confirm(event.id, f.choice(a.id)),
      f.confirm(event.id, f.choice(b.id)),
    ]);
    assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
    assert.equal((await f.db.select().from(customerPayments)).length, 1);
    const o = await f.order("RACE109"),
      x = await f.incoming("Chuyển một 109", 70000),
      y = await f.incoming("Chuyển hai 109", 70000);
    const r = await Promise.all([
      f.confirm(x.id, f.choice(o.id)),
      f.confirm(y.id, f.choice(o.id)),
    ]);
    assert.deepEqual(r.map((v) => v.status).sort(), [200, 409]);
    assert.equal(
      (
        await f.db
          .select()
          .from(customerPayments)
          .where(eq(customerPayments.orderId, o.id))
      ).reduce((n, p) => n + p.amount, 0),
      70000,
    );
    const linkedOrder = await f.order("RACELINK111"),
      pId = crypto.randomUUID();
    await f.db.insert(customerPayments).values({
      id: pId,
      orderId: linkedOrder.id,
      amount: 100000,
      paidAt: "2026-11-08",
      method: "transfer",
      createdBy: "mgr",
      createdAt: f.stamp,
    });
    const e1 = await f.incoming("Link existing one 111"),
      e2 = await f.incoming("Link existing two 111");
    const links = await Promise.all([
      f.confirm(e1.id, f.choice(linkedOrder.id, { existingPaymentId: pId })),
      f.confirm(e2.id, f.choice(linkedOrder.id, { existingPaymentId: pId })),
    ]);
    assert.deepEqual(links.map((v) => v.status).sort(), [200, 409]);
    const late = await f.incoming("LATE_WEBHOOK112"),
      lateOrder = await f.order("LATE_WEBHOOK112");
    const hook = async () => {
      const r = await f.router.handle(
        new Request("https://trial.test/api/staff/integrations/sepay/payment", {
          method: "POST",
          headers: {
            authorization: "Apikey test-sepay-key",
            "content-type": "application/json",
          },
          body: late.payload,
        }),
        f.env,
      );
      return { status: r.status, data: await r.json() };
    };
    const races = await Promise.all([
      f.confirm(late.id, f.choice(lateOrder.id)),
      hook(),
    ]);
    assert.ok(
      races.every((r) => r.status === 200),
      JSON.stringify(races),
    );
    assert.equal(
      (
        await f.db
          .select()
          .from(customerPayments)
          .where(eq(customerPayments.orderId, lateOrder.id))
      ).length,
      1,
    );
  },
);
