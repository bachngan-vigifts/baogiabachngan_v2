import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setupSepay } from "../helpers/sepay-fixture.ts";
import { positionPermissions } from "../../src/modules/staff/schema.ts";
import { customerPayments } from "../../src/modules/sales/schema.ts";
import { canViewSepay } from "../../src/modules/sales/domain/sepay-page.ts";
import { routePermission } from "../../src/modules/staff/domain/permissions.ts";

const list = "/sepay/transactions?from=2026-11-08&to=2026-11-08";
test("SePay uses explicit position permissions; Accounting can be revoked and external roles never gain access", () => {
  assert.equal(canViewSepay({ role: "manager", perms: [] }), true);
  assert.equal(
    canViewSepay({ role: "employee", positionId: "accounting" }),
    true,
  );
  assert.equal(
    canViewSepay({ role: "employee", positionId: "accounting", perms: [] }),
    false,
  );
  assert.equal(
    canViewSepay({
      role: "employee",
      positionId: "custom",
      perms: ["page.sepay"],
    }),
    true,
  );
  for (const role of ["supplier", "customer"])
    assert.equal(canViewSepay({ role, perms: ["page.sepay"] }), false);
  for (const [method, path] of [
    ["GET", "/sepay/transactions"],
    ["GET", "/sepay/transactions/id"],
    ["POST", "/sepay/pull-today"],
  ])
    assert.deepEqual(routePermission(method!, path!, new URLSearchParams()), [
      "page.sepay",
    ]);
  assert.equal(
    routePermission("POST", "/integrations/sepay/pull", new URLSearchParams()),
    null,
    "machine authentication remains separate",
  );
});

test("grant/revoke through the real permissions API takes effect on an existing session; view access never grants confirmation", async () => {
  const f = await setupSepay();
  const proof = await f.incoming("Khoản ngân hàng kiểm thử phân quyền");
  const order = await f.order("SEPAY_PERMISSION_ORDER");
  const catalog = (await f.call("/permissions", f.mgr)).data;
  assert.ok(
    catalog.catalog.some(
      (p: any) => p.key === "page.sepay" && p.group === "Kế toán",
    ),
  );
  const user = (await f.call("/me", f.emp)).data.user;
  const position = catalog.positions.find((p: any) => p.id === user.positionId);
  assert.ok(!position.perms.includes("page.sepay"));
  assert.equal((await f.call(list, f.emp)).status, 403);
  assert.equal(
    (await f.call("/sepay/transactions/" + proof.id, f.emp)).status,
    403,
  );
  const allow = await f.call(
    "/permissions/positions/" + position.id,
    f.mgr,
    "PUT",
    { perms: [...position.perms, "page.sepay"] },
  );
  assert.equal(allow.status, 200, JSON.stringify(allow.data));
  const visible = await f.call(list, f.emp);
  assert.equal(visible.status, 200, JSON.stringify(visible.data));
  assert.equal(visible.data.capabilities.canConfirm, false);
  assert.equal(
    (await f.call("/sepay/transactions/" + proof.id, f.emp)).status,
    200,
  );
  assert.equal((await f.call("/sepay/orders", f.emp)).status, 403);
  assert.equal((await f.call("/admin/sepay-transactions", f.emp)).status, 403);
  assert.equal(
    (await f.confirm(proof.id, f.choice(order.id), f.emp)).status,
    403,
  );
  assert.equal((await f.db.select().from(customerPayments)).length, 0);
  f.env.nowSec = () => Date.parse("2026-11-09T00:00:00Z") / 1000;
  f.env.sepayApiToken = "FAKE_SEPAY_PERMISSION_TOKEN";
  let requests = 0;
  f.env.sepayApiFetch = async (input) => {
    requests++;
    return Response.json(
      String(input).includes("/count")
        ? { status: 200, count_transactions: 0 }
        : { status: 200, transactions: [] },
    );
  };
  assert.equal(
    (await f.call("/sepay/pull-today", f.emp, "POST", {})).status,
    200,
  );
  assert.equal(requests, 2);
  assert.equal(
    (
      await f.call("/permissions/positions/" + position.id, f.mgr, "PUT", {
        perms: position.perms,
      })
    ).status,
    200,
  );
  for (const path of [list, "/sepay/transactions/" + proof.id])
    assert.equal((await f.call(path, f.emp)).status, 403);
  assert.equal(
    (await f.call("/sepay/pull-today", f.emp, "POST", {})).status,
    403,
  );
  assert.equal(requests, 2, "denied pull never calls the provider");
  assert.equal(
    (await f.call("/me", f.emp)).data.user.perms.includes("page.sepay"),
    false,
  );
  assert.equal((await f.call(list, f.mgr)).status, 200);
  const log = (await f.call("/permissions", f.mgr)).data.log;
  assert.ok(
    log.some((x: any) => x.detail.includes("Thanh toán SePay")),
    "grant/revoke remains in the permission audit",
  );
});

test("Accounting seed preserves prior access once; revocation survives migration replay and the deployment gate", async () => {
  const f = await setupSepay();
  assert.equal((await f.call(list, f.accountant)).status, 200);
  const view = (await f.call("/permissions", f.mgr)).data;
  const accounting = view.positions.find((p: any) => p.id === "accounting");
  const before = await f.db.select().from(positionPermissions);
  assert.equal(
    (
      await f.call("/permissions/positions/accounting", f.mgr, "PUT", {
        perms: accounting.perms.filter((k: string) => k !== "page.sepay"),
      })
    ).status,
    200,
  );
  assert.equal((await f.call(list, f.accountant)).status, 403);
  assert.equal(
    (await f.call("/sepay/pull-today", f.accountant, "POST", {})).status,
    403,
  );
  const migration = readFileSync(
    new URL(
      "../../migrations/postgres/20261110020309_sepay_page_permission.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const gate = readFileSync(
    new URL(
      "../../scripts/sql/assert-sepay-page-permission.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await f.client.exec(migration);
  await f.client.exec(migration);
  await f.client.exec(gate);
  assert.equal(
    (await f.call(list, f.accountant)).status,
    403,
    "replaying the seed must not restore revoked bank access",
  );
  const after = await f.db.select().from(positionPermissions);
  assert.deepEqual(
    after.filter((p) => p.positionId !== "accounting"),
    before.filter((p) => p.positionId !== "accounting"),
  );
  assert.equal(
    (
      await f.call("/permissions/positions/accounting", f.mgr, "PUT", {
        perms: accounting.perms,
      })
    ).status,
    200,
  );
  assert.equal(
    (await f.call(list, f.accountant)).status,
    200,
    "Manager can explicitly restore the permission",
  );
  await f.client.exec(
    "delete from audit_logs where id='migration:sepay-page-permission'",
  );
  await assert.rejects(f.client.exec(gate), /Chưa chạy/);
});
