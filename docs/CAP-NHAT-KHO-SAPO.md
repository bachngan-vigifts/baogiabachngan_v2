# Cập nhật kho bằng file xuất Sapo

Trang Sản phẩm → **Cập nhật kho**, chỉ Manager (UI và endpoint admin).

1. Bấm **Mở Sapo để tải file**; đăng nhập Sapo như thường lệ. Xuất riêng KHO VIGIFTS, Hoá đơn Lock, Hoá đơn Bách Ngân, giữ hai cột **Mã hàng, Tồn**.
2. Chọn ít nhất một file .xlsx/.xls/.csv; nguồn không cập nhật được để trống. Với từng file đã chọn, chọn trang tính/dòng tiêu đề, hai cột và kho CRM nhận dữ liệu.
3. Nhập thời điểm số liệu trên Sapo, bấm **Xem trước**. Xem kho nhận, tồn cũ và tồn mới. Nếu hai nguồn hoá đơn cùng chọn một kho, hai nguồn được cộng trước khi thay tồn kho đó. Không cộng vào tồn cũ.
4. Bấm **Xác nhận cập nhật kho**. Trang Sản phẩm và danh mục dùng trong báo giá được tải lại.

Tồn CRM lấy trực tiếp từ cột **Tồn**, cho phép âm và số lẻ. Giữ nguyên mã 0 đầu; SKU Excel có định dạng zero-padding được giữ theo hiển thị. CSV nên lưu mã dạng chữ. Không làm tròn số lượng. Mã trùng trong cùng file, ô số trống hoặc số không hợp lệ đều chặn trước khi nhập; dòng ẩn bỏ qua. Số 0 được ghi về 0. Mã không có/không xác định được liệt kê, không tự tạo sản phẩm mới. Mã không có trong file giữ nguyên.

Tối đa 20 MB/file, 50.000 mã cho cả lượt; các file đã chọn được gộp vào một transaction. Server kiểm lại kho đang hoạt động và kind=stock, SKU, phiên bản xem trước và thời điểm file. Tồn NCC, hàng chờ về, giá, ảnh, thông tin sản phẩm, sổ kho/giữ hàng không bị sửa. Nút “Nhập file tồn khác” và nhập quy cách Lock giữ luồng cũ (5.000 mã).

`POST /api/staff/admin/products/import/sapo-stock/preview|apply`: rows có `stock` theo warehouseId. Apply dùng version từ preview; khoá nhập file trong transaction và khoá sản phẩm. Dữ liệu đổi hoặc bấm lại request đã dùng phải xem trước lại. Lịch sử `stock_imports` lưu tên file, người nhập, thời điểm số liệu; `stock_import_lines.quantity` là số Tồn được nhập trực tiếp, hai cột lịch sử nullable `on_hand` / `committed` để null.

Migration **0065_stock_import_transactions.sql** chỉ thêm hai cột nullable vào bảng lịch sử có sẵn; không sửa RLS, grants, bảng số dư hoặc dữ liệu nghiệp vụ cũ. Chạy trước khi deploy API mới. Không lưu mật khẩu/cookie Sapo vào trình duyệt CRM; nút mở trang Sapo, file được người dùng tải và chọn để nhập. Chưa kiểm chứng định dạng file xuất thực tế của ba nguồn; có chọn cột thủ công nếu tiêu đề khác.

Kiểm thử: `tests/app/sapo-stock-file.test.ts` (parser, Excel/CSV thật, API/quyền/transaction/audit/chống file cũ), `tests/app/product-actions.test.ts` (luồng tồn/quy cách cũ).
