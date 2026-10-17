# Kết nối chấm công ADMS / ZKTeco

Manager mở **Bảng lương → Chấm công từ máy**. Chọn khoảng ngày tối đa 31 ngày, bấm **Đồng bộ từ máy**, rồi ghép mã máy với nhân viên CRM. Bấm mã trong bảng để điền nhanh vào form ghép. Có thể xem lại theo ngày, mã máy và phân trang.

## Phạm vi

- Đọc `checkin_logs` qua API trong tài liệu ADMS được cung cấp. Chưa có hợp đồng API cho danh bạ `employees` hoặc tình trạng `devices`; không suy đoán endpoint.
- Lưu giờ máy dưới dạng giờ Việt Nam (`Asia/Ho_Chi_Minh`), giữ nguyên mã nhân viên có số 0 ở đầu và trạng thái chưa xác định 255.
- Chống trùng theo `(company_id, log_id)`. Đọc đủ phân trang trước khi ghi trong một transaction. Nhập lại cùng khoảng ngày chỉ thêm lượt chưa có, không sửa lượt gốc đã lưu.
- Lượt vào/ra và liên kết mã máy **độc lập `hr_attendance` và lương**. Không tự coi một lượt quẹt là một ngày công. Chưa có quy tắc ca làm, giờ chuẩn, đi muộn, ca qua đêm, nửa công hay tăng ca để tự quy đổi. Manager tiếp tục duyệt ngày công hiện có.
- Chỉ Manager được đọc, đồng bộ và ghép mã; nhân viên thường (kể cả cùng phòng), khách hàng và NCC không được đọc qua các endpoint này. Chưa thêm trang tự xem lượt máy cho nhân viên.
- Mỗi nhân viên ghép một mã trong một công ty ADMS. Không ghép tự động theo tên. Bỏ ghép mã cũ trước khi đổi sang mã khác.

## Chuẩn bị máy chủ ADMS

File mẫu trong tài liệu ban đầu chưa có xác thực. Bản có xác thực nằm ở `integrations/adms/get_attendance.php`; cài thành `iclock/api/get_attendance.php`, PHP >= 7.4, với `iclock/db.php` cung cấp `$pdo`. Đối chiếu tên cột với schema thật trước khi cài.

Đặt biến môi trường phía PHP:

- `CRM_ADMS_TOKEN`: mã ngẫu nhiên tối thiểu 32 ký tự, chỉ chia sẻ giữa hai backend.
- `CRM_ADMS_COMPANY_ID`: công ty được phép đọc.

API dùng HTTPS, nhận `Authorization: Bearer …`. Cấu hình webserver/PHP-FPM chuyển tiếp header Authorization tới `HTTP_AUTHORIZATION`; cấu hình biến môi trường thực sự có hiệu lực ở worker PHP. Không truyền mã trong query string, JavaScript hoặc gửi mã qua chat.

API chỉ đọc, giới hạn 200 dòng/trang, kiểm tra company_id, ngày và tham số; sắp `check_time DESC, id DESC` để các lượt cùng giây không bị đổi thứ tự qua trang. Bảng `employees` phải có duy nhất một dòng cho mỗi `(company_id, emp_code)` để LEFT JOIN không nhân bản lượt. Nên có index `checkin_logs(company_id, check_time, id)` và `employees(company_id, emp_code)` sau khi kiểm tra index hiện hữu.

Không đọc vân tay, khuôn mặt, mật khẩu hay cấu hình điều khiển thiết bị.

## Cấu hình CRM và triển khai

Thêm secrets cho Edge Function `baogia-v2-api`:

- `ADMS_API_URL`: URL HTTPS đầy đủ của `get_attendance.php`, không có query string, user/password hay fragment.
- `ADMS_COMPANY_ID`: khớp `CRM_ADMS_COMPANY_ID`.
- `ADMS_API_TOKEN`: khớp `CRM_ADMS_TOKEN`.

URL và token không được trả về trình duyệt. Backend từ chối redirect để tránh gửi token sang địa chỉ khác. Nếu chưa cấu hình, màn hình hiển thị trạng thái chưa kết nối, không gọi ADMS.

Chạy migrations theo đúng thứ tự trước khi đưa tính năng lên:

1. `migrations/postgres/20261017033436_adms_attendance.sql`
2. `migrations/postgres/20261017033437_supabase_access_adms.sql`

Các file được tạo bằng Supabase CLI rồi đặt vào thư mục migration PostgreSQL hiện tại của repo. Cả ba bảng bật RLS và thu hồi quyền `PUBLIC`, `anon`, `authenticated`; chỉ backend CRM truy cập bằng kết nối DB hiện hữu.

Triển khai API và giao diện cùng PR. Chưa cần cron: đồng bộ tay theo khoảng ngày, tối đa 5.000 lượt/lần và 25 giây đọc ADMS. Khi vượt giới hạn, chia khoảng ngày ngắn hơn. Đọc lỗi, tổng số lượt thay đổi giữa các trang, dòng sai công ty hoặc dữ liệu không đầy đủ đều báo lỗi và không ghi lượt nào. Đồng bộ lại cả các ngày trước để nhận lượt đến muộn; không dùng thời gian quẹt mới nhất làm mốc loại bỏ dữ liệu cũ.

`GET /hr/adms` trả thời điểm / khoảng ngày của lần thành công gần nhất, kể cả khi không có lượt mới. Điều này là thời điểm CRM đồng bộ, không phải bằng chứng thiết bị đang online. Chưa có đồng bộ lịch chạy tự động hoặc sửa/xoá lượt nguồn.

## Kiểm tra sau khi có địa chỉ thật

1. Xác nhận đúng máy chủ API ADMS và company_id (địa chỉ IP máy chấm công đơn lẻ chưa đủ).
2. Kiểm tra xác thực: thiếu/sai token bị 401; sai company_id bị 403; tài khoản DB phía ADMS chỉ cần SELECT.
3. Đồng bộ một ngày ít dữ liệu; đối chiếu số lượt, giờ vào/ra và mã giữ số 0 đầu với ADMS.
4. Ghép một nhân viên CRM, xem lại lượt; nhập lại ngày đó không tăng số dòng. Đối chiếu ngày công và lương không bị thay đổi.
5. Thử trang có hơn 200 lượt, bộ lọc ngày/mã, API lỗi giữa chừng và tài khoản nhân viên không có quyền.

Chưa thể xác nhận dữ liệu / mạng / PHP trên máy chủ thật khi chưa được cung cấp địa chỉ và cấu hình. Có thể cần đường truy cập HTTPS từ Supabase tới server ADMS nếu ADMS chỉ nằm trong LAN.
