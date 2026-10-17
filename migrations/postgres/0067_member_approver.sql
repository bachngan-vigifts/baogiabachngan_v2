ALTER TABLE "staff_members" ADD COLUMN "can_approve" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Phê duyệt chuyển sang cờ "Được duyệt" từng nhân viên (chỉ Manager bật) – bỏ hai quyền duyệt theo chức vụ (nếu đã có dòng nào).
DELETE FROM "staff_position_permissions" WHERE "permission" IN ('quotes.approve', 'purchases.approve');--> statement-breakpoint
-- Sale Admin TẠM THỜI có thêm quyền của Kế toán và Kho (yêu cầu 17/10/2026). Không gồm phê duyệt.
INSERT INTO "staff_position_permissions" ("position_id", "permission")
  SELECT v.position_id, v.permission FROM (VALUES
  ('sale-admin', 'page.packing'), ('sale-admin', 'page.stock-lookup'), ('sale-admin', 'purchases.receive'),
  ('sale-admin', 'purchases.prices'), ('sale-admin', 'purchases.pay'), ('sale-admin', 'suppliers.edit')
  ) AS v(position_id, permission) JOIN "staff_positions" s ON s."id" = v.position_id ON CONFLICT DO NOTHING;
