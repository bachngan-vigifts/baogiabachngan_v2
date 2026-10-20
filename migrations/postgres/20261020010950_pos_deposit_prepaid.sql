CREATE TABLE "pos_order_reservations" (
"id" text PRIMARY KEY,
"order_id" text NOT NULL REFERENCES "sales_orders"("id"),
"order_line_id" text NOT NULL REFERENCES "sales_order_lines"("id"),
"warehouse_id" text NOT NULL REFERENCES "warehouses"("id"),
"qty" double precision NOT NULL,
"status" text NOT NULL,
"expires_at" text NOT NULL,
"created_at" text NOT NULL,
"updated_at" text NOT NULL,
"created_by" text NOT NULL REFERENCES "staff_members"("id"),
"closed_by" text REFERENCES "staff_members"("id"),
"closed_at" text,
"close_reason" text NOT NULL DEFAULT '',
CONSTRAINT "chk_pos_reservation_qty" CHECK ("qty">0),
CONSTRAINT "chk_pos_reservation_status" CHECK ("status" in ('active','released','consumed'))
);
CREATE UNIQUE INDEX "uq_pos_order_reservation" ON "pos_order_reservations" ("order_id", "order_line_id", "warehouse_id");
CREATE INDEX "idx_pos_reservation_expiry" ON "pos_order_reservations" ("warehouse_id", "status", "expires_at");
CREATE INDEX "idx_pos_reservation_order" ON "pos_order_reservations" ("order_id");
ALTER TABLE "pos_order_reservations" ENABLE ROW LEVEL SECURITY;
CREATE TABLE "pos_payment_intents" (
"id" text PRIMARY KEY,
"order_id" text NOT NULL REFERENCES "sales_orders"("id"),
"requested_shift_id" text NOT NULL REFERENCES "pos_shifts"("id"),
"kind" text NOT NULL,
"method" text NOT NULL,
"amount" double precision NOT NULL,
"request_key" text NOT NULL,
"request_hash" text NOT NULL,
"status" text NOT NULL,
"created_by" text NOT NULL REFERENCES "staff_members"("id"),
"created_at" text NOT NULL,
"confirmed_by" text REFERENCES "staff_members"("id"),
"confirmed_at" text,
"confirmed_shift_id" text REFERENCES "pos_shifts"("id"),
"cancelled_by" text REFERENCES "staff_members"("id"),
"cancelled_at" text,
"cancel_reason" text NOT NULL DEFAULT '',
"payment_id" text REFERENCES "customer_payments"("id"),
"reference" text NOT NULL DEFAULT '',
CONSTRAINT "chk_pos_intent_amount" CHECK ("amount">0 and "amount"=trunc("amount") and "amount"<=1000000000000),
CONSTRAINT "chk_pos_intent_status" CHECK ("status" in ('pending','confirmed','cancelled')),
CONSTRAINT "chk_pos_intent_kind" CHECK ("kind" in ('deposit','balance','prepaid')),
CONSTRAINT "chk_pos_intent_method" CHECK ("method"='transfer')
);
CREATE UNIQUE INDEX "uq_pos_intent_key" ON "pos_payment_intents" ("request_key");
CREATE UNIQUE INDEX "uq_pos_intent_payment" ON "pos_payment_intents" ("payment_id");
CREATE INDEX "idx_pos_intent_order" ON "pos_payment_intents" ("order_id", "status");
CREATE INDEX "idx_pos_intent_shift" ON "pos_payment_intents" ("requested_shift_id", "status", "created_at");
ALTER TABLE "pos_payment_intents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pos_returns" ADD COLUMN "request_context" text NOT NULL DEFAULT 'after_delivery';
ALTER TABLE "pos_returns" ADD CONSTRAINT "chk_pos_return_context" CHECK ("request_context" IN ('before_fulfillment','after_issue','after_delivery'));
