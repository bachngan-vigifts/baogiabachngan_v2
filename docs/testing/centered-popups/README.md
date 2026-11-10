# Popup trong viewport và mốc nộp báo cáo

## Popup

CSS `#workspace .sup-drawer` ghi đè `top:50%` thành chiều cao thanh tiêu đề, nhưng transform vẫn trừ nửa chiều cao popup. Test với factory `initPurchases` thật đặt trong `#workspace` tái hiện popup 1280×720 tại y=-304 ở viewport 1692×1338. Các test cũ đặt supplier drawer ngoài workspace nên không phát hiện. Bộ kiểm tra mới phải thất bại trên CSS của HEAD gốc.

Bản sửa để overlay tự định vị, nâng shade/drawer lên trên thanh tiêu đề, căn giữa drawer ngắn và popup native trên điện thoại, giữ header khi cuộn. Vùng grid trong popup duyệt đơn không ép bảng giá về chiều cao chỉ còn tiêu đề. Khi quay về chi tiết đơn, bỏ class form cũ để nội dung dài cuộn được. Các trang soạn đơn/HĐKT/kiểm tra duyệt toàn màn hình giữ layout trang.

[Desktop](purchase-desktop.png) · [Điện thoại](purchase-mobile.png) · [Số đo](results.json).

Test browser dùng HTML/CSS thật, factory Đơn mua NCC thật và API giả chỉ đọc, chặn toàn bộ request ra ngoài. 6 viewport: 1692×1338, 1440×900, 1024×600, 390×844, 844×390, 1280×420. Kiểm tra hai trục, ô giá đầu hiển thị, nút đóng/nút thao tác không bị che sau focus ô cuối, cuộn, resize, mở lại drawer và popup xác nhận native. Không ghi dữ liệu CRM.

```sh
node scripts/testing/centered-popups.mjs
# Tái hiện trước sửa trên nhánh PR: lệnh này dự kiến FAIL.
POPUP_BASELINE=1 POPUP_SCREENSHOTS=/tmp/crm-centered-popups-before node scripts/testing/centered-popups.mjs
```

Mặc định Chromium ở /usr/bin/chromium; PLAYWRIGHT_MODULE có thể trỏ tới bản Playwright do môi trường cung cấp. Kiểm tra thêm scripts/testing/dialog-layouts.mjs (51 ca), payroll-dialog-layouts.mjs (12 ca), cash-dialog-layouts.mjs (8 ca), script Kho warehouse-workspace.mjs được thử thêm nhưng dừng ngay ở fixture API với WAREHOUSE_BUSY (giao nhiều việc cho cùng người đang bận), trước khi mở Chromium. Backend/fixture/script Kho này không đổi trong PR; không tính đây là ca pass, không nới quy tắc giao việc để làm test xanh. Helper chung bổ sung kiểm tra biên dọc.

## Báo cáo tuần / tháng Sale

Mã hiện tại đã giữ submitted_at lần nộp chính thức đầu tiên và dùng mốc này xét đúng hạn, kể cả review=pending. Bản sửa không đổi công thức thưởng/phạt: đưa mốc nộp qua contract điểm và bản chụp mới, hiển thị "Nộp lần đầu" trên bảng duyệt/thẻ điểm; giải thích điểm chờ duyệt. Trường mới tùy chọn để đọc bản chụp cũ, không bịa giờ nộp cho dữ liệu cũ.

[Desktop](report-desktop.png) · [Điện thoại](report-mobile.png). Bộ browser kiểm tra 4 mốc nộp của bảng duyệt + thẻ điểm trên cả hai kích thước này.

Test API đồng hồ giả cho cả tuần/tháng: nộp đúng hạn, chờ duyệt nhiều ngày, nộp bổ sung sau hạn, duyệt muộn, Chưa đạt, lặp lại từ chối. Điểm giữ nguyên khi pending/ok, về 0 khi rejected; tiền trách nhiệm tạm tính giảm đúng một phần, không trừ lặp. Tất cả giữ giờ nộp đầu. Test snapshot cũ và phiếu đã chốt tiếp tục giữ bản lưu, không cập nhật tài chính ngược thời gian. Không migration hoặc sửa dữ liệu production.

Validation: 24 test domain/API/điểm-lương pass; 22 test kiến trúc/menu/bảo mật và tương thích điểm pass; typecheck, ui:build, JS syntax, git diff --check pass. CI toàn repo theo link trên PR.
