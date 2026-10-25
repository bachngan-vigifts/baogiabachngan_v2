# POS mobile: danh mục sản phẩm và cuộn tới khách hàng

## Nguyên nhân đã tái hiện

Ở 390×844, rule `max-width:1366px` nằm sau rule mobile đặt danh mục cao 10 hàng × 244px, thành 2.512px. `overscroll-behavior:contain` giữ thao tác vuốt trong danh mục, không chuyển sang `.main` là vùng cuộn của app. Cuộn gần cuối còn tự tải nối sản phẩm, render lại toàn bộ danh sách. Với fixture 1.000 sản phẩm: 6 lượt cuộn tăng 20 → 140 ô, 1 → 7 request. Khách hàng nằm bên dưới danh mục. Nút Xem đơn lại bị khoá khi giỏ trống.

## Thay đổi

- Mobile ≤850px: vùng sản phẩm tối đa `min(48svh,420px)` (có fallback `vh`), cho phép vuốt tiếp ra `.main`.
- Mỗi trang 20 sản phẩm, có Trang trước/Trang tiếp. Không tự nối trang khi cuộn hoặc tự quét thêm 5 trang để lọc tồn. Bộ lọc tồn áp dụng cho trang hiện tại; có thể chuyển trang hoặc tìm tên/mã để thu hẹp danh sách.
- Chuyển trang thay danh sách hiện tại, giữ nguyên giỏ; lỗi tải trang giữ trang cũ và cho thử lại. Tìm mới/đổi quầy/đổi bảng giá quay về trang đầu. Chuyển qua breakpoint desktop/mobile tải lại danh mục theo chế độ mới.
- Desktop giữ Xem thêm và tự nối trang như trước.
- Xem đơn mở được cả khi giỏ trống, để chọn khách trước. Dock cập nhật tên khách ngay khi chọn, không chờ tính tiền.

## Kiểm thử

Node tests: `tests/app/pos-ui.test.ts` kiểm tra phân trang mobile, số ô, không tự request khi cuộn/lọc thưa, giữ giỏ khi qua lại; desktop vẫn nối 60 sản phẩm mỗi trang. Chạy cùng mobile-density, POS order flow UI, order edit UI và customer-required.

Kiểm thử trình duyệt với CSS thật và `initPos`, khung app-shell/.main thật, API giả lập hoàn toàn:

```sh
npm install --prefix /tmp/pos-browser playwright
PLAYWRIGHT_MODULE=/tmp/pos-browser/node_modules/playwright/index.mjs node scripts/testing/pos-mobile-scroll.mjs
```

Cần Chromium tại `/usr/bin/chromium` hoặc đặt `CHROMIUM_PATH`; có thể đặt `POS_SCREENSHOT_DIR` để lưu ảnh. Không cần thêm Playwright vào dependencies production. Script chặn truy cập ngoài localhost; không gọi API thật, không thu tiền hay tạo đơn.

| Viewport | Chiều cao danh mục sau sửa |
|---|---:|
| 375×667 | 320px |
| 390×844 | 405px |
| 768×1024 | 420px |
| 844×390 | 187px |

Ở cả bốn kích thước, CDP touchStart/touchMove/touchEnd xác nhận vuốt từ cuối danh mục chuyển sang cuộn `.main`; mở/chọn khách hoạt động. Sau 6 lượt cuộn vẫn 20 ô và 1 request. Kiểm tra thêm Trang trước/tiếp và retry lỗi mạng. Đây là Chromium giả lập touch, chưa phải kiểm thử trên iPhone/Safari thật. Chưa deploy production.
