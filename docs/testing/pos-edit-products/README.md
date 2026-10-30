# Sửa sản phẩm đơn POS và bố cục chi tiết đơn

## Hành vi

- Form sửa POS có tìm tên/SKU/barcode, nút Tìm và danh sách kết quả bấm để thêm. Dùng đúng quầy và chính sách giá của bill gốc; thêm cùng SKU thì tăng SL thay vì tạo dòng trùng. Có nút × xoá từng dòng, không lưu đơn rỗng.
- Manager được thêm/xoá khi COD chưa thu, chưa xuất/giao, chưa có vận đơn GHN, không thuộc đơn cọc/trả trước, không có phiếu đóng gói/HĐKT còn hiệu lực và tối đa một chuyến chờ giao toàn bộ. Giữ các ràng buộc hiện có, kiểm tra lại tại server trong transaction.
- SKU mới đọc tên, ĐVT, giá mặc định và cấu hình VAT từ catalog/chính sách gốc tại server; không tin tên/VAT gửi từ trình duyệt. Kiểm giá, SL, CK, tồn thật sau giữ hàng; giới hạn 150 dòng, chặn SKU trùng/ID giả hoặc đổi SKU trên ID cũ.
- Giữ ID dòng còn lại, cấp ID cho dòng mới, sửa liên kết dòng của chuyến chờ giao. Tính lại voucher, tổng tiền, công nợ, COD và snapshot; giữ phí ship/dịch vụ. Không ghi xuất kho hay thu tiền. Có revision và audit trước/sau, lý do bắt buộc.
- Không xoá dòng đang được chứng từ giao/đóng gói lịch sử tham chiếu. Chặn cả lịch sử đã rời kho dù trạng thái chuyến đã bị đặt lại. Đơn có GHN/đã thu/xuất cần xử lý theo luồng huỷ/thu hồi/đổi trả hoặc lập lại đơn, không thay mã riêng trên CRM.
- Trong lúc lưu, khoá form và nút Huỷ/Lưu để tránh thay đổi thêm hoặc gửi trùng. Trên điện thoại, sản phẩm là thẻ có tên và nút xoá, không cần cuộn ngang.

Bố cục chi tiết đơn (chung trang đơn/HĐKT):

| Hàng | Trái | Phải |
| --- | --- | --- |
| Đầu | Khách hàng | Đơn hàng / HĐKT |
| Giữa | Hàng trong đơn (toàn chiều ngang) | |
| Dưới | Lịch giao hàng / đóng gói | Công nợ |
| Cuối | Hoá đơn | Thanh toán |

Điện thoại xếp theo thứ tự DOM tương ứng. Không thay đổi dữ liệu do di chuyển thẻ.

## Kiểm tra

- `pos-order-products.test.ts`: thêm/xoá với lịch giao/công nợ/snapshot, ID ổn định, không phát sinh stock_moves; SKU sai/trùng/không hoạt động/thiếu tồn và đơn rỗng rollback; chính sách không VAT; voucher %/cố định và phí ship; GHN và lịch sử không được vượt qua.
- `pos-order-edit-ui.test.ts`, `pos-order-edit.test.ts`, `pos-fees.test.ts`, `trial-ui.test.ts` và typecheck.
- `scripts/testing/pos-edit-products.mjs`: Chromium + router/PGlite cục bộ ở 1280px và 390px; xoá/thêm/tăng cùng SKU, lưu đúng một lần khi gửi lặp, số tiền server và vị trí bốn thẻ. Dữ liệu giả, không gọi hệ thống thật.

Không cần migration. Chưa merge/triển khai.

Ảnh: [Form desktop](editor-desktop.png) · [Form điện thoại](editor-mobile.png) · [Bố cục chi tiết đơn](order-layout.png). [Kết quả Chromium](results.json).
