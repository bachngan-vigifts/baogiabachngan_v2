# Tên khách hàng và sản phẩm dài trên màn hình nhỏ

## Nguyên nhân và phạm vi sửa

Lưới thẻ dùng `minmax(0,1fr) auto`: cột bên phải lấy độ rộng theo số tiền hoặc nhóm nút, khiến cột tên khách có thể chỉ còn vài chục pixel. HĐKT, Báo giá, Đơn hàng dùng chung kiểu này. Danh sách Khách hàng còn dành riêng một cột cố định cho các nút.

`trial-ui/mobile-design.css` sửa tại các thành phần dùng chung:

- Thẻ Báo giá, Đơn hàng, HĐKT, Khách hàng, Giao dịch: tên chiếm cả hàng; số tiền, người phụ trách, thao tác có hàng riêng. Nút được xuống dòng. GHN trên đơn hàng có hàng riêng, không chồng người phụ trách.
- Khung nhãn/giá trị `.kv` trong trang chi tiết và popup: giới hạn cột nhãn trên tablet; xếp nhãn trên giá trị khi màn hình ≤480px.
- Hộp chọn báo giá, chọn sản phẩm, tổng tiền phải thu và công việc: tách các phần có độ rộng lớn khỏi tên trên điện thoại nhỏ.
- Popup Kiểm tồn báo giá: giữ cột tên sản phẩm tối thiểu 240px và số lượng không tách dòng; cuộn ngang các cột số liệu, dùng được bằng bàn phím. Ghi chú ở chân popup có hàng riêng trên điện thoại.
- Gợi ý sản phẩm, Tra tồn, Nhận hàng: tách tên khỏi giá/tổng số lượng trên điện thoại nhỏ. Giỏ POS tách tên và thành tiền cả trên điện thoại lẫn khung checkout hẹp của desktop.
- Desktop: cột tên trong các danh sách có thiết kế thẻ có độ rộng tối thiểu 240px. Bảng nhiều cột tiếp tục cuộn ngang trong khung bảng. Đặt khung làm mốc cho nhãn hỗ trợ truy cập định vị tuyệt đối, tránh nhãn làm tràn cả trang.

Thay đổi CSS giao diện màn hình và nhãn/vùng cuộn bàn phím của bảng Kiểm tồn; không thêm request, polling, thay đổi dữ liệu, quyền hay phép tính tài chính. Các bảng kho/kế toán nhiều cột vẫn dùng cách cuộn ngang hiện có.

## Kiểm tra

Các script chỉ dùng localhost và dữ liệu giả; chặn request ra ngoài. Cần Playwright và Chromium. Có thể đặt `PLAYWRIGHT_MODULE` thành đường dẫn module Playwright, `CHROMIUM_PATH` thành đường dẫn Chromium.

```sh
node scripts/testing/mobile-name-layout.mjs
node --import tsx scripts/testing/mobile-name-routes.mjs
node --import tsx scripts/testing/orders-mobile-layout.mjs
node --import tsx scripts/testing/quote-stock-warning.mjs
```

- `mobile-name-layout.mjs`: CSS thật và bộ gắn thẻ mobile thật, 34 cấu trúc/biến thể tại 320, 360, 390, 430, 768, 850, 1280px (238 lượt). Kiểm tra độ rộng tên, tiền không bị cắt, trang không tràn ngang, nút nằm trong thẻ và bấm được, người phụ trách/GHN/nút không chồng nhau. Các popup trong script kiểm tra cấu trúc `.kv` dùng chung, không thực hiện nghiệp vụ duyệt/thu tiền.
- `mobile-name-routes.mjs`: router/API CRM thật với PGlite mới, 30 route tại 390 và 1280px. Có fixture tên dài ở báo giá, đơn hàng, HĐKT, khách hàng, giao dịch và các trang liên quan; các route chưa có fixture nghiệp vụ chỉ kiểm tra mở trang và tràn ngang. Báo cáo ghi riêng số trang có tên dài, không coi trang trống là đã thử tên dài.
- `quote-stock-warning.mjs`: mở popup Kiểm tồn từ báo giá HRC/B2B/VIGIFTS ở 320, 390, 768, 1024, 1354px (6 trường hợp). Kiểm tra tên, số lượng không tách dòng, hàng giữ/khả dụng giữ nguyên, bộ lọc Đủ/Thiếu/Tất cả, cuộn ngang và đóng popup; đổi số lượng/lọc không gọi thêm API sản phẩm.
- `orders-mobile-layout.mjs`: hồi quy đơn CRM/POS, liên kết Sapo, số tiền lớn, vận đơn GHN, nhiều nút thao tác tại 7 kích thước.

Ảnh và JSON xuất ra thư mục `/tmp` theo mặc định. Đặt `BROWSER_EVIDENCE_DIR` hoặc `MOBILE_SCREENSHOT_DIR` để đổi nơi lưu. Có thể đặt `BASELINE_CSS` thành CSS trước sửa và chạy script cấu trúc với `--baseline` để tái hiện lỗi; không dùng chế độ baseline như kiểm tra PASS.

Đã chạy thêm typecheck và các test UI/kiến trúc liên quan; bổ sung kiểm tra giữ hàng, Tra tồn, cảnh báo thiếu hàng và các cột số liệu sản phẩm. Đây là kiểm tra Chromium với dữ liệu giả; cần kiểm tra bổ sung trên thiết bị iOS/Safari thật khi triển khai.
