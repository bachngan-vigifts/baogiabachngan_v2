# Sản phẩm mới, xoá nhân viên, font chữ

## Thêm sản phẩm trên web (trang Sản phẩm, nút ＋ xanh)
- Nhập SKU (chữ, số, `. _ - /`, tối đa 64 ký tự), tên, thương hiệu, ĐVT, mẫu, link ảnh (https), giá theo từng bảng giá.
- Manager thêm → có hiệu lực ngay. Nhân viên thêm → "Chờ duyệt": `active = false`, không có trong danh mục khi lập báo giá.
- Khung "Sản phẩm chờ Manager duyệt" ở đầu trang: Manager bấm Duyệt / Từ chối; nhân viên thấy và xoá được sản phẩm mình gửi.
- API (`src/modules/catalog/api/product-admin.ts`): `GET /product-approvals`, `POST /products`, `POST /products/:sku/approve` (Manager), `DELETE /products/:sku` (chỉ sản phẩm chờ duyệt; Manager hoặc người tạo).
- Nhập danh mục / đồng bộ Sapo luôn ghi `approved`. Nhập danh mục kiểu "thay toàn bộ" không ẩn sản phẩm thêm trên web.

## Xoá nhân viên (trang Nhân viên, nút thùng rác)
- `DELETE /admin/members/:id` (Manager). Nhân viên bị đăng xuất mọi thiết bị, không đăng nhập được, biến khỏi danh sách và danh bạ chat.
- Dòng dữ liệu được giữ lại (`deleted_at`) để báo giá, đơn… cũ vẫn hiện đúng tên. Email được giải phóng nên tạo lại tài khoản bằng email đó được.
- Không xoá được chính mình hoặc tài khoản khách (tài khoản khách quản lý ở trang Khách hàng).

## Font chữ
- Toàn bộ giao diện dùng một font: **Be Vietnam Pro** (Google Fonts, hỗ trợ đủ dấu tiếng Việt), biến `--font` trong `style.css`. Tiêu đề trang không còn dùng font serif.
- Mẫu in (báo giá, đơn đặt hàng, hợp đồng) giữ font của văn bản in (Times New Roman / Arial).
- Mọi chuỗi hiển thị đi qua `esc()` được chuẩn hoá Unicode NFC, tránh dấu tách rời khi dữ liệu nhập từ nguồn khác.
