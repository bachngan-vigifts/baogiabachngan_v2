# Dòng gọn cho sản phẩm theo đơn và lịch giao hàng

## Hiển thị

- `#/order-products`: ảnh 24px bên trái, tên bên phải cùng hàng; tên dài có dấu ba chấm. Bỏ nhãn SKU phụ trong bảng, giữ tìm kiếm SKU và đầy đủ thông tin trong Chi tiết. Các ô khác cũng chỉ một hàng; title giữ nguyên nội dung dài.
- Màu và nhãn trạng thái lấy từ dữ liệu dòng/chuyến hiện có. Ưu tiên màu dòng: đã huỷ → đã giao đủ → quá hạn → giao một phần → có chuyến đang giao → chưa xếp đủ lịch → chưa giao. Bộ đếm/bộ lọc vẫn do API tính; một dòng có thể thuộc nhiều bộ lọc, màu ưu tiên không thay cách đếm.
- `#/deliveries`: áp dụng cho lịch ngày/tuần/tháng, danh sách chuyến và sản phẩm theo chuyến. Có chú giải màu bằng chấm màu + chữ. Quá hạn là cảnh báo, không thay trạng thái nghiệp vụ; chuyến giao lỗi có màu riêng khi chưa quá hạn.
- Số chuyến bấm được để xem chi tiết đầy đủ, gồm ảnh xác nhận, người/thời điểm xác nhận và nút gọi người nhận. Nút in giao hàng/đóng gói nằm cùng cột thao tác; giữ cơ chế kiểm tra quyền hiện có. Không thêm API, query, ghi dữ liệu hoặc quyền.
- Mobile: giữ hàng gọn, cuộn ngang bên trong bảng, ghim cột sản phẩm; không cuộn ngang toàn trang. Loại các bảng `.ff-table` khỏi cơ chế tự đổi bảng thành thẻ. Nút thao tác giữ vùng chạm ít nhất 44px. Vùng cuộn nhận focus bằng bàn phím.
- Không thêm dependency, backend hay migration. Tái sử dụng ảnh thu nhỏ, form xếp lịch, chi tiết chuyến và API hiện hành.

## Kiểm tra

Browser với CSDL test cô lập, UI/router/API thật: `scripts/testing/live-order-products.mjs` và `scripts/testing/delivery-calendar.mjs`, PC 1440px/mobile 390px. Có kiểm tra hình học ảnh trái/tên phải, không còn nhãn SKU phụ, tên bị cắt nhưng vẫn còn nguyên trong chi tiết, mỗi hàng ≤56px, trạng thái/chú giải, tìm không dấu, dòng trùng SKU, form xếp đúng dòng và lượng, các bộ lọc/ngày/tuần/tháng, nút nghiệp vụ cũ, không có lỗi JS hay tràn trang. Không truy cập hoặc ghi dữ liệu CRM thật.

Unit/API hồi quy: `tests/app/fulfilment-display.test.ts`, `fulfilment-ui.test.ts`, `delivery-slip-links-ui.test.ts`, `live-order-products.test.ts`, `pos-order-products.test.ts`, `delivery-calendar.test.ts`, `mobile-density-ui.test.ts`, `mobile-action-policy.test.ts` và `tests/architecture.test.ts`. Giữ quyền xem giá, phạm vi đơn/chuyến và cơ chế xác nhận tồn kho hiện có.

## Đo trước/sau

Chromium, context mới mỗi lượt, 3 lượt cho mỗi route và viewport, latency 40ms/download 1,6MB/s. Fixture giống nhau: 60 dòng tên dài, 20 chuyến, cùng API thật trên CSDL test; không có ảnh sản phẩm trong fixture hiệu năng (ảnh được kiểm tra ở browser flow riêng). Baseline là UI `e871d1b2`; đo bản sửa trước khi đồng bộ thay đổi Kho độc lập trên main. TTFB ở đây chỉ là HTML máy chủ local, không phải Supabase production. Không diễn giải dao động vài chục ms thành cải thiện tốc độ thật.

| Bản | Rộng | Route | Sẵn sàng ms | Load ms | TTFB ms | FCP ms | LCP ms | CLS | Cao dòng/sự kiện px | API |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Trước | 1440 | `order-products` | 3078 | 3089 | 3.6 | 580 | 3012 | 0.0085 | 164.0 | 15 |
| Trước | 1440 | `deliveries?view=list` | 3047 | 3052 | 5.5 | 608 | 3004 | 0.0170 | 178.5 | 15 |
| Trước | 1440 | `deliveries` | 2987 | 3039 | 2.5 | 592 | 2832 | 0.0021 | 73.0 | 15 |
| Trước | 390 | `order-products` | 3029 | 3042 | 3.3 | 608 | 2824 | 0.0860 | 444.6 | 15 |
| Trước | 390 | `deliveries?view=list` | 3041 | 3047 | 2.2 | 600 | 2992 | 0.0826 | 265.0 | 15 |
| Trước | 390 | `deliveries` | 2957 | 3022 | 3.0 | 596 | 2964 | 0.0693 | 28.0 | 15 |
| Sau | 1440 | `order-products` | 3084 | 3061 | 4.7 | 580 | 2844 | 0.0024 | 51.0 | 15 |
| Sau | 1440 | `deliveries?view=list` | 3039 | 3051 | 3.3 | 608 | 2840 | 0.0737 | 51.0 | 15 |
| Sau | 1440 | `deliveries` | 2989 | 3058 | 3.4 | 560 | 2844 | 0.0021 | 36.0 | 15 |
| Sau | 390 | `order-products` | 2981 | 3033 | 4.2 | 572 | 2804 | 0.0712 | 55.0 | 15 |
| Sau | 390 | `deliveries?view=list` | 3048 | 3060 | 3.3 | 596 | 2840 | 0.0681 | 55.0 | 15 |
| Sau | 390 | `deliveries` | 3005 | 3078 | 3.6 | 584 | 2824 | 0.0693 | 32.3 | 15 |

Thời gian sẵn sàng gần như giữ nguyên, không tăng API: 15 lượt lúc mở app, trong đó đúng 1 lượt API danh sách tương ứng. JS tăng khoảng 3,6KB. Các dòng tên dài được thu gọn rõ rệt; sự kiện lịch mobile vốn đã gọn nên vẫn ưu tiên vùng chạm. CLS danh sách chuyến desktop tăng trong phép đo nhưng vẫn dưới 0,1; không khẳng định mọi chỉ số đều tốt hơn.

Raw: `/tmp/compact-fulfilment-perf-{before,release}/results.json`. Tái lập với `node --import tsx scripts/testing/compact-fulfilment-perf.mjs <phase>`; `FULFILMENT_UI_DIR` chọn checkout UI; `PLAYWRIGHT_MODULE` chọn module browser cài sẵn. Không chạy test DB/browser khác song song khi đo.
