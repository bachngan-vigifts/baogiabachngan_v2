-- Kho bán theo chức vụ + điều chuyển kho + trừ kho khi duyệt đơn / HĐKT (yêu cầu 18/10/2026, docs/SO-KHO.md).
ALTER TABLE "warehouses" ADD COLUMN "stock_private" boolean DEFAULT false NOT NULL;
ALTER TABLE "sales_orders" ADD COLUMN "warehouse_id" text REFERENCES "warehouses"("id");
CREATE TABLE "warehouse_sellers" (
 "warehouse_id" text NOT NULL REFERENCES "warehouses"("id") ON DELETE CASCADE,
 "position_id" text NOT NULL REFERENCES "staff_positions"("id") ON DELETE CASCADE,
 CONSTRAINT "warehouse_sellers_warehouse_id_position_id_pk" PRIMARY KEY ("warehouse_id","position_id")
);
ALTER TABLE "warehouse_sellers" ENABLE ROW LEVEL SECURITY;
CREATE INDEX "idx_warehouse_sellers_position" ON "warehouse_sellers" ("position_id");
CREATE TABLE "stock_transfers" (
 "id" text PRIMARY KEY, "transfer_no" text NOT NULL,
 "from_warehouse_id" text NOT NULL REFERENCES "warehouses"("id"), "to_warehouse_id" text NOT NULL REFERENCES "warehouses"("id"),
 "status" text DEFAULT 'pending' NOT NULL, "reason" text DEFAULT '' NOT NULL,
 "requested_by" text NOT NULL REFERENCES "staff_members"("id"),
 "approved_by" text REFERENCES "staff_members"("id"), "approved_at" text, "reject_reason" text DEFAULT '' NOT NULL,
 "done_by" text REFERENCES "staff_members"("id"), "done_at" text, "done_note" text DEFAULT '' NOT NULL,
 "cancelled_by" text REFERENCES "staff_members"("id"), "cancelled_at" text,
 "revision" bigint DEFAULT 1 NOT NULL, "created_at" text NOT NULL, "updated_at" text NOT NULL,
 CONSTRAINT "chk_stock_transfers_status" CHECK ("status" IN ('pending', 'approved', 'done', 'rejected', 'cancelled')),
 CONSTRAINT "chk_stock_transfers_wh" CHECK ("from_warehouse_id" <> "to_warehouse_id")
);
ALTER TABLE "stock_transfers" ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX "uq_stock_transfers_no" ON "stock_transfers" ("transfer_no");
CREATE INDEX "idx_stock_transfers_status" ON "stock_transfers" ("status","created_at");
CREATE TABLE "stock_transfer_lines" (
 "id" text PRIMARY KEY, "transfer_id" text NOT NULL REFERENCES "stock_transfers"("id") ON DELETE CASCADE,
 "sku" text NOT NULL, "name" text DEFAULT '' NOT NULL, "unit" text DEFAULT '' NOT NULL, "qty" double precision NOT NULL,
 CONSTRAINT "chk_stock_transfer_lines_qty" CHECK ("qty" > 0)
);
ALTER TABLE "stock_transfer_lines" ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX "uq_stock_transfer_lines_sku" ON "stock_transfer_lines" ("transfer_id","sku");
ALTER TABLE stock_moves DROP CONSTRAINT chk_stock_moves_kind;
ALTER TABLE stock_moves ADD CONSTRAINT chk_stock_moves_kind CHECK (kind IN ('opening','receipt','issue','adjust','reverse','customer_return','sale','transfer_out','transfer_in'));
ALTER TABLE stock_moves DROP CONSTRAINT chk_stock_moves_ref_type;
ALTER TABLE stock_moves ADD CONSTRAINT chk_stock_moves_ref_type CHECK (ref_type IN ('opening','supplier_receipt','packing_slip','adjustment','pos_order','pos_delivery','pos_return','sales_order','stock_transfer'));
-- Gán sẵn kho bán theo TÊN kho đang có – Manager kiểm lại ở trang Phân quyền › Kho bán.
-- Kho Hoá đơn (mọi kho có chữ "Hoá đơn"): Kế toán bán, tồn riêng (chỉ Kế toán + Manager thấy).
UPDATE "warehouses" SET "stock_private" = true WHERE "kind" = 'stock'
  AND ("name" ILIKE '%hoá đơn%' OR "name" ILIKE '%hóa đơn%' OR "name" ILIKE '%HOÁ ĐƠN%' OR "name" ILIKE '%HÓA ĐƠN%' OR "name" ILIKE '%hoa don%');
-- KHO VIGIFTS: Sale Admin + Sale · SR Minh Long - Lock: NVBH ML + NVBH LOCK · Hoá đơn: Kế toán. Manager luôn bán mọi kho.
INSERT INTO "warehouse_sellers" ("warehouse_id", "position_id")
  SELECT w."id", v.position_id FROM "warehouses" w
  JOIN (VALUES ('vigifts', 'sale-admin'), ('vigifts', 'sale'), ('minh long', 'sales-ml'), ('minh long', 'sales-lock'), ('hoá đơn', 'accounting')) AS v(pattern, position_id)
    ON (v.pattern = 'hoá đơn' AND w."stock_private") OR (v.pattern <> 'hoá đơn' AND NOT w."stock_private" AND w."name" ILIKE '%' || v.pattern || '%')
  JOIN "staff_positions" s ON s."id" = v.position_id
  WHERE w."kind" = 'stock' AND w."active" ON CONFLICT DO NOTHING;
-- Quyền mới: Kho bấm "Đã chuyển" phiếu điều chuyển (mặc định như "Nhận hàng NCC": Kho, Sale Admin).
INSERT INTO "staff_position_permissions" ("position_id", "permission")
  SELECT v.position_id, v.permission FROM (VALUES ('warehouse', 'stock.transfer'), ('sale-admin', 'stock.transfer')) AS v(position_id, permission)
  JOIN "staff_positions" s ON s."id" = v.position_id ON CONFLICT DO NOTHING;
