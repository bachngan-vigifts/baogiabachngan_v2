# KPI số đơn hàng / HĐKT

KPI trước đây chỉ đếm HĐKT `signed`/`completed` theo ngày ký. Một đơn đã được duyệt nhưng HĐKT còn chưa ký trả về 0; đơn hàng không lập HĐKT cũng không được cộng.

Nguồn mới đếm mỗi dòng `sales_orders` kênh CRM đã duyệt (`confirmed`, `delivering`, `delivered`) một lần theo `order_date` và `owner_id`. HĐKT đi kèm không cộng thêm, không bắt buộc ký. Nháp/chờ duyệt/huỷ/POS không thuộc chỉ tiêu này. Việc ký HĐKT tháng sau không chuyển hoặc cộng lặp một giao dịch sang tháng mới.

API giữ khóa `contracts` để không làm hỏng hồ sơ lương/bản chụp cũ; nhãn hiển thị đổi thành **Đơn hàng / HĐKT** trên Tổng quan, hồ sơ nhân viên, bảng nhập KPI, tham số và báo cáo tháng. Chỉ tiêu riêng, trọng số và công thức điểm không đổi. Phiếu đã chốt giữ bản chụp; thưởng sao và thanh lý vẫn dùng nguồn/quy tắc hiện có, không lấy số đếm KPI để sinh thưởng.

Cache KPI dùng phạm vi mới để không đọc kết quả cũ còn hạn sau khi triển khai. Quyền xem, cache 30 phút và thao tác cập nhật vẫn giữ nguyên.

## Kiểm chứng

- Kiểm thử PGlite: HĐKT chưa ký/đã ký, đơn độc lập, chống trùng, huỷ/nháp, POS, đúng người phụ trách, ranh giới tháng, hơn 1.000 đơn, khóa đọc khi chốt, cache cũ, bản xem trước/phiếu chốt/Tổng quan và quyền nhân viên. Các bộ hồi quy thưởng, mục tiêu lương và kiến trúc đều chạy.
- Trình duyệt thật với dữ liệu giả, 1440/390 px, Manager và nhân viên: hiển thị 1/8, điểm gốc 0,0125 (UI làm tròn 1,3%), không lỗi JavaScript hoặc tràn ngang. Chặn mọi mạng ngoài localhost.
- Truy vấn đếm trên dữ liệu hiện tại đọc 67 dòng bằng `idx_sales_orders_report_date`, thời gian thực thi 6,103 ms. Đây là thời gian truy vấn đếm, không phải thời gian tải toàn trang. Chỉ thêm một truy vấn cho mỗi tháng tính, không gọi riêng từng nhân viên/chứng từ. Không thêm polling hoặc tải nền.
- Không migration, không đổi dữ liệu production, không mở lại/tính lại phiếu lương đã chốt.

Chạy kiểm thử trình duyệt bằng:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node --import tsx scripts/testing/sale-kpi-document-count.mjs
```

Script dùng `/usr/bin/chromium`, lưu ảnh và kết quả vào `/tmp/sale-kpi-document-count`.
