# Chuông thông báo: phục hồi kết nối

`trial-ui/notify.js` dùng chung cho nhân viên và portal. CRM nhân viên đặt `poll:false`, dùng `/pulse` để biết khi nào cần đọc thông báo mới.

Trước sửa: lỗi ở lượt `/notifications` đầu bị bỏ qua; `/pulse` đã ghi nhận mốc thông báo nên không gọi lại nếu mốc không đổi. Mở chuông chỉ mở panel, không tải lại. Lỗi mạng thoáng qua có thể khiến danh sách trống đến khi có sự kiện mới hoặc tải lại trang.

Sau sửa:

- Hiện trạng thái đang tải / chưa tải được, không trình bày lỗi tải thành danh sách trống.
- Lượt lỗi tự thử lại sau 5 giây, tăng dần tối đa 60 giây, chỉ khi tab hiện. Mạng trở lại hoặc tab hiện thì phục hồi lượt lỗi; không thêm polling vào chuông đang hoạt động bình thường.
- Mở chuông tải lại 30 thông báo mới nhất, đồng bộ cả trạng thái đã đọc từ thiết bị khác.
- Gộp các lượt tải đồng thời. Dữ liệu cũ được giữ khi tải cập nhật lỗi; lần phục hồi đầu không phát lại âm báo cho các thông báo đã tồn tại.
- Đăng xuất dừng retry/poll, xoá danh sách; phản hồi thuộc phiên cũ bị bỏ qua khi người khác đăng nhập.

Chẩn đoán sự cố 08/11/2026: kiểm tra chỉ đọc cho thấy thông báo vẫn tồn tại; `/notifications` và `/pulse` có phản hồi 200 trong log. Web Push có mã 201 từ dịch vụ push; mã này chỉ xác nhận dịch vụ nhận yêu cầu, không chứng minh màn hình thiết bị đã hiện thông báo. Đã tái hiện lỗi phục hồi bằng Chromium với mạng mô phỏng. Không có phiên trình duyệt của người báo lỗi để khẳng định nguyên nhân trên thiết bị cụ thể.

Không đổi API, schema, quyền hoặc đăng ký Web Push. Không gửi thông báo thử ra ngoài. Không cần migration.

Kiểm thử: `tests/app/notification-recovery-ui.test.ts`; trình duyệt `node --import tsx scripts/testing/notification-recovery.mjs` (Playwright/Chromium; dữ liệu tổng hợp và mạng mô phỏng).
