import { test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { setupSepay } from "../helpers/sepay-fixture.ts";
import { sepayTransactions as bank } from "../../src/modules/integrations/schema.ts";
import {
  customerPayments as receipts,
  salesContracts,
} from "../../src/modules/sales/schema.ts";
import {
  posRegisters,
  webStoreOrders as web,
} from "../../src/modules/sales/pos-schema.ts";
import { retryNearbySepay } from "../../src/modules/sales/api/sepay-nearby-retry.ts";
const at = "2026-11-08T03:00:00.000Z",
  later = "2026-11-08T03:06:00.000Z";
async function fixture() {
  const f = await setupSepay();
  f.env.nowSec = () => Date.parse(later) / 1000;
  const shift = await f.open();
  let sequence = 0;
  const pos = async (createdAt = at, amount = 100000, withReceipt = true) => {
    const order = await f.order("POS_TEST_" + ++sequence, {
      channel: "pos",
      shiftId: shift.id,
      status: "delivered",
      total: amount,
      subtotal: amount,
      createdAt,
      orderDate: new Date(Date.parse(createdAt) + 7 * 3600000)
        .toISOString()
        .slice(0, 10),
    });
    const receiptId = crypto.randomUUID();
    if (withReceipt)
      await f.db.insert(receipts).values({
        id: receiptId,
        orderId: order.id,
        customerId: f.customerId,
        shiftId: shift.id,
        amount,
        method: "transfer",
        paymentSource: "pos",
        paidAt: new Date(Date.parse(createdAt) + 7 * 3600000)
          .toISOString()
          .slice(0, 10),
        createdBy: "emp",
        createdAt,
      });
    return { ...order, receiptId };
  };
  const website = async (
    createdAt = at,
    extra: Partial<typeof web.$inferInsert> = {},
  ) => {
    const id = crypto.randomUUID();
    const row = {
      id,
      externalId: String(++sequence),
      source: "lock",
      orderNo: "WEB_TEST_" + sequence,
      registerId: f.registerId,
      status: "on-hold",
      customerName: "Khách web thử",
      paymentMethod: "SePay QR",
      total: 100000,
      currency: "VND",
      orderedAt: createdAt,
      orderedAtVerified: true,
      updatedAt: createdAt,
      financialSnapshot: JSON.stringify({
        version: 1,
        coupons: [],
        fees: [],
        shipping: [],
        payment: { paidAt: null },
      }),
      ...extra,
    };
    await f.db.insert(web).values(row);
    return row;
  };
  return { ...f, pos, website };
}
test("unreferenced POS amount/time links its existing transfer receipt once, never adds money to the shift", async () => {
  const f = await fixture(),
    order = await f.pos();
  const e = await f.incoming("Khach chuyen khoan", 100000, { id: "pos-near" });
  assert.equal(e.status, "matched");
  assert.equal(e.orderId, order.id);
  assert.equal(e.paymentId, order.receiptId);
  assert.equal((await f.db.select().from(receipts)).length, 1);
  await f.incoming("Khach chuyen khoan", 100000, { id: "pos-near" });
  assert.equal((await f.db.select().from(receipts)).length, 1);
  const second = await f.incoming("Khach chuyen khoan", 100000, {
    id: "pos-other",
  });
  assert.equal(second.status, "review");
  assert.equal(second.paymentId, null);
  const original = (await f.db.select().from(receipts))[0]!;
  assert.equal(original.shiftId, order.shiftId);
  assert.equal(original.paymentSource, "pos");
  assert.equal(original.amount, 100000);
});
test("bank first, order two minutes later: worker waits for future window, then reconciles without another webhook", async () => {
  const f = await fixture();
  f.env.nowSec = () => Date.parse(at) / 1000;
  const e = await f.incoming("Khach gui tien truoc");
  assert.equal(e.status, "review");
  const order = await f.pos("2026-11-08T03:02:00.000Z");
  await retryNearbySepay(f.env);
  assert.equal((await f.db.select().from(bank))[0]!.status, "review");
  f.env.nowSec = () => Date.parse(later) / 1000;
  f.env.sepayApiToken = "LOCAL_TEST_SEPAY_TOKEN";
  f.env.sepayApiFetch = async (input) =>
    Response.json(
      String(input).includes("/count")
        ? { status: 200, count_transactions: 0 }
        : { status: 200, transactions: [] },
    );
  const pulled = await f.call("/sepay/pull-today", f.mgr, "POST", {});
  assert.equal(pulled.status, 200, JSON.stringify(pulled.data));
  assert.equal(pulled.data.nearbyMatched, 1);
  assert.equal(pulled.data.receiptsCreated, 0);
  const [result] = await f.db.select().from(bank);
  assert.equal(result!.orderId, order.id);
  assert.equal(result!.paymentId, order.receiptId);
  assert.equal((await retryNearbySepay(f.env)).matched, 0);
});
test("web transfer evidence marks CRM document paid without changing Woo date_paid, stock, or adding a CRM receipt", async () => {
  const f = await fixture(),
    order = await f.website("2026-11-08T02:58:00.000Z");
  const e = await f.incoming("Chuyen tien mua hang");
  assert.equal(e.status, "matched");
  assert.equal(e.webOrderId, order.id);
  assert.equal(e.orderId, null);
  assert.equal(e.paymentId, null);
  assert.equal((await f.db.select().from(receipts)).length, 0);
  assert.equal(
    (await f.db.select().from(web))[0]!.financialSnapshot,
    order.financialSnapshot,
  );
  const detail = await f.call("/orders/web:" + order.id, f.mgr);
  assert.equal(detail.status, 200, JSON.stringify(detail.data));
  assert.equal(detail.data.document.paid, 100000);
  const inbox = await f.call(
    "/sepay/transactions?from=2026-11-08&to=2026-11-08",
    f.other,
  );
  assert.equal(inbox.status, 200, JSON.stringify(inbox.data));
  assert.equal(inbox.data.summary.postedCount, 1);
  assert.equal(inbox.data.summary.issueCount, 0);
  await f.db.update(web).set({ total: 100001 }).where(eq(web.id, order.id));
  const changed = await f.call(
    "/sepay/transactions?from=2026-11-08&to=2026-11-08",
    f.other,
  );
  assert.equal(changed.data.summary.issueCount, 1);
});
test("POS and web with equal money/time are ambiguous even if one is nearer; Manager can link a selected receipt", async () => {
  const f = await fixture(),
    order = await f.pos();
  await f.website("2026-11-08T03:01:00.000Z");
  const e = await f.incoming("Khach khong ghi ma");
  assert.equal(e.status, "review");
  assert.equal(e.paymentId, null);
  const preview = await f.call(
    "/sepay/orders/" + order.id + "?transactionId=" + e.id,
    f.mgr,
  );
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
  assert.equal(preview.data.recordMode, "pos-link");
  assert.equal(preview.data.existingReceipts[0].id, order.receiptId);
  assert.equal(
    (
      await f.confirm(
        e.id,
        f.choice(order.id, { existingPaymentId: order.receiptId }),
        f.other,
      )
    ).status,
    403,
  );
  const posted = await f.confirm(
    e.id,
    f.choice(order.id, { existingPaymentId: order.receiptId }),
  );
  assert.equal(posted.status, 200, JSON.stringify(posted.data));
  assert.equal(
    (
      await f.confirm(
        e.id,
        f.choice(order.id, { existingPaymentId: order.receiptId }),
      )
    ).status,
    200,
  );
  assert.equal((await f.db.select().from(receipts)).length, 1);
});
test("manual web choice is exact, audited, Manager-only and never creates a CRM payment", async () => {
  const f = await fixture(),
    order = await f.website("2026-11-08T01:00:00.000Z");
  const e = await f.incoming("Khach chuyen sai ma");
  assert.notEqual(e.status, "matched");
  const preview = await f.call(
    "/sepay/orders/web:" + order.id + "?transactionId=" + e.id,
    f.mgr,
  );
  assert.equal(preview.status, 200, JSON.stringify(preview.data));
  assert.equal(preview.data.canCreate, true);
  assert.equal(preview.data.recordMode, "web-link");
  const posted = await f.confirm(e.id, f.choice("web:" + order.id));
  assert.equal(posted.status, 200, JSON.stringify(posted.data));
  assert.equal(posted.data.webOrderId, order.id);
  assert.equal(
    (await f.confirm(e.id, f.choice("web:" + order.id))).status,
    200,
  );
  assert.equal((await f.db.select().from(receipts)).length, 0);
  const history = await f.call("/sepay/transactions/" + e.id, f.mgr);
  assert.ok(
    history.data.history.some((r: { reason: string }) =>
      r.reason.includes("Đã đối chiếu"),
    ),
  );
});
test("amount mismatch, wrong account, excluded timestamps, COD and cancelled source never auto-match", async () => {
  const f = await fixture();
  await f.pos("2026-11-08T02:54:59.999Z");
  await f.website(at, { paymentMethod: "COD" });
  await f.website(at, { status: "cancelled" });
  for (const extra of [
    { id: "no-exact" },
    { id: "wrong-bank", accountNumber: "999999" },
  ])
    assert.notEqual(
      (await f.incoming("Khach thanh toan", 100000, extra)).status,
      "matched",
    );
  const w = await f.website(at, { total: 99999 });
  assert.notEqual(
    (await f.incoming("Khach thanh toan", 100000, { id: "off-one" })).status,
    "matched",
  );
  const e = (
    await f.db.select().from(bank).where(eq(bank.providerId, "off-one"))
  )[0]!;
  assert.equal((await f.confirm(e.id, f.choice("web:" + w.id))).status, 409);
  assert.equal(
    (await f.db.select().from(receipts)).length,
    1,
    "no extra receipt on any blocked match",
  );
});
test("POS without an existing transfer receipt is held for the original POS/COD workflow", async () => {
  const f = await fixture(),
    order = await f.pos(at, 100000, false);
  const e = await f.incoming("Khach chuyen khoan");
  assert.equal(e.status, "review");
  assert.equal(e.paymentId, null);
  assert.equal((await f.confirm(e.id, f.choice(order.id))).status, 409);
  assert.equal((await f.db.select().from(receipts)).length, 0);
});
test("manual picker lists POS/web/CRM/contracts without a search string, filters date/amount/source and paginates", async () => {
  const f = await fixture();
  await f.pos();
  await f.website();
  const crm = await f.order("CRM_FILTER");
  const contract = await f.order("CONTRACT_FILTER");
  await f.db.insert(salesContracts).values({
    id: crypto.randomUUID(),
    orderId: contract.id,
    contractNo: "HDKT_FILTER",
    legalEntity: "BN",
    status: "signed",
    createdBy: "mgr",
    createdAt: at,
    updatedAt: at,
  });
  const path = "/sepay/orders?from=2026-11-08&to=2026-11-08";
  for (const [source, kind] of [
    ["pos", "pos"],
    ["web", "web"],
    ["crm", "crm"],
    ["contract", "contract"],
  ]) {
    const r = await f.call(path + "&source=" + source, f.mgr);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.ok(r.data.orders.length);
    assert.ok(r.data.orders.every((x: { kind: string }) => x.kind === kind));
  }
  assert.equal(
    (await f.call(path + "&min=100001", f.mgr)).data.orders.length,
    0,
  );
  assert.equal(
    (await f.call(path + "&q=CRM_FILTER", f.mgr)).data.orders[0].id,
    crm.id,
  );
  for (let i = 0; i < 22; i++) await f.order("CRM_PAGE_" + i);
  const first = await f.call(path + "&source=crm", f.mgr),
    next = await f.call(path + "&source=crm&offset=20", f.mgr);
  assert.equal(first.data.orders.length, 20);
  assert.equal(first.data.hasMore, true);
  assert.equal(next.data.orders.length, 3);
  assert.ok(
    !next.data.orders.some((x: { id: string }) =>
      first.data.orders.some((y: { id: string }) => x.id === y.id),
    ),
  );
  assert.equal((await f.call(path, f.other)).status, 403);
  for (const query of [
    "source=bad",
    "min=1.5",
    "offset=-1",
    "from=bad",
    "from=2026-11-09&to=2026-11-08",
  ])
    assert.equal(
      (await f.call("/sepay/orders?" + query, f.mgr)).status,
      400,
      query,
    );
});
test("failure writing audit rolls back the bank match and preserves the original receipt", async () => {
  const f = await fixture();
  await f.pos();
  await f.db.execute(
    sql`create function fail_nearby_audit() returns trigger language plpgsql as $$ begin if new.action='sepay.nearby-match' then raise exception 'injected audit failure'; end if;return new;end $$`,
  );
  await f.db.execute(
    sql`create trigger fail_nearby before insert on audit_logs for each row execute function fail_nearby_audit()`,
  );
  await assert.rejects(f.incoming("Khach thanh toan"), /500|Lỗi|injected/);
  assert.equal((await f.db.select().from(bank)).length, 0);
  assert.equal((await f.db.select().from(receipts)).length, 1);
});

test("a transfer crossing Vietnam midnight links the POS receipt from the preceding day", async () => {
  const f = await fixture();
  const o = await f.pos("2026-11-07T16:59:00.000Z");
  f.env.nowSec = () => Date.parse("2026-11-07T17:07:00.000Z") / 1000;
  const e = await f.incoming("Khach chuyen sau nua dem", 100000, {
    transactionDate: "2026-11-08 00:01:00",
  });
  assert.equal(e.status, "matched");
  assert.equal(e.paymentId, o.receiptId);
  assert.equal(
    (await f.db.select().from(receipts))[0]!.paidAt,
    "2026-11-07",
    "historical receipt date is preserved",
  );
});
test("unverified source creation time never auto-matches; manual bank proof can still be selected", async () => {
  const f = await fixture(),
    w = await f.website(at, { orderedAtVerified: false });
  const e = await f.incoming("Khach gui tien");
  assert.equal(e.status, "review");
  assert.match(e.reason, /thời điểm tạo/);
  assert.equal((await f.confirm(e.id, f.choice("web:" + w.id))).status, 200);
  const [row] = await f.db.select().from(bank);
  assert.equal(row!.matchMethod, "manual");
});
test("a changed web creation timestamp invalidates a match made by amount/time", async () => {
  const f = await fixture(),
    w = await f.website();
  const e = await f.incoming("Tien mua hang");
  assert.equal(e.status, "matched");
  assert.equal(e.matchMethod, "amount_time");
  await f.db
    .update(web)
    .set({ orderedAt: "2026-11-08T01:00:00.000Z" })
    .where(eq(web.id, w.id));
  const list = await f.call(
    "/sepay/transactions?from=2026-11-08&to=2026-11-08",
    f.mgr,
  );
  assert.equal(list.data.summary.issueCount, 1);
});
test("a bounded overflow is review, and the retry worker preserves conflicting explicit web/CRM references", async () => {
  const f = await fixture();
  for (let i = 0; i < 51; i++)
    await f.website(at, { externalId: "overflow-" + i });
  const e = await f.incoming("Nhieu don cung gio");
  assert.equal(e.status, "review");
  assert.equal(e.webOrderId, null);
  const g = await fixture();
  await g.website(at, { externalId: "21661" });
  await g.order("DH21661");
  const conflict = await g.incoming("DH21661");
  assert.equal(conflict.status, "review");
  await retryNearbySepay(g.env);
  const [row] = await g.db.select().from(bank);
  assert.equal(row!.status, "review");
  assert.equal(row!.webOrderId, null);
});
test(
  "real PostgreSQL: duplicate providers, competing transfers and manual/worker races bind a receipt exactly once",
  { skip: !process.env.TEST_PG_URL },
  async () => {
    const f = await fixture(),
      o = await f.pos();
    await Promise.all([
      f.incoming("Khach thanh toan", 100000, { id: "same" }),
      f.incoming("Khach thanh toan", 100000, { id: "same" }),
    ]);
    assert.equal((await f.db.select().from(bank)).length, 1);
    assert.equal((await f.db.select().from(receipts)).length, 1);
    const g = await fixture();
    await g.pos();
    await Promise.all([
      g.incoming("Khach chuyen khoan", 100000, { id: "first" }),
      g.incoming("Khach chuyen khoan", 100000, { id: "second" }),
    ]);
    const rows = await g.db.select().from(bank);
    assert.equal(rows.filter((r) => r.status === "matched").length, 1);
    assert.equal(rows.filter((r) => r.status === "review").length, 1);
    const h = await fixture(),
      target = await h.pos();
    h.env.nowSec = () => Date.parse(at) / 1000;
    const pending = await h.incoming("Khach dang cho doi soat");
    h.env.nowSec = () => Date.parse(later) / 1000;
    const [manual] = await Promise.all([
      h.confirm(
        pending.id,
        h.choice(target.id, { existingPaymentId: target.receiptId }),
      ),
      retryNearbySepay(h.env),
    ]);
    assert.equal(manual.status, 200, JSON.stringify(manual.data));
    assert.equal(
      (await h.db.select().from(bank))[0]!.paymentId,
      target.receiptId,
    );
    assert.equal((await h.db.select().from(receipts)).length, 1);
  },
);

test("Woo creation time is verified from the original timestamp and survives status-only/null updates", async () => {
  const f = await fixture();
  await f.db
    .update(posRegisters)
    .set({ name: "CỬA HÀNG LOCKNLOCK CẦN THƠ" })
    .where(eq(posRegisters.id, f.registerId));
  const path = "/integrations/woocommerce/lock/order?token=test-lock-token";
  const input = {
    id: 912345,
    number: "912345",
    status: "on-hold",
    total: "100000",
    currency: "VND",
    payment_method_title: "SePay QR",
    date_created: "2026-11-08T10:00:00",
    billing: { first_name: "Khách test" },
    line_items: [],
  };
  const first = await f.call(path, "", "POST", input);
  assert.equal(first.status, 200, JSON.stringify(first.data));
  const read = async () =>
    (await f.db.select().from(web).where(eq(web.externalId, "912345")))[0]!;
  assert.equal((await read()).orderedAt, at);
  assert.equal((await read()).orderedAtVerified, true);
  for (const patch of [
    { id: 912345, status: "pending" },
    {
      id: 912345,
      status: "on-hold",
      date_created: null,
      date_created_gmt: null,
    },
  ]) {
    const result = await f.call(path, "", "POST", patch);
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal((await read()).orderedAt, at);
    assert.equal((await read()).orderedAtVerified, true);
  }
  const invalid = await f.call(path, "", "POST", {
    id: 912345,
    date_created: "2026-11-08T25:00:00",
  });
  assert.equal(invalid.status, 400);
  assert.equal((await read()).orderedAt, at);
});
