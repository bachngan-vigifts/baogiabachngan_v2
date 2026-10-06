CREATE TABLE "customer_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"schedule_id" text,
	"customer_id" text,
	"amount" double precision NOT NULL,
	"paid_at" text NOT NULL,
	"method" text DEFAULT 'transfer' NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "chk_customer_payments_method" CHECK ("customer_payments"."method" IN ('transfer', 'cash', 'other')),
	CONSTRAINT "chk_customer_payments_amount" CHECK ("customer_payments"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "customer_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"delivery_no" text NOT NULL,
	"order_id" text NOT NULL,
	"planned_date" text NOT NULL,
	"time_slot" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"receiver_name" text DEFAULT '' NOT NULL,
	"receiver_phone" text DEFAULT '' NOT NULL,
	"carrier" text DEFAULT '' NOT NULL,
	"shipping_fee" double precision DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"assignee_id" text,
	"delivered_at" text,
	"note" text DEFAULT '' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_deliveries_status" CHECK ("deliveries"."status" IN ('planned', 'in_transit', 'delivered', 'failed', 'cancelled')),
	CONSTRAINT "chk_deliveries_fee" CHECK ("deliveries"."shipping_fee" >= 0)
);
--> statement-breakpoint
ALTER TABLE "deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "delivery_lines" (
	"delivery_id" text NOT NULL,
	"order_line_id" text NOT NULL,
	"qty" double precision NOT NULL,
	CONSTRAINT "delivery_lines_delivery_id_order_line_id_pk" PRIMARY KEY("delivery_id","order_line_id"),
	CONSTRAINT "chk_delivery_lines_qty" CHECK ("delivery_lines"."qty" > 0)
);
--> statement-breakpoint
ALTER TABLE "delivery_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payment_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"contract_id" text,
	"kind" text NOT NULL,
	"amount" double precision NOT NULL,
	"due_date" text,
	"note" text DEFAULT '' NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "chk_payment_schedules_kind" CHECK ("payment_schedules"."kind" IN ('deposit', 'installment', 'balance')),
	CONSTRAINT "chk_payment_schedules_amount" CHECK ("payment_schedules"."amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "payment_schedules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sales_contracts" (
	"id" text PRIMARY KEY NOT NULL,
	"contract_no" text NOT NULL,
	"order_id" text NOT NULL,
	"quote_id" text,
	"customer_id" text,
	"legal_entity" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"signed_date" text,
	"value" double precision DEFAULT 0 NOT NULL,
	"deposit_rate" double precision DEFAULT 0 NOT NULL,
	"deposit_amount" double precision DEFAULT 0 NOT NULL,
	"payment_days" bigint DEFAULT 0 NOT NULL,
	"payment_method" text DEFAULT '' NOT NULL,
	"delivery_address" text DEFAULT '' NOT NULL,
	"data" text DEFAULT '{}' NOT NULL,
	"created_by" text NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_sales_contracts_status" CHECK ("sales_contracts"."status" IN ('draft', 'signed', 'completed', 'cancelled')),
	CONSTRAINT "chk_sales_contracts_entity" CHECK ("sales_contracts"."legal_entity" IN ('BN', 'VG', 'QTV')),
	CONSTRAINT "chk_sales_contracts_money" CHECK ("sales_contracts"."value" >= 0 AND "sales_contracts"."deposit_amount" >= 0 AND "sales_contracts"."deposit_rate" >= 0 AND "sales_contracts"."deposit_rate" <= 100 AND "sales_contracts"."payment_days" >= 0)
);
--> statement-breakpoint
ALTER TABLE "sales_contracts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sales_order_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"line_no" bigint NOT NULL,
	"sku" text DEFAULT '' NOT NULL,
	"name" text NOT NULL,
	"unit" text DEFAULT '' NOT NULL,
	"qty" double precision NOT NULL,
	"unit_price" double precision DEFAULT 0 NOT NULL,
	"tax_rate" double precision DEFAULT 0 NOT NULL,
	"amount" double precision DEFAULT 0 NOT NULL,
	"delivered_qty" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "chk_sales_order_lines_qty" CHECK ("sales_order_lines"."qty" > 0 AND "sales_order_lines"."delivered_qty" >= 0 AND "sales_order_lines"."delivered_qty" <= "sales_order_lines"."qty"),
	CONSTRAINT "chk_sales_order_lines_price" CHECK ("sales_order_lines"."unit_price" >= 0 AND "sales_order_lines"."tax_rate" >= 0 AND "sales_order_lines"."tax_rate" <= 100)
);
--> statement-breakpoint
ALTER TABLE "sales_order_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sales_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"order_no" text NOT NULL,
	"quote_id" text,
	"quote_no" text DEFAULT '' NOT NULL,
	"quote_type" text NOT NULL,
	"customer_id" text,
	"customer_name" text NOT NULL,
	"contact" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"tax_code" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"owner_id" text NOT NULL,
	"created_by" text NOT NULL,
	"order_date" text NOT NULL,
	"expected_delivery_date" text,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"subtotal" double precision DEFAULT 0 NOT NULL,
	"tax" double precision DEFAULT 0 NOT NULL,
	"total" double precision DEFAULT 0 NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"sapo_order_id" text,
	"sapo_order_code" text,
	"revision" bigint DEFAULT 1 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_sales_orders_status" CHECK ("sales_orders"."status" IN ('draft', 'confirmed', 'delivering', 'delivered', 'cancelled')),
	CONSTRAINT "chk_sales_orders_type" CHECK ("sales_orders"."quote_type" IN ('HRC', 'B2B', 'VIGIFTS')),
	CONSTRAINT "chk_sales_orders_total" CHECK ("sales_orders"."total" >= 0)
);
--> statement-breakpoint
ALTER TABLE "sales_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_schedule_id_payment_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."payment_schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_customer_id_sapo_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."sapo_customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_created_by_staff_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_assignee_id_staff_members_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_created_by_staff_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_lines" ADD CONSTRAINT "delivery_lines_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_lines" ADD CONSTRAINT "delivery_lines_order_line_id_sales_order_lines_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."sales_order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_schedules" ADD CONSTRAINT "payment_schedules_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_schedules" ADD CONSTRAINT "payment_schedules_contract_id_sales_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."sales_contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_contracts" ADD CONSTRAINT "sales_contracts_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_contracts" ADD CONSTRAINT "sales_contracts_quote_id_staff_quotations_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."staff_quotations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_contracts" ADD CONSTRAINT "sales_contracts_customer_id_sapo_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."sapo_customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_contracts" ADD CONSTRAINT "sales_contracts_created_by_staff_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_quote_id_staff_quotations_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."staff_quotations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_customer_id_sapo_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."sapo_customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_owner_id_staff_members_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_created_by_staff_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_customer_payments_order" ON "customer_payments" USING btree ("order_id","paid_at");--> statement-breakpoint
CREATE INDEX "idx_customer_payments_customer" ON "customer_payments" USING btree ("customer_id","paid_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_deliveries_no" ON "deliveries" USING btree ("delivery_no");--> statement-breakpoint
CREATE INDEX "idx_deliveries_date" ON "deliveries" USING btree ("planned_date","status");--> statement-breakpoint
CREATE INDEX "idx_deliveries_order" ON "deliveries" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_delivery_lines_order_line" ON "delivery_lines" USING btree ("order_line_id");--> statement-breakpoint
CREATE INDEX "idx_payment_schedules_order" ON "payment_schedules" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_payment_schedules_due" ON "payment_schedules" USING btree ("due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_sales_contracts_no" ON "sales_contracts" USING btree ("contract_no");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_sales_contracts_order" ON "sales_contracts" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_sales_contracts_customer" ON "sales_contracts" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_sales_contracts_status" ON "sales_contracts" USING btree ("status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_sales_order_lines_order" ON "sales_order_lines" USING btree ("order_id","line_no");--> statement-breakpoint
CREATE INDEX "idx_sales_order_lines_sku" ON "sales_order_lines" USING btree ("sku");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_sales_orders_no" ON "sales_orders" USING btree ("order_no");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_sales_orders_quote_active" ON "sales_orders" USING btree ("quote_id") WHERE "sales_orders"."quote_id" IS NOT NULL AND "sales_orders"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "idx_sales_orders_customer" ON "sales_orders" USING btree ("customer_id","order_date");--> statement-breakpoint
CREATE INDEX "idx_sales_orders_owner" ON "sales_orders" USING btree ("owner_id","updated_at");--> statement-breakpoint
CREATE INDEX "idx_sales_orders_status" ON "sales_orders" USING btree ("status","order_date");