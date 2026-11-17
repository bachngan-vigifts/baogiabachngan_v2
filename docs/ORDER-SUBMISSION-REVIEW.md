# Nhân viên gửi yêu cầu phê duyệt đơn / HĐKT

Mở đơn/HĐKT CRM còn nháp thuộc phạm vi được sửa → **Gửi yêu cầu phê duyệt**.

1. Đối chiếu sản phẩm, số lượng và giá bán với khách.
2. Điền ngày giao hàng, địa chỉ cụ thể, tên và số điện thoại người nhận. Không dùng địa chỉ “Theo thỏa thuận”.
3. Chọn công ty hay khách trả phí giao hàng, hình thức thanh toán. Chọn “Khác” phải ghi rõ. Nhân viên không nhập/xem giá vốn nội bộ ở bước này; nếu công ty chịu ship, Manager khai báo chi phí khi duyệt.
4. Đơn có in logo: điền yêu cầu in. Chọn **Làm mẫu để khách duyệt trước** và ngày dự kiến duyệt mẫu không sau ngày giao, hoặc **Đã được phép sản xuất hàng loạt** và xác nhận khách đã cho phép. Kiểm tra file sản xuất đã đính kèm. Lựa chọn này không tự đánh dấu xong công việc In mẫu/Sản xuất.
5. Đánh dấu đủ các mục xác nhận. Nút **Gửi yêu cầu phê duyệt** chỉ mở khi các trường và xác nhận đều hợp lệ. Bấm quay lại không lưu/gửi.

Sau khi gửi, Manager nhận thông báo theo phạm vi phân quyền hiện có. Thẻ thông tin trên đơn lưu lại nội dung nhân viên đã xác nhận. Gửi lại cùng đơn đã gửi không tạo thêm yêu cầu hoặc thông báo. Nếu đơn/báo giá đổi khi popup đang mở, mở lại bảng xác nhận trước khi gửi.

Sửa sản phẩm, giá bán hoặc điều khoản báo giá sau khi gửi sẽ đưa đơn còn nháp về trạng thái chưa gửi duyệt; nhân viên kiểm tra và gửi lại. Lịch sử lần gửi cũ được giữ. Sửa riêng chi phí nội bộ không huỷ xác nhận và không ghi đè địa chỉ/ngày giao đã xác nhận. Nếu bên chịu ship khác báo giá cũ, Manager phải đối chiếu và cập nhật đúng ở bước chi phí trước khi duyệt.

Không thay đổi giá trị hợp đồng, tỷ lệ cọc, lịch thanh toán, tồn kho hoặc trạng thái hoàn thành sản xuất khi nhân viên gửi yêu cầu. Luồng POS giữ riêng. Đơn cũ không tự bị gửi lại hoặc đổi trạng thái bởi migration.

## Trước khi deploy

Chạy `migrations/postgres/20261117130655_order_submission_review.sql` trước khi deploy API/UI. Migration thêm cột nullable `sales_orders.submission_review`, không sửa bản ghi cũ, không đổi RLS. Đã kiểm tra trên database thử và chạy lặp; chưa chạy production trong PR này.
