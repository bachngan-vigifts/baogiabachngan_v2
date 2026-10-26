# Xoá và tách phiếu xin hàng theo số NCC

## Hành vi

- File xin hàng gửi `groupBySupplierOrder: true`: server phân giải nguồn theo quy tắc hiện hành, tạo các phiếu riêng theo **NCC + số đơn NCC** trong cùng transaction. Số trùng ở NCC khác tách riêng; chưa có số NCC thì theo đơn CRM. Mỗi phiếu có ID, mã hàng, SL, nguồn và luồng gửi/nhận độc lập. Không chỉ chia thẻ hiển thị.
- Cùng client key trả lại các phiếu đã tạo, không tạo lần hai. Một dòng sai làm rollback toàn bộ lần lưu. UI hiện link mở từng phiếu để kiểm tra/gửi NCC.
- Phiếu cũ nhiều số NCC có nút Manager **Tách thành n phiếu NCC**, xem các nguồn rồi xác nhận. Giữ số lượng, ngày lấy, trạng thái phản hồi và người đã phản hồi. ID cũ trỏ tới các phiếu con khi đọc qua CRM/cổng NCC theo phạm vi quyền. Không tự ghi production khi mở trang.
- Manager có nút **Xoá phiếu** và hộp xác nhận. Phiếu cũ chưa tách ghi rõ **Xoá toàn bộ phiếu gốc**, liệt kê nguồn/số mã. Xoá mềm, lưu actor/thời điểm/snapshot audit, không xoá đơn mua hoặc bút toán kho.
- Phiếu có receive event tham chiếu chính nó bị chặn xoá/tách, kể cả lịch sử nhận hỏng hoặc đã huỷ nhận. Khoá đơn mua cùng giao dịch giúp đối soát với lần nhận đồng thời.
- Phiếu đã xoá không xuất hiện trong danh sách, lịch nhận, hàng đang về hoặc cổng NCC; không sửa/gửi/xác nhận/nhận tiếp được. Gửi lại key cũ không hồi sinh phiếu đã xoá.
- Ô tick đứng trước số phiếu. Nháp xám, chờ NCC vàng, đồng ý xanh, từ chối đỏ, hỗn hợp tím; giữ nhãn chữ ở danh sách và chi tiết.

## Nhận đúng phần xin và lựa chọn Sapo

Hộp trước khi nhận có **Có — tạo đơn nhập Sapo**, **Không — chỉ nhập CRM**, và Đóng để thoát. Lựa chọn gửi dưới dạng boolean `createSapo`, lưu trên phiếu nhận và receive audit. Không: vẫn cộng hàng đạt vào kho CRM/giảm phần còn thiếu đơn mua, trạng thái Sapo `not_needed`, không queue/dispatch job; chặn đối soát Sapo tự tạo job cho phiếu này. Có: giữ outbox/claim/callback hiện hành. API cũ không gửi cờ vẫn mặc định Có; cùng client key đổi lựa chọn bị từ chối, không tạo lại phiếu nhận.

Nút trên phiếu là **Nhận theo phiếu · DMH…**. Form chỉ lấy các mã/SL còn được nhận trong request + đơn nguồn; giữ phạm vi khi đóng hộp Sapo và bấm Nhận hàng lần nữa, tải lại lượng còn lại trước mở form. Server chặn dòng ngoài phiếu và vượt lượng. Nhận vào phiếu hiện có của CRM, không tạo một luồng cộng kho khác; đơn mua gốc chỉ giảm đúng phần đã nhận.

## API và triển khai

- POST `/purchase-early-requests` giữ hợp đồng cũ khi không bật gom; khi bật trả `requestIds`, `requests`, `request` đầu tiên và ID gốc của lần lưu.
- POST `/purchase-early-requests/:id/split`: Manager, replay không sinh thêm con.
- DELETE `/purchase-early-requests/:id`: Manager, replay an toàn; không cascade sang các phiếu con nếu gọi lại ID gốc đã tách.
- Migration `20261026080503_early_request_delete_split.sql`: thêm `deleted_at/deleted_by`, index FK và `supplier_receipts.create_sapo`. Workflow chạy trước API; UI tiếp tục đợi API theo release gate.

Kiểm thử PGlite: chia nhóm/lưu thật, giữ 0 đầu, không lẫn NCC, replay, lịch sử phản hồi, quyền, xoá mềm/audit, chặn nhận hàng và hồi sinh; hồi quy file, Manager, nhận hàng và migration. Chromium 390/1280 dùng router thật/PGlite kiểm tách, xoá, vị trí checkbox và màu trạng thái.

Chưa deploy; không tách/xoá/xác nhận phiếu thật hoặc thay đổi tồn production trong tác vụ.
