-- Dữ liệu tham chiếu: chức vụ mặc định. KHÔNG đổi cấu trúc bảng.
-- Cần có sẵn vì vai trò suy từ chức vụ: id 'manager' → Manager, id 'supplier' (hiển thị "NCC") → tài khoản NCC (xem staff/domain/roles.ts).
-- INSERT OR IGNORE: chạy lại hoặc nạp trên DB đã có chức vụ cùng id (khi chuyển dữ liệu từ bản cũ) đều an toàn.
-- Nguồn duy nhất của danh sách này là DEFAULT_POSITIONS trong staff/domain/members.ts (có test đối chiếu).
INSERT OR IGNORE INTO staff_positions (id, name) VALUES
  ('manager', 'Manager'),
  ('sale', 'Sale'),
  ('sale-admin', 'Sale Admin'),
  ('sales-ml', 'NVBH ML'),
  ('sales-lock', 'NVBH LOCK'),
  ('warehouse', 'Kho'),
  ('accounting', 'Kế toán'),
  ('supplier', 'NCC');
