# Lấy hàng trước, menu nhóm và POS — 26/10/2026

## Trang Lấy hàng trước

- Menu Mua hàng → Lấy hàng trước (`#/early-requests`). Đọc các phiếu hiện có, không sao chép/tạo thêm chứng từ khi mở trang.
- Danh sách 20 phiếu/trang, thứ tự ngày lập + ID ổn định. Lọc trên server trước phân trang: mã phiếu, SKU/tên hàng, NCC, số đơn mua CRM/NCC; NCC; trạng thái; khoảng ngày lấy hoặc ngày lập (giờ Việt Nam).
- Bộ lọc được giữ trong URL để mở chi tiết rồi quay lại/tải lại. Không cắt dòng/nguồn phân bổ của một phiếu giữa hai trang.
- Tải file mẫu và xin hàng bằng file qua module hiện hành. Hai cột số đơn vẫn có thể trống theo quy tắc cũ. Chọn hàng đang về chuyển đến luồng chọn mã hiện hành.
- Chi tiết dùng chung `initEarlyRequests`: sửa/lưu nháp, gửi NCC, Manager xác nhận thay NCC, mở cổng NCC và nhận theo đúng phiếu/đơn mua. Sau sửa/gửi/xác nhận vẫn chỉ hiển thị phiếu đang mở.
- Quyền trang dùng `page.purchases`; quyền tạo/gửi, xác nhận thay và nhận hàng giữ kiểm tra hiện hành trên server. Chỉ gửi/xác nhận không cộng tồn; nhận hàng vẫn đi qua phiếu nhận và các kiểm tra kho/Sapo hiện có.

## Menu trái

Các nhóm mặc định đóng sau mỗi lần tải trang. Nút tiêu đề có mũi tên, `aria-expanded`, `aria-controls`, dùng được bằng Enter/Space. Mở nhóm độc lập; không đổi quyền hoặc thuộc tính `hidden` của các trang con. Menu chân trang điện thoại vẫn có toàn bộ trang được cấp quyền và cuộn ngang.

## POS

- Bấm Thanh toán thiếu khách → chọn/tạo khách → chờ tính lại giá mới rồi mở form thanh toán. Bỏ timer preview dư gây race khi mạng chậm hơn debounce 180ms. Đóng hộp khách, chọn khách thông thường, đổi đơn hoặc đổi trang không tạo chuyển tiếp ngoài ý muốn. Không tự submit thanh toán.
- Tab B2B chỉ có khách có MST không trống; khách lẻ là không có MST, kể cả dữ liệu cũ gắn nhãn `isRetail` chưa đúng. Khoảng trắng không được coi là MST. Không mở rộng quyền xem hồ sơ trước đây bị hạn chế.
- Thu gọn ô CK; hiện “Sau CK / SP” từ kết quả tính của server, cùng cơ sở giá bảng giá. Giá này trừ CK dòng, chưa trừ voucher cả đơn; CK tiền theo dòng được chia đúng số lượng. Khi sửa đang chờ preview hiện “Đang tính…”, không giữ giá cũ gây hiểu nhầm.
- Menu thao tác tự đóng dù nút vừa bấm tự khoá trong lúc lưu, tránh phủ lên bước tiếp theo.

## Xác minh

- PGlite/API: 55 phiếu phân trang không trùng/mất; đầy đủ dòng; các trạng thái và nguồn NCC; tìm phiếu cũ; wildcard literal; ngày Việt Nam; validate bộ lọc; quyền xem/gửi.
- Hồi quy xin hàng, file mẫu, Manager confirm, receiving, POS customer pagination/UI/retail.
- Chromium với router thật/PGlite: trang mới 390/1280, thu gọn sidebar/bàn phím/footer, sửa-gửi-xác nhận, tải mẫu, lỗi/retry, đổi vai trò.
- Chromium POS 375/390/1280: preview chậm 350ms, chuyển tiếp sau chọn/tạo khách, huỷ ý định an toàn, lọc MST, giá sau CK % và tiền/dòng với số lượng 2. Không gọi `/pos/checkout`.

Không migration, không deploy production, không thay dữ liệu thực hoặc gửi Sapo/GHN để thử.
