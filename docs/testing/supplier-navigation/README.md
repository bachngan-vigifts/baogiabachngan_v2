# Cổng NCC, liên kết phiếu và lọc danh mục POS

Một PR gồm 4 yêu cầu, từ main `4b4dc12`.

1. Cổng NCC có nút quay về. Manager có link tên SP → thẻ tồn/lịch sử CRM, số đơn CRM/NCC → đơn mua, số phiếu → trang Lấy hàng trước. Dưới trạng thái là nút Xem chi tiết: tab toàn bộ đơn mua của NCC trên phiếu, phiếu xin hàng (đi hết phân trang), tồn các mã trên phiếu. Đóng hoặc bấm liên kết không giữ dialog che trang mới. NCC thật không có chức năng/truy vấn này; quyền API giữ nguyên theo xác nhận của chủ repo.
2. Tiêu đề nhóm `NCC: DDLT...` ở CRM mở thẳng đơn mua. Nếu cùng số NCC có nhiều đơn CRM thì hiện riêng từng mã đơn để chọn; không chọn nhầm một đơn mặc định.
3. Cột Đã nhận trên từng dòng hàng đơn mua hiển thị **nhận đạt** (`good`) đã có từ API. Bấm số mở những phiếu xin hàng có `receivedQty > 0` đúng SKU và orderId. Không dùng số xin/đồng ý thay số thực nhận. Phần nhận thường/nhập cũ không có provenance được ghi rõ; nhận bị huỷ không được liệt kê khi API trả receivedQty=0. Không đổi cách nhận, tồn kho hoặc tính số lượng.
4. POS: quầy Lock ẩn nhóm Minh Long/LYS/Healthy Cook/sứ dưỡng sinh; quầy Minh Long ẩn Lock/LocknLock/Lock&Lock. Dựa trên tên quầy rõ ràng và nhãn hàng/tên SP. Tên quầy chung hoặc chưa xác định, sản phẩm dùng chung/chưa nhận diện giữ như cũ. Lọc trong truy vấn catalog **trước limit/offset**, cả barcode và skus; xem thêm/trang tiếp và Tìm tất cả SP không đưa lại nhãn hàng đối diện. Preview gõ tìm dùng cùng hàm/pattern được build; cache tách theo quầy/bảng giá, gắn request cũ đúng quầy khi đổi quầy trong lúc tải. Không xoá dòng giỏ đang có hoặc đổi quyền checkout.

Không thêm endpoint, tham số API, schema, dependency hoặc quyền. Có thay WHERE của endpoint POS catalog hiện có để thực hiện yêu cầu lọc theo quầy; không thay công thức tiền/thuế/CK, trừ tồn, Sapo/GHN/cron. Các chức năng Manager dùng endpoint staff hiện có, NCC thật vẫn được server chặn truy cập dữ liệu nội bộ.

## Validation

- Typecheck, UI build, diff check đạt; [87 test liên quan đạt](tests.txt), gồm catalog filter trước phân trang, barcode bị ẩn không còn exactSku; hydration đúng SKU; preview không chớp nhãn hàng khác lúc đang tải; scope/quyền quầy và tồn giữ nguyên; early request/receiving API và UI.
- Browser router thật + PGlite: Manager/NCC ở 390/1280px; back, link đơn từ tiêu đề, 3 tab chi tiết, số thực nhận 4 với liên kết phiếu nguồn; bấm phiếu đóng dialog và điều hướng đúng. NCC không có truy vấn purchase-orders/products. Không tràn trang hoặc pageerror; browser không ghi dữ liệu nghiệp vụ. Chỉ fixture local được seed/nhận thử, không gọi production.
- POS browser regression: cuộn chạm grid → giỏ, phân trang/retry, chọn khách, resize desktop/mobile. 375x667,390x844,768x1024,844x390 và desktop.

[Manager 390](portal-mgr-390.png) · [Manager 1280](portal-mgr-1280.png) · [Đơn mua](detail-orders-390.png) · [Tồn](detail-stock-390.png) · [Đã nhận 390](received-390.png) · [Đã nhận 1280](received-1280.png) · [NCC thật](portal-ncc-390.png).

Dừng ở PR để chủ repo duyệt; không merge/deploy.
