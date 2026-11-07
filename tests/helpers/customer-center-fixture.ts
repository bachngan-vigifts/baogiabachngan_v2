import { eq } from "drizzle-orm";
import { createTestDb } from "./postgres.ts";
import { seedStaff, PASSWORD } from "./staff-fixture.ts";
import { createAppRouter } from "../../src/app/router.ts";
import {
  customers,
  customerStaff,
} from "../../src/modules/customers/schema.ts";
import { positions } from "../../src/modules/staff/schema.ts";
import {
  salesOrders,
  salesOrderLines,
} from "../../src/modules/sales/schema.ts";
import { vietnamDate } from "../../src/modules/sales/domain/sales.ts";
export async function customerCenterFixture() {
  const s = await createTestDb();
  await seedStaff(s.d1);
  await s.db
    .update(positions)
    .set({ dataScope: "own" })
    .where(eq(positions.id, "sale"));
  const today = vietnamDate().iso,
    now = new Date().toISOString(),
    prior = String(Number(today.slice(0, 4)) - 1) + today.slice(4, 7) + "-05";
  const addCustomer = async (
    id: string,
    ownerId = "emp",
    extra: Partial<typeof customers.$inferInsert> = {},
  ) => {
    await s.db
      .insert(customers)
      .values({
        id,
        name: "Công ty " + id,
        contact: "Chị Liên",
        phone: "0901234567",
        email: "",
        address: "Cần Thơ",
        search: "",
        sourceVersion: 0,
        syncedAt: now,
        ...extra,
      });
    await s.db
      .insert(customerStaff)
      .values({
        customerId: id,
        memberId: ownerId,
        role: "owner",
        createdBy: "mgr",
        createdAt: now,
      });
  };
  const order = async (
    id: string,
    customerId: string,
    date = prior,
    status: typeof salesOrders.$inferInsert.status = "confirmed",
    ownerId = "emp",
  ) => {
    await s.db
      .insert(salesOrders)
      .values({
        id,
        orderNo: id,
        customerId,
        customerName: "Khách " + customerId,
        orderDate: date,
        status,
        quoteType: "VIGIFTS",
        ownerId,
        createdBy: ownerId,
        total: 108000,
        subtotal: 100000,
        tax: 8000,
        createdAt: now,
        updatedAt: now,
      });
    await s.db
      .insert(salesOrderLines)
      .values({
        id: id + "-line",
        orderId: id,
        lineNo: 1,
        name: "Ly kiểm thử",
        qty: 1,
        unitPrice: 100000,
        amount: 100000,
      });
  };
  const router = createAppRouter(),
    origin = "https://trial.test";
  const call = async (
    path: string,
    cookie = "",
    method = "GET",
    body?: unknown,
  ) => {
    const r = await router.handle(
      new Request(origin + "/api/staff" + path, {
        method,
        headers: { origin, cookie, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      { db: s.db, passwordIterations: 1000, sapoOrderPush: "off" },
    );
    return {
      status: r.status,
      data: (await r.json()) as any,
      cookie: r.headers.get("set-cookie")?.split(";")[0] ?? "",
    };
  };
  const login = async (id: string) =>
    (
      await call("/login", "", "POST", {
        email: id + "@x.vn",
        password: PASSWORD,
      })
    ).cookie;
  return {
    ...s,
    today,
    now,
    prior,
    call,
    addCustomer,
    order,
    mgr: await login("mgr"),
    emp: await login("emp"),
    ncc: await login("ncc"),
  };
}
