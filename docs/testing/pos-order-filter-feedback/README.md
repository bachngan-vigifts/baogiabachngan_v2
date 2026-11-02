# POS: phản hồi khi lọc đơn và tránh tải lại không cần thiết

## Thay đổi

- Bấm thẻ đổi lựa chọn ngay, thẻ có vòng quay; hiện “Đang lọc…” ngay dưới các thẻ và đánh dấu bảng đang bận. Khoá thẻ/bộ lọc/nút tải thêm trong khi chờ, chặn cả sự kiện bấm lặp bằng code. Không khoá giỏ hàng/thanh toán POS.
- Ô tìm đơn vẫn dùng được lúc đang lọc. Bỏ chặn pointer-events/opacity của CSS busy-container chung riêng cho khung này; các dòng cũ bị mờ và không mở được trong lúc chờ. Gõ tiếp có debounce và kết quả yêu cầu cũ không ghi đè truy vấn mới.
- Lỗi tải: giữ kết quả đã xác nhận trước, trả các bộ lọc về phạm vi tương ứng kết quả đó, hiện lý do và nút “Thử lại” cho yêu cầu thất bại. 401/403 xóa dữ liệu/bộ đệm cũ. Phản hồi phiên tài khoản trước bị bỏ qua.
- Bộ đệm chỉ RAM 15 giây, tách tài khoản/quầy/nguồn/nhân viên/ngày/thanh toán/từ khoá. Tối đa 8 kết quả từng bộ lọc, 2 danh sách đủ. Không lưu token, localStorage/IndexedDB hoặc hàng chờ ghi.
- Chỉ lọc trạng thái tại chỗ khi máy chủ đã trả **đủ toàn bộ danh sách**: status all, không nextOffset, số dòng bằng totalOrders và counts.all. Trường hợp thông thường có tối đa 100 đơn/trang, như 48 đơn trong ảnh, chuyển thẻ không gọi máy chủ. Tính tổng theo trạng thái và từng tiền tệ giống server; giữ phân tích tổng quan độc lập thẻ trạng thái/thanh toán như hiện tại.
- Khi chưa có đủ danh sách, lần mở bộ lọc mới vẫn gọi server; không suy từ trang đầu ra kết quả toàn bộ. Quay lại bộ lọc vừa mở dùng kết quả trong hạn. Hết hạn, tải lại POS hoặc sau các thao tác làm thay đổi đơn sẽ đọc mới; thêm tải lại bảng sau luồng trả hàng.

Không sửa server/SQL/nghiệp vụ, quyền, số đếm nguồn, cách phân loại huỷ/GHN hoặc số tiền thanh toán. Các thao tác ghi vẫn kiểm tra quyền/trạng thái ở server. Không migration, không đọc/ghi production, không đụng phiên/cron/đồng bộ Sapo.

## Kiểm chứng

- `pos-order-board-cache.test.ts`: đối chiếu với hàm server cho mọi thẻ, từng bộ lọc thanh toán, đơn web còn mở, đa tiền tệ và trạng thái thanh toán chưa rõ. Không dùng danh sách phân trang làm toàn bộ, đúng TTL, đổi tài khoản/kho/bộ lọc và xoá bộ đệm.
- `pos-ui.test.ts`: 35 test UI POS (cùng 3 test cache là 38 trong lượt chạy chung), gồm phản hồi tức thì, chặn bấm trùng, lỗi và thử lại, lọc tại chỗ không thêm request, truy vấn mới thắng phản hồi cũ và phiên tài khoản cũ không đổi dữ liệu phiên mới.
- Bộ test order-board server, kiến trúc, trial UI và typecheck đạt.
- `scripts/testing/pos-order-filter-feedback.mjs`: app CRM thật, router kiểm quyền bằng dữ liệu thử PGlite, bảng đơn giả dùng chính công thức lọc server. Chặn browser kết nối ngoài local. Lock/Minh Long × 1280px/390px × danh sách đủ 48 đơn/phân trang 200 đơn: tổng 8 kịch bản, không lỗi JS.
- Danh sách đủ: đổi thẻ khoảng 0,07–0,20 giây, 0 request mới. Phân trang: API cố ý trễ 2 giây, hiện trạng thái chờ, bấm lặp không tăng số request; ô tìm kiếm nhận focus được trong lúc chờ. Quay lại các thẻ vừa xem khoảng 0,13–0,29 giây và không thêm request.

Thời gian là thử local Chromium, không cam kết tốc độ production. Chưa thử Safari/iPhone thật. Ảnh là các thẻ đang chờ, dữ liệu thử, không phải đơn thật. results.json chứa đủ 8 kịch bản.
