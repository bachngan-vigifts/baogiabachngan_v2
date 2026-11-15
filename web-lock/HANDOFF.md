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
- Làm nóng cache: workflow `cache-warm.yml` trên main, 1 luồng, lịch 6 giờ/lần. Đến 19:50 ngày 15/11 vẫn chưa có lần chạy theo lịch nào (lẽ ra đã chạy 13:17 và 19:17); cần kiểm tra lại.
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
| `woo-wdr-dedupe.php` | Woo Discount Rules: mỗi bảng giảm giá chỉ hỏi máy chủ 1 lần/trang (trước 3 lần giống hệt khi mở trang biến thể), thêm 15/11 |
| `woo-wdr-bulk-table-off.php` | Tắt tải động bảng giảm giá rỗng của Woo Discount Rules (filter của plugin), thêm 16/11; đã gỡ `woo-wdr-dedupe.php` |
| `lnl-block-php-probe.php` | Trả 404 sớm cho bot dò file PHP giả (1,6–3,3 giây xuống 0,4 giây), thêm 15/11 |
| `woo-buy-now-direct.php` | Mua ngay đi thẳng tới thanh toán trong một lượt |

Không có trên web thật (chỉ còn trong kho mã): `lnl-disable-plugins.php` (gỡ 15/11 sau khi anh Thái Deactivate Jetpack và Query Monitor trong quản trị), `woo-ajax-buy-now.php` (đã gỡ vì anh Thái báo treo), `woo-default-qr-payment.php` (không hiệu quả, việc QR mặc định do Open Claw làm).

## Số liệu mới nhất (điện thoại, giỏ khách tạm)

- Máy chủ xử lý một lệnh rỗng: khoảng 1,5 giây. Đây là chỗ nghẽn chính.
- Thêm vào giỏ: 1,5–2 giây, thỉnh thoảng 4–5 giây.
- Mua ngay tới trang thanh toán: 1,7–2,2 giây (trước là 3–5,4 giây).
- Trang giỏ hàng: 1,2–2,0 giây. Trang thanh toán: 1,2–2,2 giây.

## Việc còn mở

1. ~~File chặn Jetpack~~: đã gỡ 15/11, hai plugin đã Deactivate.
2. ~~Mua ngay với sản phẩm có biến thể~~: đã thử 15/11 (3/3 lần đạt: vào thẳng thanh toán, giỏ đúng 1 món, một lượt). Chưa chọn biến thể thì nút giữ nguyên trang. Lúc thử máy chủ chậm (lệnh rỗng 2,1–2,8 giây) nên thời gian 3,4–9,8 giây.
3. Khoảng trống dưới giá ở các băng chuyền trang chủ: đã hỏi, chưa có trả lời.
4. Voucher Shop mở chậm (2,2–4,6 giây): cần mã snippet 221 trong Code Snippets, hoặc giao Open Claw in sẵn danh sách vào trang.
5. Dòng "Đã bán": muốn xoá hẳn thì phải tắt ở đoạn mã gốc (chưa biết nằm ở đâu).
6. Giảm thời gian khởi động WordPress: cần danh sách plugin đang bật. Chưa vào được trang quản trị; tiện ích Chrome chặn locknlockonline.com.
7. Sau khi chặn Jetpack, máy chủ chậm nặng khoảng 2 phút rồi tự hết; chưa rõ nguyên nhân.
8. Action Scheduler: file SQL `web-lock/changes/action-scheduler-cleanup.sql`, anh Thái tự chạy trong phpMyAdmin, chưa báo đã chạy.
9. MailPoet: anh Thái tự tắt "Opt-in on checkout" trong cài đặt MailPoet.
10. ~~PR #683~~ đã gộp ngày 14/11. Không gộp các workflow chạy một lần (xóa `.git`, dọn log).
11. ~~2 file đánh dấu cũ~~: đã gỡ 15/11.

## Công cụ đo (đều chỉ đọc, giỏ khách tạm, không đặt đơn)

- `web-lock-buy-test.mjs`: thử nút giỏ hàng và Mua ngay, mỗi nút 3 lần.
- `web-lock-cards-measure.mjs`: đếm hàng thẻ có nút lệch, chụp ảnh.
- `web-lock-flow-measure.mjs`: đo cả luồng mua hàng và lệnh trùng.
- `web-lock-boot-measure.mjs`: đo thời gian máy chủ xử lý lệnh rỗng.
- `web-lock-checkout-preview.mjs`: xem thử trang thanh toán, thử popup lỗi.
- Mỗi công cụ có workflow cùng tên, kích hoạt bằng file `.github/<tên>.run`.

## Phát hiện 15/11 tối

- Hosting giới hạn CPU 200% (2 nhân); lúc chậm CPU chạm 199/200. RAM dư (dưới 40%). Công cụ: `resource-usage.yml`.
- Lượt truy cập gần nhất (`last-visitors.yml`): khoảng 120/870 lượt là bot không khai tên trình duyệt dò file PHP giả, nay đã chặn sớm bằng `lnl-block-php-probe.php`.
- Link quảng cáo Google có `gad_source`, `gbraid` làm trượt cache (2,2 giây so với 0,3 giây khi có gclid/utm). Đã nhờ anh Thái thêm `gad_*, gbraid, wbraid, srsltid, ttclid` vào LiteSpeed Cache → Cache → Advanced → Drop Query String. Anh Thái đã lưu 15/11; đo lại: link có mã quảng cáo 0,33–0,39 giây (mã lạ không có trong danh sách vẫn 2,2 giây).
- Lúc 21:20 CPU vẫn 95–99% dù đã chặn bot và sửa cache quảng cáo; luồng mua vẫn 2–12 giây. Nguồn tải còn lại chưa xác định hết. Lưu ý: chính các bài đo cũng góp tải, đừng chạy nhiều bài đo cùng lúc khi máy chủ đang chậm.
- Mỗi lần đổi biến thể, Flatsome gửi `flatsome_additional_variation_images_load_images_ajax_frontend` (cần thiết, giữ).

## 16/11 sáng (giờ VN)

- Chẩn đoán chỉ đọc: xem `web-lock/CHAN-DOAN-2026-11-15.md`. Anh Thái yêu cầu chỉ đọc trước khi sửa tiếp; mọi thay đổi phải hỏi.
- Anh Thái đã XOÁ hẳn Jetpack và Jetpack Boost (thư mục plugins không còn, readme 404). REST vẫn còn namespace `jetpack/v4` do gói jetpack-connection đi kèm plugin khác (bình thường). `/wp-json/` gốc đang bị Cloudflare cache bản cũ.
- Đo ngay sau khi xoá: lệnh rỗng 2,2–4,3 giây, chưa thấy cải thiện; cần đo lại lúc yên.
- Việc tiếp theo đề xuất (chờ duyệt): tắt bảng giảm giá động WDR bằng filter `advanced_woo_discount_rules_disable_load_dynamic_bulk_table` → 'off', rồi gỡ `woo-wdr-dedupe.php`; tắt LiteSpeed Debug Log; Redis maxmemory.
- 16/11: việc 2 xong (0 lệnh wdr_ajax). Việc 5 (`woo-fragments-guest-skip.php`) TỰ GỠ vì không đạt: đoạn mã không được gắn (seed=0) — WooCommerce nạp `wc-cart-fragments` muộn (khi vẽ giỏ mini), sau `wp_enqueue_scripts`, nên `wp_script_is('enqueued')` sai. Cần gắn ở `wp_print_footer_scripts` hoặc kiểm tra `wp_script_is` lúc in.
- Lỗi có sẵn (cả TRƯỚC khi đổi, 3/3): thêm vào giỏ ở trang sản phẩm rồi mở trang danh mục bình giữ nhiệt → giỏ mini hiện 0 dù Store API = 1; trang chủ hiện đúng 1. Chưa rõ nguyên nhân.
- Việc 3 (tắt Debug Log) và 4 (Redis maxmemory) đã gửi hướng dẫn cho anh Thái; chưa xác nhận.
- 16/11 ĐÃ XÁC NHẬN (3/3): giỏ mini hiện 0 ở trang đã xem trước khi thêm giỏ vì Cloudflare gắn `Cache-Control: max-age=2678400` (31 ngày) cho HTML được cache (máy chủ gốc không gửi Cache-Control). Trình duyệt lấy lại trang từ bộ nhớ của nó, không hỏi máy chủ; trang danh mục và trang chủ không nạp cart-fragments nên không tự sửa. Hệ quả rộng hơn: giá/tồn kho/khuyến mãi trên trang khách đã xem có thể cũ tới 31 ngày trong trình duyệt của khách. Sửa đúng: Cloudflare → Browser Cache TTL / Cache Rule cho HTML: "Respect origin" (hoặc ngắn), giữ Edge TTL. Chờ anh Thái (cần quyền Cloudflare).
- 16/11 05:34 VN: email "lỗi nghiêm trọng Jetpack" = 1 request đang chạy code Jetpack đúng lúc thư mục bị xoá (Fatal: Failed opening required .../jetpack/.../class-wc-analytics-tracking.php), chỉ 1 lần, sau đó không còn lỗi. Còn sót: bảng `*_jetpack_sync_queue`, option `jpsq_*`, sự kiện cron `jetpack_sync_cron`/`jetpack_sync_full_cron` (vô hại, dọn sau nếu muốn). Lệnh rỗng sau khi xoá Jetpack vẫn 2,5–2,8 giây (chưa cải thiện). Debug log LiteSpeed vẫn đang ghi (2,7 MB) → việc 3 chưa làm.
