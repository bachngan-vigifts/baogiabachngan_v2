# Tài chính & KPI

Trang `#/finance` nằm ở Nhân sự & quản trị (điện thoại: menu Quản trị). Chỉ Manager được vào trang và các API tài chính mới. Dùng khung giao diện CRM hiện có, không chuyển stack hay tạo bảng mới.

## Cách xem

1. Chọn ngày bắt đầu, ngày kết thúc và chi nhánh; bấm **Xem báo cáo**. Tối đa 366 ngày/lượt. Mặc định từ đầu tháng đến hôm nay theo giờ Việt Nam.
2. Dòng tiền trong kỳ và công nợ hiện tại tải lần lượt. Mỗi phần ghi thời điểm tính. **Làm mới số liệu** bỏ bản tính sẵn; không sửa chứng từ.
3. Bấm **Tính lợi nhuận** khi cần. Dùng cùng tính toán và cache với Phân tích lợi nhuận; không tự chạy nền. Không tự tính kỳ trước.
4. Chọn **Tháng KPI**, bấm **Xem KPI**, chọn nhân viên. Bộ lọc chi nhánh không phân bổ KPI; điểm lấy nguyên từ nguồn bảng lương. Phân biệt tổng điểm thực tế, điểm dùng tính thưởng, KPI cố định/điều chỉnh và phiếu đã chốt.

## Ý nghĩa và giới hạn số liệu

- **Phạm vi nguồn:** chỉ chứng từ đã ghi vào sổ CRM (`sales_orders`, phiếu thu/chi liên quan). Đơn web ở `web_store_orders` chưa chuyển thành đơn CRM chưa được tính; không ghép thêm rồi đếm trùng với đơn đã chuyển.
- **Doanh thu thuần:** ngày đơn, chưa VAT, trừ hàng trả có hiệu lực công nợ; dùng nguyên quy tắc `/profit`.
- **Chi phí đã ghi nhận / lợi nhuận tạm tính:** cùng nguồn lợi nhuận hiện hành. Biên trên doanh thu đủ giá vốn cộng thu phí khách. Không gọi là lãi ròng kế toán. Thiếu giá vốn, phí hãng vận chuyển hoặc đối soát nhân sự không khớp thì không hiện tổng chi phí/lợi nhuận/biên. Giá vốn ước tính hoặc tính lại được chú thích.
- **Tháng lẻ:** phần chi phí nhân sự tháng lẻ chưa được tính theo quy tắc lợi nhuận hiện có; trang ghi rõ. Chi nhánh không tự nhận chi phí chung hay lương Sale chưa phân bổ. Văn phòng và phí thẻ còn thiếu được ghi chú riêng.
- **Tiền vào/ra:** ngày chứng từ, không phải ngày đơn hay chi phí kế toán. Phiếu thu huỷ và tiền đổi hàng dùng cấn trừ công nợ không tính là tiền vào. Phiếu hoàn tiền liên kết với sổ quỹ tính một lần. Chuyển quỹ nội bộ và điều chỉnh sổ để riêng.
- **Phiếu thủ công trả NCC / hoàn khách chưa liên kết:** có nguy cơ trùng chứng từ; đánh dấu cần đối chiếu và không hiện tổng tiền ra/dòng tiền thuần như số đã xác nhận. Bảng phương thức chỉ là tổng chứng từ đã ghi, chưa phải đối soát ngân hàng.
- **GHN đã thu COD / phương thức khác:** chưa xác nhận tiền về công ty thì để riêng, không cộng vào tiền vào. Thu/trả NCC có phương thức `other` không coi mặc định là tiền mặt/ngân hàng. Công nợ vẫn dùng nguyên ghi nhận thanh toán hiện có.
- **Chi nhánh dòng tiền:** theo nơi phát sinh đơn hoặc ca quỹ. Trả NCC chưa có nguồn phân bổ đáng tin cậy: tổng công ty có tính, lọc chi nhánh thì loại và nêu riêng số chưa gán.
- **Công nợ hiện tại:** dư phải thu dương, loại đơn huỷ/nháp chưa ký, dùng cùng quy tắc lịch thu/phiếu thu/hoàn hàng của Công nợ. Ngày lọc phía trên không biến số này thành dư cuối kỳ quá khứ. Tiền khách dư không bù chéo sang nợ đơn khác.
- **DSO, điểm hòa vốn, vốn lưu động, số dư tiền cuối kỳ:** chưa đủ dữ liệu để tính; không dùng số minh hoạ hay thay bằng 0.

## Cấu trúc và bảo vệ hiệu năng

- `src/app/finance-*`: ghép nguồn có sẵn, kiểm tra ngày và chi nhánh, các GET chỉ Manager. Truy vấn tham số qua Drizzle, không SQL từ chuỗi đầu vào.
- Các phép đọc tài chính mới chạy trong transaction chỉ đọc, repeatable read; mỗi statement tối đa 6 giây. Không thay đổi chứng từ nguồn.
- Dòng tiền: 4 truy vấn nguồn theo lô. Công nợ: truy vấn theo lô, không gọi API từng đơn; không dùng tổng trang đầu giới hạn 2.000 dòng. Vượt 10.000 đơn/phiếu quỹ trong phạm vi thì báo lỗi yêu cầu thu hẹp, không cắt rồi trả tổng thiếu.
- Cache tài chính mới 60 giây. Lợi nhuận/KPI dùng cache hiện có 30 phút; từng phần ghi thời điểm tính. Bấm làm mới rồi xem lại phần lợi nhuận/KPI để yêu cầu tính mới.
- `/profit?view=overview` chỉ lược bỏ chi tiết khỏi phản hồi, không đổi công thức. Dùng chung cache với phản hồi đầy đủ (tham số `view` không tạo bản tính khác).
- JS và CSS trang tài chính chỉ tải khi vào trang; không thêm polling. Luồng API trang chạy tuần tự, ngừng bước tiếp theo khi đổi trang/đăng xuất, bỏ phản hồi cũ. Không gửi API theo từng lần sửa ô lọc.
- Không migration, không đụng đăng nhập, kết nối CSDL, cron hay đồng bộ.

## Kiểm thử

- `tests/app/finance-overview.test.ts`: quyền, ngày, chi nhánh, thu/chi, phiếu huỷ, cấn trừ, hoàn tiền trùng, ranh giới ngày VN, cache, công nợ/hàng trả, trên 2.000 đơn, số truy vấn cố định, lỗi nguồn và projection lợi nhuận.
- `tests/app/finance-ui.test.ts`: cách hiển thị số thiếu, tháng lẻ, chi phí chung, số 0, KPI, ngày VN, lazy import và quyền Manager.
- Hồi quy profit, dashboard-kpi, report-cache, login-focus, trial-ui, mobile-nav và architecture.
- `scripts/testing/finance-page.mjs`: Chromium + CRM router + PGlite giả; desktop/điện thoại, bộ lọc, quyền, tổng tiền, tải theo yêu cầu, lỗi/thử lại và phản hồi trễ. Không dùng production.
