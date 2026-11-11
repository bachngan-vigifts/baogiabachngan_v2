# Tìm nhà cung cấp khi lập đơn mua

Trong “Mua theo đơn / báo giá”, bước chọn NCC dùng ô tìm kiếm thay cho danh sách cuộn. Gõ tên, MST, số điện thoại hoặc tên người liên hệ; kết quả hỗ trợ tiếng Việt không dấu và số điện thoại có dấu phân cách. SĐT người liên hệ cũng được tìm.

Bấm kết quả hoặc dùng phím mũi tên rồi Enter để thêm đúng ID NCC vào đơn. Chỉ gõ tên chưa được tính là chọn. Các NCC đã chọn giữ thành thẻ, có thể bỏ để chia lại số lượng. Không thêm trùng NCC; giữ giới hạn sáu NCC và bộ chia số lượng/tạo nháp hiện hành. Escape đóng gợi ý trước, giữ nội dung đang nhập trong đơn.

API `/purchase-options/suppliers` chỉ đọc, dùng quyền Mua hàng hiện có và chỉ trả NCC đang hoạt động. Trả tối đa 12 NCC mỗi trang; tìm sau 220ms ngừng gõ, bỏ phản hồi cũ, dừng khi đóng ngăn soạn. API không cấp quyền sửa danh bạ NCC, không trả email/tài khoản ngân hàng hay ghi chú nội bộ. Không tạo migration/index mới.

Kiểm chứng: `tests/app/purchase-supplier-search.test.ts`, `scripts/testing/purchase-supplier-search.mjs`, `docs/testing/purchase-supplier-search-browser.json`. Trình duyệt với router CRM/PGlite kiểm tra cả desktop/mobile, tìm theo năm trường, phản hồi trễ, bàn phím, chống trùng và POST tạo nháp đúng NCC với số lượng 27. Dữ liệu đều giả lập.

# Rà soát “Gửi liên kết đặt lại”

Theo `src/modules/staff/api/auth-routes.ts`, endpoint `/forgot-password` chuẩn hoá email, kiểm tra chống bot/giới hạn gửi, dùng Resend cấu hình hiện hành và trả thông báo chung. Việc gửi nền qua `waitUntil` được kiểm thử riêng.

Điều kiện ở `src/modules/staff/repo/auth-repo.ts` (`issuePortalPasswordReset`): có tài khoản trong `staff_members` và `staff_credentials`, đang hoạt động, role `supplier` hoặc `customer`, đúng cổng nếu truyền audience, email không phải địa chỉ giả `.invalid`. Một email chỉ nằm trong danh bạ NCC hoặc tài khoản nội bộ Manager/nhân viên không tự nhận thư qua luồng này. Giao diện bổ sung hướng dẫn rõ sự khác biệt này.

Mật khẩu/phiên hiện hành giữ nguyên khi yêu cầu gửi. Nếu dịch vụ mail lỗi, giao dịch cập nhật token rollback; liên kết trước/mật khẩu hiện hành vẫn dùng được. Token mới có hiệu lực 60 phút, dùng một lần, không trả token cho form và không CC email đặt lại cho danh sách nhận đơn mua.

Đã chạy **29 kiểm thử** từ `tests/app/portal-forgot-password.test.ts` và `src/modules/staff/api/auth-routes.test.ts`: toàn bộ qua, gồm gửi thành công, lỗi dịch vụ, gửi nền, hết hạn, dùng lại/đổi mật khẩu đồng thời, tài khoản không đủ điều kiện và giới hạn gửi. Mailer giả; không gửi thư thật.

Đã đọc log production tổng hợp trong khoảng **11/11/2026 00:00–08:45 UTC**: truy vấn chỉ đếm marker `password_reset_mail_failed`, không đọc email/token/nội dung thư; không có kết quả khớp trong cửa sổ này. Kết quả này chưa xác định nguyên nhân email cụ thể không tới hộp thư.

Truy vấn chỉ đọc kiểm tra loại tài khoản/trạng thái của email được báo đã bị hệ thống duyệt tự động chặn do chưa có xác nhận đọc hồ sơ tài khoản cụ thể. Chưa xác minh được email đó là tài khoản NCC, khách hàng hay nội bộ. Chưa đổi cấu hình mail, tài khoản, mật khẩu hoặc dữ liệu production.
