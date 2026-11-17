# Nhắc chăm sóc sau khi lưu báo giá

Khi bấm **Lưu** báo giá trên máy tính/điện thoại hoặc Ctrl/Cmd+S và lưu thành công, CRM hỏi **Có nhắc lịch chăm sóc khách hàng không?**

- **Không nhắc lúc này** hoặc đóng popup: báo giá vẫn đã lưu; không tạo lịch hay giao dịch.
- **Đặt lịch chăm sóc**: chọn ngày, mốc nhắc trước, hình thức dự kiến, đúng người liên hệ và việc cần làm. Có nút chọn nhanh ngày mai / sau 3 ngày / sau 1 tuần.
- Lịch mặc định thuộc người phụ trách báo giá. Nhân viên không tự giao lịch cho người khác; Manager chọn được nhân viên hợp lệ theo quyền CRM hiện có.
- Nếu đã có lịch chưa xong cho báo giá/khách/người phụ trách đó, popup hiện lịch đang chờ và liên kết **Xem / sửa lịch hiện tại**. Không âm thầm tạo thêm hoặc dời lịch cũ.
- Nếu báo giá mới chỉ gõ tên khách, chưa liên kết hồ sơ khách CRM, cần chọn/liên kết đúng khách rồi lưu lại. Không tự gắn lịch vào khách có tên gần giống.

Lịch được lưu trong **Giao dịch & chăm sóc** hiện có, gắn mã báo giá và đúng phiên bản vừa lưu, khách hàng và nhân viên nhận nhắc. Tới mốc nhắc, luồng có sẵn sinh việc chăm sóc ở **Công việc**; không dựng thêm bảng lịch hoặc một lõi nhắc việc khác. Trong nhật ký có liên kết về bản báo giá liên quan.

Lưu báo giá không đồng nghĩa với đã gửi báo giá cho khách. Đặt lịch chỉ ghi trạng thái **Chưa thực hiện**, không cộng giao dịch KPI hoặc doanh số. Chỉ ghi nhận hoàn thành/liên hệ khi đã thực sự trao đổi, với đúng ngày giao dịch. Đánh dấu xong lịch hẹn không tự tạo thêm một lần liên hệ KPI.

Nếu mạng lỗi khi lưu lịch, nội dung và mã gửi được giữ cho lần thử lại. Báo giá không bị huỷ/ghi lùi; máy chủ chống gửi trùng và kiểm tra lịch đang chờ trong giao dịch. Đóng hoặc chuyển khỏi báo giá khi đang tải thông tin không mở lại popup muộn. Các lần lưu nội bộ để tính chi phí/xuất chứng từ không bật popup để không ngắt quy trình đó.

Không thêm migration, bảng hay cron mới; dùng các trường liên kết báo giá/chống gửi lặp và cơ chế nhắc việc đã có của CRM. Chưa deploy production trong PR này.
