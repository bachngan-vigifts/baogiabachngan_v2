CREATE TABLE "product_sales_history" (
	"id" text PRIMARY KEY NOT NULL,
	"sku" text NOT NULL,
	"order_id" text NOT NULL,
	"order_line_id" text NOT NULL,
	"order_no" text NOT NULL,
	"customer_id" text,
	"customer_name" text NOT NULL,
	"owner_id" text,
	"name" text DEFAULT '' NOT NULL,
	"unit" text DEFAULT '' NOT NULL,
	"qty" double precision NOT NULL,
	"unit_price" double precision NOT NULL,
	"tax_rate" double precision DEFAULT 0 NOT NULL,
	"sold_on" text NOT NULL,
	"recorded_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_sales_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_sales_history" ADD CONSTRAINT "product_sales_history_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_sales_history" ADD CONSTRAINT "product_sales_history_order_line_id_sales_order_lines_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."sales_order_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_sales_history" ADD CONSTRAINT "product_sales_history_customer_id_sapo_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."sapo_customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_sales_history" ADD CONSTRAINT "product_sales_history_owner_id_staff_members_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."staff_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_product_sales_line" ON "product_sales_history" USING btree ("order_line_id");--> statement-breakpoint
CREATE INDEX "idx_product_sales_sku" ON "product_sales_history" USING btree ("sku","sold_on");--> statement-breakpoint
-- Lấy lại lịch sử từ các đơn đã xác nhận có sẵn (bỏ đơn nháp / đã huỷ, dòng không có mã hàng).
INSERT INTO "product_sales_history" ("id", "sku", "order_id", "order_line_id", "order_no", "customer_id", "customer_name", "owner_id", "name", "unit", "qty", "unit_price", "tax_rate", "sold_on", "recorded_at")
SELECT gen_random_uuid()::text, l."sku", o."id", l."id", o."order_no", o."customer_id", o."customer_name", o."owner_id", l."name", l."unit", l."qty", l."unit_price", l."tax_rate", o."order_date", o."created_at"
FROM "sales_order_lines" l JOIN "sales_orders" o ON o."id" = l."order_id"
WHERE o."status" IN ('confirmed', 'delivering', 'delivered') AND l."sku" <> ''
ON CONFLICT ("order_line_id") DO NOTHING;--> statement-breakpoint
-- Mỗi mã chỉ giữ 10 lần bán gần nhất.
DELETE FROM "product_sales_history" h USING (
  SELECT "id", row_number() OVER (PARTITION BY "sku" ORDER BY "sold_on" DESC, "recorded_at" DESC) AS rn FROM "product_sales_history"
) r WHERE h."id" = r."id" AND r.rn > 10;
