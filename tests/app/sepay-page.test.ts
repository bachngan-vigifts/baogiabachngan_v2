import {defaultSepayCrmAccount} from '../../src/modules/sales/domain/sepay-crm-account.ts';
import {posRegisters} from '../../src/modules/sales/pos-schema.ts';
import { customers } from '../../src/modules/customers/schema.ts';
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
    e = await f.incoming("Khoản chưa khớp 104",100000,{accountNumber:"654321"}),
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
  f.env.sepayReceiptAccounts = ["654321"];
  for (const extra of [
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
    true,
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
test("preview is read-only and fresh debt is rechecked at confirmation; search excludes POS/cancelled and marks drafts", async () => {
  const f = await setupSepay(),
    o = await f.order("PREVIEW106"),
    e = await f.incoming("Chờ chọn đúng khách 106");
  await f.order("PREVIEW106POS", { channel: "pos" });
  await f.order("PREVIEW106DRAFT", { status: "draft" });
  await f.order("PREVIEW106CANCELLED", { status: "cancelled" });
  const search = await f.call("/sepay/orders?q=PREVIEW106&source=crm", f.mgr);
  assert.equal(search.data.orders.length, 2);
  assert.equal(search.data.orders.find((r: any) => r.id === o.id).selectable, true);
  assert.equal(search.data.orders.find((r: any) => r.status === "draft").selectable, true);
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
  assert.equal((await f.call("/sepay/orders?q=x", f.mgr)).status, 200);
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

test("SePay picker lists real documents, searches canonical customer/code, filters and paginates without weakening receipt guards", async () => {
  const f = await setupSepay();
  await f.db.update(customers).set({name: "CÔNG TY XƯƠNG LỢI".normalize("NFD"), contact:"Chị Lan", customerCode:"KH_XL"}).where(eq(customers.id,f.customerId));
  const draft = await f.order("DH_007_06112026",{customerName:"Người liên hệ",status:"draft",orderDate:"2026-11-06"});
  const contract = {id:crypto.randomUUID(),orderId:draft.id,customerId:f.customerId,contractNo:"11-03/06112026/HĐKT/VG-0822909229",legalEntity:"VG" as const,status:"draft" as const,createdBy:"mgr",createdAt:f.stamp,updatedAt:f.stamp};
  await f.db.insert(salesContracts).values(contract);
  const e = await f.incoming("Chờ đối soát khách Xương Lợi");
  for (const q of ["xưởng lợi", "LOI XUONG", "KH_XL", "Chị Lan", "110306112026HDKTVG0822909229"]) {
    const r = await f.call("/sepay/orders?q="+encodeURIComponent(q),f.mgr);
    assert.equal(r.status,200);
    assert.equal(r.data.orders[0].id,draft.id,q);
    assert.equal(r.data.orders[0].selectable,true);
  }
  const preview = await f.call('/sepay/orders/'+draft.id+'?transactionId='+e.id,f.mgr);
  assert.equal(preview.status,200); assert.equal(preview.data.canCreate,true);
  assert.match(preview.data.warning,/còn nháp/);
  assert.equal((await f.confirm(e.id,f.choice(draft.id),f.accountant)).status,403);
  assert.equal((await f.call("/sepay/orders?eligibility=eligible",f.mgr)).data.orders.length,1);
  await f.db.update(salesContracts).set({status:"signed"}).where(eq(salesContracts.id,contract.id));
  assert.equal((await f.call("/sepay/orders?kind=contract&eligibility=eligible",f.mgr)).data.orders[0].selectable,true);
  await f.order("XL_CANCELLED",{status:"cancelled"});
  await f.order("XL_POS",{channel:"pos"});
  for(let i=0;i<22;i++) await f.order("XL_"+String(i).padStart(2,"0"));
  const page1 = await f.call("/sepay/orders?kind=all",f.mgr), page2 = await f.call("/sepay/orders?kind=all&offset=20",f.mgr);
  assert.equal(page1.data.orders.length,20);assert.equal(page1.data.hasMore,true);
  assert.equal(page2.data.orders.length,3);assert.equal(page2.data.hasMore,false);
  assert.equal(new Set([...page1.data.orders,...page2.data.orders].map((o:any)=>o.id)).size,23);
  assert.equal((await f.call("/sepay/orders?kind=contract&from=2026-11-06&to=2026-11-06",f.mgr)).data.orders.length,1);
  assert.equal((await f.call("/sepay/orders?kind=contract&from=2026-11-07",f.mgr)).data.orders.length,0);
  const cancelled = await f.call("/sepay/orders?eligibility=cancelled",f.mgr);
  assert.equal(cancelled.data.orders.length,1);assert.equal(cancelled.data.orders[0].selectable,false);
  assert.equal((await f.call("/sepay/orders?kind=order",f.mgr)).data.orders.some((o:any)=>o.contractNo),false);
  for(const query of ["offset=-1","offset=1.5","kind=bad","eligibility=bad","from=2026-02-30","from=2026-11-09&to=2026-11-01"])
    assert.equal((await f.call("/sepay/orders?"+query,f.mgr)).status,400,query);
  assert.equal((await f.call("/sepay/orders",f.accountant)).status,403);
  assert.equal((await f.call("/sepay/orders",f.emp)).status,403);
  assert.equal((await f.db.select().from(customerPayments)).length,0);
});

test("Manager may manually assign a bank receipt to an unsigned CRM draft without approving it; automatic matching stays blocked", async () => {
  const f = await setupSepay();
  const o = await f.order("CRM_DRAFT_DEPOSIT_101",{status:"draft"});
  const e = await f.incoming(o.orderNo,30000,{accountNumber:"654321"});
  assert.notEqual(e.status,"matched");
  assert.equal((await f.db.select().from(customerPayments)).length,0);
  const contractId = crypto.randomUUID();
  await f.db.insert(salesContracts).values({id:contractId,orderId:o.id,contractNo:'DRAFT_CONTRACT_101',legalEntity:'BN',status:'draft',createdBy:'mgr',createdAt:f.stamp,updatedAt:f.stamp});
  f.env.sepayReceiptAccounts=[];
  const blocked = await f.call('/sepay/orders/'+o.id+'?transactionId='+e.id,f.mgr);
  assert.equal(blocked.status,200);assert.equal(blocked.data.canCreate,false);
  assert.equal((await f.confirm(e.id,f.choice(o.id))).status,409);
  f.env.sepayReceiptAccounts=['654321'];
  assert.equal((await f.confirm(e.id,f.choice(o.id),f.accountant)).status,403);
  assert.equal((await f.confirm(e.id,f.choice(o.id))).status,200);
  assert.equal((await f.confirm(e.id,f.choice(o.id))).data.duplicate,true);
  const rows = await f.db.select().from(customerPayments).where(eq(customerPayments.orderId,o.id));
  assert.equal(rows.length,1);assert.equal(rows[0]!.amount,30000);
  assert.equal((await f.db.select().from(salesOrders).where(eq(salesOrders.id,o.id)))[0]!.status,'draft');
  assert.equal((await f.db.select().from(salesContracts).where(eq(salesContracts.id,contractId)))[0]!.status,'draft');
  const second = await f.incoming('Chờ chọn thủ công lần hai',80000);
  assert.equal((await f.confirm(second.id,f.choice(o.id))).status,409,'cannot receive beyond remaining 70000');
  const cancelled = await f.order('CANCELLED_DEPOSIT',{status:'cancelled'});
  assert.equal((await f.call('/sepay/orders/'+cancelled.id+'?transactionId='+second.id,f.mgr)).status,409);
  assert.equal((await f.confirm(second.id,f.choice(cancelled.id))).status,409);
  const otherDraft=await f.order('DRAFT_NO_SCHEDULE',{status:'draft'});
  await f.db.delete(paymentSchedules).where(eq(paymentSchedules.orderId,otherDraft.id));
  assert.equal((await f.confirm(second.id,f.choice(otherDraft.id))).status,409,'draft without a valid amount/schedule is blocked');
});

test("manual CRM reconciliation accepts an active configured register account; automatic allowlist and confirmation recheck remain independent", async () => {
  const f=await setupSepay(); f.env.sepayReceiptAccounts=[];
  const o=await f.order('COMPANY_BANK_101',{status:'draft'});
  const e=await f.incoming(o.orderNo,30000);
  assert.notEqual(e.status,'matched');
  const detail=await f.call('/sepay/transactions/'+e.id,f.mgr);
  const preview=()=>f.call('/sepay/orders/'+o.id+'?transactionId='+e.id,f.mgr);
  assert.equal(detail.data.accountApproved,true);
  assert.equal((await preview()).data.accountApproved,true);
  assert.equal((await preview()).data.canCreate,true);
  assert.equal((await f.db.select().from(customerPayments)).length,0);
  assert.equal((await f.confirm(e.id,f.choice(o.id),f.accountant)).status,403);
  await f.db.update(posRegisters).set({active:false}).where(eq(posRegisters.id,f.registerId));
  assert.equal((await preview()).data.accountApproved,false);
  assert.equal((await f.confirm(e.id,f.choice(o.id))).status,409,'recheck active account at confirmation');
  await f.db.update(posRegisters).set({active:true,bankAccount:'999999'}).where(eq(posRegisters.id,f.registerId));
  assert.equal((await f.confirm(e.id,f.choice(o.id))).status,409,'do not trust the preview after account changes');
  await f.db.update(posRegisters).set({bankAccount:' 123 456 '}).where(eq(posRegisters.id,f.registerId));
  assert.equal((await f.confirm(e.id,f.choice(o.id))).status,200);
  assert.equal((await f.confirm(e.id,f.choice(o.id))).data.duplicate,true);
  const receipts=await f.db.select().from(customerPayments).where(eq(customerPayments.orderId,o.id));
  assert.equal(receipts.length,1);assert.equal(receipts[0]!.amount,30000);
  assert.equal(f.env.sepayReceiptAccounts.length,0,'does not turn on automatic CRM matching');
  const approvedOrder=await f.order('AUTO_STILL_DISABLED_102');
  const auto=await f.incoming(approvedOrder.orderNo,20000);
  assert.notEqual(auto.status,'matched','registered POS bank alone cannot enable automatic CRM receipts');
  assert.equal((await f.db.select().from(customerPayments)).length,1);
});

test("VG default receiving account matches the stored contract number, never transfer prose or another entity", () => {
  for (const no of ['11-03/06112026/HĐKT/VG-TEST','hdkt/vg-test','11/HĐKT/VG-ABC'.normalize('NFD')])
    assert.equal(defaultSepayCrmAccount(no),'159063909');
  for (const no of [null,'11/HĐKT/BN-ABC','11/HĐKT/VGX-ABC','11/HĐKT/VG-','VG-ABC','NHKT/VG-ABC'])
    assert.equal(defaultSepayCrmAccount(no),null);
});
test("VG contract defaults to confirmed account for manual receipts without secrets or register; unknown account stays blocked and original bank proof stays immutable", async () => {
  const f=await setupSepay();f.env.sepayReceiptAccounts=[];
  await f.db.update(posRegisters).set({active:false}).where(eq(posRegisters.id,f.registerId));
  const o=await f.order('VG_DEFAULT_101',{status:'draft'});
  await f.db.insert(salesContracts).values({id:crypto.randomUUID(),orderId:o.id,contractNo:'11/06112026/HĐKT/VG-DEFAULT',legalEntity:'VG',status:'draft',createdBy:'mgr',createdAt:f.stamp,updatedAt:f.stamp});
  const e=await f.incoming(o.orderNo,30000,{accountNumber:'159063909'});
  assert.notEqual(e.status,'matched','does not turn on unattended matching');
  const preview=await f.call('/sepay/orders/'+o.id+'?transactionId='+e.id,f.mgr);
  assert.equal(preview.data.expectedAccount,'159063909');assert.equal(preview.data.canCreate,true);
  const other=await f.incoming('Chờ gán VG',30000,{accountNumber:'156036909'});
  const blocked=await f.call('/sepay/orders/'+o.id+'?transactionId='+other.id,f.mgr);
  assert.equal(blocked.data.accountApproved,false);assert.match(blocked.data.blockReason,/159063909/);
  assert.equal((await f.confirm(other.id,f.choice(o.id))).status,409);
  assert.equal((await f.confirm(e.id,f.choice(o.id),f.accountant)).status,403);
  assert.equal((await f.confirm(e.id,f.choice(o.id))).status,200);
  assert.equal((await f.confirm(e.id,f.choice(o.id))).data.duplicate,true);
  const receipts=await f.db.select().from(customerPayments).where(eq(customerPayments.orderId,o.id));
  assert.equal(receipts.length,1);assert.equal(receipts[0]!.amount,30000);
  assert.equal((await f.db.select().from(sepayTransactions).where(eq(sepayTransactions.id,e.id)))[0]!.accountNumber,'159063909');
  const bn=await f.order('BN_DEFAULT_102',{status:'draft'});
  await f.db.insert(salesContracts).values({id:crypto.randomUUID(),orderId:bn.id,contractNo:'12/06112026/HĐKT/BN-DEFAULT',legalEntity:'BN',status:'draft',createdBy:'mgr',createdAt:f.stamp,updatedAt:f.stamp});
  const bnEvent=await f.incoming('Thanh toán BN',30000,{accountNumber:'159063909'});
  assert.equal((await f.call('/sepay/orders/'+bn.id+'?transactionId='+bnEvent.id,f.mgr)).data.canCreate,false);
});

test('SePay searches invoice numbers and suggests references from payment narrative without amount filtering',async()=>{
 const f=await setupSepay();const a=await f.order('DH-REF-A',{invoiceNo:'000123'});await f.order('DH-REF-B',{invoiceNo:'000123'});await f.order('DH-OTHER');
 const search=await f.call('/sepay/orders?q=000123',f.mgr);assert.equal(search.status,200);assert.equal(search.data.orders.length,2);assert.ok(search.data.orders.some((x:any)=>x.id===a.id&&x.invoiceNo==='000123'));
 const suggestions=await f.call('/sepay/orders?reference='+encodeURIComponent('thanh toán hóa đơn số 000123'),f.mgr);assert.equal(suggestions.status,200);assert.equal(suggestions.data.orders.length,2);
 const order=await f.call('/sepay/orders?reference='+encodeURIComponent('thanh toan don DH-REF-A'),f.mgr);assert.equal(order.data.orders.length,1);assert.equal(order.data.orders[0].id,a.id);
});
