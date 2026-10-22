# Lịch làm việc của kho

- Thêm `#/receiving` (Lịch nhận hàng) ngay trên Lịch giao hàng. Dùng quyền `page.purchases`; không tự cấp thêm quyền.
- Lấy đơn mua NCC đã duyệt, chưa huỷ và còn thiếu, dùng chung `outstandingLines` với Hàng đang về. Hàng lỗi không tính đã nhận; phiếu nhận đã huỷ không trừ phần còn thiếu. Không trả giá nhập.
- Hẹn từng dòng ưu tiên hơn ngày hẹn trên đơn; nhóm theo đơn + ngày. Có lọc khoảng ngày, NCC, quá hẹn / sắp tới / chưa hẹn, tìm kiếm và phân trang 50 lượt. Chưa hẹn ngày vẫn hiện khi lọc khoảng ngày. Số đếm menu là số đơn còn thiếu; một đơn nhiều ngày chỉ đếm một lần.
- Lịch giao hàng và số đếm loại kênh POS ở API, trước giới hạn danh sách. Chi tiết đơn POS và các thao tác giao/COD của đơn giữ nguyên.
- Nhân viên chức vụ `warehouse` không thấy menu Công việc. Không xoá trang, việc, thông báo hoặc lịch sử.
- Sổ kho của chức vụ `warehouse` chỉ có kho thật đang hoạt động với tên chứa `vigifts` (không phân biệt hoa thường). Mặc định chọn kho này; API so tồn, thẻ kho, điều chỉnh/chốt đầu kỳ nếu đã được cấp quyền cũng kiểm phạm vi. Không tìm thấy kho phù hợp thì trả rỗng, không mở rộng về toàn bộ kho. Quyền và phạm vi Manager giữ nguyên. Tra tồn và các bộ chọn kho nhận/điều chuyển giữ quy tắc riêng hiện có.

## Kiểm tra

Typecheck, UI build; PostgreSQL/API: tồn kho/phạm vi quyền, nhận một phần, hàng lỗi, huỷ phiếu nhận, đơn nháp/huỷ/đã đủ không lên lịch, ngày hẹn từng dòng, chưa hẹn, lọc/tìm/phân trang, quyền trang, POS loại khỏi lịch và badge nhưng vẫn có trong chi tiết đơn. Chromium: giao diện desktop/mobile, lọc và link đơn mua.

Không cần migration. Không ghi hoặc thay đổi dữ liệu CRM production.
