import { test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { setup } from "../helpers/pos-fixture.ts";
import {
  salesOrders,
  salesContracts,
  customerPayments,
  paymentSchedules,
} from "../../src/modules/sales/schema.ts";
import { posReturns } from "../../src/modules/sales/return-schema.ts";
import { sepayTransactions } from "../../src/modules/integrations/schema.ts";
import { returnAccount } from "../../src/modules/sales/api/pos-return-credit.ts";
import { financeCashflow } from "../../src/app/finance-readers.ts";
import { stockMoves } from "../../src/modules/inventory/schema.ts";
import { cashCollections } from "../../src/modules/sales/cash-collection-schema.ts";

async function fixture() {
  const f = await setup();
  f.env.sepayReceiptAccounts = ["123456"];
  const stamp = "2026-11-08T03:00:00.000Z";
  const order = async (
    no: string,
    extra: Partial<typeof salesOrders.$inferInsert> = {},
  ) => {
    const row = {
      id: crypto.randomUUID(),
      orderNo: no,
      quoteType: "HRC" as const,
      customerId: f.customerId,
      customerName: "Synthetic customer",
      ownerId: "emp",
      createdBy: "emp",
      orderDate: "2026-11-08",
      status: "confirmed" as const,
      subtotal: 100000,
      total: 100000,
      createdAt: stamp,
      updatedAt: stamp,
      ...extra,
    };
    await f.db.insert(salesOrders).values(row);
    await f.db.insert(paymentSchedules).values({
      id: crypto.randomUUID(),
      orderId: row.id,
      kind: "balance",
      amount: row.total,
      dueDate: "2026-11-08",
      createdAt: stamp,
    });
    return row;
  };
  const payload = (
    content: string,
    amount = 100000,
    extra: Record<string, unknown> = {},
  ) => ({
    id: crypto.randomUUID(),
    transferType: "in",
    transferAmount: amount,
    accountNumber: "123456",
    content,
    transactionDate: "2026-11-08 10:00:00",
    ...extra,
  });
  const hook = async (
    body: Record<string, unknown>,
    key = "test-sepay-key",
  ) => {
    const r = await f.router.handle(
      new Request("https://trial.test/api/staff/integrations/sepay/payment", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Apikey " + key,
        },
        body: JSON.stringify(body),
      }),
      f.env,
    );
    return {
      status: r.status,
      data: (await r.json()) as {
        status: string;
        duplicate: boolean;
        paymentId: string | null;
        orderId: string | null;
        error?: string;
      },
    };
  };
  const receipts = (id: string) =>
    f.db
      .select()
      .from(customerPayments)
      .where(eq(customerPayments.orderId, id));
  return { ...f, stamp, order, payload, hook, receipts };
}

test("SePay rejects unauthorized, outbound, fractional/oversized money and malformed timestamps without side effects", async () => {
  const f = await fixture(),
    o = await f.order("SAFETY101");
  for (const key of ["", "wrong"])
    assert.equal((await f.hook(f.payload(o.orderNo), key)).status, 401);
  for (const extra of [
    { transferType: "out" },
    { transferAmount: 0.1 },
    { transferAmount: 1e13 },
    { transactionDate: "" },
    { transactionDate: "2026-02-30 10:00:00" },
  ])
    assert.equal(
      (await f.hook(f.payload(o.orderNo, 100000, extra))).status,
      400,
    );
  assert.equal((await f.receipts(o.id)).length, 0);
  assert.equal((await f.db.select().from(sepayTransactions)).length, 0);
});

test("partial payments, exact replays and changed replays are safe; same-day finance includes the VN-date receipt", async () => {
  const f = await fixture(),
    o = await f.order("PAYMENTS102");
  const p = f.payload("Thanh toán " + o.orderNo, 30000, {
    transactionDate: "2026-11-08 00:10:00",
  });
  assert.equal((await f.hook(p)).data.status, "matched");
  assert.equal((await f.hook(p)).data.duplicate, true);
  for (const extra of [
    { transferAmount: 40000 },
    { accountNumber: "wrong" },
    { content: "changed" },
    { transactionDate: "2026-11-08 01:10:00" },
  ])
    assert.equal((await f.hook({ ...p, ...extra })).status, 409);
  assert.equal(
    (await f.hook(f.payload(o.orderNo, 70001))).data.status,
    "review",
  );
  assert.equal(
    (await f.hook(f.payload(o.orderNo, 70000))).data.status,
    "matched",
  );
  assert.equal((await f.hook(f.payload(o.orderNo, 1))).data.status, "review");
  const rows = await f.receipts(o.id);
  assert.deepEqual(
    rows.map((p) => p.amount).sort((a, b) => a - b),
    [30000, 70000],
  );
  assert.ok(rows.every((p) => p.paidAt === "2026-11-08"));
  const flow = await financeCashflow(f.db, {
    from: "2026-11-08",
    to: "2026-11-08",
    branch: "",
  });
  assert.equal(flow.in, 100000);
  assert.equal(
    (await f.db.select().from(stockMoves)).length,
    1,
    "receipts must not create stock movements",
  );
});

test("whole references prevent prefix/suffix false matches; quote, Sapo and Vietnamese HĐKT work", async () => {
  const f = await fixture(),
    prefix = await f.order("DH1");
  for (const text of ["DH10", "PDH1", "DH1EXT"])
    assert.equal((await f.hook(f.payload(text))).data.status, "unmatched");
  assert.equal((await f.receipts(prefix.id)).length, 0);
  const quote = await f.order("ORDERQUOTE103", {
    quoteNo: "HRC_BG_001_08112026",
  });
  assert.equal(
    (await f.hook(f.payload("Thanh toan HRC BG 001 08112026"))).data.orderId,
    quote.id,
  );
  const sapo = await f.order("ORDERSAPO104", { sapoOrderCode: "440005991" });
  assert.equal((await f.hook(f.payload("TT 440005991"))).data.orderId, sapo.id);
  const contract = await f.order("ORDERCONTRACT105");
  await f.db.insert(salesContracts).values({
    id: crypto.randomUUID(),
    contractNo: "11-08/08112026/HĐKT/VG-CUSTOMER105",
    orderId: contract.id,
    legalEntity: "VG",
    status: "signed",
    value: 100000,
    createdBy: "emp",
    createdAt: f.stamp,
    updatedAt: f.stamp,
  });
  assert.equal(
    (
      await f.hook(
        f.payload("Thanh toán 11-08/08112026/HĐKT/VG-CUSTOMER105 FT777"),
      )
    ).data.orderId,
    contract.id,
  );
  const a = await f.order("AMBIGUOUSA106"),
    b = await f.order("AMBIGUOUSB106");
  assert.equal(
    (await f.hook(f.payload(a.orderNo + " " + b.orderNo))).data.status,
    "review",
  );
});

test("signed draft contracts count as debt; unsigned drafts and cancelled orders do not", async () => {
  const f = await fixture();
  for (const status of ["signed", "completed", "draft", "cancelled"] as const) {
    const o = await f.order("DRAFT" + status.toUpperCase(), {
      status: "draft",
    });
    await f.db.insert(salesContracts).values({
      id: crypto.randomUUID(),
      contractNo: "CONTRACT" + status.toUpperCase(),
      orderId: o.id,
      legalEntity: "BN",
      status,
      value: 100000,
      createdBy: "emp",
      createdAt: f.stamp,
      updatedAt: f.stamp,
    });
    assert.equal(
      (await f.hook(f.payload(o.orderNo))).data.status,
      status === "signed" || status === "completed" ? "matched" : "unmatched",
    );
  }
  const cancelled = await f.order("CANCELLED107", { status: "cancelled" });
  assert.equal(
    (await f.hook(f.payload(cancelled.orderNo))).data.status,
    "unmatched",
  );
});

test("unknown account or absent allowlist stays review; POS remains in the POS receipt/QR flow", async () => {
  const f = await fixture(),
    o = await f.order("ACCOUNT108");
  assert.equal(
    (await f.hook(f.payload(o.orderNo, 100000, { accountNumber: "999999" })))
      .data.status,
    "review",
  );
  f.env.sepayReceiptAccounts = undefined;
  assert.equal((await f.hook(f.payload(o.orderNo))).data.status, "review");
  f.env.sepayReceiptAccounts = ["123456"];
  const pos = await f.order("POS109", { channel: "pos" });
  assert.equal((await f.hook(f.payload(pos.orderNo))).data.status, "review");
  assert.equal((await f.receipts(pos.id)).length, 0);
});

test("effective return credit and voided receipts use canonical net debt", async () => {
  const f = await fixture(),
    o = await f.order("RETURNCREDIT110");
  await f.db.insert(posReturns).values({
    id: crypto.randomUUID(),
    returnNo: "RETURN110",
    source: "crm",
    orderId: o.id,
    warehouseId: "pos-wh",
    kind: "return",
    status: "completed",
    reason: "Synthetic credit",
    subtotal: 60000,
    total: 60000,
    sourceSnapshot: "{}",
    requestKey: crypto.randomUUID(),
    createdBy: "mgr",
    createdAt: f.stamp,
    updatedAt: f.stamp,
    creditEffectiveAt: f.stamp,
  });
  await f.db.insert(customerPayments).values({
    id: crypto.randomUUID(),
    orderId: o.id,
    amount: 100000,
    paidAt: "2026-11-08",
    createdBy: "mgr",
    createdAt: f.stamp,
    voidedAt: f.stamp,
    voidedBy: "mgr",
    voidReason: "Synthetic void",
  });
  assert.equal((await returnAccount(f.db, o.id)).balance, 40000);
  assert.equal(
    (await f.hook(f.payload(o.orderNo, 70000))).data.status,
    "review",
  );
  assert.equal(
    (await f.hook(f.payload(o.orderNo, 40000))).data.status,
    "matched",
  );
  assert.equal((await returnAccount(f.db, o.id)).balance, 0);
});

test("pending transactions can reconcile after order/config exists; matched or voided receipts never resurrect on replay", async () => {
  const f = await fixture(),
    p = f.payload("LATEORDER111");
  assert.equal((await f.hook(p)).data.status, "unmatched");
  const o = await f.order("LATEORDER111");
  assert.equal((await f.hook(p)).data.status, "matched");
  const [receipt] = await f.receipts(o.id);
  await f.db
    .update(customerPayments)
    .set({ voidedAt: f.stamp, voidedBy: "mgr", voidReason: "Synthetic void" })
    .where(eq(customerPayments.id, receipt!.id));
  assert.equal((await f.hook(p)).data.duplicate, true);
  assert.equal((await f.receipts(o.id)).length, 1);
  assert.equal((await f.db.select().from(sepayTransactions)).length, 1);
});

test("SePay respects cash already held by staff awaiting confirmation", async () => {
  const f = await fixture(),
    o = await f.order("HELDCASH116");
  await f.db.insert(cashCollections).values({
    id: crypto.randomUUID(),
    orderId: o.id,
    requestKey: crypto.randomUUID(),
    amount: 60000,
    paidAt: "2026-11-08",
    collectedBy: "emp",
    createdAt: f.stamp,
    status: "held",
  });
  assert.equal(
    (await f.hook(f.payload(o.orderNo, 70000))).data.status,
    "review",
  );
  assert.equal(
    (await f.hook(f.payload(o.orderNo, 40000))).data.status,
    "matched",
  );
  assert.equal((await f.receipts(o.id)).length, 1);
});

test("SePay follows the receivables schedule instead of assuming original order total is collectible", async () => {
  const f = await fixture(),
    o = await f.order("DEBTSCHEDULE118");
  await f.db
    .update(paymentSchedules)
    .set({ amount: 40000 })
    .where(eq(paymentSchedules.orderId, o.id));
  assert.equal(
    (await f.hook(f.payload(o.orderNo, 70000))).data.status,
    "review",
  );
  assert.equal(
    (await f.hook(f.payload(o.orderNo, 40000))).data.status,
    "matched",
  );
  const missing = await f.order("MISSINGSCHEDULE119");
  await f.db
    .delete(paymentSchedules)
    .where(eq(paymentSchedules.orderId, missing.id));
  assert.equal(
    (await f.hook(f.payload(missing.orderNo))).data.status,
    "review",
  );
});

test("manual transfers matching bank evidence are reviewed; distinct transfers and voided receipts remain collectable", async () => {
  const f = await fixture(),
    o = await f.order("MANUALOVERLAP122");
  const id = crypto.randomUUID();
  await f.db
    .insert(customerPayments)
    .values({
      id,
      orderId: o.id,
      amount: 30000,
      paidAt: "2026-11-08",
      method: "transfer",
      createdBy: "mgr",
      createdAt: f.stamp,
      reference: "Bank statement entered manually",
    });
  const p = f.payload(o.orderNo, 30000);
  assert.equal((await f.hook(p)).data.status, "review");
  assert.equal((await f.receipts(o.id)).length, 1);
  assert.equal(
    (await f.hook(f.payload(o.orderNo, 40000))).data.status,
    "matched",
  );
  await f.db
    .update(customerPayments)
    .set({
      voidedAt: f.stamp,
      voidedBy: "mgr",
      voidReason: "Duplicate manual receipt corrected in test",
    })
    .where(eq(customerPayments.id, id));
  assert.equal((await f.hook(p)).data.status, "matched");
  assert.equal((await f.hook(p)).data.duplicate, true);
  const differentDay = await f.order("MANUALOTHERDAY123");
  await f.db
    .insert(customerPayments)
    .values({
      id: crypto.randomUUID(),
      orderId: differentDay.id,
      amount: 30000,
      paidAt: "2026-11-07",
      method: "transfer",
      createdBy: "mgr",
      createdAt: f.stamp,
    });
  assert.equal(
    (await f.hook(f.payload(differentDay.orderNo, 30000))).data.status,
    "matched",
  );
  const sameReference = await f.order("MANUALREFERENCE124");
  const event = f.payload(sameReference.orderNo, 30000);
  await f.db
    .insert(customerPayments)
    .values({
      id: crypto.randomUUID(),
      orderId: sameReference.id,
      amount: 20000,
      paidAt: "2026-11-07",
      method: "transfer",
      createdBy: "mgr",
      createdAt: f.stamp,
      reference: "SEPAY:" + event.id,
    });
  assert.equal((await f.hook(event)).data.status, "review");
});

test("Manager-only reconciliation APIs validate status/missing IDs, audit and never duplicate a receipt", async () => {
  const f = await fixture(),
    o = await f.order("RECONCILE112");
  f.env.sepayReceiptAccounts = undefined;
  await f.hook(f.payload(o.orderNo));
  const path = "/admin/sepay-transactions";
  assert.equal((await f.call(path)).status, 401);
  assert.equal((await f.call(path, f.emp)).status, 403);
  assert.equal((await f.call(path, f.ncc)).status, 403);
  assert.equal((await f.call(path + "?status=invalid", f.mgr)).status, 400);
  const list = await f.call(path, f.mgr);
  assert.equal(list.status, 200);
  const id = list.data.transactions[0].id;
  assert.ok(!JSON.stringify(list.data).includes("payload"));
  assert.equal(
    (await f.call(path + "/missing/reconcile", f.mgr, "POST", {})).status,
    404,
  );
  assert.equal(
    (await f.call(path + "/" + id + "/reconcile", f.emp, "POST", {})).status,
    403,
  );
  f.env.sepayReceiptAccounts = ["123456"];
  const done = await f.call(path + "/" + id + "/reconcile", f.mgr, "POST", {});
  assert.equal(done.status, 200, JSON.stringify(done.data));
  assert.equal(done.data.status, "matched");
  assert.equal(
    (await f.call(path + "/" + id + "/reconcile", f.mgr, "POST", {})).data
      .duplicate,
    true,
  );
  assert.equal((await f.receipts(o.id)).length, 1);
  assert.equal((await f.receipts(o.id))[0]!.createdBy, "mgr");
  const bad = f.payload("BADPAYLOAD117");
  await f.hook(bad);
  const [stored] = await f.db
    .select()
    .from(sepayTransactions)
    .where(eq(sepayTransactions.providerId, bad.id));
  await f.db
    .update(sepayTransactions)
    .set({ payload: "{" })
    .where(eq(sepayTransactions.id, stored!.id));
  assert.equal(
    (await f.call(path + "/" + stored!.id + "/reconcile", f.mgr, "POST", {}))
      .status,
    409,
  );
});

test("DB failure rolls back both receipt and inbox; retry after recovery posts exactly once", async () => {
  const f = await fixture(),
    o = await f.order("ROLLBACK113"),
    p = f.payload(o.orderNo);
  await f.client.exec(
    "create function test_sepay_fail() returns trigger language plpgsql as $$ begin raise exception 'test-only insert failure'; end $$; create trigger test_sepay_fail before insert on sepay_transactions for each row execute function test_sepay_fail()",
  );
  assert.equal((await f.hook(p)).status, 500);
  assert.equal((await f.receipts(o.id)).length, 0);
  assert.equal((await f.db.select().from(sepayTransactions)).length, 0);
  await f.client.exec("drop trigger test_sepay_fail on sepay_transactions");
  assert.equal((await f.hook(p)).data.status, "matched");
  assert.equal((await f.receipts(o.id)).length, 1);
});

test("SePay migration readiness gate is read-only and rejects a missing deduplication index", async () => {
  const f = await fixture();
  const gate = readFileSync(
    new URL("../../scripts/sql/assert-sepay-transactions.sql", import.meta.url),
    "utf8",
  );
  await f.db.transaction(
    async (tx) => {
      await tx.execute(sql.raw(gate));
    },
    { accessMode: "read only" },
  );
  await f.client.exec("drop index uq_sepay_transactions_provider");
  await assert.rejects(f.client.exec(gate), /chống trùng/);
});

test(
  "real PostgreSQL: same-ID replays dedupe and different-ID transfers cannot jointly exceed debt",
  { skip: !process.env.TEST_PG_URL },
  async () => {
    const f = await fixture();
    await f.client.exec(
      "create function test_sepay_delay() returns trigger language plpgsql as $$ begin perform pg_sleep(0.3); return NEW; end $$; create trigger test_sepay_delay before insert on customer_payments for each row execute function test_sepay_delay()",
    );
    for (const same of [true, false]) {
      const o = await f.order(same ? "RACESAME114" : "RACEDIFFERENT115");
      const p = f.payload(o.orderNo, same ? 100000 : 70000);
      const results = await Promise.all([
        f.hook(p),
        f.hook(same ? p : { ...p, id: crypto.randomUUID() }),
      ]);
      assert.ok(
        results.every((r) => r.status === 200),
        JSON.stringify(results),
      );
      assert.equal((await f.receipts(o.id)).length, 1);
      assert.equal((await f.receipts(o.id))[0]!.amount, same ? 100000 : 70000);
      if (!same) assert.ok(results.some((r) => r.data.status === "review"));
    }
    const manual = await f.order("RACEMANUAL120");
    const mixed = await Promise.all([
      f.hook(f.payload(manual.orderNo, 70000)),
      f.call("/payments", f.mgr, "POST", {
        orderId: manual.id,
        amount: 70000,
        paidAt: "2026-11-08",
        method: "transfer",
        key: crypto.randomUUID(),
      }),
    ]);
    assert.equal(mixed[0].status, 200);
    assert.ok([201, 400].includes(mixed[1].status), JSON.stringify(mixed));
    assert.equal(
      (await f.receipts(manual.id)).reduce((n, p) => n + p.amount, 0),
      70000,
    );
    const cancel = await f.order("RACECANCEL121");
    await Promise.all([
      f.hook(f.payload(cancel.orderNo, 70000)),
      f.call("/orders/" + cancel.id + "/status", f.mgr, "PUT", {
        status: "cancelled",
      }),
    ]);
    const [fresh] = await f.db
      .select()
      .from(salesOrders)
      .where(eq(salesOrders.id, cancel.id));
    assert.ok(
      fresh!.status !== "cancelled" ||
        (await f.receipts(cancel.id)).length === 0,
      "a cancelled order cannot acquire a concurrent receipt",
    );
  },
);
