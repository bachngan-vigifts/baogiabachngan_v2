# Sản phẩm theo đơn và lịch giao mẫu

Không tạo thêm trang Lịch giao hàng trùng chức năng. `#/deliveries` giữ danh sách chuyến thật, thêm tab **Lịch mẫu** tại `#/deliveries?view=calendar`. Trang mới `#/order-products` là bảng tổng hợp mẫu theo dòng sản phẩm, khác danh mục sản phẩm và chi tiết một đơn.

Cả hai thuộc nhóm Bán hàng trên PC/mobile. Mục lịch cũ được chuyển từ Kho, giữ route và quyền `page.deliveries`; sản phẩm theo đơn dùng quyền `page.orders`. Năm mục bán hàng đầu mobile giữ nguyên. Kho vẫn thấy lịch theo quyền đã có, không nhận thêm quyền đơn hàng/giá.

## Phạm vi mẫu

- Dữ liệu giả dùng chung ở `order-shipment-demo-data.js`, không gọi API ghi. Tên/mã đơn có chữ MẪU, ID bắt đầu `demo-`, không mở chứng từ thật.
- Một dòng là một dòng đơn, không gộp theo SKU. Số đặt/đã giao/còn lại tính từ liên kết dòng–chuyến mẫu; giao nhiều đợt không đánh dấu cả dòng hoàn tất sớm. Tiến độ sản xuất ghi rõ theo đơn.
- Tìm kiếm không dấu, lọc nhân viên, trạng thái; xem chi tiết và các đợt giao của dòng. Không cộng số lượng khác đơn vị.
- Lịch Tháng/Tuần/Ngày/Danh sách, thứ Hai đầu tuần. Mobile mặc định Danh sách; lịch lưới thể hiện số chuyến, chạm ngày xem chi tiết. Một sự kiện là một chuyến có nhiều sản phẩm, không nhân thành sự kiện cho từng SKU.
- Tạo lịch thử giới hạn lượng chưa xếp, kiểm tra ngày; cập nhật bộ dữ liệu trong phiên trình duyệt và thông báo rõ chưa lưu CRM. Không có xác nhận giao thật, trừ tồn, đổi trạng thái đơn hoặc gọi số điện thoại giả.
- Danh sách chuyến thật và các nút nghiệp vụ cũ giữ nguyên. Màn mẫu không được dùng làm lịch điều hành thật.

## Nối dữ liệu thật ở PR riêng

Cần API tổng hợp dòng hàng với phân trang, bộ lọc và tổng phía máy chủ; mở rộng dữ liệu lịch nếu cần sản phẩm/chuyến POS. API hiện tại `/deliveries` giới hạn 500 và loại POS, vì vậy không thể dùng bản mẫu để khẳng định đã có lịch đầy đủ. Tôn trọng quyền xem đơn/giá; không tải riêng từng đơn để ghép bảng. Đổi lịch/xác nhận giao phải dùng chứng từ và kiểm tra tồn hiện có.

## Kiểm tra

Unit: `tests/app/order-shipment-demo.test.ts`, `tests/app/mobile-nav-order.test.ts`. Trình duyệt local với dữ liệu giả: `node --import tsx scripts/testing/order-shipment-demo.mjs`, viewport 390px và 1440px. Không truy cập hay ghi dữ liệu production.
