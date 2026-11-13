import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setupAccountingSupplier } from "../helpers/accounting-supplier-fixture.ts";
import { eq } from "drizzle-orm";
import { accountingSupplierLinks } from "../../src/modules/accounting/supplier-schema.ts";
import { accountingLines } from "../../src/modules/accounting/schema.ts";
const migration = readFileSync(
  "migrations/postgres/20261113010807_accounting_supplier_links.sql",
  "utf8",
);
test("explicit supplier linking, publication, replay and revoke never add debt or leak private accounting", async () => {
  const f = await setupAccountingSupplier(),
    ncc = f.cookies.ncc!,
    kt = f.cookies.kt!;
  await f.client.exec(migration);
  await f.client.exec(migration);
  const baseline = (
    await f.call("/supplier-portal/workspace/balances?id=a1", ncc)
  ).data.items[0];
  assert.equal(baseline.remaining, 863900);
  const options = await f.call(
    "/accounting/suppliers/a/invoice-options?invoiceId=" + f.invoiceId,
    kt,
  );
  assert.equal(options.status, 200, JSON.stringify(options.data));
  assert.equal(options.data.options[0].id, f.documentId);
  const body = {
    invoiceId: f.invoiceId,
    documentId: f.documentId,
    confirmed: true,
    shared: false,
  };
  const privateLink = await f.post("/accounting/suppliers/a/links", body, kt);
  let inv = (await f.call("/supplier-portal/workspace/invoices", ncc)).data
    .items[0];
  assert.equal(inv.accountingStatus, "Chưa có đối chiếu được chia sẻ");
  await f.post(
    "/accounting/supplier-links/" + privateLink.id + "/revoke",
    { revision: 1, reason: "Chuyển chia sẻ có xác nhận" },
    kt,
  );
  const pub = await f.post(
    "/accounting/suppliers/a/links",
    { ...body, shared: true },
    kt,
  );
  const replay = await f.post(
    "/accounting/suppliers/a/links",
    { ...body, shared: true },
    kt,
  );
  assert.equal(replay.id, pub.id);
  assert.equal(replay.replayed, true);
  inv = (await f.call("/supplier-portal/workspace/invoices", ncc)).data
    .items[0];
  assert.equal(inv.accountingStatus, "Đã ghi sổ");
  const balance = (
    await f.call("/supplier-portal/workspace/balances?id=a1", ncc)
  ).data.items[0];
  assert.equal(balance.remaining, baseline.remaining);
  assert.equal(balance.paid, baseline.paid);
  assert.equal(balance.accountedInvoiceTotal, 540);
  assert.equal(balance.accountedInvoiceCount, 1);
  for (const page of ["invoices", "balances"])
    for (const suffix of ["", "/export"]) {
      const r = await f.call(
        "/supplier-portal/workspace/" + page + suffix,
        ncc,
      );
      assert.equal(r.status, 200);
      assert.doesNotMatch(
        JSON.stringify(r.data),
        /PRIVATE-ACCOUNTING|SECRET-INTERNAL|PRIVATE-PAYMENT|bookName|documentId|accounting-vigifts|Kho tổng|1111111111/,
      );
    }
  const other = await f.call(
    "/supplier-portal/workspace/invoices",
    f.cookies.ncc2,
  );
  assert.equal(other.data.items.length, 0);
  assert.equal(
    (
      await f.call(
        "/supplier-portal/workspace/invoices/" + f.invoiceId,
        f.cookies.ncc2,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await f.call(
        "/supplier-portal/workspace/balances?identifier=a&supplierId=a",
        f.cookies.ncc2,
      )
    ).status,
    404,
  );
  const internal = await f.call("/accounting/suppliers/a", kt);
  assert.equal(internal.status, 200);
  assert.equal(internal.data.links.length, 1);
  assert.equal(internal.data.links[0].bookName, "Kho tổng Vigifts");
  await f.post(
    "/accounting/supplier-links/" + pub.id + "/revoke",
    { revision: 1, reason: "Đối soát lại" },
    kt,
  );
  assert.equal(
    (
      await f.call(
        "/accounting/supplier-links/" + pub.id + "/revoke",
        kt,
        "POST",
        { revision: 1, reason: "lặp" },
      )
    ).status,
    409,
  );
  assert.equal(
    (await f.call("/supplier-portal/workspace/balances?id=a1", ncc)).data
      .items[0].accountedInvoiceTotal,
    0,
  );
  assert.equal((await f.db.select().from(accountingSupplierLinks)).length, 2);
  assert.equal(
    (await f.client.query<{n:number}>("select count(*)::int n from stock_moves")).rows[0]
      ?.n,
    0,
  );
  assert.equal(
    (await f.client.query<{n:number}>("select count(*)::int n from supplier_payments"))
      .rows[0]?.n,
    1,
  );
});
test("guards: no supplier/accountant cross access, mismatched money/SKU and voided entries do not publish", async () => {
  const f = await setupAccountingSupplier(),
    body = {
      invoiceId: f.invoiceId,
      documentId: f.documentId,
      confirmed: true,
      shared: true,
    };
  for (const role of ["ncc", "ncc2", "emp", "sa", "kho"])
    for (const [path, method, b] of [
      ["/accounting/suppliers/a", "GET", undefined],
      [
        "/accounting/suppliers/a/invoice-options?invoiceId=" + f.invoiceId,
        "GET",
        undefined,
      ],
      ["/accounting/suppliers/a/links", "POST", body],
      [
        "/accounting/supplier-links/no/revoke",
        "POST",
        { revision: 1, reason: "test" },
      ],
    ] as const) {
      assert.equal(
        (await f.call(path, f.cookies[role], method, b)).status,
        403,
        role + " " + path,
      );
    }
  assert.equal(
    (await f.call("/accounting/suppliers/b/links", f.cookies.mgr, "POST", body))
      .status,
    404,
  );
  await f.db
    .update(accountingLines)
    .set({ taxRate: "10" })
    .where(eq(accountingLines.documentId, f.documentId));
  assert.equal(
    (await f.call("/accounting/suppliers/a/links", f.cookies.kt, "POST", body))
      .status,
    409,
  );
  await f.db
    .update(accountingLines)
    .set({ taxRate: "8", sku: "NOT-IN-ORDER" })
    .where(eq(accountingLines.documentId, f.documentId));
  assert.equal(
    (await f.call("/accounting/suppliers/a/links", f.cookies.kt, "POST", body))
      .status,
    409,
  );
  await f.db
    .update(accountingLines)
    .set({ sku: "031106000" })
    .where(eq(accountingLines.documentId, f.documentId));
  await f.post("/accounting/suppliers/a/links", body, f.cookies.kt);
  await f.post("/accounting/documents/" + f.documentId + "/void", {
    revision: 2,
    reason: "Chứng từ thử cần đối soát lại",
  });
  const report = await f.call(
    "/supplier-portal/workspace/invoices",
    f.cookies.ncc,
  );
  assert.equal(
    report.data.items[0].accountingStatus,
    "Chưa có đối chiếu được chia sẻ",
  );
  assert.equal(
    (await f.call("/supplier-portal/workspace/balances?id=a1", f.cookies.ncc))
      .data.items[0].accountedInvoiceTotal,
    0,
  );
});
