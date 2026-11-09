import { eq } from "drizzle-orm";
import { setup } from "./pos-fixture.ts";
import { employees } from "../../src/modules/staff/schema.ts";
import {
  salesOrders,
  paymentSchedules,
} from "../../src/modules/sales/schema.ts";
import { sepayTransactions } from "../../src/modules/integrations/schema.ts";
export async function setupSepay() {
  const f = await setup();
  f.env.sepayReceiptAccounts = ["123456"];
  await f.db
    .update(employees)
    .set({ positionId: "accounting" })
    .where(eq(employees.id, "cashier2"));
  const stamp = "2026-11-08T03:00:00.000Z";
  const order = async (
    no: string,
    extra: Partial<typeof salesOrders.$inferInsert> = {},
  ) => {
    const o = {
      id: crypto.randomUUID(),
      orderNo: no,
      quoteType: "HRC" as const,
      customerName: "Khách kiểm thử SePay",
      customerId: f.customerId,
      ownerId: "emp",
      createdBy: "emp",
      orderDate: "2026-11-08",
      status: "confirmed" as const,
      total: 100000,
      subtotal: 100000,
      createdAt: stamp,
      updatedAt: stamp,
      ...extra,
    };
    await f.db.insert(salesOrders).values(o);
    await f.db.insert(paymentSchedules).values({
      id: crypto.randomUUID(),
      orderId: o.id,
      kind: "balance",
      amount: o.total,
      createdAt: stamp,
    });
    return o;
  };
  const incoming = async (
    content: string,
    amount = 100000,
    extra: Record<string, unknown> = {},
  ) => {
    const payload = {
      id: crypto.randomUUID(),
      transferType: "in",
      transferAmount: amount,
      accountNumber: "123456",
      content,
      transactionDate: "2026-11-08 10:00:00",
      ...extra,
    };
    const r = await f.router.handle(
      new Request("https://trial.test/api/staff/integrations/sepay/payment", {
        method: "POST",
        headers: {
          authorization: "Apikey test-sepay-key",
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      }),
      f.env,
    );
    if (r.status !== 200) throw new Error(JSON.stringify(await r.json()));
    const [event] = await f.db
      .select()
      .from(sepayTransactions)
      .where(eq(sepayTransactions.providerId, String(payload.id)));
    return event!;
  };
  const choice = (orderId: string, extra: Record<string, unknown> = {}) => ({
    orderId,
    confirmed: true,
    reason: "Đã đối chiếu chứng từ ngân hàng và xác nhận đúng khách hàng.",
    ...extra,
  });
  const confirm = (id: string, body: unknown, cookie = f.mgr) =>
    f.call("/sepay/transactions/" + id + "/confirm", cookie, "POST", body);
  return { ...f, accountant: f.other, stamp, order, incoming, choice, confirm };
}
