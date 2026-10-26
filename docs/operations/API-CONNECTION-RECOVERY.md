# Khắc phục API mất kết nối dữ liệu — 26/10/2026

## Bằng chứng đọc production

Thông báo “Không thể kết nối dữ liệu. Vui lòng thử lại.” do catch 503 của Edge Function `baogia-v2-api`. Truy vấn Supabase logs trong 24 giờ trước lần điều tra ghi nhận:

- 399 lỗi PostgreSQL `remaining connection slots are reserved for roles with the SUPERUSER attribute`.
- 333 log `API request failed`, nhiều endpoint cùng 503: orders, quotes, tasks/summary, notifications, chat/unread.
- `max_connections = 60`, `superuser_reserved_connections = 3`. Số kết nối tại lúc ít tải không phản ánh đỉnh lỗi.

Code cũ giữ một direct Postgres client trên mỗi Edge isolate, idle 10 giây. Nhiều isolate cùng giữ socket vượt ngân sách kết nối. Log catch cũ không ghi SQLSTATE nên che khuất nguyên nhân.

## Thay đổi

- Direct mode: chia sẻ client giữa các request đang chạy, đóng ngay khi request và các công việc `waitUntil` cuối cùng kết thúc. Client đang đóng được tách khỏi request mới. Không đóng client khi công việc nền còn dùng DB.
- Pooler mode: tiếp tục dùng Supavisor transaction pooler nếu secret `SUPABASE_POOLER_URL` có sẵn; `prepare:false`, max 3. Workflow deploy truyền secret tùy chọn từ GitHub sang Supabase, không đoán URL/mật khẩu, không xóa cấu hình hiện có khi GitHub chưa có secret.
- Probe DB có single flight trên từng client, cache thành công 5 giây; chỉ retry lỗi hết kết nối với backoff hữu hạn trước khi dispatch nghiệp vụ.
- Giao diện nhân viên/NCC/khách hàng thử lại GET/HEAD tối đa 2 lần khi lỗi mạng hoặc HTTP 502/503/504; timeout từng lần đọc 15 giây, backoff tối đa 2 giây. Không retry 401/403 hoặc lỗi nghiệp vụ.
- POST/PUT/PATCH/DELETE luôn gửi một lần. Không tự lặp thu tiền, xuất kho, lưu đơn khi không rõ kết quả.
- Health công bố `databaseMode` (không công bố URL/credential). Log lỗi chỉ SQLSTATE/mode; response 503 có code và `Retry-After`.

## Kiểm tra

- Unit lifecycle: request chồng nhau, background, đóng lỗi, pooled/direct, probe single-flight/retry/cache/failure.
- Thực thi handler Edge thật bằng VM với DB/router giả lập: finally trên thành công/lỗi, health, không dispatch POST khi probe thất bại, không lặp handler ghi, giữ DB đến hết background.
- Transport: phục hồi network/503, backoff, timeout, giới hạn lần, abort, không retry ghi hoặc lỗi xác thực.
- Login/session regression: 401 cũ không đăng xuất phiên mới, không cướp focus; thành công giữ đúng token.
- Browser Chromium với router thật/PGlite: GET 503 một lần tự phục hồi; 503 kéo dài vẫn cho thử lại thủ công; không phát sinh business write trong recovery.

## Sau khi được review và triển khai

1. Deploy API trước giao diện. Không cần migration hoặc sửa dữ liệu đơn hàng.
2. Đọc health với Origin hợp lệ để xác minh `direct-request-scoped` hoặc `transaction-pooler`.
3. Đối chiếu logs theo cùng cửa sổ tải: SQLSTATE 53300, HTTP 503, độ trễ và số kết nối. Không kết luận hết lỗi chỉ từ một lần health thành công.
4. Nếu còn đỉnh đồng thời vượt sức chứa DB, cấu hình đúng transaction pooler qua secret hoặc điều chỉnh tài nguyên. Không tăng retry vô hạn, không tăng max direct connection.

Chưa triển khai production trong phạm vi PR. Không sửa số dư, tồn kho, vận đơn hoặc retry phiếu thật để kiểm thử.
