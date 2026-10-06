CREATE TABLE "product_movements" (
	"id" text PRIMARY KEY NOT NULL,
	"ref_key" text NOT NULL,
	"sku" text NOT NULL,
	"kind" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"qty" double precision NOT NULL,
	"unit" text DEFAULT '' NOT NULL,
	"unit_price" double precision,
	"partner" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"ref_code" text DEFAULT '' NOT NULL,
	"link" text DEFAULT '' NOT NULL,
	"status" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"occurred_at" text NOT NULL,
	"recorded_at" text NOT NULL,
	CONSTRAINT "chk_product_movements_kind" CHECK ("product_movements"."kind" IN ('sale', 'delivery', 'purchase', 'transfer', 'adjustment', 'customer_return', 'supplier_return'))
);
--> statement-breakpoint
ALTER TABLE "product_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sapo_inventory_docs" DROP CONSTRAINT "chk_sapo_inventory_docs_kind";--> statement-breakpoint
CREATE UNIQUE INDEX "idx_product_movements_ref" ON "product_movements" USING btree ("ref_key");--> statement-breakpoint
CREATE INDEX "idx_product_movements_sku" ON "product_movements" USING btree ("sku","occurred_at");--> statement-breakpoint
ALTER TABLE "sapo_inventory_docs" ADD CONSTRAINT "chk_sapo_inventory_docs_kind" CHECK ("sapo_inventory_docs"."kind" IN ('purchase_order', 'stock_transfer', 'stock_adjustment', 'order_return', 'purchase_return'));--> statement-breakpoint
-- Lấy lại lịch sử từ dữ liệu có sẵn. 1) Bán: dòng (có mã) của đơn đã xác nhận.
INSERT INTO "product_movements" ("id", "ref_key", "sku", "kind", "name", "qty", "unit", "unit_price", "partner", "ref_code", "link", "status", "occurred_at", "recorded_at")
SELECT gen_random_uuid()::text, 'sale:' || o."id" || ':' || l."id", trim(l."sku"), 'sale', l."name", l."qty", l."unit", l."unit_price", o."customer_name", o."order_no", '#/orders/' || o."id", 'Đã xác nhận', o."created_at", o."created_at"
FROM "sales_order_lines" l JOIN "sales_orders" o ON o."id" = l."order_id"
WHERE o."status" IN ('confirmed', 'delivering', 'delivered') AND trim(l."sku") <> ''
ON CONFLICT ("ref_key") DO NOTHING;--> statement-breakpoint
-- 2) Xuất kho giao hàng: chuyến đã giao.
INSERT INTO "product_movements" ("id", "ref_key", "sku", "kind", "name", "qty", "unit", "unit_price", "partner", "location", "ref_code", "link", "status", "occurred_at", "recorded_at")
SELECT gen_random_uuid()::text, 'delivery:' || d."id" || ':' || l."id", trim(l."sku"), 'delivery', l."name", dl."qty", l."unit", l."unit_price", o."customer_name", d."address",
  d."delivery_no" || ' · ' || o."order_no", '#/orders/' || o."id", 'Đã giao', coalesce(d."delivered_at" || 'T12:00:00.000Z', d."updated_at"), d."updated_at"
FROM "delivery_lines" dl JOIN "deliveries" d ON d."id" = dl."delivery_id" JOIN "sales_order_lines" l ON l."id" = dl."order_line_id" JOIN "sales_orders" o ON o."id" = d."order_id"
WHERE d."status" = 'delivered' AND trim(l."sku") <> ''
ON CONFLICT ("ref_key") DO NOTHING;--> statement-breakpoint
-- 3) Chứng từ kho Sapo đã đồng bộ: nhập hàng, điều chuyển, cân bằng kho.
INSERT INTO "product_movements" ("id", "ref_key", "sku", "kind", "name", "qty", "unit_price", "partner", "location", "ref_code", "status", "note", "occurred_at", "recorded_at")
SELECT gen_random_uuid()::text, 'sapo:' || d."id" || ':' || x."line_no", trim(x."sku"),
  CASE d."kind" WHEN 'purchase_order' THEN 'purchase' WHEN 'stock_transfer' THEN 'transfer' ELSE 'adjustment' END,
  x."name", CASE WHEN d."kind" = 'stock_adjustment' AND x."diff_qty" IS NOT NULL THEN x."diff_qty" ELSE x."qty" END, x."price", d."partner_name",
  CASE WHEN d."kind" = 'stock_transfer' THEN d."location_name" || ' → ' || d."to_location_name" ELSE d."location_name" END, d."code", d."status",
  CASE WHEN d."kind" = 'stock_adjustment' AND x."diff_qty" IS NULL THEN 'Số lượng kiểm thực tế ' || x."qty" ELSE '' END,
  coalesce(d."created_on", d."synced_at"), d."synced_at"
FROM "sapo_inventory_doc_lines" x JOIN "sapo_inventory_docs" d ON d."id" = x."doc_id"
WHERE trim(x."sku") <> ''
ON CONFLICT ("ref_key") DO NOTHING;--> statement-breakpoint
-- Mỗi mã chỉ giữ 20 giao dịch gần nhất.
DELETE FROM "product_movements" h USING (
  SELECT "id", row_number() OVER (PARTITION BY "sku" ORDER BY "occurred_at" DESC, "recorded_at" DESC) AS rn FROM "product_movements"
) r WHERE h."id" = r."id" AND r.rn > 20;
