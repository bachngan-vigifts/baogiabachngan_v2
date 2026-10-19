# Barcode sản phẩm và camera POS

Manager vào **Sản phẩm → Cập nhật barcode từ file**. Nhập Excel XLSX/XLS hoặc CSV, chọn trang tính, bấm **Xem trước** rồi **Lưu barcode**. Có CSV mẫu gồm `SKU,Barcode`; nhận cả tên cột Mã hàng/Mã SKU/Mã sản phẩm và Mã vạch. Giữ hai cột dạng Text để giữ số 0 đầu và tránh Excel làm tròn mã dài. Mã số khoa học hoặc ô Number quá 15 chữ số bị chặn để xuất lại từ nguồn dạng Text. File tối đa 20 MB, 20.000 dòng; bảng xem trước tối đa 50 dòng, lỗi hiển thị số dòng của file.

Dùng `product_barcodes` hiện có; không thêm bảng/cột/migration/quyền. API `/admin/product-barcodes/preview` và `/apply` chỉ Manager, kiểm ở server. Preview chỉ đọc; apply có version và giao dịch toàn file. SKU không tồn tại, chưa hoạt động/duyệt, cùng barcode gắn hai SKU, barcode đã thuộc sản phẩm khác hoặc trùng SKU của sản phẩm khác đều chặn lưu. Dòng lặp cùng barcode/SKU được bỏ qua. Chỉ bổ sung alias barcode, giữ các barcode cũ dùng tiếp; không đổi giá, tồn, hay thông tin sản phẩm. Có audit số lượng, tên file và mẫu mappings theo giới hạn audit chung.

POS tìm/quét barcode khớp chính xác trước tìm theo tên. Nếu dữ liệu cũ có một mã vừa là SKU vừa là barcode của hai sản phẩm thì báo xung đột, không tự thêm nhầm hàng. API gắn barcode thủ công cũng chặn trùng SKU khác.

Trên điện thoại, **POS → Quét mã** mở camera sau, cần HTTPS và quyền Camera của trình duyệt. Ưu tiên BarcodeDetector khi có; Safari/iPhone thiếu API này dùng ZXing 0.1.5 được đóng gói tại CRM, tải khi cần. Khung hình được giải mã tại thiết bị, không gửi lên dịch vụ quét bên ngoài. Dừng camera khi đọc được mã, đóng popup, chuyển route hoặc gặp lỗi; đóng trong lúc chờ cấp quyền/tải bộ quét cũng giải phóng stream khi có. Lỗi từ chối quyền/không có camera/camera đang bận có hướng dẫn, vẫn nhập mã thủ công được.

Đã kiểm Chromium desktop/mobile bằng camera giả: đọc CSV giữ số 0, preview/apply, mở camera fallback và đóng/chuyển trang đều nhả camera. ZXing thực giải mã ảnh EAN-13 mẫu, test riêng lifecycle native/fallback và quyền camera bị từ chối. Chưa xác nhận bằng iPhone/Android vật lý hoặc nhập file barcode thật lên production.
