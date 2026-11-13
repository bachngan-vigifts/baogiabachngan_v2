import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { setupEarly } from "./purchase-early-fixture.ts";
import {
  suppliers,
  incomingShipmentLines,
  supplierPayments,
} from "../../src/modules/suppliers/schema.ts";
export async function setupAccountingSupplier() {
  const f = await setupEarly();
  await f.db
    .update(suppliers)
    .set({ taxCode: "0123456789" })
    .where(eq(suppliers.id, "a"));
  await f.db
    .update(suppliers)
    .set({ taxCode: "9876543210" })
    .where(eq(suppliers.id, "b"));
  await f.db
    .update(incomingShipmentLines)
    .set({ price: 100, taxRate: 8 })
    .where(eq(incomingShipmentLines.shipmentId, "a1"));
  const post = async (path: string, body: unknown, cookie = f.cookies.mgr!) => {
    const r = await f.call(path, cookie, "POST", body);
    assert.ok(r.status < 300, path + ": " + JSON.stringify(r.data));
    return r.data;
  };
  const entity = await post("/accounting/entities", {
    name: "Pháp nhân thử",
    taxCode: "1111111111",
    confirmed: true,
  });
  const configured = await f.call(
    "/accounting/books/accounting-vigifts",
    f.cookies.mgr,
    "PUT",
    {
      name: "Kho tổng Vigifts",
      invoiceProvider: "viettel",
      entityId: entity.id,
      revision: 1,
    },
  );
  assert.equal(configured.status, 200);
  const opening = await post("/accounting/books/accounting-vigifts/documents", {
    kind: "opening",
    date: "2026-10-01",
    reference: "OPEN",
    lines: [],
    confirmedZero: true,
  });
  await post("/accounting/documents/" + opening.id + "/post", {
    confirmed: true,
    revision: 1,
  });
  const i = await post(
    "/supplier-portal/workspace/invoices",
    {
      clientKey: "fixture-invoice-a",
      orderId: "a1",
      invoiceNo: "INVOICE-A",
      series: "AA26",
      date: "2026-10-05",
      subtotal: 500,
      tax: 40,
      total: 540,
      note: "NCC OWN NOTE",
    },
    f.cookies.ncc,
  );
  await post("/supplier-workspace-admin/invoices/" + i.id + "/verify", {
    status: "verified",
  });
  const d = await post("/accounting/books/accounting-vigifts/documents", {
    kind: "purchase",
    reference: "INVOICE-A",
    series: "AA26",
    date: "2026-10-05",
    counterpartyTaxCode: "0123456789",
    note: "PRIVATE-ACCOUNTING-NOTE",
    lines: [
      {
        sku: "031106000",
        name: "SECRET-INTERNAL-NAME",
        unit: "Cái",
        quantity: 5,
        netValue: 500,
        taxRate: 8,
      },
    ],
  });
  await post("/accounting/documents/" + d.id + "/post", {
    confirmed: true,
    revision: 1,
  });
  await f.db
    .insert(supplierPayments)
    .values({
      id: "pay-a",
      shipmentId: "a1",
      amount: 100,
      paidDate: "2026-10-06",
      method: "transfer",
      clientKey: "accounting-test-pay",
      reference: "PAY-A",
      note: "PRIVATE-PAYMENT-NOTE",
      createdBy: "mgr",
      createdAt: "2026-10-06T00:00:00Z",
    });
  return { ...f, post, invoiceId: i.id, documentId: d.id };
}
