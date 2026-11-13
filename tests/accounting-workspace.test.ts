import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setupEarly } from "./helpers/purchase-early-fixture.ts";
const migration = readFileSync(
  "migrations/postgres/20261113002619_accounting_workspace.sql",
  "utf8",
);
test("empty database migration replay, RLS and hard API guards including direct URLs", async () => {
  const f = await setupEarly();
  await f.client.exec(
    "create role anon; create role authenticated; create role service_role;",
  );
  await f.client.exec(migration);
  await f.client.exec(migration);
  const gate = readFileSync(
    "scripts/sql/assert-accounting-workspace.sql",
    "utf8",
  );
  await f.client.exec("begin read only");
  await f.client.exec(gate);
  await f.client.exec(gate);
  await f.client.exec("rollback");
  await f.client.exec("begin");
  await f.client.exec(
    "alter table accounting_books drop column invoice_provider",
  );
  await f.client.exec("savepoint missing_column");
  await assert.rejects(f.client.exec(gate), /invoice_provider/);
  await f.client.exec("rollback");

  const tables = await f.client.query<{
    relname: string;
    relrowsecurity: boolean;
  }>(
    "select relname,relrowsecurity from pg_class where relname in ('accounting_entities','accounting_books','accounting_documents','accounting_lines','accounting_periods','accounting_reviews')",
  );
  assert.equal(tables.rows.length, 6);
  assert.ok(tables.rows.every((t) => t.relrowsecurity));
  const grants = await f.client.query<{ ok: boolean }>(
    "select has_table_privilege('anon','accounting_books','SELECT') or has_table_privilege('authenticated','accounting_books','SELECT') as ok",
  );
  assert.equal(grants.rows[0]?.ok, false);
  for (const id of ["emp", "sa", "kho", "ncc"])
    for (const [path, method, body] of [
      ["/accounting/options", "GET", undefined],
      [
        "/accounting/report?entityId=x&from=2026-10-01&to=2026-10-31",
        "GET",
        undefined,
      ],
      ["/accounting/documents/x", "GET", undefined],
      ["/accounting/entities", "POST", {}],
      ["/accounting/books/x/sale-drafts", "POST", {}],
      ["/accounting/assistant", "POST", {}],
    ] as const) {
      const r = await f.call(path, f.cookies[id], method, body);
      assert.equal(r.status, 403, id + " " + path);
    }
  assert.equal((await f.call("/accounting/options", f.cookies.kt)).status, 200);
  assert.equal(
    (await f.call("/accounting/books", f.cookies.kt, "POST", { name: "X" }))
      .status,
    403,
  );
});
test("opening, purchases, posting, duplicate/stale guards, K coverage and physical isolation", async () => {
  const f = await setupEarly(),
    mgr = f.cookies.mgr!,
    kt = f.cookies.kt!;
  const send = async (p: string, body: unknown, cookie = mgr) => {
    const r = await f.call(p, cookie, "POST", body);
    assert.ok(r.status < 300, JSON.stringify(r.data));
    return r.data;
  };
  const before = await f.client.query("select * from stock_moves");
  const entity = await send("/accounting/entities", {
    name: "Pháp nhân thử nghiệm",
    taxCode: "0123456789",
    confirmed: true,
  });
  const book = await send("/accounting/books", {
    name: "Sổ thử nghiệm",
    entityId: entity.id,
  });
  const create = async (
    kind: string,
    reference: string,
    quantity: number,
    value: number,
    date = "2026-10-01",
  ) =>
    send(
      "/accounting/books/" + book.id + "/documents",
      {
        kind,
        reference,
        date,
        lines: [
          {
            sku: "SKU-TEST",
            name: "Hàng thử",
            unit: "Cái",
            quantity,
            netValue: value,
            taxRate: 8,
          },
        ],
      },
      kt,
    );
  const opening = await create("opening", "OPEN", 10, 1000);
  assert.equal(opening.physicalInventoryAffected, false);
  assert.equal(
    (
      await f.call(
        "/accounting/documents/" + opening.id + "/post",
        kt,
        "POST",
        { revision: 1, confirmed: true },
      )
    ).status,
    403,
  );
  await send("/accounting/documents/" + opening.id + "/post", {
    revision: 1,
    confirmed: true,
  });
  assert.equal(
    (
      await f.call(
        "/accounting/documents/" + opening.id + "/post",
        mgr,
        "POST",
        { revision: 1, confirmed: true },
      )
    ).status,
    409,
  );
  const p = await create("purchase", "INV-IN", 10, 2000, "2026-10-02");
  await send("/accounting/documents/" + p.id + "/post", {
    revision: 1,
    confirmed: true,
  });
  const s = await create("sale", "INV-OUT", 4, 1000, "2026-10-03");
  await send("/accounting/documents/" + s.id + "/post", {
    revision: 1,
    confirmed: true,
  });
  const dup = await f.call(
    "/accounting/books/" + book.id + "/documents",
    kt,
    "POST",
    {
      kind: "purchase",
      reference: "INV-IN",
      date: "2026-10-02",
      lines: [
        {
          sku: "SKU-TEST",
          name: "H",
          unit: "Cái",
          quantity: 1,
          netValue: 100,
          taxRate: 8,
        },
      ],
    },
  );
  assert.equal(dup.status, 409);
  const report = () =>
    f.call(
      "/accounting/report?entityId=" +
        entity.id +
        "&from=2026-10-01&to=2026-10-31",
      kt,
    );
  let r = await report();
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.stock[0].quantity, 16);
  assert.equal(r.data.totals.stockValue, 2400);
  assert.equal(r.data.k.state, "unknown");
  await send("/accounting/periods/confirm", {
    entityId: entity.id,
    month: "2026-10",
    reference: "Đã đối soát đủ hóa đơn kỳ thử",
    confirmed: true,
  });
  r = await report();
  assert.equal(r.data.k.state, "unconfigured");
  assert.equal(r.data.k.ratio, 1 / 3);
  const bad = await create("sale", "NEGATIVE", 100, 5000, "2026-10-04");
  assert.equal(
    (
      await f.call("/accounting/documents/" + bad.id + "/post", mgr, "POST", {
        revision: 1,
        confirmed: true,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await f.call("/accounting/books/" + book.id, mgr, "PUT", {
        revision: 2,
        name: "Sổ thử nghiệm",
        entityId: null,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await f.call(
        "/accounting/documents/" + opening.id + "/void",
        mgr,
        "POST",
        { revision: 2, reason: "Thử" },
      )
    ).status,
    409,
  );
  await send("/accounting/documents/" + s.id + "/void", {
    revision: 2,
    reason: "Hủy đối chiếu thử",
  });
  r = await report();
  assert.equal(r.data.stock[0].quantity, 20);
  assert.equal(r.data.k.state, "unknown");
  assert.deepEqual(
    (await f.client.query("select * from stock_moves")).rows,
    before.rows,
  );
  assert.equal(
    (
      await f.call("/accounting/books/" + book.id + "/documents", kt, "POST", {
        kind: "sale_return",
        reference: "RETURN",
        date: "2026-10-04",
        lines: [
          {
            sku: "SKU-TEST",
            name: "H",
            unit: "Cái",
            quantity: 1,
            netValue: 100,
            taxRate: 8,
          },
        ],
      })
    ).status,
    422,
  );
});
test("actual order matching keeps source SKUs, rejects duplicates and stale orders; zero opening is explicit", async () => {
  const f = await setupEarly(),
    mgr = f.cookies.mgr!,
    kt = f.cookies.kt!;
  const { salesOrders, salesOrderLines } = await import(
    "../src/modules/sales/schema.ts"
  );
  const { eq } = await import("drizzle-orm");
  const ok = async (p: string, b: unknown) => {
    const r = await f.call(p, mgr, "POST", b);
    assert.ok(r.status < 300, JSON.stringify(r.data));
    return r.data;
  };
  const opts = await f.call("/accounting/options", kt);
  assert.ok(
    opts.data.books.some(
      (b: any) =>
        b.name === "Kho tổng Vigifts" &&
        b.invoiceProvider === "viettel" &&
        b.entityId === null,
    ),
  );
  assert.ok(
    opts.data.books.some(
      (b: any) =>
        b.name === "Kho tổng Bách Ngân" &&
        b.invoiceProvider === "vnpt" &&
        b.openingDate === null,
    ),
  );
  const e = await ok("/accounting/entities", {
    name: "Test Legal",
    taxCode: "0123456789",
    confirmed: true,
  });
  const b = await ok("/accounting/books", {
    name: "Source matching test",
    entityId: e.id,
  });
  const open = await ok("/accounting/books/" + b.id + "/documents", {
    kind: "opening",
    date: "2026-10-01",
    reference: "ZERO",
    confirmedZero: true,
    lines: [],
  });
  await ok("/accounting/documents/" + open.id + "/post", {
    confirmed: true,
    revision: 1,
  });
  const now = new Date().toISOString();
  await f.db.insert(salesOrders).values({
    id: "source-test",
    orderNo: "SOURCE-TEST",
    quoteType: "HRC",
    customerName: "Test",
    ownerId: "mgr",
    createdBy: "mgr",
    orderDate: "2026-10-05",
    status: "confirmed",
    subtotal: 101,
    tax: 8.08,
    total: 109.08,
    createdAt: now,
    updatedAt: now,
  });
  await f.db.insert(salesOrderLines).values([
    {
      id: "sl-1",
      orderId: "source-test",
      lineNo: 1,
      sku: "ACTUAL-A",
      name: "Actual A",
      unit: "Cái",
      qty: 1,
      unitPrice: 50.5,
      amount: 50.5,
      taxRate: 8,
    },
    {
      id: "sl-2",
      orderId: "source-test",
      lineNo: 2,
      sku: "ACTUAL-B",
      name: "Actual B",
      unit: "Cái",
      qty: 1,
      unitPrice: 50.5,
      amount: 50.5,
      taxRate: 8,
    },
  ]);
  const suggestion = await f.call(
    "/accounting/books/" + b.id + "/suggest?orderId=source-test",
    kt,
  );
  assert.equal(suggestion.status, 200);
  assert.deepEqual(
    suggestion.data.lines.map((l: any) => l.sku),
    ["ACTUAL-A", "ACTUAL-B"],
  );
  assert.equal(
    suggestion.data.lines.reduce((n: number, l: any) => n + l.netValue, 0),
    101,
  );
  const body = {
    orderId: "source-test",
    sourceRevision: 1,
    date: "2026-10-05",
    reference: "DRAFT",
    confirmedEntity: true,
    lines: [{ sku: "FORGED", qty: 999 }],
  };
  const created = await f.call(
    "/accounting/books/" + b.id + "/sale-drafts",
    kt,
    "POST",
    body,
  );
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.invoiceIssued, false);
  const detail = await f.call("/accounting/documents/" + created.data.id, kt);
  assert.deepEqual(
    detail.data.lines.map((l: any) => l.sku),
    ["ACTUAL-A", "ACTUAL-B"],
  );
  assert.equal(
    (
      await f.call(
        "/accounting/books/" + b.id + "/sale-drafts",
        kt,
        "POST",
        body,
      )
    ).status,
    409,
  );
  await f.db
    .update(salesOrders)
    .set({ revision: 2 })
    .where(eq(salesOrders.id, "source-test"));
  assert.equal(
    (
      await f.call(
        "/accounting/documents/" + created.data.id + "/post",
        mgr,
        "POST",
        { revision: 1, confirmed: true },
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await f.db
        .select()
        .from(salesOrders)
        .where(eq(salesOrders.id, "source-test"))
    )[0]?.invoiceStatus,
    "none",
  );
});
