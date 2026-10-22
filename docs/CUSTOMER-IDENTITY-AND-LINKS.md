# Liên kết chi tiết và chống trùng khách

## Liên kết trong đơn / HĐKT

Tên khách liên kết theo `customerId` tới hồ sơ khách nếu người xem được vào trang khách. Tên sản phẩm có SKU liên kết tới `#/products?sku=...`, mở thẻ tồn kho/lịch sử sản phẩm hiện có; giữ nguyên SKU (kể cả số 0 đầu hoặc ký tự đặc biệt). Khoản phí và dòng không có SKU giữ dạng chữ. Không suy đoán khách theo tên khi đơn không có customerId.

## Kiểm tra trùng

Tạo/sửa khách trong danh bạ và POS kiểm tra **bất kỳ** MST, SĐT hoặc tên trùng sau chuẩn hoá:

- MST bỏ khoảng trắng/dấu chấm, không phân biệt hoa thường; giữ mã chi nhánh. Rỗng hoặc toàn số 0 không coi là định danh.
- SĐT bỏ ký tự trình bày, nhận cùng số dạng 0…, +84… và 0084…; hỗ trợ nhiều số ngăn bởi dấu phẩy/chấm phẩy/gạch chéo. Rỗng, toàn số 0 hoặc quá ngắn không coi là định danh.
- Tên bỏ dấu tiếng Việt, chuẩn hoá hoa/thường, dấu câu và khoảng trắng rồi so khớp chính xác. Không dùng so khớp gần đúng để tự gộp các tên tương tự.

Form hiện cảnh báo với hồ sơ trùng và cho chọn hồ sơ sẵn có. Máy chủ kiểm tra lại khi lưu, dưới cùng một transaction advisory lock cho danh bạ/POS/đồng bộ Sapo/nhập khách lẻ, tránh hai người tạo cùng lúc. Nhập Sapo bỏ qua bản mới/định danh mới gây trùng, có đếm `duplicates`; nhập khách lẻ vẫn chỉ thêm và không ghi đè. Tôn trọng phân quyền khách lẻ, khách chờ duyệt và quyền chọn trong POS.

Hồ sơ trùng cũ không bị gộp/xoá. Sửa thông tin khác vẫn được nếu định danh chuẩn hoá không đổi; đổi sang định danh trùng mới bị chặn. Không đổi liên kết chứng từ hay công nợ. Không migration hoặc thao tác dữ liệu production.

## Kiểm tra

Typecheck; PostgreSQL/API cho tạo/sửa/đồng thời CRM–POS, mã cũ/khách trùng có sẵn, Sapo, nhập khách lẻ, phân quyền; regression customers/customer-duplicates/customer-discounts/retail-customers/pos-customer-form/order-line-details. Chromium: link đúng ID/SKU, ký tự đặc biệt và text an toàn, cảnh báo debounce/chống phản hồi cũ, chọn khách không submit nhầm.
