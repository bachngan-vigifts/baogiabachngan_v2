# Gửi VietQR từ POS sang điện thoại NVBH

## Sử dụng

1. NVBH đăng nhập CRM trên điện thoại, giữ trang đang mở. Tài khoản phải có quyền bán POS và thuộc cửa hàng nhận. Cho phép thông báo để nhận nhanh qua Web Push; nếu chưa bật, trang đang mở tự kiểm tra lại sau mỗi 2,5 giây kể từ khi lượt trước hoàn tất.
2. Thu ngân mở VietQR của đơn, chọn **Gửi QR sang điện thoại NVBH**. Quầy Lock/Minh Long tự giới hạn cửa hàng tương ứng. Quầy Sale Admin không xác định được cửa hàng phải chọn rõ cửa hàng nhận; chỉ Manager/Sale Admin được thực hiện lựa chọn này.
3. Điện thoại NVBH thuộc cửa hàng đó tự mở màn hình QR chỉ để khách quét. Một điện thoại hiển thị QR vừa được gửi gần nhất; gửi lại chủ động tạo lượt hiển thị mới. Tài khoản có nhiều điện thoại mở CRM có thể nhận trên tất cả điện thoại đó.
4. Việc xác nhận thu vẫn thực hiện qua SePay hoặc quy trình thu ngân hiện có. Màn hình nhận không có nút thu tiền, tạo đơn hoặc trừ kho. QR được ẩn khi máy chủ báo đã thanh toán, hết hạn, đóng ca, bị thu hồi hoặc đã có QR mới trong cùng ca.

Không thể ép trình duyệt mở popup khi điện thoại khoá, trang bị hệ điều hành ngừng chạy hoặc CRM đã đóng. Trong trường hợp đó Web Push có thể hiển thị thông báo theo quyền/cấu hình thiết bị; người dùng cần mở CRM. Không cam kết độ trễ thực tế khi chưa đo trên thiết bị và mạng cửa hàng.

## Thiết kế và giới hạn

- Dùng bảng thông báo và đăng ký Web Push hiện có; không cần migration, dịch vụ hay credential mới.
- Push chỉ đánh thức trang; điện thoại đọc lại dữ liệu QR và phân quyền từ API. Không lấy URL/tiền/tài khoản ngân hàng từ payload thông báo.
- Thông tin ngân hàng được cố định trong JSON của yêu cầu QR khi tạo; đổi cấu hình quầy không thay QR đã gửi. QR cũ thiếu thông tin cố định phải tạo lại trước khi chia sẻ.
- Mỗi lần gửi kiểm tra lại NVBH đang hoạt động và phạm vi quầy theo phân quyền. Chuyển cửa hàng/đổi vị trí không tiếp tục đọc được QR đã chia sẻ. Manager, kế toán và Sale Admin không tự nhận màn hình chỉ nhờ vai trò.
- Chỉ đẩy Web Push đến subscription di động; trang desktop không tự mở màn hình nhận. Nhận diện thiết bị dựa trên trình duyệt, không phải bằng chứng bảo mật; quyền dữ liệu vẫn dựa trên tài khoản và cửa hàng.
- Poll không chồng lấn, ngừng khi trang ẩn; QR bị che khi mất kết nối và kiểm tra lại khi trở về. Hết hạn cục bộ vẫn ẩn QR nếu mạng hỏng. Thao tác sửa giỏ gửi yêu cầu ẩn QR cũ; nếu mạng phía thu ngân lỗi, phía nhận chỉ biết khi có lần cập nhật máy chủ tiếp theo hoặc hết hạn.
- Đây là chia sẻ toàn bộ NVBH của cửa hàng, chưa ghép cặp riêng từng máy thu ngân–điện thoại.

## Kiểm thử

Dữ liệu giả lập, không gửi thông báo hay tạo thanh toán production:

- `tests/app/pos-qr-phone.test.ts`: đúng/sai cửa hàng; Sale Admin chọn đích; NVBH, Manager, NCC, chưa đăng nhập; đổi quyền; mobile-only push; gửi lặp không trùng; ngân hàng cố định; trạng thái đã thu/hết hạn/thu hồi; không phát sinh đơn, phiếu thu hay giao dịch kho.
- `tests/app/pos-qr-phone-ui.test.ts`: push đánh thức ngay; bỏ qua URL không tin cậy; đóng/gửi lại; hết hạn; trang ẩn; desktop; đổi tài khoản khi request chưa xong.
- Hồi quy POS, mã đơn QR, in QR, phạm vi thông báo và kiến trúc.
- Chromium màn hình 390 và 430 px: popup không tràn màn hình; chỉ có nút Đóng. Ảnh dùng hình QR minh hoạ không thanh toán được, nội dung DEMO.

Chạy bằng Node >=22.22: `npm run typecheck` và `node --import tsx --test tests/app/pos-qr-phone.test.ts tests/app/pos-qr-phone-ui.test.ts`.
