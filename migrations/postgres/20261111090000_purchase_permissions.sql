-- Đưa 4 quyền mua hàng đang gắn cứng theo chức vụ lên trang Phân quyền. Giữ đúng quyền đang chạy; chạy lại không đổi gì.
-- Xem xin hàng trước: mọi chức vụ đang vào được trang Đơn mua NCC.
INSERT INTO "staff_position_permissions" ("position_id", "permission")
  SELECT "position_id", 'purchases.early-view' FROM "staff_position_permissions" WHERE "permission" = 'page.purchases' ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Xin hàng trước (Sale Admin), xác nhận thay NCC (Sale Admin, Kế toán), huỷ đơn mua đã duyệt (Sale Admin), Kế toán nhận hàng NCC.
INSERT INTO "staff_position_permissions" ("position_id", "permission")
  SELECT v.position_id, v.permission FROM (VALUES
  ('sale-admin', 'purchases.early-request'), ('sale-admin', 'purchases.confirm'), ('accounting', 'purchases.confirm'),
  ('sale-admin', 'purchases.cancel-approved'), ('accounting', 'purchases.receive')
  ) AS v(position_id, permission) JOIN "staff_positions" s ON s."id" = v.position_id ON CONFLICT DO NOTHING;
