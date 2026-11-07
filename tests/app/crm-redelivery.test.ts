import { contractTest as test, assert } from "../TEST_TEMPLATE.ts";
import { and, eq } from "drizzle-orm";
import { setupCrmReturns } from "../helpers/crm-return-fixture.ts";
import {
  salesOrders,
  salesOrderLines,
  deliveries,
  deliveryLines,
  packingSlips,
  packingSlipLines,
} from "../../src/modules/sales/schema.ts";
import {
  posReturns,
  posRefunds,
} from "../../src/modules/sales/return-schema.ts";
import { stockMoves } from "../../src/modules/inventory/schema.ts";
import { products } from "../../src/modules/catalog/schema.ts";
import { postMoves } from "../../src/modules/inventory/api/ledger.ts";
import {
  returnPurpose,
  requestedReturnPurpose,
} from "../../src/modules/sales/domain/crm-return-purpose.ts";
import { crmStockFulfilment } from "../../src/modules/sales/api/crm-stock-lifecycle.ts";
const date = "2026-11-10";
test("return intent is explicit, logistics is new default, legacy snapshots retain credit", () => {
  assert.equal(requestedReturnPurpose(undefined), "redelivery");
  assert.equal(requestedReturnPurpose("credit"), "credit");
  assert.throws(() => requestedReturnPurpose("refund-now"));
  assert.equal(returnPurpose("{}"), "credit");
  assert.equal(returnPurpose("bad-json"), "credit");
  assert.equal(returnPurpose('{"returnPurpose":"redelivery"}'), "redelivery");
});
async function fixture(id: string, issued = true) {
  const f = await setupCrmReturns();
  await f.seed(id, 2186125, "emp", issued);
  const at = new Date().toISOString();
  await f.db.insert(products).values([
    { sku: "09566", name: "Bộ 09", unit: "Bộ", updatedAt: at },
    { sku: "22566", name: "Bộ 22", unit: "Bộ", updatedAt: at },
  ]);
  await f.db
    .update(salesOrders)
    .set({ warehouseId: "pos-wh" })
    .where(eq(salesOrders.id, id));
  const base = `/orders/${id}/returns`,
    detail = () => f.call("/orders/" + id, f.mgr).then((r) => f.ok(r));
  const logistics = async (qty = 2, line = "a") =>
    f.ok(
      await f.call(base, f.emp, "POST", {
        key: crypto.randomUUID(),
        warehouseId: "pos-wh",
        reason: "Nhận để giao lại",
        lines: [{ orderLineId: id + "-" + line, qty, disposition: "restock" }],
      }),
      201,
    );
  const physical = async (slip: string, qty = 2, line = "a") => {
    await f.db
      .insert(packingSlips)
      .values({
        id: slip,
        slipNo: "DG-" + slip,
        orderId: id,
        source: "warehouse",
        status: "packed",
        stockWarehouseId: "pos-wh",
        totalQty: qty,
        createdBy: "mgr",
        createdAt: at,
        updatedAt: at,
        packedAt: at,
        packedBy: "mgr",
      });
    await f.db
      .insert(packingSlipLines)
      .values({
        id: slip + "-line",
        slipId: slip,
        orderLineId: id + "-" + line,
        sku: line === "a" ? "09566" : "22566",
        name: "Đóng lại",
        unit: "Bộ",
        qty,
      });
  };
  return { ...f, base, detail, logistics, physical, at };
}
test("receive for redelivery keeps debt, paid amounts and invoices; reopens packing and shipments, keeps historical shipments, caps repeated cycles", async () => {
  const f = await fixture("again");
  await f.physical("original");
  await f.physical("original-b", 2, "b");
  await f.db
    .insert(deliveries)
    .values({
      id: "old",
      deliveryNo: "GH-OLD",
      orderId: "again",
      plannedDate: date,
      deliveredAt: date,
      status: "delivered",
      createdBy: "mgr",
      createdAt: f.at,
      updatedAt: f.at,
    });
  await f.db.insert(deliveryLines).values([
    { deliveryId: "old", orderLineId: "again-a", qty: 2 },
    { deliveryId: "old", orderLineId: "again-b", qty: 2 },
  ]);
  const before = await f.detail(),
    r = await f.logistics();
  f.ok(await f.call(f.base+'/'+r.id+'/approve',f.mgr,'POST',{}));
  const concurrent=await Promise.all([1,2,3].map(()=>f.call(f.base+'/'+r.id+'/receive',f.emp,'POST',{confirmed:true})));
  assert.ok(concurrent.every(x=>x.status===200));assert.equal(concurrent.filter(x=>x.data.replayed).length,2);
  let d = await f.detail();
  assert.equal(d.receivable.balance, before.receivable.balance);
  assert.equal(d.order.total, before.order.total);
  assert.equal(d.payments[0].amount, before.payments[0].amount);
  assert.equal(d.order.invoiceNo, "0002026");
  const line = d.lines.find((l: { id: string }) => l.id === "again-a");
  assert.deepEqual(
    [
      line.deliveredQty,
      line.historicalDeliveredQty,
      line.returnedQty,
      line.customerKeptQty,
    ],
    [0, 2, 2, 0],
  );
  assert.equal(d.returnAdjustment, null);
  assert.notEqual(d.order.status, "delivered");
  assert.equal((await f.call(f.base, f.emp)).data.account.refunded, 0);
  assert.equal((await f.call(f.base, f.emp)).data.account.credit, 0);
  assert.equal(
    (
      await f.call(f.base + "/" + r.id + "/refund", f.mgr, "POST", {
        key: crypto.randomUUID(),
        amount: 1,
        method: "transfer",
        reference: "NO",
        drawerId: "store",
        confirmed: true,
      })
    ).status,
    409,
  );
  const packed = f.ok(await f.call("/orders/again/packing", f.mgr));
  assert.equal(
    packed.lines.find((l: { id: string }) => l.id === "again-a").left,
    2,
  );
  const ship = f.ok(
    await f.call("/deliveries", f.mgr, "POST", {
      orderId: "again",
      plannedDate: date,
      lines: [{ orderLineId: "again-a", qty: 2 }],
    }),
    201,
  );
  assert.equal(
    (
      await f.call("/deliveries", f.mgr, "POST", {
        orderId: "again",
        plannedDate: date,
        lines: [{ orderLineId: "again-a", qty: 1 }],
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.call("/deliveries/" + ship.id + "/status", f.mgr, "PUT", {
        status: "delivered",
      })
    ).status,
    409,
    "old issue cannot authorize redispatch after return",
  );
  await f.physical("replacement");
  await postMoves(f.db, "mgr", [
    {
      sku: "09566",
      warehouseId: "pos-wh",
      qty: -2,
      kind: "sale",
      refType: "packing_slip",
      refId: "replacement",
    },
  ]);
  f.ok(
    await f.call("/deliveries/" + ship.id + "/status", f.mgr, "PUT", {
      status: "delivered",
    }),
  );
  d = await f.detail();
  assert.equal(d.lines[0].historicalDeliveredQty, 4);
  assert.equal(d.lines[0].customerKeptQty, 2);
  assert.equal(
    d.deliveries.find((x: { id: string }) => x.id === "old").status,
    "delivered",
  );
  const second = await f.logistics();
  await f.receive("again", second.id);
  d = await f.detail();
  assert.equal(d.lines[0].deliveredQty, 0);
  assert.equal(d.lines[0].returnedQty, 4);
  assert.equal(d.receivable.balance, before.receivable.balance);
  const moves = await f.db
    .select()
    .from(stockMoves)
    .where(eq(stockMoves.refId, second.id));
  f.ok(
    await f.call(f.base + "/" + second.id + "/receive", f.emp, "POST", {
      confirmed: true,
    }),
  );
  assert.equal(
    (
      await f.db
        .select()
        .from(stockMoves)
        .where(eq(stockMoves.refId, second.id))
    ).length,
    moves.length,
  );
  assert.equal(
    (await crmStockFulfilment(f.db, ["again"])).get("again")?.lines[0]?.issued,
    0,
  );
});
test("legacy unrefunded credit can be corrected by Manager once without another stock movement; actual refunds block conversion", async () => {
  const f = await fixture("legacy");
  const r = (
    await f.create("legacy", [
      { orderLineId: "legacy-a", qty: 2, disposition: "restock" },
    ])
  ).data;
  await f.receive("legacy", r.id);
  const beforeMoves = await f.db
      .select()
      .from(stockMoves)
      .where(eq(stockMoves.refId, r.id)),
    payload = { confirmed: true, reason: "Nhận hàng để giao lại cho khách" };
  assert.equal(
    (await f.call(f.base + "/" + r.id + "/redelivery", f.emp, "POST", payload))
      .status,
    403,
  );
  assert.equal(
    (await f.call(f.base + "/missing/redelivery", f.mgr, "POST", payload))
      .status,
    404,
  );
  f.ok(
    await f.call(f.base + "/" + r.id + "/redelivery", f.mgr, "POST", payload),
  );
  assert.equal(
    f.ok(
      await f.call(f.base + "/" + r.id + "/redelivery", f.mgr, "POST", payload),
    ).replayed,
    true,
  );
  const d = await f.detail();
  assert.equal(d.receivable.balance, 2186125);
  assert.equal(d.lines[0].deliveredQty, 0);
  assert.deepEqual(
    await f.db.select().from(stockMoves).where(eq(stockMoves.refId, r.id)),
    beforeMoves,
  );
  assert.equal(
    (await f.db.select().from(posReturns).where(eq(posReturns.id, r.id)))[0]
      ?.creditEffectiveAt,
    null,
  );
  await f.seed("refunded", 4372250);
  const paid = (
    await f.create("refunded", [
      { orderLineId: "refunded-a", qty: 2, disposition: "restock" },
    ])
  ).data;
  await f.receive("refunded", paid.id);
  f.ok(
    await f.call(
      "/orders/refunded/returns/" + paid.id + "/refund",
      f.mgr,
      "POST",
      {
        key: crypto.randomUUID(),
        amount: 1,
        method: "transfer",
        reference: "PAID",
        drawerId: "store",
        confirmed: true,
      },
    ),
    201,
  );
  assert.equal(
    (
      await f.call(
        "/orders/refunded/returns/" + paid.id + "/redelivery",
        f.mgr,
        "POST",
        payload,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await f.db
        .select()
        .from(posRefunds)
        .where(eq(posRefunds.returnId, paid.id))
    ).length,
    1,
  );
});
test("historical pre-opening receipt does not consume future issue proof or release never-existing packing allocations", async () => {
  const f = await fixture("pre", false);
  await f.db
    .update(salesOrderLines)
    .set({ deliveredQty: 0 })
    .where(eq(salesOrderLines.id, "pre-b"));
  await postMoves(f.db, "mgr", [
    {
      sku: "09566",
      warehouseId: "pos-wh",
      qty: 0.001,
      kind: "opening",
      refType: "opening",
      refId: "opening-pre",
    },
  ]);
  const r = await f.logistics();
  f.ok(
    await f.call(f.base + "/" + r.id + "/approve", f.mgr, "POST", {
      stockBasis: {
        kind: "pre_opening",
        note: "Giao trước chốt tồn, không có phiếu xuất cũ",
      },
    }),
  );
  f.ok(
    await f.call(f.base + "/" + r.id + "/receive", f.emp, "POST", {
      confirmed: true,
    }),
  );
  const ship = f.ok(
    await f.call("/deliveries", f.mgr, "POST", {
      orderId: "pre",
      plannedDate: date,
      lines: [{ orderLineId: "pre-a", qty: 2 }],
    }),
    201,
  );
  assert.equal(
    (
      await f.call("/deliveries/" + ship.id + "/status", f.mgr, "PUT", {
        status: "delivered",
      })
    ).status,
    409,
  );
  await f.physical("pre-new");
  await postMoves(f.db, "mgr", [
    {
      sku: "09566",
      warehouseId: "pos-wh",
      qty: -2,
      kind: "sale",
      refType: "packing_slip",
      refId: "pre-new",
    },
  ]);
  assert.equal(
    (await crmStockFulfilment(f.db, ["pre"])).get("pre")?.lines[0]?.issued,
    2,
  );
  const packing = f.ok(await f.call("/orders/pre/packing", f.mgr));
  assert.equal(
    packing.lines[0].left,
    0,
    "receipt without old packing must not release the new packing allocation",
  );
  f.ok(
    await f.call("/deliveries/" + ship.id + "/status", f.mgr, "PUT", {
      status: "delivered",
    }),
  );
});

test('damaged logistics receipt opens replacement quantity without adding sellable inventory or reducing debt',async()=>{
 const f=await fixture('damaged-logistics');const before=await f.detail();
 const r=f.ok(await f.call(f.base,f.emp,'POST',{key:crypto.randomUUID(),warehouseId:'pos-wh',reason:'Hàng hỏng nhận về để giao bù',lines:[{orderLineId:'damaged-logistics-a',qty:1,disposition:'damaged'}]}),201);
 await f.receive('damaged-logistics',r.id);const after=await f.detail();assert.equal(after.receivable.balance,before.receivable.balance);
 assert.deepEqual([after.lines[0].deliveredQty,after.lines[0].historicalDeliveredQty,after.lines[0].restockedQty,after.lines[0].customerKeptQty],[1,2,0,1]);
 assert.equal((await f.db.select().from(stockMoves).where(eq(stockMoves.refId,r.id))).length,0);
 assert.equal((await crmStockFulfilment(f.db,['damaged-logistics'])).get('damaged-logistics')?.lines[0]?.issued,1);
});
