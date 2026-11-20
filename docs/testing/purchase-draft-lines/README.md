# Thêm/bớt sản phẩm khi sửa đơn mua nháp

Mở đơn mua còn nháp → **Sửa nháp**. Dòng hàng có nút **Bỏ sản phẩm** và ô số lượng. Dưới danh sách có **Thêm sản phẩm vào đơn nháp**: tìm theo mã/tên trong danh mục hoặc nhập mã, tên, ĐVT, số lượng thủ công, bấm **Thêm sản phẩm** rồi **Lưu nháp**.

Thay đổi chỉ nằm trong form cho đến khi lưu. Tối đa 300 SKU khác nhau, không phân biệt hoa/thường; phải còn ít nhất một SP. Số lượng nguyên 1–10.000.000. Giữ số 0 đầu SKU. Dòng thêm trực tiếp không tự gắn chứng từ; dòng cũ giữ nguồn và giảm phần liên kết theo số lượng mới. Nút bỏ luôn hiện trên thẻ sản phẩm ở điện thoại, không cần kéo ngang tới cột cuối.

API vẫn chỉ cho người tạo hoặc Manager sửa đơn còn nháp, kiểm tra phiên bản và nguồn trong transaction. Khi gửi thiếu trường giá/VAT, giữ giá/VAT cũ; giữ CK mua đã lưu. Nhân viên không có quyền giá không sửa được các trường ẩn bằng payload giả. Dòng mới chưa có giá vẫn để trống để nhập ở bước kiểm tra giá. Không thay đổi đơn đã duyệt/nhận, không phát sinh tồn kho hoặc gửi NCC khi sửa nháp.

Không cần migration. Có thay đổi API để bảo toàn giá khi lưu; triển khai API và UI theo luồng hiện có.

Kiểm thử mới: purchase-draft-lines-ui (thêm/bỏ, nguồn khi giảm SL, không sửa bản detail trước lưu, mã trùng, SL lẻ, đơn trống); purchase-draft-lines (lưu đúng dòng, bảo toàn giá/VAT/CK, chặn giả giá, sai quyền, version cũ và đơn đã duyệt). Hồi quy purchase-product-lookup, purchase-order-number-ui, purchasing. Chromium fixture 390/1280px dùng mã 0002: tìm danh mục, thêm, bỏ dòng cũ, lưu payload đúng và không tràn ngang. Không ghi dữ liệu production.
