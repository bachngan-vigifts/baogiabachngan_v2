# Báo giá Sale và tổng hợp báo giá cho nhân viên

Tạo mới có bốn lựa chọn HRC, B2B, Vigifts, **Báo giá Sale**. Mẫu Sale dùng hồ sơ trình bày `template: sale` trong JSON báo giá và giữ kiểu tính tiền B2B có phí in. Đơn hàng/HĐKT tiếp tục dùng các loại chứng từ hiện hành; không cần migration hay thay đổi quyền truy cập báo giá.

## Thao tác

1. Chọn **Báo giá Sale**, điền khách hàng, ngày, điều khoản và thêm sản phẩm. Số tự sinh có tiền tố `SALE_BG`.
2. Bảng gồm đúng tám cột: STT, hình ảnh, tên sản phẩm, SL, giá bán trung bình (đề xuất), giá bán, phí in, thành tiền. Nút xoá nằm trong ô STT. Ảnh danh mục không được tự coi là thiết kế.
3. Bấm ô hình để tải ảnh hoặc gắn đường dẫn HTTPS cho thiết kế của từng dòng. File tải lên nằm trong kho riêng tư hiện có, được ký link khi người có quyền mở báo giá. Bản lưu giữ khoá file, không giữ token/link hết hạn. Thay thiết kế của một báo giá không sửa ảnh danh mục hay báo giá khác.
4. Có thể **lưu nháp** thiếu ảnh. Gửi duyệt, duyệt, xuất file yêu cầu đủ ảnh. Manager lập báo giá thiếu ảnh cũng chỉ tạo nháp; bỏ ảnh ở bản đã duyệt/chờ duyệt đưa bản đó về nháp. Không áp dụng chốt ảnh này cho HRC/B2B/Vigifts cũ.
5. Sau khi duyệt, menu tải có **PDF cho Sale (8 cột)** và **Excel cho Sale (8 cột)**. PDF A4 ngang, font tiếng Việt và lặp tiêu đề khi phân trang. Excel một sheet với tám cột, ảnh nhúng và ô số; không có dữ liệu riêng tư nằm trong cột/sheet ẩn. File thiếu ảnh thiết kế không được xuất thành bản trắng ảnh.

Giá bán là giá thực tế chưa VAT, không có chiết khấu ẩn ở mẫu Sale. Phí in là giá in bán cho khách trên một sản phẩm. Thành tiền = SL × (giá bán + phí in). VAT và tổng thanh toán vẫn theo bộ tính hiện hành.

## Giá tham khảo

Bình quân gia quyền theo số lượng của cùng SKU trong sáu tháng gần nhất theo ngày đơn, chưa VAT và phí in, trong phạm vi đơn người xem được phép đọc. Manager có phạm vi toàn công ty theo quyền hiện hành. Không đưa chi tiết đơn/khách hàng hay giá vốn vào API gợi ý.

Nguồn là `sales_order_lines`: POS/web dùng đơn giá thuần đã chụp; CRM dùng giá niêm yết chụp trên đơn trừ tiền CK chụp trên dòng để tách phí in. Dòng CRM cũ thiếu ảnh chụp giá niêm yết không được đoán từ báo giá đang sửa. Bỏ đơn huỷ/nháp chưa đủ điều kiện; HĐKT ký hợp lệ được tính một lần qua đơn gốc. Trừ số lượng trả đã có hiệu lực công nợ, không trừ hàng mới nhận hoàn vật lý nếu chưa phát sinh giảm công nợ.

Thiếu lịch sử hiện **Chưa đủ lịch sử**, không dùng 0 thay cho giá chưa biết. Giá gợi ý không tự ghi vào giá bán. API chỉ đọc, truy vấn theo lô SKU có giới hạn và giữ phạm vi quyền trong SQL. Chỉ tải gợi ý khi dùng mẫu Sale hoặc chủ động xuất file; không chạy trên trang chủ. Danh sách SKU dài được chia lô giới hạn URL và chỉ có một truy vấn gợi ý đang chạy trong trình soạn.

## Bảng tổng hợp cho nhân viên

Nhân viên được mở **Xem tổng hợp báo giá** trên báo giá có quyền xem. Bảng hiện doanh thu trước VAT, tổng CK khách của bản đã lưu (chỉ xem), cước dự toán và bên thanh toán cước. Khi đang sửa, CK khách có nhãn **bản đã lưu**; lưu thành công sẽ nhận tổng mới từ máy chủ.

Giá nhập, CK mua vào, chi phí in gia công, lợi nhuận gộp, tỷ lệ lợi nhuận và các điều khiển sửa những dữ liệu này vẫn chỉ Manager. API nhân viên tiếp tục bỏ các trường chi phí/hoa hồng từng dòng; chỉ bổ sung tổng CK khách cần cho bảng này. Nhân viên gửi dữ liệu giá vốn hay sửa tổng CK khách không làm thay đổi dữ liệu Manager đã lưu.

## Kiểm chứng

- `tests/app/sale-quote-template.test.ts`: nháp/duyệt/ảnh riêng tư/phạm vi/giá lịch sử/giảm công nợ/bảng tổng hợp.
- `tests/app/sale-quote-export.test.ts`: đọc lại XLSX thật, font tiếng Việt, phân trang tên dài, ảnh nhúng và giữ đúng tiền.
- `tests/app/quote-paste.test.ts`: nhập SKU/SL không kéo ảnh danh mục hay CK ẩn vào mẫu Sale.
- `scripts/testing/sale-quote-layout.mjs`: trình duyệt với router CRM và PGlite, bốn kích thước 390/768/1280/1920.
- `scripts/testing/sale-quote-exports.mjs`: xuất từ ba mẫu cũ trên máy tính/điện thoại.
- `docs/testing/sale-quote-exports-browser.json`: bằng chứng tổng hợp bằng dữ liệu giả.

Không truy vấn hay sửa DB production để kiểm thử. Chưa đo tải production; số liệu giá tham khảo có phạm vi quyền và nguồn thiếu được ghi rõ trên giao diện.
