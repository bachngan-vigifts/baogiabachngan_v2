-- Kế toán được vào mọi trang (yêu cầu 29/10/2026), trừ Bảng lương và Phân quyền (hai trang này chỉ Manager / quyền "Quản lý phân quyền").
-- Mở lại Báo giá / Chăm sóc KH / Khách hỏi tồn (0071 đã bỏ) và thêm các trang Kho: Phiếu đóng gói, Tra tồn, Sổ kho (xem).
-- Chỉ THÊM quyền xem trang; không thêm quyền thao tác kho / bán quầy (nhận hàng, điều chuyển, chốt tồn, POS). Chạy lại không đổi gì.
INSERT INTO "staff_position_permissions" ("position_id", "permission")
  SELECT v.position_id, v.permission FROM (VALUES
  ('accounting', 'page.quotes'), ('accounting', 'page.care'), ('accounting', 'page.stock-requests'),
  ('accounting', 'page.packing'), ('accounting', 'page.stock-lookup'), ('accounting', 'inventory.view')
  ) AS v(position_id, permission) JOIN "staff_positions" s ON s."id" = v.position_id ON CONFLICT DO NOTHING;
