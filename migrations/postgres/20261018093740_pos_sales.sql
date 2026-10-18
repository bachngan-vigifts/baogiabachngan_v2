CREATE TABLE "product_barcodes" (
	"barcode" text PRIMARY KEY NOT NULL,
	"sku" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_barcodes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pos_payment_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"shift_id" text NOT NULL,
	"request_key" text NOT NULL,
	"cart" text NOT NULL,
	"fingerprint" text NOT NULL,
	"amount" double precision NOT NULL,
	"created_at" text NOT NULL,
	"expires_at" text NOT NULL,
	"confirmed_at" text,
	CONSTRAINT "chk_pos_qr_amount" CHECK ("pos_payment_requests"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "pos_payment_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pos_registers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"warehouse_id" text NOT NULL,
	"price_policy_id" text NOT NULL,
	"second_price_policy_id" text NOT NULL,
	"price_includes_vat" boolean DEFAULT true NOT NULL,
	"tax_rate" double precision DEFAULT 8 NOT NULL,
	"bank_code" text DEFAULT '' NOT NULL,
	"bank_account" text DEFAULT '' NOT NULL,
	"bank_account_name" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "chk_pos_register_prices" CHECK ("pos_registers"."price_policy_id" <> "pos_registers"."second_price_policy_id"),
	CONSTRAINT "chk_pos_tax" CHECK ("pos_registers"."tax_rate" >= 0 and "pos_registers"."tax_rate" <= 100)
);
--> statement-breakpoint
ALTER TABLE "pos_registers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pos_shift_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"starts_at" text NOT NULL,
	"ends_at" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pos_shift_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pos_shifts" (
	"id" text PRIMARY KEY NOT NULL,
	"register_id" text NOT NULL,
	"member_id" text NOT NULL,
	"template_id" text NOT NULL,
	"business_date" text NOT NULL,
	"open_key" text NOT NULL,
	"opened_at" text NOT NULL,
	"opening_cash" double precision NOT NULL,
	"closed_at" text,
	"counted_cash" double precision,
	"expected_cash" double precision,
	"cash_difference" double precision,
	"difference_reason" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"report_snapshot" text,
	CONSTRAINT "chk_pos_opening_cash" CHECK ("pos_shifts"."opening_cash" >= 0 and "pos_shifts"."opening_cash" = trunc("pos_shifts"."opening_cash")),
	CONSTRAINT "chk_pos_close" CHECK (("pos_shifts"."closed_at" is null and "pos_shifts"."report_snapshot" is null) or ("pos_shifts"."closed_at" is not null and "pos_shifts"."report_snapshot" is not null and "pos_shifts"."counted_cash" >= 0 and ("pos_shifts"."cash_difference" = 0 or length(trim("pos_shifts"."difference_reason")) > 0)))
);
--> statement-breakpoint
ALTER TABLE "pos_shifts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pos_shift_stock_counts" (
	"shift_id" text NOT NULL,
	"sku" text NOT NULL,
	"system_qty" double precision NOT NULL,
	"counted_qty" double precision NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	CONSTRAINT "pos_shift_stock_counts_shift_id_sku_pk" PRIMARY KEY("shift_id","sku"),
	CONSTRAINT "chk_pos_count" CHECK ("pos_shift_stock_counts"."counted_qty" >= 0)
);
--> statement-breakpoint
ALTER TABLE "pos_shift_stock_counts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_moves" DROP CONSTRAINT "chk_stock_moves_ref_type";--> statement-breakpoint
ALTER TABLE "customer_payments" ADD COLUMN "shift_id" text;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD COLUMN "delivery_id" text;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD COLUMN "request_key" text;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD COLUMN "payment_source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "cod_amount" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "list_unit_price" double precision;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "discount_type" text DEFAULT 'percent' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "discount_value" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "discount_amount" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "channel" text DEFAULT 'crm' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "shift_id" text;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "checkout_key" text;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "pos_snapshot" text;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "pos_payment_request_id" text;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "fulfillment_mode" text DEFAULT 'delivery' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_barcodes" ADD CONSTRAINT "product_barcodes_sku_products_sku_fk" FOREIGN KEY ("sku") REFERENCES "public"."products"("sku") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_payment_requests" ADD CONSTRAINT "pos_payment_requests_shift_id_pos_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."pos_shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_registers" ADD CONSTRAINT "pos_registers_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_registers" ADD CONSTRAINT "pos_registers_price_policy_id_price_policies_id_fk" FOREIGN KEY ("price_policy_id") REFERENCES "public"."price_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_registers" ADD CONSTRAINT "pos_registers_second_price_policy_id_price_policies_id_fk" FOREIGN KEY ("second_price_policy_id") REFERENCES "public"."price_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_registers" ADD CONSTRAINT "pos_registers_updated_by_staff_members_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD CONSTRAINT "pos_shifts_register_id_pos_registers_id_fk" FOREIGN KEY ("register_id") REFERENCES "public"."pos_registers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD CONSTRAINT "pos_shifts_member_id_staff_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD CONSTRAINT "pos_shifts_template_id_pos_shift_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."pos_shift_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_shift_stock_counts" ADD CONSTRAINT "pos_shift_stock_counts_shift_id_pos_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."pos_shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_shift_stock_counts" ADD CONSTRAINT "pos_shift_stock_counts_sku_products_sku_fk" FOREIGN KEY ("sku") REFERENCES "public"."products"("sku") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_product_barcodes_sku" ON "product_barcodes" USING btree ("sku");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_pos_qr_key" ON "pos_payment_requests" USING btree ("request_key");--> statement-breakpoint
CREATE INDEX "idx_pos_qr_shift" ON "pos_payment_requests" USING btree ("shift_id");--> statement-breakpoint
CREATE INDEX "idx_pos_register_warehouse" ON "pos_registers" USING btree ("warehouse_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_pos_shift_open_key" ON "pos_shifts" USING btree ("open_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_pos_member_open" ON "pos_shifts" USING btree ("member_id") WHERE "pos_shifts"."closed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_pos_register_open" ON "pos_shifts" USING btree ("register_id") WHERE "pos_shifts"."closed_at" is null;--> statement-breakpoint
CREATE INDEX "idx_pos_shifts_member" ON "pos_shifts" USING btree ("member_id","opened_at");--> statement-breakpoint
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_shift_id_pos_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."pos_shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_shift_id_pos_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."pos_shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_pos_payment_request_id_pos_payment_requests_id_fk" FOREIGN KEY ("pos_payment_request_id") REFERENCES "public"."pos_payment_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_pos_payments_shift" ON "customer_payments" USING btree ("shift_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_pos_payment_request" ON "customer_payments" USING btree ("request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_pos_checkout_key" ON "sales_orders" USING btree ("checkout_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_pos_order_qr" ON "sales_orders" USING btree ("pos_payment_request_id");--> statement-breakpoint
CREATE INDEX "idx_pos_orders_shift" ON "sales_orders" USING btree ("shift_id");--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "chk_stock_moves_ref_type" CHECK ("stock_moves"."ref_type" IN ('opening', 'supplier_receipt', 'packing_slip', 'adjustment', 'pos_order', 'pos_delivery'));
--> statement-breakpoint
INSERT INTO staff_position_permissions(position_id,permission) SELECT id,'pos.sell' FROM staff_positions WHERE id IN ('sale','sale-admin','sales-ml','sales-lock') ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO pos_shift_templates(id,name,starts_at,ends_at) VALUES ('morning','Ca sáng','08:00','14:00') ON CONFLICT DO NOTHING;
