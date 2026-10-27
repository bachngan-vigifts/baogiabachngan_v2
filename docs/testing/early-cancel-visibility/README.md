# Huỷ/xoá trong từng phiếu NCC

## Lỗi và hành vi sau sửa

“Huỷ phiếu và xoá” trước đây nằm ngoài các thẻ NCC và dùng class không có màu/nền nên trông như chữ thường. Đặt nút đỏ, chữ trắng vào ngay đầu nội dung **từng thẻ phiếu NCC**, không gom vào menu ⋮. Bỏ nút xoá toàn bộ ở thanh thao tác chi tiết. Danh sách giữ nút đỏ trên từng phiếu gốc với xác nhận đầy đủ phạm vi.

Bấm nút trong thẻ NCC chỉ huỷ phiếu NCC đó, kể cả NCC đã đồng ý. Xác nhận chỉ liệt kê nguồn và mã thuộc phiếu đang chọn. Các phiếu NCC còn lại giữ nguyên số lượng/trạng thái, tiếp tục hiện trên màn hình; khi huỷ hết mới trở về danh sách.

## Xử lý và giới hạn

- Endpoint POST `/purchase-early-requests/:id/cancel-slip` chỉ dành cho Manager, kiểm tra tập allocationIds là toàn bộ một nhóm NCC/số đơn NCC. Từ chối tập thiếu, trộn nhóm hoặc nguồn đã đổi.
- Dùng giao dịch có khoá và cơ chế tách/xoá hiện có: nếu phiếu gốc chứa nhiều nhóm, tách thành phiếu NCC rồi chỉ xoá mềm phiếu đích. Giữ lịch sử, ghi audit; link phiếu gốc tiếp tục mở các phiếu còn lại. Tách và huỷ cùng giao dịch, không để kết quả tách một phần nếu thất bại.
- Giữ chặn nhận hàng hiện có: phiếu gốc đã có lịch sử nhận hàng không được tách/huỷ để đối soát. Không nới quyền, đổi schema hay ghi bút toán tồn kho, thanh toán, Sapo/GHN.
- Dùng variant nút `primary danger-bg` sẵn có ở danh sách, từng thẻ chi tiết và nút xác nhận.

## Validation

- Typecheck, build UI, diff check đạt.
- 10 test liên quan đạt: delete/split/cancel-slip (5), Manager UI (4), danh sách/phân trang (1). Bao gồm quyền Manager, giữ số lượng/trạng thái nhóm khác, gọi lại không huỷ thêm, chặn nhận hàng, từ chối tập mã thiếu hoặc trộn nhiều phiếu, không ghi stock_moves.
- Hai browser script `early-list-actions.mjs` và `early-cancel-delete.mjs` chạy với router/PGlite cục bộ: danh sách và chi tiết ở 390/1280px, nền đỏ; xác nhận trước khi ghi; nhóm đã NCC đồng ý; huỷ lần lượt ba phiếu chỉ mất đúng phiếu chọn, giữ các phiếu khác và trở về danh sách khi hết; tài khoản kho không có nút; tồn không đổi; không lỗi JavaScript.
- Ảnh đính kèm dùng dữ liệu thử cục bộ. Không xoá phiếu thật. Bộ test đầy đủ chạy tiếp trên CI.
