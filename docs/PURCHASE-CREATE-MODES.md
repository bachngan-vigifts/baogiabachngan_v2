# Lập đơn mua: theo chứng từ hoặc mua bổ sung

- `+ Lập đơn mua` và `#/purchases/new` mở popup chọn nhu cầu.
- Mua theo đơn / báo giá: giữ tìm kiếm và quyền chứng từ hiện có; thêm tải tiếp theo từng nhóm chứng từ (8 dòng/nhóm/lượt), thứ tự ngày và ID ổn định. Link có `type`/`id` vẫn mở thẳng chứng từ nguồn.
- Mua bổ sung: dùng `/products` hiện có, 30 sản phẩm/lượt; tìm mã/tên, chọn nhiều sản phẩm. Các trang dùng chung dòng đơn nháp nên không mất mã hoặc số lượng khi tìm lại. Bỏ dòng ở bảng chia NCC cũng bỏ tích trong danh mục. Nhập SL ở bảng chia NCC, mỗi mã là số nguyên dương.
- Cả hai dùng API tạo đơn mua và quy trình duyệt hiện có, không thêm schema hoặc tự duyệt. Nhân viên lưu nháp, Manager giữ hành vi gửi chờ duyệt giá hiện tại.
- POS: bỏ hai lối tắt “Đặt cọc · Nhận sau” / “Ship trả trước 100%” trong popup thanh toán. Thêm “← Về CRM” cạnh tiêu đề, chuyển tới `#/tasks`.

## Kiểm tra

Kiểm thử DOM mới: lựa chọn/hủy popup, phân trang/tìm kiếm giữ lựa chọn, SKU có số 0 đầu, tên độc hại chỉ là văn bản, phản hồi cũ, đóng picker, lỗi tải và thử lại. Kiểm thử API: 19 báo giá qua nhiều trang không trùng/thiếu, tìm kiếm, offset sai, chặn tài khoản NCC, mua bổ sung không có chứng từ vẫn giữ SKU và số lượng.

Chạy bộ purchasing, POS UI, tra cứu mã thủ công, module mới, trial UI, typecheck và ui:build. Không tạo đơn hay gửi yêu cầu trên production; chưa kiểm tra trực quan bằng Chromium trong môi trường này.
