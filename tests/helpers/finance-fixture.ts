import { setup } from "./pos-fixture.ts";
import {
  salesOrders,
  customerPayments,
  paymentSchedules,
  salesOrderLines,
} from "../../src/modules/sales/schema.ts";
import { cashEntries } from "../../src/modules/sales/cash-schema.ts";
import {
  posReturns,
  posRefunds,
} from "../../src/modules/sales/return-schema.ts";
import {
  incomingShipments,
  supplierPayments,
} from "../../src/modules/suppliers/schema.ts";
export async function setupFinance() {
  const f = await setup(),
    shift = await f.open(),
    day = "2026-11-09",
    stamp = day + "T03:00:00.000Z";
  const order = (
    id: string,
    extra: Partial<typeof salesOrders.$inferInsert> = {},
  ) => ({
    id,
    orderNo: id,
    quoteType: "HRC" as const,
    customerName: "Khách thử",
    ownerId: "emp",
    createdBy: "emp",
    orderDate: day,
    status: "confirmed" as const,
    total: 1000,
    subtotal: 1000,
    createdAt: stamp,
    updatedAt: stamp,
    ...extra,
  });
  await f.db
    .insert(salesOrders)
    .values([
      order("finance-crm"),
      order("finance-pos", { channel: "pos", shiftId: shift.id }),
      order("finance-draft", { status: "draft" }),
      order("finance-cancel", { status: "cancelled" }),
    ]);
  await f.db.insert(salesOrderLines).values({
    id: "finance-line",
    orderId: "finance-crm",
    lineNo: 1,
    sku: "00123",
    name: "Ly sứ",
    qty: 1,
    unitPrice: 1000,
    amount: 1000,
  });
  const receipt = (
    id: string,
    amount: number,
    extra: Partial<typeof customerPayments.$inferInsert> = {},
  ) => ({
    id,
    orderId: "finance-crm",
    amount,
    paidAt: day,
    createdBy: "mgr",
    createdAt: stamp,
    ...extra,
  });
  await f.db.insert(customerPayments).values([
    receipt("finance-pay", 400),
    receipt("finance-void", 900, { voidedAt: stamp }),
    receipt("finance-credit", 100, { paymentSource: "pos_exchange_credit" }),
    receipt("finance-pos-pay", 700, {
      orderId: "finance-pos",
      method: "cash",
    }),
    receipt("finance-old", 50, { paidAt: "2026-10-31" }),
  ]);
  await f.db.insert(paymentSchedules).values(
    ["finance-crm", "finance-pos", "finance-draft", "finance-cancel"].map(
      (id) => ({
        id: "sch-" + id,
        orderId: id,
        kind: "balance" as const,
        amount: 1000,
        dueDate: "2026-10-01",
        createdAt: stamp,
      }),
    ),
  );
  const cash = (
    id: string,
    kind: string,
    direction: string,
    amount: number,
    extra: Partial<typeof cashEntries.$inferInsert> = {},
  ) => ({
    id,
    entryNo: id,
    drawerId: "store",
    shiftId: shift.id,
    kind,
    direction,
    amount,
    reason: "Phiếu thử",
    status: "posted",
    approvalThresholdSnapshot: 1000000,
    createdBy: "mgr",
    createdAt: stamp,
    requestKey: id,
    updatedAt: stamp,
    ...extra,
  });
  await f.db.insert(cashEntries).values([
    cash("finance-income", "other_income", "in", 30),
    cash("finance-petty", "petty_expense", "out", 20),
    cash("finance-transfer", "cash_out", "out", 200),
    cash("finance-adjust", "adjustment", "in", 12),
    cash("finance-pending", "petty_expense", "out", 500, {
      status: "pending",
    }),
    cash("finance-mirror", "customer_refund", "out", 50),
    cash("finance-midnight", "other_income", "in", 7, {
      createdAt: "2026-11-08T17:00:00.000Z",
    }),
    cash("finance-before", "other_income", "in", 999, {
      createdAt: "2026-11-08T16:59:59.999Z",
    }),
    cash("finance-after", "other_income", "in", 999, {
      createdAt: "2026-11-09T17:00:00.000Z",
    }),
  ]);
  await f.db.insert(posReturns).values({
    id: "finance-return",
    returnNo: "TH-F",
    source: "crm",
    orderId: "finance-crm",
    warehouseId: "pos-wh",
    kind: "return",
    status: "processing",
    reason: "Đổi giao lại",
    subtotal: 100,
    tax: 0,
    total: 100,
    sourceSnapshot: "{}",
    requestKey: "finance-return",
    createdBy: "mgr",
    createdAt: stamp,
    updatedAt: stamp,
    receivedAt: stamp,
  });
  await f.db.insert(posRefunds).values({
    id: "finance-refund",
    refundNo: "HT-F",
    returnId: "finance-return",
    drawerId: "store",
    shiftId: shift.id,
    method: "cash",
    amount: 50,
    cashEntryId: "finance-mirror",
    confirmedBy: "mgr",
    confirmedAt: stamp,
    requestKey: "finance-refund",
    createdAt: stamp,
  });
  await f.db.insert(incomingShipments).values({
    id: "finance-incoming",
    ticketNumber: "DMH-F",
    warehouse: "Kho thử",
    createdBy: "mgr",
    createdAt: stamp,
    updatedAt: stamp,
  });
  await f.db.insert(supplierPayments).values({
    id: "finance-supplier",
    shipmentId: "finance-incoming",
    amount: 80,
    paidDate: day,
    clientKey: "finance-supplier",
    createdBy: "mgr",
    createdAt: stamp,
  });
  return { ...f, day, stamp, order };
}
