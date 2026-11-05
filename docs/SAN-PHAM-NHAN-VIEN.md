# Sản phẩm mới, xoá nhân viên, font chữ

## Thêm sản phẩm trên web (trang Sản phẩm, nút ＋ xanh)
- Nhập SKU (chữ, số, `. _ - /`, tối đa 64 ký tự), tên, thương hiệu, ĐVT, mẫu, link ảnh (https), giá theo từng bảng giá.
- Manager thêm → có hiệu lực ngay. Nhân viên thêm → "Chờ duyệt": `active = false`, không có trong danh mục khi lập báo giá.
- Khung "Sản phẩm chờ Manager duyệt" ở đầu trang: Manager bấm Duyệt / Từ chối; nhân viên thấy và xoá được sản phẩm mình gửi.
- API (`src/modules/catalog/api/product-admin.ts`): `GET /product-approvals`, `POST /products`, `POST /products/:sku/approve` (Manager), `DELETE /products/:sku` (chỉ sản phẩm chờ duyệt; Manager hoặc người tạo).
- Nhập danh mục / đồng bộ Sapo luôn ghi `approved`. Nhập danh mục kiểu "thay toàn bộ" không ẩn sản phẩm thêm trên web.

## Thuế sản phẩm khi thêm / cập nhật

- Form **Thêm sản phẩm** và **Cập nhật sản phẩm** có ô **Thuế sản phẩm (VAT)**: chọn **8%** hoặc **10%**. Sản phẩm mới mặc định 8%.
- Khi sửa, form hiển thị mức đã lưu. Sản phẩm cũ chưa áp dụng thuế hoặc có mức khác được giữ nguyên cho đến khi người dùng chọn 8%/10%; chỉ sửa tên, ảnh hoặc giá không tự đổi thuế.
- API nhận `taxRate` là số 8 hoặc 10, lưu vào trường thuế đầu ra có sẵn (`taxOut`, `taxable = true`). Khi cập nhật không gửi `taxRate`, giữ nguyên thuế. Không cần migration.
- Việc chọn thuế không tự tính lại bảng giá, không đổi thuế đầu vào, tồn kho hoặc chứng từ đã lập. Quy tắc đồng bộ thông tin sản phẩm từ Sapo vẫn giữ nguyên.

## Xoá nhân viên (trang Nhân viên, nút thùng rác)
- `DELETE /admin/members/:id` (Manager). Nhân viên bị đăng xuất mọi thiết bị, không đăng nhập được, biến khỏi danh sách và danh bạ chat.
- Dòng dữ liệu được giữ lại (`deleted_at`) để báo giá, đơn… cũ vẫn hiện đúng tên. Email được giải phóng nên tạo lại tài khoản bằng email đó được.
- Không xoá được chính mình hoặc tài khoản khách (tài khoản khách quản lý ở trang Khách hàng).

## Font chữ
- Toàn bộ giao diện dùng một font: **Be Vietnam Pro** (Google Fonts, hỗ trợ đủ dấu tiếng Việt), biến `--font` trong `style.css`. Tiêu đề trang không còn dùng font serif.
- Mẫu in (báo giá, đơn đặt hàng, hợp đồng) giữ font của văn bản in (Times New Roman / Arial).
- Mọi chuỗi hiển thị đi qua `esc()` được chuẩn hoá Unicode NFC, tránh dấu tách rời khi dữ liệu nhập từ nguồn khác.


## Các thao tác trên trang Sản phẩm
- Nút **Thêm sản phẩm** có tên rõ ràng; quy trình thêm/duyệt giữ nguyên.
- Manager có 4 nút: **Giá trị tồn kho**, **Kiểm tra dữ liệu**, **Cập nhật quy cách Lock từ file**, **Cập nhật tồn kho từ file**.
- Giá trị tồn tính trên toàn bộ sản phẩm đang dùng, theo bảng giá chọn trong hộp thoại, chỉ cộng tồn dương tại kho thực. Tồn NCC/hàng chờ về và SKU chưa có giá không vào tổng; giá 0 là hợp lệ. Không cộng thêm VAT.
- Kiểm tra dữ liệu đếm SKU thiếu quy cách, thiếu giá theo bảng chọn, tồn âm và không có tồn dương ở kho thực; mỗi nhóm hiển thị tối đa 50 dòng. Có tra cứu SKU và lịch sử giao dịch; hiện thông tin file tồn nhập gần nhất.
- Nhập Excel XLSX/XLS/CSV bằng SheetJS **0.20.3** đóng gói tại `trial-ui/xlsx.full.min.js`, dùng lại từ web báo giá cũ; tải file mẫu Excel trong hộp thoại. Không gửi file gốc ra bên ngoài.
- Chọn trang tính, dòng tiêu đề và cột dữ liệu. Bỏ qua dòng ẩn; giữ SKU có số 0 ở đầu trong CSV. Tối đa 20 MB/file, 5.000 mã/lượt.
- Tồn: ô trống giữ nguyên, số 0 cập nhật về 0, số lẻ làm tròn gần nhất, mã trùng giữ số tồn lớn nhất từng kho. Chọn kho nhận cột Tồn (mặc định NCC) hoặc gán riêng các cột kho. Không đổi giá/ảnh/quy cách.
- Quy cách Lock: khớp SKU thuộc Lock, QTY/BOX là SP/thùng, G.W là kg/thùng, chọn mm hoặc cm cho kích thước (mặc định mm → cm). Ô trống/0 giữ nguyên, SKU trùng hoặc SP/thùng lẻ bị từ chối. Không đổi giá/ảnh/tồn.
- Xem trước không ghi dữ liệu. Chỉ nút **Xác nhận cập nhật** ghi sau khi có mã khớp. Nếu danh mục/tồn hoặc nội dung file đổi sau xem trước thì API trả 409, yêu cầu xem trước lại. File tồn cũ hơn lần nhập gần nhất của các kho nhận bị từ chối.
- API quản trị (`product-actions.ts`) kiểm tra Manager phía máy chủ; nhập mỗi lượt trong một giao dịch, lưu `stock_imports`/`stock_import_lines` hoặc `product_edits`. Các bảng đã có, không cần migration.


Manager có thêm **Cập nhật barcode từ file** (Excel/CSV, xem trước rồi lưu). Quy tắc mã trùng, file mẫu và quét camera POS xem [Barcode và camera](BARCODES.md).
