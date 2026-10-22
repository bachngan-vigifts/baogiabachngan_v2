# VietQR: nội dung theo số đơn POS

QR mới hiện và mã hoá `Thanh toán đơn POS_YYYYMMDD_NNN`. Số này được giữ trước ở `reservedOrderNo` trong JSON `pos_payment_requests.cart`, rồi dùng nguyên khi checkout. Không thêm schema, không tạo đơn/phiếu thu hay xuất kho lúc tạo QR.

Cả QR và checkout dùng chung cấp số, khoá két và khoá ngày. Đơn tiền mặt/COD xen giữa bỏ qua số QR đã giữ. Gọi lại cùng key giữ nguyên QR/số; checkout replay giữ nguyên đơn; cùng QR không dùng cho đơn thứ hai. Qua nửa đêm vẫn giữ số đã hiển thị. QR bỏ dở/hết hạn không tái sử dụng số để tránh đối soát nhầm khoản tiền đến trễ, vì vậy dãy số có thể có khoảng trống.

SePay nhận nội dung theo số đơn, kể cả nội dung ngân hàng đã bỏ dấu/gạch dưới và trường `code` chứa mã riêng của ngân hàng. Khớp đủ số, tránh `...100` khớp `...1000`; chặn nội dung khớp nhiều yêu cầu; vẫn kiểm tài khoản và số tiền. Tra theo tham chiếu thay cho cắt 200 yêu cầu gần nhất. QR cũ tiếp tục nhận token UUID như trước; không sửa tham chiếu của QR đã phát hành.

## Validation

- Unit: nội dung, chuẩn hoá, biên số, QR cũ, JSON hỏng.
- PostgreSQL/API: QR đồng thời không trùng số; nội dung ảnh giống nội dung hiển thị; tạo QR chưa ghi đơn/thu/xuất; replay QR/checkout; đơn tiền mặt xen giữa; dùng đúng số QR khi checkout; qua ngày; số QR hết hạn không dùng lại.
- SePay giả lập: đúng/sai tiền, sai tài khoản, `code` ngân hàng riêng, replay, hơn 200 yêu cầu mới hơn, QR UUID cũ.
- Không gọi SePay/ngân hàng, tạo QR thật hay ghi dữ liệu production. Chưa kiểm trực quan trong CRM live.
