# Báo cáo kinh doanh nội bộ

`GET /api/staff/reports/business?from=2026-01&to=2026-03`

Chỉ tài khoản Manager đã đăng nhập được truy cập. `from` và `to` là tháng
YYYY-MM, bao gồm cả hai đầu, tối đa 12 tháng; thiếu hoặc sai trả 400.
Phản hồi `{ from, to, rows }` có một dòng cho mỗi tháng theo thứ tự tăng dần,
kể cả tháng không có dữ liệu (các số bằng 0).

- `sales.orders/subtotal/total`: số đơn, giá trị trước VAT và sau VAT của đơn
  confirmed/delivering/delivered theo `order_date`, tất cả kênh bán hàng.
  Đây là giá trị đơn đã duyệt, chưa trừ trả hàng; không phải doanh thu kế toán,
  doanh số KPI thuần hoặc tiền thực thu.
- `payroll.payslips/gross/deductions/net/paid`: số phiếu, tổng thu nhập, khấu trừ,
  thực nhận và thực nhận của phiếu paid theo tháng lương. Chỉ lấy phiếu đã chốt
  trong hr_payslips, không tính lương tạm tính. Không trả hồ sơ/ngân hàng cá nhân.

Hai nguồn được tổng hợp riêng trong transaction read-only repeatable-read để
tránh nhân bản tổng tiền và bảo đảm cùng snapshot. API không sửa dữ liệu.

Migration `20261104000000_internal_reports.sql` bổ sung kiểm tra định dạng tháng
phiếu lương và partial index ngày đơn hàng cho các trạng thái được thống kê.
Index lương `(month, status)` hiện có được dùng lại. Cần xử lý tháng phiếu lương
cũ sai định dạng trước khi áp dụng migration; constraint được kiểm tra trên dữ liệu cũ.
Migration chưa được áp dụng lên database triển khai bởi tác vụ này.

Repo tại thời điểm thực hiện không có codex.md và TEST_TEMPLATE.ts. Template
node:test/strict assert được bổ sung ở tests/TEST_TEMPLATE.ts; test báo cáo dùng
cùng template và PostgreSQL WASM với toàn bộ migrations của repo.

## Chạy test

Dùng Node 22.22.0 và PHP CLI (các test WordPress/GHN gọi `php` trực tiếp).
Chạy `npm run typecheck` và `npm test`. Trên máy 5 CPU có thể dùng
`npm test -- --test-concurrency=5`; vẫn chạy toàn bộ cùng test suite.
Các test cần dịch vụ bên ngoài có thể được repo chủ động skip khi thiếu cấu hình.
