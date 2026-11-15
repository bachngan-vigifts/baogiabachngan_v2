# Bàn giao công việc web Lock (locknlockonline.com)

Cập nhật: 2026-11-15 19:40 (giờ Việt Nam). Nhánh làm việc: `probe/cpanel-readonly` (không nằm trong main).

## Quy tắc bắt buộc

- Gọi người dùng là "Anh Thái", trả lời tiếng Việt, ngắn, đúng trọng tâm.
- Không in mật khẩu, token, cookie, khóa API. Đường dẫn socket Redis có tên tài khoản hosting: không nhắc lại.
- Thay đổi trên web thật: nêu kế hoạch, chờ anh Thái đồng ý. Hỏi từng câu một.
- Làm bản xem thử có ảnh trước/sau rồi mới đưa lên.
- Không đẩy thẳng main; PR phải qua kiểm tra tự động; không gộp khi chưa có xác nhận.
- Không ghi tên model vào commit, PR, mã.
- Tiết kiệm phút GitHub Actions.

## Cách triển khai lên web thật

- Mỗi thay đổi là MỘT file mu-plugin MỚI trong `web-lock/mu-plugins/`. Công cụ từ chối ghi đè file đã có, nên sửa tiếp thì tạo file mới (ví dụ `woo-ui-align-2.php`).
- File phải là ASCII thuần (chữ tiếng Việt viết bằng `\u....`), dưới 9000 ký tự.
- Chạy bằng workflow `.github/workflows/<tên>-deploy.yml`, kích hoạt khi file `.github/<tên>.run` đổi (nội dung `dry-run`, `apply` hoặc `rollback`). Xong thì gỡ file `.run`.
- Quy trình trong workflow: đo trước, kiểm tra sức khỏe, thêm file, dọn cache, đo sau, tự gỡ nếu đo sau không đạt.
- Hoàn tác: xóa file mu-plugin trên hosting (chế độ `rollback`).

## Cache

- Công cụ dọn cache (`scripts/maintenance/cpanel-purge-lscache.mjs`) mặc định chỉ dọn cache trang của LiteSpeed và bản lưu ở Cloudflare, giữ Redis. `PURGE_SCOPE=all` mới dọn toàn bộ; tránh dùng vì làm giỏ hàng và thanh toán chậm.
- Thay đổi chỉ ở giỏ hàng hoặc thanh toán thì không cần dọn cache.
- Làm nóng cache: workflow `cache-warm.yml` trên main, 1 luồng, lịch 6 giờ/lần. Chưa thấy lần chạy theo lịch nào trong danh sách; cần kiểm tra lại.
- Không chạy làm nóng tay ngay sau khi dọn cache: máy chủ từng bị chậm nặng.

## Các mu-plugin đang chạy trên web thật

| File | Việc |
|---|---|
| `woo-ajax-add-to-cart.php` | Thêm vào giỏ ở trang sản phẩm không tải lại trang |
| `woo-cart-optimize.php` | Giảm tải trang giỏ hàng |
| `woo-checkout-lite.php` | Bỏ thư viện đo độ mạnh mật khẩu ở thanh toán |
| `woo-no-order-attribution.php` | Tắt 16 trường theo dõi nguồn đơn |
| `woo-checkout-mobile.php`, `woo-checkout-mobile-top.php` | Giao diện thanh toán trên điện thoại, ô hoá đơn công ty lên đầu |
| `woo-checkout-no-account.php` | Bỏ ô tạo tài khoản và dòng đăng nhập ở thanh toán |
| `woo-checkout-error-popup.php` | Lỗi nhập liệu thanh toán hiện dạng popup |
| `woo-tap-feedback.php` | Thanh tiến trình khi chạm vào liên kết |
| `woo-product-sticky-tidy.php` | Thanh mua dính đáy gọn một hàng, nút bấm thay vào form chính |
| `woo-minicart-vouchers.php` | Các mức voucher trong giỏ hàng mini |
| `woo-price-card-tidy.php` | Khoảng giá đọc từ thấp đến cao |
| `woo-ui-align.php`, `-2`, `-3` | Căn thẳng thẻ sản phẩm (điện thoại, máy tính, trang chủ, danh mục) |
| `woo-card-buttons.php` | Nút "Chọn" lên dòng nhãn giảm giá, "Thêm vào giỏ" thành biểu tượng |
| `woo-hide-sold.php` | Ẩn dòng "Đã bán" |
| `lnl-disable-plugins.php` | Chặn Jetpack và Query Monitor không cho nạp |
| `woo-buy-now-direct.php` | Mua ngay đi thẳng tới thanh toán trong một lượt |

Không có trên web thật (chỉ còn trong kho mã): `woo-ajax-buy-now.php` (đã gỡ vì anh Thái báo treo), `woo-default-qr-payment.php` (không hiệu quả, việc QR mặc định do Open Claw làm).

## Số liệu mới nhất (điện thoại, giỏ khách tạm)

- Máy chủ xử lý một lệnh rỗng: khoảng 1,5 giây. Đây là chỗ nghẽn chính.
- Thêm vào giỏ: 1,5–2 giây, thỉnh thoảng 4–5 giây.
- Mua ngay tới trang thanh toán: 1,7–2,2 giây (trước là 3–5,4 giây).
- Trang giỏ hàng: 1,2–2,0 giây. Trang thanh toán: 1,2–2,2 giây.

## Việc còn mở

1. Anh Thái chưa trả lời: giữ file chặn Jetpack/Query Monitor, hay tự bấm Deactivate trong trang quản trị rồi gỡ file.
2. Mua ngay với sản phẩm có biến thể: chưa thử trên web thật.
3. Khoảng trống dưới giá ở các băng chuyền trang chủ: đã hỏi, chưa có trả lời.
4. Voucher Shop mở chậm (2,2–4,6 giây): cần mã snippet 221 trong Code Snippets, hoặc giao Open Claw in sẵn danh sách vào trang.
5. Dòng "Đã bán": muốn xoá hẳn thì phải tắt ở đoạn mã gốc (chưa biết nằm ở đâu).
6. Giảm thời gian khởi động WordPress: cần danh sách plugin đang bật. Chưa vào được trang quản trị; tiện ích Chrome chặn locknlockonline.com.
7. Sau khi chặn Jetpack, máy chủ chậm nặng khoảng 2 phút rồi tự hết; chưa rõ nguyên nhân.
8. Action Scheduler: file SQL `web-lock/changes/action-scheduler-cleanup.sql`, anh Thái tự chạy trong phpMyAdmin, chưa báo đã chạy.
9. MailPoet: anh Thái tự tắt "Opt-in on checkout" trong cài đặt MailPoet.
10. PR #683 vẫn chờ anh Thái gộp. Không gộp các workflow chạy một lần (xóa `.git`, dọn log).
11. Còn 2 file đánh dấu cũ chưa gỡ: `.github/woo-checkout-mobile.run`, `.github/woo-checkout-mobile-top.run`.

## Công cụ đo (đều chỉ đọc, giỏ khách tạm, không đặt đơn)

- `web-lock-buy-test.mjs`: thử nút giỏ hàng và Mua ngay, mỗi nút 3 lần.
- `web-lock-cards-measure.mjs`: đếm hàng thẻ có nút lệch, chụp ảnh.
- `web-lock-flow-measure.mjs`: đo cả luồng mua hàng và lệnh trùng.
- `web-lock-boot-measure.mjs`: đo thời gian máy chủ xử lý lệnh rỗng.
- `web-lock-checkout-preview.mjs`: xem thử trang thanh toán, thử popup lỗi.
- Mỗi công cụ có workflow cùng tên, kích hoạt bằng file `.github/<tên>.run`.
