# Nhận hàng nhanh theo phiếu xin

## Trước và sau

Nút “Nhận theo phiếu · mã đơn mua” trước đây điều hướng sang drawer đơn mua rồi qua bước chọn Sapo và form nhận hàng. Dù API đã có phạm vi phiếu xin, cách mở này dễ khiến người dùng hiểu là nhập cả đơn mua.

Nút mới “Nhận hàng nhanh” nằm trong thẻ phiếu NCC và mở form tại chỗ, trên cả trang Lấy hàng trước lẫn phần lịch sử phiếu trong Hàng đang về. Không mở drawer đơn mua, không đổi URL. Form có mã phiếu xin/NCC, chỉ các mã và lượng còn nhận của thẻ đang chọn; chọn ngày, kho, Có/Không tạo đơn nhập Sapo rồi xác nhận.

## Phạm vi và ghi nhận

- Chỉ hiện khi có quyền nhận, phiếu đã gửi và có phân bổ NCC đồng ý/còn lượng nhận. Cổng NCC và người không có quyền nhận không có nút.
- Nạp `/purchase-early-requests/:id/receiving?orderId=...`, giao với SKU/nguồn thuộc đúng thẻ. Giới hạn lượng nhập theo cả phiếu xin và số còn nhận của đơn mua. Không nạp toàn bộ dòng đơn mua vào form.
- Gửi API nhận hàng hiện có kèm earlyRequestId, đúng lineId nguồn, số hàng đạt và kho chọn. Máy chủ kiểm tra lại quyền/phạm vi/số lượng và ghi ledger hiện có. Phần còn nhận của đơn mua được cập nhật từ phiếu nhận, không sửa số lượng đặt hoặc công thức tiền.
- Nhận nhanh dành cho hàng đạt; không nhập hàng hỏng qua form này. Chọn Không chỉ nhập CRM; chọn Có tạo outbox Sapo theo luồng hiện có.
- Một thẻ có nhiều đơn nguồn thì mỗi nguồn lưu một phiếu nhận. Giữ clientKey và toàn bộ nội dung lượt nhận sau lần gửi đầu. Nếu lỗi giữa chừng, hiển thị số nguồn đã xác nhận; Thử lại bỏ qua nguồn đã thành công và dùng lại cùng khoá cho nguồn chưa rõ kết quả. Không sửa nội dung đang retry. Đóng lượt chưa hoàn tất có xác nhận và tải lại dữ liệu.
- Không đổi API, schema, quyền, tồn đầu kỳ hoặc công thức tiền/thuế. Không nhận hàng trên production khi kiểm thử.

## Validation

- Typecheck, build UI, syntax/diff checks: đạt.
- 22 test liên quan đạt: Manager UI (4), receiving (5), partial split/ownership (4), supplier slip/batch (2), mobile action policy (2), trial UI (5).
- Browser thật + router/PGlite: 360/390/430/768/1280px, không lỗi JS/tràn ngang hoặc mất focus sau refresh. Nút lưu nằm trong viewport. Đóng form trước xác nhận không ghi dữ liệu.
- Fixture xin 52, nhận 7: chỉ một purchase_line được nhận, phiếu còn 45, đơn mua giảm còn nhận đúng 7, dòng ngoài phiếu giữ nguyên, kho chỉ cộng 7. Bấm gửi hai lần chỉ lưu một lần. Không tạo job Sapo khi chọn chỉ CRM.
- Fixture một thẻ gộp hai đơn nguồn: chỉ nhận 2 + 3 hàng đạt của NCC chọn; SKU thuộc thẻ NCC khác không được gửi. Mô phỏng HTTP 503 sau khi nguồn thứ hai đã commit, rồi Thử lại: tổng kho vẫn chỉ cộng 5, nguồn đầu không gửi lại, nguồn sau dùng đúng body/clientKey cũ. Chọn Có tạo đúng hai job Sapo trong DB thử; không gọi Sapo thật.
- Kiểm tra cả trang Lấy hàng trước và URL cũ của Hàng đang về. Toàn bộ test chạy tiếp trên CI.

Ảnh và results.json chỉ chứa fixture cục bộ. Chạy browser: `PLAYWRIGHT_MODULE=/tmp/pos-browser/node_modules/playwright/index.mjs node --import tsx scripts/testing/early-quick-receive.mjs`.
