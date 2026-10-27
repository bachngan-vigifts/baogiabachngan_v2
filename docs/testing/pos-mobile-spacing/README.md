# POS mobile spacing

Chỉ sửa CSS ở max-width 850px; không thay pos.js, API, quyền, tính tiền hay tồn kho. Baseline từ main `44e8524`.

- Cụm ca: trạng thái một hàng, hàng tiếp có chọn quầy/Kết ca/⋯; tất cả nút nằm trong viewport 360px. Tên quầy dài tự xuống dòng.
- Chính sách giá và Tìm tất cả SP chia đôi, hở 8px, cùng cao 40px và cùng đường đáy.
- Thẻ sản phẩm cao theo nội dung; ảnh contain 104px, tên tối đa hai dòng, giá sát mã; vẫn giữ Tồn các kho. Chiều cao ảnh/dòng ổn định tránh sai số track khi cuộn chạm qua mép grid trên Chromium.
- Ô thống kê Tất cả đơn/Đơn web và các trạng thái: số + nhãn cùng hàng, cao 42px; giữ badge đỏ và chức năng lọc.

| Số đo fixture 390px | Trước | Sau |
|---|---:|---:|
| Mép phải nút ⋯ | 406px (bị cắt) | 380px |
| Bề rộng chính sách / tìm tất cả | 257 / 107px | 181 / 181px |
| Cao thẻ sản phẩm | 300px | 238px |
| Khoảng mã → giá | 52px | 8px |
| Cao ô thống kê đơn | 76px | 42px |

[Trước 390](before/pos-390.png) · [Sau 390](after/pos-390.png) · [Ô đơn trước](before/orders-390.png) · [Ô đơn sau](after/orders-390.png) · [Desktop trước](before/pos-1280.png) · [Desktop sau](after/pos-1280.png).

Validation: browser geometry 360/390/430/768/1280px, không tràn trang, mở ⋯ dùng được, hai ô cân nhau. Desktop 1280 số đo giống hệt; ảnh chỉ có 46 pixel anti-alias lệch tối đa 2/255, không thay layout. Fixture dùng ảnh SVG local thay ảnh sản phẩm thật, chặn mọi request ngoài fixture.

Regression pos-mobile-scroll đạt 375x667, 390x844, 768x1024, 844x390: touch chaining từ grid xuống giỏ, phân trang/retry, chọn khách; desktop append và resize mobile/desktop đạt. Typecheck, UI build và 26 test pos-ui đạt. Không tạo đơn hoặc giao dịch production.

Chạy: `POS_LAYOUT_VERIFY=1 PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/testing/pos-mobile-spacing.mjs`. Đo baseline qua `POS_CSS_SOURCE` trỏ tới bản pos.css cũ. Không thêm dependency vào ứng dụng.
