# Tiêu đề phiếu giao hàng và phiếu đóng gói

Dùng nguyên file ảnh chủ doanh nghiệp cung cấp (`trial-ui/slip-letterhead.jpg`, 1280×230), giữ tỷ lệ ảnh. Hai mẫu phiếu và các đường in từ đơn/HĐKT hoặc trang Kho đều dùng `slipSheetHtml` nên nhận cùng tiêu đề. Mẫu báo giá, đơn đặt hàng và bộ Word HĐKT không đổi.

Lề in trên 20 mm, trái/phải 8 mm, dưới 10 mm; có cả quy tắc trang có tên và quy tắc `@page` tạm thời hiện có để Safari nhận đúng lề. Chờ ảnh tiêu đề giải mã xong trước khi gọi in; lỗi ảnh báo thử lại, nút không mở hai lần trong lúc chờ. Ảnh không kéo giãn.

Khổ ngang thu đều 0,9 và căn giữa để chừa chiều cao cho tiêu đề mới; giữ khối chữ ký liền nhau. Khổ dọc giữ tỷ lệ cũ 0,73. Phiếu nhiều dòng vẫn có thể nhiều trang.

Kiểm chứng trên Chromium thực và API/PGlite, dữ liệu giả lập, chặn mọi kết nối ngoài máy thử:

- Mở hai hộp in thực, ảnh tải đúng kích thước và tỷ lệ. Tại thời điểm gọi in, ảnh đã giải mã.
- Xuất bốn PDF A4: giao hàng/đóng gói × dọc/ngang. Mẫu hai dòng đều một trang, có chữ ký. Các PDF đính kèm chỉ chứa dữ liệu giả lập.
- PyMuPDF kiểm tra vị trí ảnh trong cả bốn PDF: mép trên khoảng 20,11 mm (quy tắc CSS 20 mm, sai số làm tròn pixel của trình duyệt); xem `pdf-checks.json`.
- Không lỗi JavaScript; giữ nguyên thứ tự sản phẩm đã sửa trong cùng PR.
- Typecheck và 21 test mẫu in, form in, cấu trúc giao diện đạt. Phần thứ tự dòng trước đó có 29 test API/bản in/quy trình/kiến trúc đạt.

Chạy lại browser harness: `PLAYWRIGHT_MODULE=<đường dẫn playwright/index.mjs> node --import tsx scripts/testing/slip-letterhead.mjs`. Kết quả mặc định tại `/workspace/scratch/slip-letterhead`.

Không migration, không đọc/ghi dữ liệu production, chưa triển khai.
