# Nhận webhook SyncTime vào CRM

## Phạm vi hiện tại

Ảnh cấu hình của SyncTime cho phép đẩy realtime tới URL riêng, kèm Header và HMAC tùy chọn. Chưa có tài liệu payload hoặc cách ký HMAC của nhà cung cấp. Bản này tạo **hộp nhận JSON chờ đối chiếu**, không suy đoán trường dữ liệu, không tự tạo ngày công và không thay đổi lương.

Sau khi nhận được gói thực tế, cần đối chiếu event, mã nhân viên, giờ, múi giờ, serial máy, nguồn và mã log duy nhất rồi bổ sung bước chuẩn hóa sang lượt chấm công. Gói đang lưu chưa được coi là ngày công đã xử lý. SyncTime Client vẫn phải đồng bộ dữ liệu từ máy lên SyncTime trước.

## Triển khai

Chạy hai migration theo thứ tự trước khi đưa API/giao diện lên:

1. `migrations/postgres/20261017075411_synctime_webhook_inbox.sql`
2. `migrations/postgres/20261017075450_supabase_access_synctime_webhook.sql`

Cả hai bảng bật RLS, thu hồi quyền PUBLIC/anon/authenticated; chỉ backend truy cập. Mã nhận được tạo ở CRM, không cần thêm secret vào Edge Functions. Triển khai API và UI từ cùng PR. Đây là các file tạo qua Supabase CLI, SQL/schema snapshot sinh từ Drizzle theo cách quản lý migration hiện tại của repo.

## Điền form phía SyncTime

Trong CRM, Manager vào **Bảng lương → Chấm công từ máy → Nhận webhook từ SyncTime** và bấm **Tạo mã kết nối**. Mã chỉ hiện ở lần tạo này, không lưu trong localStorage hoặc URL; DB chỉ lưu hash.

- **Tên hiển thị:** `CRM Bách Ngân`.
- **Bật đẩy realtime:** bật.
- **URL webhook:** sao chép ô URL trong CRM. API hiện tại nhận tại `https://taceqfnsorewelsbdckg.supabase.co/functions/v1/baogia-v2-api/api/staff/integrations/synctime/webhook` **sau khi bản này được triển khai**.
- **Header thêm:** sao chép toàn bộ dòng `Authorization: Bearer ...` CRM vừa tạo. Đây là mã riêng của CRM, không phải khóa SyncTime Client ở màn hình Cấu hình SyncTime API.
- **HMAC secret:** để trống; bản này xác thực bằng Bearer qua HTTPS. Chưa triển khai thuật toán chữ ký khi chưa có đặc tả header/chuỗi ký/timestamp từ SyncTime.
- **Nguồn log:** chọn các nguồn thực tế cần chuyển (Máy ADMS, SyncTime API, USB); Nhập tay/app chỉ chọn nếu doanh nghiệp muốn lấy cả nguồn đó.
- **Map mã nhân viên:** để trống ở bước đầu, giữ nguyên mã nguồn để đối chiếu. Không tự đổi thành mã nhân viên CRM khi chưa xác minh.

Sau đó bấm Lưu trong SyncTime. Khi gửi một log thử hợp lệ, quay lại CRM bấm Cập nhật trạng thái rồi Xem gói mẫu. Tất cả API tạo/đổi/ngắt mã và xem gói đều chỉ Manager, có kiểm tra Origin như các thao tác quản trị khác.

## Quy tắc đầu nhận

- Chỉ POST JSON object hoặc array, tối đa 128 KiB, UTF-8 hợp lệ. Không nhận cookie phiên CRM thay cho mã webhook. Mã Sapo cũng không được dùng để xác thực SyncTime.
- Mỗi phút tối đa 120 yêu cầu đã xác thực; vượt giới hạn trả 429, cần gửi lại sau. Không lưu header bí mật.
- Trả HTTP 200 và `status=success` chỉ khi đã lưu DB; `processing=pending_schema_review` cho biết chưa chuẩn hóa chấm công. Nếu lỗi DB thì không ACK thành công, SyncTime cần retry.
- Gói có cùng JSON đã lưu không ghi thêm (hash của văn bản JSON gốc, giữ nguyên cả mã số lớn, **không phải** dedup mã log nghiệp vụ). Một log được bọc lại trong event/timestamp mới vẫn có thể thành gói khác; cần schema thật để dedup nghiệp vụ ở bước chuẩn hóa.
- Lưu gói trong 30 ngày để đối chiếu; dọn gói cũ khi tiếp nhận gói mới. Thống kê ở CRM là số gói lưu, không phải số lượt quẹt hay ngày công. Không có cron dọn riêng khi không có gói mới.
- GET trạng thái không trả khóa hoặc payload. Chỉ Manager chủ động mở gói mẫu mới nhận payload qua API quản trị, UI hiển thị bằng textContent.
- Bấm Đổi mã làm mã cũ mất hiệu lực; phải cập nhật Header thêm phía SyncTime. Bấm Ngắt nhận webhook thu hồi mã mà không xóa gói đã nhận.

Không bấm Lưu cấu hình phía SyncTime trước khi API mới đã triển khai và mã nhận được tạo. Chưa kiểm chứng gửi thực tế từ SyncTime; cần một log mẫu sau triển khai để hoàn thiện bước chuyển vào chấm công.
