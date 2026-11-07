import { contractTest as test, assert } from "../TEST_TEMPLATE.ts";
import { eq } from "drizzle-orm";
import { customerCenterFixture } from "../helpers/customer-center-fixture.ts";
import {
  centerWindow,
  campaignInput,
} from "../../src/modules/customer-hub/domain/center.ts";
import { salesContracts } from "../../src/modules/sales/schema.ts";
import { customerActivities } from "../../src/modules/care/schema.ts";
import {
  customers,
  customerStaff,
} from "../../src/modules/customers/schema.ts";
import { mergeCustomers } from "../../src/modules/customer-hub/api/duplicates.ts";
const base = "/customers/center";
test("period window handles previous year, December rollover, leap days and invalid filters", () => {
  assert.deepEqual(centerWindow("2026-12", "2026-11-07"), {
    month: "2026-12",
    days: 180,
    today: "2026-11-07",
    from: "2025-12-01",
    to: "2026-01-01",
    cutoff: "2026-05-11",
  });
  assert.equal(centerWindow("2025-02", "2024-08-27", 180).cutoff, "2024-02-29");
  for (const month of ["2026-00", "2026-13", "bad", "0000-11"])
    assert.throws(() => centerWindow(month, "2026-11-07"));
  for (const days of [0, -1, 1.5, NaN, 3651])
    assert.throws(() => centerWindow("2026-11", "2026-11-07", days));
  assert.throws(() =>
    campaignInput({
      name: "A",
      startDate: "2026-02-30",
      endDate: "2026-03-01",
    }),
  );
  assert.throws(() =>
    campaignInput({
      name: " ",
      startDate: "2026-11-01",
      endDate: "2026-11-02",
    }),
  );
  assert.throws(() =>
    campaignInput({
      name: "A",
      startDate: "2026-11-02",
      endDate: "2026-11-01",
    }),
  );
});
test("real opportunities/counts paginate in SQL, exclude unrecognised purchases and respect customer/order scopes", async () => {
  const f = await customerCenterFixture();
  for (const id of [
    "mine",
    "cancel",
    "draft",
    "signed",
    "recent",
    "never",
    "pending",
    "retail",
  ])
    await f.addCustomer(
      id,
      "emp",
      id === "pending"
        ? { approvalStatus: "pending" }
        : id === "retail"
          ? { isRetail: true }
          : {},
    );
  await f.addCustomer("hidden", "mgr");
  for (const id of ["mine", "pending", "retail"])
    await f.order(id + "-order", id);
  await f.order("cancel-order", "cancel", f.prior, "cancelled");
  await f.order("draft-order", "draft", f.prior, "draft");
  await f.order("signed-order", "signed", f.prior, "draft");
  await f.db.insert(salesContracts).values({
    id: "contract",
    contractNo: "CT",
    orderId: "signed-order",
    customerId: "signed",
    legalEntity: "VG",
    status: "signed",
    createdBy: "emp",
    createdAt: f.now,
    updatedAt: f.now,
  });
  await f.order("hidden-order", "hidden", f.prior, "confirmed", "mgr");
  await f.order("recent-order", "recent", f.today);
  for (let n = 0; n < 22; n++) {
    await f.addCustomer("page-" + String(n).padStart(2, "0"));
    await f.order("page-order-" + n, "page-" + String(n).padStart(2, "0"));
  }
  assert.equal((await f.call(base + "/counts")).status, 401);
  assert.equal((await f.call(base + "/counts", f.ncc)).status, 403);
  const counts = await f.call(base + "/counts", f.emp);
  assert.equal(counts.status, 200, JSON.stringify(counts));
  assert.equal(counts.data.period, 24);
  assert.equal(counts.data.dormant, 24);
  assert.equal(counts.data.campaigns, 0);
  assert.equal((await f.call(base + "/counts", f.mgr)).data.period, 25);
  const first = (
    await f.call(base + "/opportunities?kind=period&limit=20", f.emp)
  ).data;
  assert.equal(first.total, 24);
  assert.equal(first.customers.length, 20);
  const second = (
    await f.call(base + "/opportunities?kind=period&limit=20&offset=20", f.emp)
  ).data;
  assert.equal(second.customers.length, 4);
  assert.equal(
    new Set(
      [...first.customers, ...second.customers].map(
        (r: { id: string }) => r.id,
      ),
    ).size,
    24,
  );
  const found = (
    await f.call(base + "/opportunities?kind=dormant&q=cong%20ty%20mine", f.emp)
  ).data;
  assert.equal(found.total, 1);
  assert.equal(found.customers[0].lastOrderId, "mine-order");
  assert.equal(found.customers[0].products, "Ly kiểm thử × 1");
  assert.equal(found.customers[0].periodValue, 108000);
  assert.ok(!JSON.stringify(first).includes("unitCost"));
  assert.ok(!first.customers.some((r: { id: string }) => r.id === "hidden"));
  await f.db.insert(customerStaff).values({
    customerId: "hidden",
    memberId: "emp",
    role: "shared",
    createdBy: "mgr",
    createdAt: f.now,
  });
  assert.equal((await f.call(base + "/counts", f.emp)).data.period, 25);
  assert.equal(
    (await f.call(base + "/opportunities?kind=bad", f.emp)).status,
    400,
  );
  assert.equal((await f.call(base + "/counts?days=0", f.emp)).status, 400);
});
test("real campaigns persist assignments and care links; reject cross-customer, cross-owner, retries/stale changes and invisible records", async () => {
  const f = await customerCenterFixture();
  await f.addCustomer("mine");
  await f.addCustomer("other", "mgr");
  const body = {
    name: "Chăm sóc tháng này",
    note: "Khách thực tế",
    startDate: f.today,
    endDate: f.today,
    customerIds: ["mine", "mine"],
    assigneeId: "emp",
  };
  assert.equal(
    (await f.call(base + "/campaigns", f.emp, "POST", body)).status,
    403,
  );
  assert.equal(
    (
      await f.call(base + "/campaigns", f.mgr, "POST", {
        ...body,
        assigneeId: "off",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.call(base + "/campaigns", f.mgr, "POST", {
        ...body,
        customerIds: ["other"],
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.call(base + "/campaigns", f.mgr, "POST", {
        ...body,
        endDate: "2026-02-30",
      })
    ).status,
    400,
  );
  assert.equal(
    (await f.call(base + "/campaigns", f.mgr)).data.total,
    0,
    "failed creation is atomic",
  );
  const made = await f.call(base + "/campaigns", f.mgr, "POST", body);
  assert.equal(made.status, 201, JSON.stringify(made));
  const path = base + "/campaigns/" + made.data.campaign.id;
  assert.equal((await f.call(base + "/counts", f.emp)).data.campaigns, 1);
  assert.equal(
    (
      await f.call(path + "/targets", f.mgr, "POST", {
        customerIds: ["mine"],
        assigneeId: "emp",
      })
    ).status,
    200,
  );
  const detail = (await f.call(path, f.emp)).data;
  assert.equal(detail.total, 1);
  const target = detail.targets[0];
  const addActivity = async (
    id: string,
    customerId = "mine",
    ownerId = "emp",
    date = f.today,
  ) =>
    f.db.insert(customerActivities).values({
      id,
      customerId,
      ownerId,
      type: "call",
      result: "consulting",
      completion: "completed",
      occurredAt: date + "T05:00:00Z",
      content: "Đã hỏi nhu cầu",
      createdAt: f.now,
      updatedAt: f.now,
    });
  await addActivity("wrong-customer", "other");
  await addActivity("wrong-owner", "mine", "mgr");
  await addActivity("outside", "mine", "emp", "2020-01-01");
  await addActivity("real");
  const link = path + "/targets/" + target.id + "/activity";
  for (const id of ["absent", "wrong-customer", "wrong-owner", "outside"])
    assert.equal(
      (await f.call(link, f.emp, "PUT", { activityId: id, revision: 1 }))
        .status,
      400,
      id,
    );
  assert.equal(
    (await f.call(link, f.emp, "PUT", { activityId: "real", revision: 9 }))
      .status,
    409,
  );
  assert.equal(
    (await f.call(link, f.emp, "PUT", { activityId: "real", revision: 1 }))
      .status,
    200,
  );
  assert.equal(
    (await f.call(link, f.emp, "PUT", { activityId: "real", revision: 1 }))
      .status,
    200,
    "retry returns the same persisted link",
  );
  const progress = (await f.call(base + "/campaigns", f.emp)).data.campaigns[0]
    .progress;
  assert.deepEqual(
    [progress.assigned, progress.contacted, progress.completed],
    [1, 1, 1],
  );
  const other = await f.call(base + "/campaigns", f.mgr, "POST", {
    ...body,
    name: "Riêng quản lý",
    customerIds: ["other"],
    assigneeId: "mgr",
  });
  assert.equal(other.status, 201);
  assert.equal((await f.call(base + "/campaigns", f.emp)).data.total, 1);
  assert.equal(
    (await f.call(base + "/campaigns/" + other.data.campaign.id, f.emp)).status,
    404,
  );
  const duplicate = await f.call(base + "/campaigns", f.mgr, "POST", {
    ...body,
    name: "Đợt khác",
  });
  const target2 = (
    await f.call(base + "/campaigns/" + duplicate.data.campaign.id, f.emp)
  ).data.targets[0];
  assert.equal(
    (
      await f.call(
        base +
          "/campaigns/" +
          duplicate.data.campaign.id +
          "/targets/" +
          target2.id +
          "/activity",
        f.emp,
        "PUT",
        { activityId: "real", revision: 1 },
      )
    ).status,
    409,
  );
  assert.equal(
    (await f.call(path, f.emp, "PUT", { status: "completed", revision: 1 }))
      .status,
    403,
  );
  assert.equal(
    (await f.call(path, f.mgr, "PUT", { status: "completed", revision: 1 }))
      .status,
    200,
  );
  assert.equal(
    (await f.call(path, f.mgr, "PUT", { status: "active", revision: 1 }))
      .status,
    409,
  );
  assert.equal(
    (await f.call(link, f.emp, "PUT", { activityId: "real", revision: 1 }))
      .status,
    409,
  );
  assert.equal(
    (
      await f.call(path + "/targets", f.mgr, "POST", {
        customerIds: ["mine"],
        assigneeId: "emp",
      })
    ).status,
    409,
  );
  await f.db
    .delete(customerActivities)
    .where(eq(customerActivities.id, "real"));
  assert.equal(
    (await f.call(path, f.emp)).data.targets[0].activityId,
    null,
    "deleted activity does not leave a fake completion",
  );
  await f.db.delete(customerStaff).where(eq(customerStaff.customerId, "mine"));
  assert.equal(
    (await f.call(path, f.emp)).status,
    404,
    "revoking customer visibility immediately revokes campaign access",
  );
});

test("customer deduplication preserves campaign attribution and real care while counting one surviving customer", async () => {
  const f = await customerCenterFixture();
  await f.addCustomer("keep", "mgr", { taxCode: "1234567890" });
  await f.addCustomer("drop", "mgr", { taxCode: "1234567890" });
  const made = await f.call(base + "/campaigns", f.mgr, "POST", {
    name: "Gộp khách",
    startDate: f.today,
    endDate: f.today,
    customerIds: ["keep", "drop"],
    assigneeId: "mgr",
  });
  assert.equal(made.status, 201);
  const path = base + "/campaigns/" + made.data.campaign.id,
    detail = (await f.call(path, f.mgr)).data;
  const t = detail.targets.find(
    (r: { customerId: string }) => r.customerId === "drop",
  );
  await f.db
    .insert(customerActivities)
    .values({
      id: "merged-care",
      content: "Đã trao đổi nhu cầu thực tế",
      customerId: "drop",
      ownerId: "mgr",
      type: "call",
      completion: "completed",
      occurredAt: f.today + "T05:00:00Z",
      createdAt: f.now,
      updatedAt: f.now,
    });
  assert.equal(
    (
      await f.call(path + "/targets/" + t.id + "/activity", f.mgr, "PUT", {
        activityId: "merged-care",
        revision: 1,
      })
    ).status,
    200,
  );
  assert.equal(await mergeCustomers(f.db, "keep", ["drop"], "mgr"), 1);
  const merged = (await f.call(path, f.mgr)).data;
  assert.equal(merged.total, 1);
  assert.equal(merged.targets[0].customerId, "keep");
  assert.equal(merged.targets[0].activityId, "merged-care");
  assert.equal(merged.targets[0].completion, "completed");
  assert.equal(
    (await f.db.select().from(customers).where(eq(customers.id, "drop")))
      .length,
    0,
  );
  assert.equal(
    (
      await f.db
        .select()
        .from(customerActivities)
        .where(eq(customerActivities.id, "merged-care"))
    )[0]?.customerId,
    "keep",
  );
});
