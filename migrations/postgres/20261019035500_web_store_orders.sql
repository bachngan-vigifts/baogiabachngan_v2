CREATE TABLE "web_store_orders" (
  "id" text PRIMARY KEY NOT NULL,
  "source" text NOT NULL,
  "external_id" text NOT NULL,
  "order_no" text NOT NULL,
  "register_id" text NOT NULL REFERENCES "pos_registers"("id"),
  "status" text NOT NULL,
  "customer_name" text DEFAULT 'Khách lẻ' NOT NULL,
  "phone" text DEFAULT '' NOT NULL,
  "email" text DEFAULT '' NOT NULL,
  "address" text DEFAULT '' NOT NULL,
  "total" double precision DEFAULT 0 NOT NULL,
  "currency" text DEFAULT 'VND' NOT NULL,
  "payment_method" text DEFAULT '' NOT NULL,
  "lines" text DEFAULT '[]' NOT NULL,
  "ordered_at" text NOT NULL,
  "updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "web_store_orders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_web_store_order" ON "web_store_orders" ("source","external_id");
--> statement-breakpoint
CREATE INDEX "idx_web_store_orders_register" ON "web_store_orders" ("register_id","updated_at");
