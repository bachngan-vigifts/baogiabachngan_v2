# CRM visual style

Theo yêu cầu chỉ chỉnh font, màu, nền, icon; giữ cấu trúc hiện có. Base: `80980325`.

`visual-theme.css` được tải cuối, chỉ áp dụng `screen` và scope `.app-shell`.
Font Arial/Helvetica Neue/Segoe UI dùng hệ thống, không thêm CDN hoặc thư viện icon.
Giữ SVG Tabler hiện có, đồng nhất màu và độ dày nét. Không đổi DOM/controller,
kích thước control, spacing, grid, breakpoint, công thức tiền, quyền hoặc migration.
Màu trạng thái thành công/cảnh báo/lỗi và nút nguy hiểm vẫn phân biệt.

## Kiểm tra

- `node --import tsx --test tests/architecture.test.ts tests/app/trial-ui.test.ts tests/app/pos-ui.test.ts`: pass.
- `node node_modules/typescript/bin/tsc --noEmit`: exit 0.
- `node --import tsx scripts/build-trial-ui.ts`: exit 0, không đổi file sinh ra.
- `git diff --check`: pass.
- `PLAYWRIGHT_MODULE=<playwright/index.mjs> node scripts/testing/crm-visual-style.mjs`: pass 1440×900, 1366×768, 390×900.
  Fixture dùng shell/CSS thật và dòng sản phẩm giả lập, không chạy app/API production.
  Bật/tắt theme giữ nguyên danh sách control, trạng thái disabled/hidden, giá trị nhập,
  chiều rộng sidebar, chế độ bảng/thẻ; không tràn ngang trang. Font input mobile vẫn ≥16px.
  So sánh biến font/màu dưới media print: không thay đổi.
- Chạy lại `scripts/testing/pos-search-cards.mjs` với liên kết `visual-theme.css` thêm
  vào HTML fixture, controller POS/PGlite thật, provider/network ngoài bị chặn:
  pass 1366×768, 1440×900, 1812×1100, 390×844; chọn hàng giữ giỏ, không lỗi JS;
  PC vẫn có hai hàng đủ chiều cao (88px/thẻ, vùng kết quả 192px).

Ảnh `products-before/after-*`: cùng shell, dữ liệu và viewport, chỉ đổi stylesheet.
Ảnh `pos-after-*`: POS với dữ liệu fixture. Không có dữ liệu khách hàng thật.

Kiểm tra này xác nhận thay đổi trình bày trên Chromium và các control nêu trên;
không phải kiểm thử toàn bộ module CRM hoặc Safari trên thiết bị thật.
Chưa merge/deploy; không cần migration.
