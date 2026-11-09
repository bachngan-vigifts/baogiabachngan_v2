import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createTestDb } from "../helpers/postgres.ts";
const migration = readFileSync(
  new URL(
    "../../migrations/postgres/20261109193137_sepay_proximity_indexes.sql",
    import.meta.url,
  ),
  "utf8",
).replaceAll("--> statement-breakpoint", "");
const gate = readFileSync(
  new URL("../../scripts/sql/assert-sepay-proximity.sql", import.meta.url),
  "utf8",
);
test("SePay time matching indexes are repeatable, gate detects absence, and one receipt cannot link two bank payments", async () => {
  const { client } = await createTestDb();
  await client.exec(migration);
  await client.exec(migration);
  await client.exec(gate);
  const insert = (id: string) =>
    client.query(
      "insert into sepay_transactions(id,provider_id,transfer_type,amount,transaction_at,status,payment_id,payload,received_at) values($1,$1,'in',100,'2026-11-08T03:00:00Z','matched','receipt-one','{}','2026-11-08T03:00:00Z')",
      [id],
    );
  await insert("first");
  await assert.rejects(insert("second"), /uq_sepay_payment_link|duplicate key/);
  await client.exec("drop index idx_sales_orders_created");
  await assert.rejects(client.exec(gate), /index đối soát/);
  await client.exec(migration);
  await client.exec(gate);
});
