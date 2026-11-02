# Thu tiền mặt CRM: nhân viên giữ → Manager nhận và xác nhận

## Luồng cuối cùng

- Manager hoặc nhân viên có chức vụ `sale`, `sale-admin`, `sales-lock`, `sales-ml` có thể ghi nhận tiền mặt cho đơn/HĐKT CRM trong phạm vi được truy cập, không cần mở két/ca POS.
- Nhân viên bấm thu: tạo `customer_cash_collections.status=held`. Hiện “Tiền mặt nhân viên còn giữ”, người giữ, số tiền và ngày thu khách. Chưa tạo phiếu thu có hiệu lực, chưa tăng Đã thu, chưa giảm công nợ và chưa hoàn tất thanh toán.
- Manager thực nhận tiền, bấm “Xác nhận đã nhận tiền” và xác nhận trong hộp hỏi: tạo đúng một `customer_payments`, chuyển ghi nhận sang confirmed, lưu Manager/thời điểm xác nhận trong cùng transaction. Khi đó mới giảm công nợ. Nhân viên và Kế toán không tự xác nhận được.
- Ngày thu khách ban đầu giữ ở `paid_at`; ngày Manager xác nhận giữ riêng ở `confirmed_at`. Phiếu thu hoàn tất giữ người thu ban đầu, lịch sử bàn giao ghi rõ Manager nhận tiền. Không đổi ngày một cách ngầm định.
- Nếu Manager tự ghi thu tiền mình đã thực nhận, phiếu có hiệu lực ngay. Không tự cộng tiền CRM vào két kể cả người thu có ca POS đang mở.
- Tiền còn giữ được dành riêng trong số có thể thu tiếp, kể cả thu thêm bằng chuyển khoản. Toàn bộ công nợ chỉ hoàn tất khi phiếu thu được xác nhận đủ. Ghi nhận cũ không bị chuyển đổi hoặc đảo tiền tự động.
- Manager được huỷ ghi nhận thu nhầm/tiền đã trả lại khách, bắt buộc lý do và xác nhận; đây không phải luồng chuyển/hoàn tiền tự động. Lịch sử giữ lại. Đã xác nhận thì phải dùng quyền huỷ phiếu thu hiện tại, không huỷ hoặc xác nhận lại ghi nhận cũ để tạo phiếu thứ hai.
- Chặn xác nhận đơn đã huỷ hoặc tiền vượt công nợ hiện tại. Ghi nhận vẫn còn để đối soát, không xóa lặng lẽ. Không xoá hẳn đơn có lịch sử tiền mặt nhân viên giữ.

## Triển khai

Chạy tay **`migrations/postgres/20261102071719_customer_cash_collections.sql` trước khi triển khai API**. Chỉ tạo bảng/index/RLS, không sửa phiếu thu/tiền cũ. Bảng không cho public/anon/authenticated truy cập trực tiếp. `scripts/sql/assert-customer-cash-collections.sql` là kiểm tra chỉ đọc trước deploy; thiếu migration thì dừng deploy API. UI hiện tại đợi API triển khai đúng commit trước khi deploy.

Chưa chạy migration trên production, chưa merge/deploy. Không thay POS/COD/cọc/trả trước, phiên/cron/đồng bộ Sapo hoặc số dư két thật.

## Kiểm chứng

- Test đủ các chức vụ; thu khi két đã có đầu kỳ nhưng không có ca và khi ca đang mở. Nhân viên giữ tiền chưa làm tăng paid, chưa tạo effective payment, không đổi két. Manager nhận thì mới cập nhật công nợ.
- Thu đủ toàn bộ đơn vẫn chưa hoàn tất trước khi Manager xác nhận. Chặn thu thêm vượt số còn có thể thu.
- Gửi đồng thời/gửi lại cùng mã chỉ một ghi nhận. Xác nhận đồng thời/gửi lại chỉ một phiếu thu. Cùng mã khác nội dung bị 409. Chỉ Manager được xác nhận/huỷ ghi nhận.
- Lỗi ghi trạng thái sau khi insert phiếu thu: rollback cả transaction; không có phiếu thu lẻ. Công nợ đổi sau khi thu: chặn xác nhận vượt. Huỷ phiếu thu hoàn lại công nợ, không biến tiền đã bàn giao thành nhân viên còn giữ, không cho xác nhận lại tạo thêm phiếu.
- Bộ test cash, POS, sales, thu trước duyệt, giao diện, kiến trúc và TypeScript đạt. Test kiểm tra SQL gate chạy được trên schema sau migration.
- Browser Chromium local, CRM/router/PGlite bằng dữ liệu giả, chặn mạng browser ra ngoài: Sale 1280px, Sale Admin 390px ghi held; không thấy nút Manager. Manager 1280px thấy hai khoản chờ, xác nhận thực nhận từng khoản thành công; sau đó ghi thu trực tiếp. Két không đổi, không lỗi JS.

Ảnh và results.json là dữ liệu thử local, không phải production. Một số ảnh trạng thái giữ tiền ẩn toast tạm để đọc nội dung. Chưa kiểm tra trên Safari/iPhone thật.
