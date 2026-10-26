# Huỷ nhanh bill POS — Manager

Theo yêu cầu anh Thái: chỉ ghi sổ CRM, Sapo/GHN xử lý thủ công. Không gọi hệ thống ngoài hoặc tự chuyển tiền ngân hàng.

Từ chi tiết đơn POS, Manager bấm **Huỷ phiếu nhanh**, xem hàng/kho/số tiền/phương thức gốc, chọn ca đúng quầy/két, nhập lý do và xác nhận đã thu hồi đủ hàng nguyên vẹn, đã hoàn tiền thực tế. Chuyển khoản bắt buộc mã giao dịch thực hoàn. Nếu chưa có ca mở đúng quầy/két thì chặn.

Một transaction khoá két và đơn: tạo phiếu trả đã duyệt/nhận, nhập đúng lượng vào kho gốc, ghi hoàn đủ tiền hàng/phí/VAT bằng phiếu hoàn (tiền mặt có phiếu chi; chuyển khoản không trừ két tiền mặt), đổi đơn thành huỷ và lưu audit/idempotency marker. Không xoá phiếu thu gốc, không sửa báo cáo ca đã chốt. Báo cáo giữ giá trị bill gốc và đối ứng giá trị trả đúng một lần, các khoản trả/hoàn tôn trọng mốc thời gian báo cáo.

Phạm vi: bill POS tại quầy đã giao đủ/thu đủ, chưa có đổi/trả/hoàn, không thanh toán bằng tín dụng đổi hàng, chưa xuất hoá đơn, xuất kho khớp snapshot. Đơn cọc/ship, trả một phần, hàng hỏng, chứng từ hoặc tiền lệch dùng luồng Trả / Đổi / Hoàn tiền hiện có để đối soát; không suy đoán kho/tiền.

Chống lặp: cùng key/nội dung trả kết quả đã xử lý; key/nội dung khác sau huỷ bị chặn. Kiểm tra quyền Manager ở server, không chỉ giấu nút.

Kiểm thử: `tests/app/pos-quick-cancel.test.ts` chạy router/PGlite thật, cash/bank, quyền/xác nhận/revision/tham chiếu, gửi đồng thời, replay, báo cáo lịch sử và rollback khi lỗi sau ghi kho. `scripts/testing/pos-quick-cancel.mjs` chạy CRM/router thật tại localhost ở 390/1280px, yêu cầu xác nhận trước POST và đúng một lần ghi. Không thao tác đơn production.
