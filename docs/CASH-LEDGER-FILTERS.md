# Bộ lọc Sổ quỹ

Thêm bộ lọc người tạo phiếu và hình thức thanh toán. Mặc định Tiền mặt giữ hành vi hiện có; có thể chọn Chuyển khoản, Khác hoặc Tất cả hình thức để xem thêm các khoản thu POS đã ghi theo hình thức tương ứng. Phiếu thu/chi thủ công là tiền mặt vì dữ liệu hiện tại không có trường phương thức cho phiếu này. Không suy đoán phương thức từ ghi chú.

`GET /cash/entries` nhận `createdBy`, `method=cash|transfer|other|all` (mặc định cash), `direction=in|out` (bỏ trống = tất cả). Các điều kiện áp dụng trước phân trang và tổng thu/chi. Danh sách nhân viên lấy từ dữ liệu trong kỳ, đúng két và phạm vi quyền, độc lập trang và các bộ lọc còn lại. Phiếu chờ duyệt/huỷ vẫn hiển thị theo lịch sử nhưng không cộng tổng. Việc chọn bộ lọc đặt lại cursor, bỏ phản hồi cũ và giữ bộ lọc qua cập nhật danh sách. Excel dùng các dòng đã tải và đang hiển thị theo bộ lọc, bổ sung cột hình thức.

Các điều kiện `entryScope`, `ownShift`, `selectedDrawer` giữ nguyên; không mở rộng quyền đọc. Không đổi công thức số dư két, kết ca, schema, hoặc dữ liệu production.

Thanh công cụ dùng cùng đáy cho các ô chọn/ngày và nút xuất, wrap trên màn nhỏ. Đã kiểm tra qua DOM và CSS; chưa kiểm tra trực quan Chromium/live.
