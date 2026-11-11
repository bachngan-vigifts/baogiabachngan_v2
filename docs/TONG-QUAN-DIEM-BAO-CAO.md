# KPI và báo cáo tuần / tháng trên Tổng quan

Trang `#/dashboard` dùng chung lựa chọn tháng và nhân viên cho KPI Sale và báo cáo. Danh sách người là hợp các projection đã được máy chủ lọc quyền từ `/dashboard/kpi` và `/dashboard/report-scores`, chỉ trong tháng hiện tại. Nhân viên Sale Admin chỉ có báo cáo vẫn chọn được; không lấy KPI của người khác để bù. Lọc nhóm/người/tháng bỏ dữ liệu cũ và bỏ qua phản hồi về sai thứ tự.

Bốn ô báo cáo: số tuần đã nộp / số tuần trong kỳ (không tính kỳ miễn trước triển khai), đúng hạn/trễ/chưa nộp/chưa tới hạn/miễn; trạng thái báo cáo tháng; số kỳ chờ duyệt; tổng điểm báo cáo do máy chủ trả. Chi tiết từng kỳ và hạn nộp nằm trong mục mở rộng; có lối tắt báo cáo tuần và tháng đúng kỳ. Miễn không bị tính vào số tuần còn chưa nộp.

Không cộng điểm báo cáo vào phần trăm KPI, không tính lại công thức lương hoặc quy tắc lấy bốn tuần cao nhất trên trình duyệt. Điểm đã chốt giữ đúng snapshot; snapshot cũ không có điểm hiển thị chưa có bản lưu, không giả 0 hoặc lấy điểm hiện tại. Không có dữ liệu mẫu trong UI production.

Không thêm API, truy vấn, thư viện hoặc migration; giữ các cổng kiểm tra và quyền máy chủ hiện có. Manager xem đúng phạm vi lọc; nhân viên chỉ nhận projection cá nhân, kể cả khi được quyền xem doanh số toàn công ty. Đổi người tái sử dụng dữ liệu đã tải, không gọi API thêm. KPI và báo cáo có lỗi/thử lại riêng; nút thử lại bỏ bộ đệm để thực sự lấy bản mới. Giữ chỗ cho dòng cập nhật và khối KPI đang tải; chiều cao tối thiểu Dashboard giữ khoảng chừa chat ngoài viewport đầu, đồng thời không cho flex co ngắn khối nội dung và đè vùng đệm lên nút chi tiết.

## Kiểm tra

- `tests/app/dashboard-report-summary.test.ts`: số kỳ nộp/duyệt, miễn, chưa tới hạn, snapshot thiếu, hợp danh sách đúng tháng.
- `tests/app/report-scores.test.ts`, `dashboard-kpi.test.ts`, `dashboard-kpi-layout.test.ts`, `tests/architecture.test.ts`: nguồn điểm/lương, phân quyền, dữ liệu riêng, snapshot lịch sử, KPI thực tế.
- `scripts/testing/dashboard-report-summary.mjs flows`: PC1440/mobile390, một lựa chọn người/tháng, Sale Admin không có KPI, lọc người, phản hồi cũ, KPI vẫn hiện khi báo cáo về chậm, lỗi/retry độc lập, không giả 0, không thêm API khi đổi người.
- `scripts/testing/report-scores.mjs`: Manager/Sale/Sale Admin PC/mobile, chi tiết điểm khớp phiếu lương, nháp/nộp/duyệt báo cáo tháng, snapshot và điểm khi chưa mở lương. `scripts/testing/dashboard-actual-kpi.mjs`: KPI thực tế không bị thay bởi KPI cố định trên lương.

## Đo hiệu năng khi ghép cụm KPI/báo cáo (PR #574)

Chromium, toàn bộ app/router thật và Postgres test cô lập; không dùng dữ liệu production. Mỗi viewport đo 3 context mới, latency40ms, download1.600.000 byte/s; không chạy test DB khác song song. Lấy trung vị. Mốc sẵn sàng: DOM đã có KPI và điểm báo cáo (chưa cần mở bảng chi tiết); quan sát thêm1,8s để lấy paint/CLS và số API. TTFB là HTML máy chủ test, không phải Supabase production. JS là encodedBodySize trên máy chủ test không nén.

| Giai đoạn | Rộng | Sẵn sàng ms | Load ms | TTFB ms | FCP ms | LCP ms | CLS | API | JS KB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Trước sửa | 1440 | 3126 | 3080 | 5.8 | 556 | 3124 | 0.1923 | 17 | 2393.8 |
| Trước sửa | 390 | 3052 | 2999 | 2.7 | 564 | 2980 | 1.1545 | 17 | 2393.8 |
| Bản cuối | 1440 | 3065 | 3044 | 5.3 | 600 | 3084 | 0.0612 | 17 | 2396.1 |
| Bản cuối | 390 | 3051 | 3004 | 3.0 | 580 | 2984 | 0.0193 | 17 | 2396.1 |

Thời gian sẵn sàng gần như giữ nguyên, số API không tăng. JS tăng khoảng2,2KB, không thêm thư viện. Không diễn giải các chênh lệch vài chục ms thành cải thiện tốc độ production; FCP có dao động riêng. LayoutShift sources xác định khoảng chừa chat, dòng cache/meta và một trạng thái co/giãn trung gian khi hai API trả lời lệch nhau; đã sửa đúng các vùng này, không giấu nội dung khỏi phép đo.

Raw: `/tmp/dashboard-report-summary-{baseline,release}/results.json`. Chạy lại: `node --import tsx scripts/testing/dashboard-report-summary.mjs baseline|release` với checkout tương ứng; dùng `DASHBOARD_UI_DIR` khi cần chỉ định thư mục UI. Browser cần Playwright/Chromium có sẵn hoặc đường dẫn `PLAYWRIGHT_MODULE`. Dữ liệu test chỉ ở fixture, không ghi vào CRM thật.


## Hiển thị sẵn cho Sale Admin và mặc định tháng này

- Tài khoản Sale Admin mở Tổng quan thấy ngay báo cáo tuần/tháng, không chờ hoặc gọi `/dashboard/kpi`. Sử dụng người dùng đăng nhập hiện có, không gọi API tra vai trò mới. Đây là chế độ trình bày; máy chủ vẫn giới hạn báo cáo cá nhân như trước.
- Manager chọn Sale Admin: ô chọn nhân viên có điểm báo cáo, số tuần đã nộp và trạng thái tháng thay cho nhãn chung “Báo cáo”. Không hiện thông báo chưa bật KPI; chi tiết từng tuần/tháng mặc định mở. Nếu người dùng đóng, lần vẽ lại cùng người/tháng tôn trọng lựa chọn đó.
- Kỳ ban đầu là tháng hiện tại theo Việt Nam, cả “Từ” và “Đến” cùng tháng; vẫn chọn được 3/6/12 tháng hoặc khoảng khác. Đổi tài khoản/quyền bỏ dữ liệu, bộ lọc và lựa chọn của người trước; nhân viên không giữ bộ lọc người/nhóm của Manager.
- Không mở KPI lương cho Sale Admin, không thay trọng số, điểm, lương hoặc quyền xem người khác. Báo cáo không yêu cầu đã có hồ sơ lương. Snapshot thiếu vẫn báo chưa có bản lưu, không giả 0. Không có migration hay thay đổi API/backend.

Browser đã kiểm tra Manager/Sale/Sale Admin PC/mobile, Sale Admin chưa có hồ sơ lương, mặc định tháng này, các mốc 3/6/12 tháng, đóng/mở chi tiết, retry và đổi từ Manager sang Sale Admin trong cùng tab. `/dashboard/report-scores?from=2026-11&to=2026-11&owner=người_khác` vẫn trả 403 cho Sale Admin. Các ca chỉ dùng CSDL test cô lập.

Đo riêng điểm vào Tổng quan của Sale Admin: 3 context mới mỗi viewport, cùng điều kiện latency40ms/download1,6MB/s như trên; không chạy test DB khác song song. Trước mặc định 6 tháng, sau mặc định tháng hiện tại theo yêu cầu: đây là so sánh trải nghiệm mở trang, không phải benchmark hai truy vấn cùng phạm vi. Lấy trung vị:

| Sale Admin | Rộng | Sẵn sàng ms | Load ms | TTFB ms | FCP ms | LCP ms | CLS | API | JS KB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Trước | 1440 | 3056 | 3042 | 3.7 | 588 | 3224 | 0.1179 | 14 | 2396.8 |
| Trước | 390 | 3034 | 2991 | 2.3 | 592 | 2972 | 0.2669 | 14 | 2396.8 |
| Sau | 1440 | 3013 | 3014 | 3.8 | 592 | 3208 | 0.0166 | 13 | 2399.4 |
| Sau | 390 | 2984 | 2974 | 2.5 | 572 | 2928 | 0.0292 | 13 | 2399.4 |

Lượt gọi giảm 14→13 do bỏ KPI lương không dùng. JS tăng khoảng2,6KB, không thêm thư viện. Tốc độ sẵn sàng gần như giữ nguyên; CLS giảm sau khi giữ chỗ cho bảng báo cáo đang tải và ổn định heading mobile. TTFB chỉ là HTML của máy chủ test, không phải Supabase production. Raw `/tmp/dashboard-report-summary-sale-admin-{before,after}/results.json`. Chạy lại với `DASHBOARD_PERF_ROLE=sale-admin` và phase tương ứng.
